// Evidence-grounded viva and mutation task generation. Template-based (Fixture generator, see DECISIONS D-004): every task
// carries the exact stored source excerpt and a rubric fixed BEFORE it is served, so criteria cannot be dropped after seeing an answer.
import { all, newId, now, one, run } from './db.ts';

export interface Criterion { id: string; label: string; weight: number; fields: string[]; keywords: string[] }
export interface Rubric { version: string; criteria: Criterion[] }

const TOPIC_ORDER: Record<string, string[]> = {
  React: ['state', 'props', 'hooks'],
  JavaScript: ['arrays', 'async', 'functions'],
  'Node.js & Express': ['routes', 'middleware', 'errors'],
  SQL: ['filtering', 'joins', 'grouping', 'queries'],
};
export const PLANNED_VIVA_QUESTIONS = 3;
export const PLANNED_MUTATIONS = 2;

interface Ev { id: string; skill: string; topic: string; classification: string; refs: string; excerpt: string | null; ctx: string; snapshot_ref: string }
export function usableEvidence(assessmentId: string): Ev[] {
  return all<Ev>(`SELECT * FROM evidence WHERE assessment_id=? AND classification IN ('SUPPORTED','PARTIAL') AND excerpt IS NOT NULL`, assessmentId);
}
export function plannedTopics(skill: string, ev: Ev[]): Ev[] {
  const order = TOPIC_ORDER[skill] ?? [];
  return order.map((t) => ev.find((e) => e.skill === skill && e.topic === t)).filter((e): e is Ev => !!e);
}

const GENERIC_LIMITS = ['empty', 'error', 'fail', 'null', 'undefined', 'edge', 'invalid', 'missing', 'zero', 'no data', 'exception'];
const GENERIC_REASON = ['because', 'so that', 'instead', 'trade-off', 'otherwise', 'why', 'reason', 'avoid', 'prefer'];

const rubric = (kind: 'viva' | 'mutation', kw: { correct: string[]; flow: string[] }): Rubric => {
  const viva = kind === 'viva';
  return { version: 'rubric-1.0.0', criteria: viva ? [
    { id: 'correctness', label: 'Technical correctness', weight: 40, fields: ['answer'], keywords: kw.correct },
    { id: 'dataflow', label: 'Explanation of behaviour and data flow', weight: 30, fields: ['answer'], keywords: kw.flow },
    { id: 'reasoning', label: 'Reasoning behind decisions', weight: 20, fields: ['answer'], keywords: GENERIC_REASON },
    { id: 'limits', label: 'Limitations and failure cases', weight: 10, fields: ['answer'], keywords: GENERIC_LIMITS },
  ] : [
    { id: 'correctness', label: 'Correctness of proposed solution', weight: 40, fields: ['patch', 'reasoning'], keywords: kw.correct },
    { id: 'reasoning', label: 'Reasoning about necessary changes', weight: 30, fields: ['reasoning'], keywords: [...kw.flow, ...GENERIC_REASON] },
    { id: 'edges', label: 'Edge cases and effects on existing behaviour', weight: 20, fields: ['edgeCases'], keywords: GENERIC_LIMITS },
    { id: 'verification', label: 'Verification approach', weight: 10, fields: ['verification'], keywords: ['test', 'assert', 'check', 'verify', 'case', 'expect', 'manual', 'log'] },
  ] };
};
const lc = (s?: string) => (s ?? '').toLowerCase();

