// Safe ZIP extraction into an immutable, hash-manifested snapshot. Nothing here installs dependencies or runs project code.
import yauzl from 'yauzl';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { sha256 } from './db.ts';

export class SnapshotError extends Error {
  constructor(public code: 'UNSUPPORTED_FILE' | 'PROJECT_TOO_LARGE' | 'UNPROCESSABLE', message: string) { super(message); }
}
export interface ManifestFile { path: string; storage: string; hash: string; bytes: number; lines: number }
export interface Manifest { files: ManifestFile[]; skipped: { path: string; reason: string }[]; archiveHash: string; entryCount: number; truncated: boolean }

const TEXT_EXT = /\.(jsx?|tsx?|mjs|cjs|json|sql|md|html|css)$/i;
const EXCLUDED = /(^|\/)(node_modules|dist|build|coverage|\.git|\.next|vendor)(\/|$)|\.min\.(js|css)$|(^|\/)package-lock\.json$|(^|\/)\.env(\.|$)/i;
const SECRET = /(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{6,}['"])/gi;
export const redactSecrets = (s: string) => s.replace(SECRET, '[REDACTED]');

const MB = 1024 * 1024;

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('no stream'));
      const chunks: Buffer[] = []; let n = 0;
      stream.on('data', (c: Buffer) => {
        n += c.length;
        if (n > cap) { stream.destroy(); reject(new SnapshotError('PROJECT_TOO_LARGE', 'A file expanded beyond the allowed size.')); } else chunks.push(c);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

/** Validates entries while streaming decompression; limits are enforced on real bytes, not only archive metadata. */
export async function extractZipToSnapshot(zipBuf: Buffer, destDir: string): Promise<Manifest> {
  if (zipBuf.length > config.MAX_ZIP_MB * MB) throw new SnapshotError('PROJECT_TOO_LARGE', `ZIP is larger than ${config.MAX_ZIP_MB} MB.`);
  if (zipBuf.subarray(0, 2).toString('latin1') !== 'PK') throw new SnapshotError('UNSUPPORTED_FILE', 'This is not a ZIP archive.');
  const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.fromBuffer(zipBuf, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (e, z) => (e || !z ? rej(new SnapshotError('UNSUPPORTED_FILE', 'The ZIP could not be read.')) : res(z))));
  fs.mkdirSync(destDir, { recursive: true });
  const files: ManifestFile[] = []; const skipped: Manifest['skipped'] = [];
  let entryCount = 0, totalBytes = 0, truncated = false;
  const staged: { rel: string; data: Buffer }[] = [];

  await new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) => {
      zip.close();
      if (e instanceof SnapshotError) return reject(e);
      const m = String((e as Error)?.message ?? '');
      reject(new SnapshotError('UNSUPPORTED_FILE', /relative path|absolute path|invalid characters/i.test(m) ? 'The ZIP contains an unsafe path.' : 'The ZIP could not be read.'));
    };
    zip.on('error', fail);
    zip.on('end', () => resolve());
    zip.on('entry', async (entry: yauzl.Entry) => {
      try {
        entryCount++;
        if (entryCount > config.MAX_ZIP_ENTRIES) throw new SnapshotError('PROJECT_TOO_LARGE', `More than ${config.MAX_ZIP_ENTRIES} entries.`);
        const name = entry.fileName.replace(/\\/g, '/');
        if (entry.isEncrypted()) throw new SnapshotError('UNSUPPORTED_FILE', 'Encrypted ZIP entries are not allowed.');
        if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.includes('\0'))
          throw new SnapshotError('UNSUPPORTED_FILE', 'The ZIP contains an unsafe path.');
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode === 0xa000) throw new SnapshotError('UNSUPPORTED_FILE', 'Symbolic links are not allowed in the ZIP.');
        if (name.endsWith('/')) return zip.readEntry();
        if (EXCLUDED.test(name)) { skipped.push({ path: name, reason: 'excluded (dependencies, build output or secrets)' }); return zip.readEntry(); }
        if (!TEXT_EXT.test(name)) { skipped.push({ path: name, reason: 'not an analysed source type' }); return zip.readEntry(); }
        if (/\.zip$/i.test(name)) { skipped.push({ path: name, reason: 'nested archives are not extracted' }); return zip.readEntry(); }
        if (entry.uncompressedSize > config.MAX_FILE_MB * MB) { skipped.push({ path: name, reason: `larger than ${config.MAX_FILE_MB} MB` }); truncated = true; return zip.readEntry(); }
        const data = await readEntry(zip, entry, config.MAX_FILE_MB * MB);
        totalBytes += data.length;
        if (totalBytes > config.MAX_EXTRACTED_MB * MB) throw new SnapshotError('PROJECT_TOO_LARGE', `Extracted size is over ${config.MAX_EXTRACTED_MB} MB.`);
        if (data.includes(0)) { skipped.push({ path: name, reason: 'binary content' }); return zip.readEntry(); }
        staged.push({ rel: name, data });
        zip.readEntry();
      } catch (e) { fail(e); }
    });
    zip.readEntry();
  });

  // strip one shared root folder (GitHub archives and most ZIPs have one)
  const roots = new Set(staged.map((s) => s.rel.split('/')[0]));
  const strip = roots.size === 1 && staged.every((s) => s.rel.includes('/')) ? [...roots][0] + '/' : '';
  staged.forEach((s, i) => {
    const rel = s.rel.slice(strip.length);
    const storage = `f${String(i).padStart(5, '0')}.src`; // generated storage name: user filenames are data, never paths
    fs.writeFileSync(path.join(destDir, storage), s.data);
    files.push({ path: rel, storage, hash: sha256(s.data), bytes: s.data.length, lines: s.data.toString('utf8').split('\n').length });
  });
  if (files.length === 0) throw new SnapshotError('UNPROCESSABLE', 'No analysable source files were found in the project.');
  const manifest: Manifest = { files, skipped, archiveHash: sha256(zipBuf), entryCount, truncated };
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

