// Static analysis (never executes code). Versioned rules turn a snapshot into narrow, referenced evidence records.
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import fs from 'node:fs';
import path from 'node:path';
import type { EvidenceClass } from '@proof/contracts';
import { redactSecrets, type Manifest } from './snapshot.ts';

const traverse: typeof _traverse = ((_traverse as any).default ?? _traverse) as typeof _traverse;
type N = any;

export interface Ref { path: string; hash: string; startLine: number; endLine: number }
export interface EvidenceDraft {
  skill: string; topic: string; ruleId: string; ruleVersion: number; classification: EvidenceClass;
  findings: string; limitations: string; refs: Ref[]; excerpt: string | null; ctx: Record<string, string>;
}
export interface AnalysisResult {
  evidence: EvidenceDraft[];
  backing: Record<string, EvidenceClass>;
  backingReason: Record<string, string>;
  coverage: { files: number; parsed: number; failed: string[]; truncated: boolean };
}

const RANK: Record<string, number> = { SUPPORTED: 2, PARTIAL: 1, NOT_DETECTED: 0, INCONCLUSIVE: 0 };
const MAX_SPAN = 30;
const SQL_RE = /\b(select\b[\s\S]+\bfrom\b|insert\s+into\b|update\b[\s\S]+\bset\b|delete\s+from\b|create\s+table\b)/i;
const HTTP = new Set(['get', 'post', 'put', 'delete', 'patch']);
const ARRAY_M = ['reduce', 'filter', 'map', 'find', 'sort'];