interface Tpl { prompts: ((c: Record<string, string>) => string)[]; kw: (c: Record<string, string>) => { correct: string[]; flow: string[] } }
const VIVA: Record<string, Tpl> = {
  state: {
    prompts: [(c) => `In the shown code, "${c.stateVar}" is updated with ${c.setter}(). Walk through what happens from the moment this update runs to the moment the new value appears on screen.`,
      (c) => `Why is "${c.stateVar}" kept in React state instead of a plain variable, and what would go wrong if you assigned to it directly instead of calling ${c.setter}()?`,
      (c) => `What does the UI show before "${c.stateVar}" holds any data, and how would you handle the update failing?`],
    kw: (c) => ({ correct: [lc(c.setter), lc(c.stateVar), 're-render', 'render', 'new value', 'state'], flow: ['event', 'handler', 'called', 'trigger', 'component', 'update', 'then', 'schedule'] }),
  },
  props: {
    prompts: [(c) => `Component ${c.component} receives (${c.props}). Explain how data reaches it and what it does with those props.`,
      (c) => `Why can ${c.component} not change its own props, and how would a child ask its parent to change something?`],
    kw: (c) => ({ correct: [lc(c.component), 'props', 'parent', 'child', 'read-only', 'immutable', 'callback'], flow: ['pass', 'render', 'receive', 'flow', 'down', 'function'] }),
  },
  hooks: {
    prompts: [() => 'Explain when the effect in the shown code runs and why it behaves that way. What does its dependency array control?',
      () => 'What would change if the dependency array were removed or left empty, and what cleanup (if any) would you add?'],
    kw: () => ({ correct: ['effect', 'dependency', 'dependencies', 'render', 'array', 'run'], flow: ['after', 'mount', 'change', 'cleanup', 'unmount', 'rerun', 're-run'] }),
  },
  arrays: {
    prompts: [(c) => `The shown code uses .${c.method}() on ${c.receiver}. Explain what it returns, step by step, for a small example.`,
      (c) => `Does .${c.method}() change the original array? Why does that matter here, and what would you do for an empty array?`],
    kw: (c) => ({ correct: [lc(c.method), 'callback', 'new array', 'return', 'element', 'iterate'], flow: ['each', 'item', 'step', 'accumulator', 'result', 'example'] }),
  },
  async: {
    prompts: [(c) => `Explain how ${c.fn} runs: what does await do, and what does the caller receive?`,
      (c) => `What happens in ${c.fn} if the awaited operation fails, and how should the caller deal with it?`],
    kw: () => ({ correct: ['await', 'promise', 'async', 'resolve', 'pause', 'return'], flow: ['then', 'caller', 'event loop', 'sequence', 'wait', 'result'] }),
  },
  functions: {
    prompts: [(c) => `Describe what ${c.fn}() takes in, what it returns, and where it is used.`,
      (c) => `What inputs could make ${c.fn}() misbehave, and how would you guard against them?`],
    kw: (c) => ({ correct: [lc(c.fn), 'parameter', 'argument', 'return', 'value', 'input'], flow: ['call', 'used', 'caller', 'output', 'pure', 'result'] }),
  },
  routes: {
    prompts: [(c) => `Explain what happens when a client sends ${c.method} ${c.route} to this server, from request to response.`,
      (c) => `What status codes and response bodies should ${c.method} ${c.route} return for success and for bad input, and why?`],
    kw: (c) => ({ correct: [lc(c.method), lc(c.route), 'request', 'response', 'handler', 'route', 'req', 'res'], flow: ['body', 'status', 'json', 'send', 'client', 'middleware', 'param'] }),
  },
  middleware: {
    prompts: [() => 'What does this middleware do for each request, and what happens if next() is not called?',
      () => 'Where does the order of middleware matter in this app, and what would break if it were reordered?'],
    kw: () => ({ correct: ['middleware', 'next', 'request', 'response', 'order', 'chain'], flow: ['before', 'after', 'pass', 'route', 'handler', 'stack'] }),
  },
  errors: {
    prompts: [(c) => `How are failures handled around ${c.route}? Follow an error from where it happens to what the client receives.`,
      () => 'What error cases are still not handled, and what would you add?'],
    kw: () => ({ correct: ['error', 'catch', 'status', 'next', 'handler', 'try'], flow: ['client', 'response', 'log', 'json', 'middleware', '500', '400'] }),
  },
  filtering: {
    prompts: [(c) => `Explain what this query returns and how the filtering works: ${c.statement}`, () => 'How would you keep this query safe from SQL injection, and what index might help it?'],
    kw: () => ({ correct: ['where', 'filter', 'rows', 'condition', 'select', 'parameter'], flow: ['table', 'return', 'match', 'column', 'index', 'placeholder'] }),
  },
  joins: {
    prompts: [(c) => `Explain how the join works in: ${c.statement}. Which rows are kept or dropped?`, () => 'What changes if you switch to a LEFT JOIN, and when would that matter?'],
    kw: () => ({ correct: ['join', 'match', 'key', 'rows', 'both tables', 'on'], flow: ['inner', 'left', 'null', 'column', 'foreign', 'relationship'] }),
  },
  grouping: {
    prompts: [(c) => `Explain how grouping works in: ${c.statement}. What does each result row represent?`, () => 'Where would HAVING differ from WHERE for this query?'],
    kw: () => ({ correct: ['group', 'aggregate', 'count', 'sum', 'row', 'per'], flow: ['having', 'where', 'column', 'result', 'each', 'distinct'] }),
  },
  queries: {
    prompts: [(c) => `Explain what this statement does and what it reads or writes: ${c.statement}`, () => 'How would you extend it to filter or limit the data, and why?'],
    kw: () => ({ correct: ['select', 'table', 'rows', 'column', 'insert', 'query'], flow: ['return', 'write', 'read', 'where', 'limit', 'result'] }),
  },
};