export function readSnapshotFile(dir: string, m: Manifest, rel: string): string | null {
  const f = m.files.find((x) => x.path === rel);
  return f ? fs.readFileSync(path.join(dir, f.storage), 'utf8') : null;
}

/** Every evidence reference must resolve against the selected snapshot: path exists, hash matches, range is inside the file. */
export function validateRef(dir: string, m: Manifest, ref: { path: string; hash: string; startLine: number; endLine: number }): boolean {
  const f = m.files.find((x) => x.path === ref.path);
  if (!f || f.hash !== ref.hash) return false;
  const content = fs.readFileSync(path.join(dir, f.storage));
  if (sha256(content) !== f.hash) return false;
  return ref.startLine >= 1 && ref.endLine >= ref.startLine && ref.endLine <= f.lines;
}

// ---- GitHub (public repositories only; private access is not implemented) ----
const ALLOWED_HOSTS = new Set(['api.github.com', 'codeload.github.com']);
export class GithubError extends Error { constructor(public code: 'REPOSITORY_INACCESSIBLE' | 'UNPROCESSABLE', message: string) { super(message); } }

export function parseGithubUrl(url: string): { owner: string; repo: string; branch?: string } {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') throw new GithubError('UNPROCESSABLE', 'Use an HTTPS github.com repository URL.');
  const [owner, repoRaw, kind, ...rest] = u.pathname.split('/').filter(Boolean);
  const repo = repoRaw?.replace(/\.git$/, '');
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new GithubError('UNPROCESSABLE', 'Could not read owner and repository from the URL.');
  return { owner, repo, branch: kind === 'tree' && rest.length ? rest.join('/') : undefined };
}

async function ghFetch(url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new GithubError('REPOSITORY_INACCESSIBLE', 'Blocked a redirect to an unapproved host.');
    const headers: Record<string, string> = { 'User-Agent': 'proof-of-skill-assessment', Accept: accept };
    if (config.GITHUB_TOKEN && host === 'api.github.com') headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`; // never forwarded to other hosts
    const res = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location')!, current).toString(); continue; }
    return res;
  }
  throw new GithubError('REPOSITORY_INACCESSIBLE', 'Too many redirects.');
}

export async function resolveGithub(url: string, branch?: string) {
  const p = parseGithubUrl(url);
  const meta = await ghFetch(`https://api.github.com/repos/${p.owner}/${p.repo}`).catch(() => { throw new GithubError('REPOSITORY_INACCESSIBLE', 'GitHub could not be reached. Try again or upload a ZIP.'); });
  if (meta.status === 404) throw new GithubError('REPOSITORY_INACCESSIBLE', 'Repository not found or private. Only public repositories are supported. You can upload a ZIP instead.');
  if (meta.status === 403 || meta.status === 429) throw new GithubError('REPOSITORY_INACCESSIBLE', 'GitHub rate limit reached. Try again later or upload a ZIP.');
  if (!meta.ok) throw new GithubError('REPOSITORY_INACCESSIBLE', `GitHub returned ${meta.status}.`);
  const info = (await meta.json()) as { default_branch: string; size: number };
  const br = branch ?? p.branch ?? info.default_branch;
  const c = await ghFetch(`https://api.github.com/repos/${p.owner}/${p.repo}/commits/${encodeURIComponent(br)}`);
  if (!c.ok) throw new GithubError('REPOSITORY_INACCESSIBLE', `Branch "${br}" could not be resolved.`);
  const commit = ((await c.json()) as { sha: string }).sha;
  return { ...p, branch: br, commit, sizeKb: info.size };
}

export async function downloadGithubArchive(owner: string, repo: string, commit: string): Promise<Buffer> {
  const res = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${commit}`, 'application/vnd.github+json');
  if (!res.ok) throw new GithubError('REPOSITORY_INACCESSIBLE', `Archive download failed (${res.status}).`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > config.MAX_ZIP_MB * MB) throw new SnapshotError('PROJECT_TOO_LARGE', `Repository archive is larger than ${config.MAX_ZIP_MB} MB.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > config.MAX_ZIP_MB * MB) throw new SnapshotError('PROJECT_TOO_LARGE', `Repository archive is larger than ${config.MAX_ZIP_MB} MB.`);
  return buf;
}

export interface CommitInfo { sha: string; date: string; files: { name: string; additions: number }[] }
export async function fetchCommits(owner: string, repo: string, sha: string, max = 20): Promise<CommitInfo[]> {
  const list = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${sha}&per_page=${max}`);
  if (!list.ok) throw new GithubError('REPOSITORY_INACCESSIBLE', `Commit list failed (${list.status}).`);
  const items = (await list.json()) as { sha: string; commit: { author: { date: string } } }[];
  const out: CommitInfo[] = [];
  for (const it of items) {
    const d = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${it.sha}`);
    // A failed detail call (rate limit, outage) must not shrink the sample and be misread as a thin history.
    if (!d.ok) throw new GithubError('REPOSITORY_INACCESSIBLE', d.status === 403 || d.status === 429 ? 'GitHub rate limit reached while reading commits.' : `Commit detail failed (${d.status}).`);
    const j = (await d.json()) as { files?: { filename: string; additions: number }[] };
    out.push({ sha: it.sha, date: it.commit.author.date, files: (j.files ?? []).map((f) => ({ name: f.filename, additions: f.additions })) });
  }
  return out;
}