export function analyzeSnapshot(dir: string, manifest: Manifest): AnalysisResult {
  const best = new Map<string, EvidenceDraft>();
  const failed: string[] = [];
  let parsed = 0;
  const deps = new Set<string>();
  const jsxUsed = new Set<string>();
  const calledNames = new Set<string>();
  const deferred: (() => void)[] = [];
  let sqlSeen = false;

  const sources = new Map<string, { text: string; lines: string[]; hash: string }>();
  for (const f of manifest.files) {
    const text = fs.readFileSync(path.join(dir, f.storage), 'utf8');
    sources.set(f.path, { text, lines: text.split('\n'), hash: f.hash });
  }

  const offer = (d: EvidenceDraft) => {
    const k = `${d.skill}|${d.topic}`;
    const cur = best.get(k);
    if (!cur || RANK[d.classification] > RANK[cur.classification]) best.set(k, d);
  };
  const span = (file: string, a: number, b: number, extraStart?: number): { ref: Ref; excerpt: string } => {
    const s = sources.get(file)!;
    let start = extraStart && b - extraStart < MAX_SPAN ? Math.min(extraStart, a) : a;
    const end = Math.min(b, start + MAX_SPAN - 1, s.lines.length);
    start = Math.max(1, Math.min(start, end));
    return { ref: { path: file, hash: s.hash, startLine: start, endLine: end }, excerpt: redactSecrets(s.lines.slice(start - 1, end).join('\n')) };
  };
  const mk = (skill: string, topic: string, ruleId: string, cls: EvidenceClass, file: string, a: number, b: number, findings: string, limitations: string, ctx: Record<string, string>, extraStart?: number) => {
    const { ref, excerpt } = span(file, a, b, extraStart);
    return { skill, topic, ruleId, ruleVersion: 1, classification: cls, findings, limitations, refs: [ref], excerpt, ctx } as EvidenceDraft;
  };

  for (const f of manifest.files) {
    const src = sources.get(f.path)!;
    if (/(^|\/)package\.json$/.test(f.path)) {
      try { const j = JSON.parse(src.text); Object.keys({ ...j.dependencies, ...j.devDependencies }).forEach((d) => deps.add(d)); } catch { /* ignore malformed manifest */ }
      continue;
    }
    if (/\.sql$/i.test(f.path)) {
      sqlSeen = true;
      parsed++;
      const stmts = src.text.split(';');
      let offset = 0;
      for (const st of stmts) {
        const a = src.text.slice(0, offset).split('\n').length + (st.match(/^\s*/)![0].split('\n').length - 1);
        offset += st.length + 1;
        if (SQL_RE.test(st)) offerSql(st, f.path, a, a + st.trim().split('\n').length - 1);
      }
      continue;
    }
    if (!/\.(jsx?|tsx?|mjs|cjs)$/i.test(f.path)) continue;
    let ast: N;
    try {
      ast = parse(src.text, { sourceType: 'unambiguous', errorRecovery: false, plugins: ['jsx', ...(/\.tsx?$/i.test(f.path) ? (['typescript'] as const) : [])] });
      parsed++;
    } catch { failed.push(f.path); continue; }

    const states: { state: string; setter: string; line: number }[] = [];
    const calls: { name: string; fnStart: number; fnEnd: number }[] = [];
    const jsxIdents = new Set<string>();
    const routerNames = new Set<string>(['app', 'router']);
    let hasEffect = false;

    traverse(ast, {
      VariableDeclarator(p) {
        const n: N = p.node;
        if (n.id.type === 'ArrayPattern' && n.id.elements.length >= 2 && n.init?.type === 'CallExpression') {
          const c = n.init.callee; const nm = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? c.property?.name : '';
          if (nm === 'useState' && n.id.elements[0]?.type === 'Identifier' && n.id.elements[1]?.type === 'Identifier')
            states.push({ state: n.id.elements[0].name, setter: n.id.elements[1].name, line: n.loc.start.line });
        }
        if (n.id.type === 'Identifier' && n.init?.type === 'CallExpression') {
          const c = n.init.callee;
          if ((c.type === 'Identifier' && (c.name === 'express' || c.name === 'Router')) || (c.type === 'MemberExpression' && c.property?.name === 'Router')) routerNames.add(n.id.name);
        }
        // named helper functions
        if (n.id.type === 'Identifier' && /^[a-z]/.test(n.id.name) && (n.init?.type === 'ArrowFunctionExpression' || n.init?.type === 'FunctionExpression') && !n.init.async && n.init.params.length >= 1) {
          const fn = n.init; const hasRet = fn.body.type !== 'BlockStatement' || JSON.stringify(fn.body.body.map((x: N) => x.type)).includes('ReturnStatement');
          if (hasRet && !hasJsx(fn)) helperFns(n.id.name, n.loc.start.line, n.loc.end.line, fn.params.length, f.path);
        }
      },
      FunctionDeclaration(p) {
        const n: N = p.node;
        if (n.id && /^[a-z]/.test(n.id.name) && !n.async && n.params.length >= 1 && !hasJsx(n) && JSON.stringify(n.body.body.map((x: N) => x.type)).includes('ReturnStatement'))
          helperFns(n.id.name, n.loc.start.line, n.loc.end.line, n.params.length, f.path);
        if (n.id && /^[A-Z]/.test(n.id.name) && hasJsx(n)) component(n.id.name, n, f.path);
        if (n.async) asyncRule(n.id?.name ?? 'async function', n, f.path);
      },
      ArrowFunctionExpression(p) {
        const n: N = p.node; const parent: N = p.parent;
        if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier' && /^[A-Z]/.test(parent.id.name) && hasJsx(n)) component(parent.id.name, n, f.path);
        if (n.async) asyncRule(parent.type === 'VariableDeclarator' ? parent.id.name : 'async arrow function', n, f.path);
      },
      JSXOpeningElement(p) { const nm = (p.node as N).name; if (nm.type === 'JSXIdentifier') jsxUsed.add(nm.name); },
      JSXExpressionContainer(p) { p.traverse({ Identifier(ip) { jsxIdents.add(ip.node.name); } }); },
      CallExpression(p) {
        const n: N = p.node; const c = n.callee;
        const fp = p.getFunctionParent()?.node as N;
        if (c.type === 'Identifier') {
          calledNames.add(c.name);
          if (fp) calls.push({ name: c.name, fnStart: fp.loc.start.line, fnEnd: fp.loc.end.line });
          if (c.name === 'useEffect') {
            hasEffect = true;
            const deps2 = n.arguments[1]?.type === 'ArrayExpression';
            offer(mk('React', 'hooks', 'react-effect', deps2 ? 'SUPPORTED' : 'PARTIAL', f.path, n.loc.start.line, n.loc.end.line,
              deps2 ? 'useEffect runs side effects with an explicit dependency array.' : 'useEffect found without a dependency array, so it runs after every render.',
              'Effect cleanup and stale-closure behaviour were not analysed.', { deps: deps2 ? src.lines[n.arguments[1].loc.start.line - 1].trim().slice(0, 80) : 'none' }));
          }
        }
        if (c.type === 'MemberExpression' && c.property?.type === 'Identifier') {
          const m = c.property.name;
          if (ARRAY_M.includes(m) && n.arguments[0] && /Function/.test(n.arguments[0].type)) {
            const stmt = p.getStatementParent()?.node as N ?? n;
            offer(mk('JavaScript', 'arrays', 'js-array', n.arguments[0].params.length ? 'SUPPORTED' : 'PARTIAL', f.path, stmt.loc.start.line, stmt.loc.end.line,
              `Array method .${m}() is used with a callback.`, 'Only direct method calls with inline callbacks are recognised.', { method: m, receiver: c.object.type === 'Identifier' ? c.object.name : 'an array' }));
          }
          if (HTTP.has(m) && c.object.type === 'Identifier' && routerNames.has(c.object.name) && n.arguments[0]?.type === 'StringLiteral') {
            const h = n.arguments[n.arguments.length - 1]; const inline = /Function/.test(h.type) && h.params.length >= 2;
            offer(mk('Node.js & Express', 'routes', 'express-routes', inline ? 'SUPPORTED' : 'PARTIAL', f.path, n.loc.start.line, n.loc.end.line,
              `Route ${m.toUpperCase()} ${n.arguments[0].value} is registered${inline ? ' with an inline request handler' : ''}.`, 'Cross-file route mounting is not resolved.', { method: m.toUpperCase(), route: n.arguments[0].value }));
            if (/Function/.test(h.type) && (JSON.stringify(h.body).includes('TryStatement') || /\.status\(\s*[45]\d\d/.test(src.lines.slice(h.loc.start.line - 1, h.loc.end.line).join('\n'))))
              offer(mk('Node.js & Express', 'errors', 'express-errors', 'PARTIAL', f.path, h.loc.start.line, h.loc.end.line, `Route ${n.arguments[0].value} handles some failures locally (try/catch or an error status).`, 'No centralised error-handling middleware was found with this pattern.', { route: n.arguments[0].value }));
          }
          if (m === 'use' && c.object.type === 'Identifier' && routerNames.has(c.object.name)) {
            const fn = n.arguments.find((a: N) => /Function/.test(a.type));
            if (fn?.params.length === 4) offer(mk('Node.js & Express', 'errors', 'express-errors', 'SUPPORTED', f.path, n.loc.start.line, n.loc.end.line, 'Centralised error-handling middleware (err, req, res, next) is registered.', 'Whether every route reaches it was not traced.', { route: 'all routes' }));
            else if (fn?.params.length === 3) offer(mk('Node.js & Express', 'middleware', 'express-middleware', 'SUPPORTED', f.path, n.loc.start.line, n.loc.end.line, 'Custom middleware (req, res, next) is registered.', 'Middleware ordering across files is not resolved.', { name: 'custom middleware' }));
            else if (n.arguments[0]?.type === 'CallExpression' || n.arguments[0]?.type === 'Identifier') offer(mk('Node.js & Express', 'middleware', 'express-middleware', 'PARTIAL', f.path, n.loc.start.line, n.loc.end.line, 'Middleware is registered with app.use().', 'Only the registration was inspected, not the middleware body.', { name: 'built-in or imported middleware' }));
          }
        }
      },
      StringLiteral(p) { const v = (p.node as N).value; if (typeof v === 'string' && SQL_RE.test(v)) { sqlSeen = true; offerSql(v, f.path, (p.node as N).loc.start.line, (p.node as N).loc.end.line); } },
      TemplateLiteral(p) { const v = (p.node as N).quasis.map((q: N) => q.value.cooked).join('?'); if (SQL_RE.test(v)) { sqlSeen = true; offerSql(v, f.path, (p.node as N).loc.start.line, (p.node as N).loc.end.line); } },
    });

    // React state rule, after the whole file is read
    for (const s of states) {
      const setterCalls = calls.filter((c) => c.name === s.setter);
      const rendered = jsxIdents.has(s.state);
      const cls: EvidenceClass | null = setterCalls.length && rendered ? 'SUPPORTED' : setterCalls.length || rendered ? 'PARTIAL' : null;
      if (!cls) continue;
      const h = setterCalls[0];
      offer(mk('React', 'state', 'react-state', cls, f.path, h ? h.fnStart : s.line, h ? h.fnEnd : s.line + 3,
        cls === 'SUPPORTED' ? `State "${s.state}" is declared, updated through ${s.setter}() in a handler, and rendered.` : `State "${s.state}" is declared but only ${setterCalls.length ? 'updated' : 'rendered'}; the full declare-update-render path was not found.`,
        'Only same-file connections were traced.', { stateVar: s.state, setter: s.setter, handler: h ? `the function at lines ${h.fnStart}-${h.fnEnd}` : 'a handler' }, s.line));
    }
    void hasEffect;

    function hasJsx(fn: N): boolean { return JSON.stringify(fn.body, (k, v) => (k === 'loc' ? undefined : v)).includes('"JSXElement"') || JSON.stringify(fn.body, (k, v) => (k === 'loc' ? undefined : v)).includes('"JSXFragment"'); }
    function component(name: string, fn: N, file: string) {
      const p0 = fn.params[0]; const destructured = p0?.type === 'ObjectPattern'; const propsId = p0?.type === 'Identifier';
      if (!destructured && !propsId) return;
      const names = destructured ? p0.properties.map((x: N) => x.key?.name ?? x.argument?.name).filter(Boolean).join(', ') : 'props';
      deferred.push(() => offer(mk('React', 'props', 'react-props', jsxUsed.has(name) ? 'SUPPORTED' : 'PARTIAL', file, fn.loc.start.line, fn.loc.end.line,
        jsxUsed.has(name) ? `Component ${name} receives props (${names}) and is rendered elsewhere in the project.` : `Component ${name} receives props (${names}) but is not rendered by another inspected component.`,
        'Prop types and prop drilling depth were not analysed.', { component: name, props: names })));
    }
    function asyncRule(name: string, fn: N, file: string) {
      const body = JSON.stringify(fn.body, (k, v) => (k === 'loc' ? undefined : v));
      if (!body.includes('AwaitExpression')) return;
      const guarded = body.includes('TryStatement') || body.includes('"catch"');
      offer(mk('JavaScript', 'async', 'js-async', guarded ? 'SUPPORTED' : 'PARTIAL', file, fn.loc.start.line, fn.loc.end.line,
        guarded ? `Async function ${name} awaits work and handles failure.` : `Async function ${name} awaits work but no error handling was found.`,
        'Race conditions and cancellation were not analysed.', { fn: name }));
    }
    function helperFns(name: string, a: number, b: number, nParams: number, file: string) {
      deferred.push(() => offer(mk('JavaScript', 'functions', 'js-functions', calledNames.has(name) ? 'SUPPORTED' : 'PARTIAL', file, a, b,
        calledNames.has(name) ? `Function ${name}(${nParams} parameter${nParams > 1 ? 's' : ''}) returns a value and is called.` : `Function ${name} is declared but no call was found in inspected files.`,
        'Closures and higher-order usage were not analysed.', { fn: name })));
    }
  }

  function offerSql(text: string, file: string, a: number, b: number) {
    const t = text.replace(/\s+/g, ' ');
    const param = /\?|\$\d+|:\w+/.test(t) ? ' with parameter placeholders' : '';
    const add = (topic: string, what: string) => offer(mk('SQL', topic, 'sql-patterns', 'SUPPORTED', file, a, b, `${what}${param}.`, 'Only the statement text was inspected. The SQL dialect and runtime behaviour are not verified.', { statement: t.slice(0, 80) }));
    if (/\bjoin\b/i.test(t)) add('joins', 'A query joins tables');
    if (/group\s+by/i.test(t)) add('grouping', 'A query groups results');
    if (/\bwhere\b/i.test(t)) add('filtering', 'A query filters rows with WHERE');
    if (!/\bjoin\b|group\s+by|\bwhere\b/i.test(t)) offer(mk('SQL', 'queries', 'sql-patterns', 'PARTIAL', file, a, b, 'A basic SQL statement was found.', 'No filtering, joins or grouping were seen in it.', { statement: t.slice(0, 80) }));
  }
  deferred.forEach((d) => d());

  // skill-level backing, with the reason shown to the candidate
  const evidence = [...best.values()];
  const backing: Record<string, EvidenceClass> = {}; const backingReason: Record<string, string> = {};
  const jsxFiles = manifest.files.some((f) => /\.(jsx|tsx)$/.test(f.path));
  for (const skill of ['JavaScript', 'React', 'Node.js & Express', 'SQL']) {
    const recs = evidence.filter((e) => e.skill === skill);
    if (recs.some((r) => r.classification === 'SUPPORTED')) { backing[skill] = recs.every((r) => r.classification === 'SUPPORTED') || recs.filter((r) => r.classification === 'SUPPORTED').length >= 2 ? 'SUPPORTED' : 'PARTIAL'; backingReason[skill] = backing[skill] === 'SUPPORTED' ? 'Connected implementation found within the rule scope.' : 'Some relevant implementation found; support is incomplete.'; }
    else if (recs.length) { backing[skill] = 'PARTIAL'; backingReason[skill] = 'Relevant patterns were found but the connection is incomplete.'; }
    else if (skill === 'SQL' && !sqlSeen) { backing[skill] = 'INCONCLUSIVE'; backingReason[skill] = 'No query code was available to inspect. A knowledge score is still possible.'; }
    else if (failed.length || manifest.truncated) { backing[skill] = 'INCONCLUSIVE'; backingReason[skill] = 'Some files could not be parsed or were too large, so a determination is not possible.'; }
    else { backing[skill] = 'NOT_DETECTED'; backingReason[skill] = skill === 'React' && !deps.has('react') && !jsxFiles ? 'No React usage was found in inspected files. This does not mean you lack the skill.' : 'No matching implementation was found in inspected files. This does not mean you lack the skill.'; }
  }
  return { evidence, backing, backingReason, coverage: { files: manifest.files.length, parsed, failed, truncated: manifest.truncated } };
}