interface MutTpl { topic: string; title: (c: Record<string, string>) => string; kw: { correct: string[]; flow: string[] } }
const MUTATIONS: Record<string, MutTpl[]> = {
  React: [
    { topic: 'new-requirement', title: (c) => `New requirement: each item may carry an optional "discount" (0 to 1). Change the code so displayed totals use it while ${c.setter ?? 'the existing state update'} keeps working correctly.`, kw: { correct: ['discount', 'total', 'price', 'qty', 'quantity', '*', '-', 'reduce', 'map'], flow: ['state', 'derive', 'render', 'update', 'item', 'setter'] } },
    { topic: 'robustness', title: () => 'Robustness: the data this component shows must survive a page reload. Describe and sketch the change, and what could go wrong with it.', kw: { correct: ['localstorage', 'storage', 'persist', 'json', 'useeffect', 'initial', 'parse', 'save'], flow: ['load', 'reload', 'state', 'effect', 'serialize', 'default'] } },
  ],
  JavaScript: [
    { topic: 'new-requirement', title: () => 'New requirement: leave out items whose quantity is 0 and sort the rest by price, WITHOUT mutating the original array. Show the change.', kw: { correct: ['filter', 'sort', 'slice', 'spread', '[...', 'copy', 'price', 'qty', 'toSorted'.toLowerCase()], flow: ['original', 'mutate', 'new array', 'chain', 'return'] } },
    { topic: 'robustness', title: (c) => `Robustness: make the async work${c.fn ? ` in ${c.fn}` : ''} retry once on failure and time out after a limit. What should happen on final failure?`, kw: { correct: ['retry', 'timeout', 'catch', 'try', 'await', 'promise', 'abort', 'race'], flow: ['attempt', 'fail', 'error', 'loop', 'delay', 'throw'] } },
  ],
  'Node.js & Express': [
    { topic: 'new-requirement', title: (c) => `New requirement: reject invalid request bodies on ${c.method ?? 'POST'} ${c.route ?? 'this route'} with HTTP 400 and a clear message. Show the change, ideally as middleware.`, kw: { correct: ['400', 'validate', 'validation', 'middleware', 'req.body', 'next', 'status', 'json'], flow: ['reject', 'before', 'handler', 'schema', 'message', 'return'] } },
    { topic: 'robustness', title: () => 'Robustness: add one centralised place that logs failures and returns a consistent JSON error. Show where it goes and why.', kw: { correct: ['error', 'middleware', 'err', 'next', 'status', 'json', 'log', 'catch'], flow: ['after', 'routes', 'consistent', 'register', 'handler', 'async'] } },
  ],
  SQL: [
    { topic: 'new-requirement', title: () => 'New requirement: return only one page of results at a time (page size 10) in a stable order. Show the changed SQL.', kw: { correct: ['limit', 'offset', 'order by', 'page', 'select', 'where'], flow: ['stable', 'deterministic', 'parameter', 'index', 'next page'] } },
    { topic: 'robustness', title: () => 'Robustness: two related writes must either both happen or neither. Show how you would wrap them.', kw: { correct: ['transaction', 'begin', 'commit', 'rollback', 'atomic'], flow: ['fail', 'both', 'error', 'consistent', 'isolation'] } },
  ],
};

