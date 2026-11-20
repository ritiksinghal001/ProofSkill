import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommits, parseGithubUrl, resolveGithub, GithubError } from './snapshot.ts';
import { classifyHistory } from './history.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

test('url parsing: owner, repo, branch from /tree/, rejects non-github and malformed', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/a/b.git'), { owner: 'a', repo: 'b', branch: undefined });
  assert.equal(parseGithubUrl('https://github.com/a/b/tree/feat/x').branch, 'feat/x');
  assert.throws(() => parseGithubUrl('https://gitlab.com/a/b'), GithubError);
  assert.throws(() => parseGithubUrl('http://github.com/a/b'), GithubError);
  assert.throws(() => parseGithubUrl('https://github.com/a'), GithubError);
});

test('a rate-limited commit detail call fails loudly instead of shrinking the sample into a "limited" verdict', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string) => (String(u).includes('per_page') ? json([{ sha: 'a1', commit: { author: { date: '2026-01-01T00:00:00Z' } } }]) : json({ message: 'rate limit' }, 403))) as typeof fetch;
  try { await assert.rejects(fetchCommits('o', 'r', 'sha'), /rate limit/); } finally { globalThis.fetch = real; }
  assert.equal(classifyHistory(null, 'Commit history could not be retrieved.').cls, 'UNAVAILABLE');
});

test('redirects to unapproved hosts are blocked and credentials never leave api.github.com', async () => {
  const real = globalThis.fetch; const seen: Record<string, string>[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { seen.push(init.headers); return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }); }) as typeof fetch;
  try { await assert.rejects(resolveGithub('https://github.com/a/b'), /unapproved host|could not be reached/); } finally { globalThis.fetch = real; }
  assert.equal(seen.length, 1); // the second hop was never made
});

test('private or missing repository gives a clear, actionable message', async () => {
  const real = globalThis.fetch; globalThis.fetch = (async () => json({}, 404)) as typeof fetch;
  try { await assert.rejects(resolveGithub('https://github.com/a/b'), /private.*ZIP/s); } finally { globalThis.fetch = real; }
});

test('history rubric: single bulk commit and thin history are LIMITED; steady progression is SUFFICIENT', () => {
  const c = (d: string, files: [string, number][]) => ({ sha: d, date: `2026-01-0${d}T00:00:00Z`, files: files.map(([name, additions]) => ({ name, additions })) });
  assert.equal(classifyHistory([c('1', [['a.js', 500]]), c('2', [['a.js', 5]]), c('3', [['a.js', 5]]), c('4', [['a.js', 5]])]).cls, 'LIMITED');
  assert.equal(classifyHistory([c('1', [['a.js', 20]]), c('2', [['b.js', 30]])]).cls, 'LIMITED');
  assert.equal(classifyHistory([c('1', [['a.js', 40]]), c('2', [['b.js', 30]]), c('3', [['c.jsx', 30]]), c('4', [['a.js', 20]])]).cls, 'SUFFICIENT');
});