const LIFECYCLE = [
  ['problem', 'What problem does your project solve, and for whom?'], ['requirements', 'What were the main requirements you set before building?'],
  ['architecture', 'Describe the architecture: main parts and how they talk to each other.'], ['technology', 'Which technologies did you choose, and why those over alternatives?'],
  ['stages', 'Walk through the stages you built it in, from first working version to now.'], ['challenges', 'What was your hardest bug or challenge, and how did you debug it?'],
  ['testing', 'How did you test or check that it works?'], ['improvements', 'What would you improve next, and why?'],
];

export function ensureLifecycleTasks(assessmentId: string) {
  if (one('SELECT 1 x FROM tasks WHERE assessment_id=? AND kind=?', assessmentId, 'LIFECYCLE')) return;
  LIFECYCLE.forEach(([topic, prompt], i) => run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', newId(), assessmentId, 'LIFECYCLE', null, topic, i, prompt,
    JSON.stringify([{ id: 'answer', label: 'Your explanation', hint: 'A few sentences in your own words.' }]), null, JSON.stringify({ version: 'none', criteria: [] }), null, 'fixed-prompts', now()));
}

function sourceOf(ev: Ev) {
  const ref = JSON.parse(ev.refs)[0];
  return JSON.stringify({ path: ref.path, startLine: ref.startLine, endLine: ref.endLine, snapshotRef: ev.snapshot_ref, excerpt: ev.excerpt });
}
function insertTask(assessmentId: string, kind: 'VIVA' | 'MUTATION', skill: string, topic: string, idx: number, prompt: string, fields: object[], ev: Ev, rb: Rubric) {
  run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', newId(), assessmentId, kind, skill, topic, idx, prompt, JSON.stringify(fields), sourceOf(ev), JSON.stringify(rb), ev.id, 'template-v1 (fixture generator)', now());
}

/** Generates (once) viva tasks for every skill with at least two evidenced topics. */
export function ensureVivaTasks(assessmentId: string) {
  if (one('SELECT 1 x FROM tasks WHERE assessment_id=? AND kind=?', assessmentId, 'VIVA')) return;
  const ev = usableEvidence(assessmentId);
  for (const skill of Object.keys(TOPIC_ORDER)) {
    const topics = plannedTopics(skill, ev);
    if (topics.length < 2) continue; // coverage not met: component stays incomplete, never silently scored
    const [a, b] = topics; let idx = 0;
    const plan: [Ev, number][] = [[a, 0], [a, 1], [b, 0]];
    for (const [e, pi] of plan) {
      const tpl = VIVA[e.topic]; const ctx = JSON.parse(e.ctx);
      const prompt = tpl.prompts[Math.min(pi, tpl.prompts.length - 1)](ctx);
      insertTask(assessmentId, 'VIVA', skill, e.topic, idx++, prompt, [{ id: 'answer', label: 'Your answer', hint: 'Explain in your own words. Correctness and reasoning count, not length or style.' }], e, rubric('viva', tpl.kw(ctx)));
    }
  }
}

export function ensureMutationTasks(assessmentId: string) {
  if (one('SELECT 1 x FROM tasks WHERE assessment_id=? AND kind=?', assessmentId, 'MUTATION')) return;
  const ev = usableEvidence(assessmentId);
  for (const skill of Object.keys(TOPIC_ORDER)) {
    const topics = plannedTopics(skill, ev);
    if (!topics.length) continue;
    MUTATIONS[skill].forEach((m, i) => {
      const e = topics[Math.min(i, topics.length - 1)]; const ctx = JSON.parse(e.ctx);
      insertTask(assessmentId, 'MUTATION', skill, m.topic, i, m.title(ctx), [
        { id: 'patch', label: 'Proposed change (code or pseudocode)', code: true },
        { id: 'reasoning', label: 'Why this works' },
        { id: 'edgeCases', label: 'Edge cases and effects on existing behaviour' },
        { id: 'verification', label: 'How you would verify it', hint: 'A plan only. Tests are not run, and no credit is given for tests that were never run.' },
      ], e, rubric('mutation', m.kw));
    });
  }
}
