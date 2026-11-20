// Reviewed MCQ bank (demo-sized, authored for this build; see docs/DECISIONS.md D-006). Answer keys live only here and in the DB.
// Format: [skill, topic, difficulty, text, [correct option first, then distractors]]. Options are shuffled per attempt.
import { all, db, newId, one, run } from './db.ts';

type Q = [string, string, 'basic' | 'intermediate' | 'advanced', string, string[]];
const BANK: Q[] = [
  // ---- JavaScript: 3 basic, 5 intermediate, 2 advanced ----
  ['JavaScript', 'scope', 'basic', 'What does this print?\n\nconsole.log(a);\nvar a = 1;', ['undefined', 'ReferenceError', '1', 'null']],
  ['JavaScript', 'functions', 'basic', 'Which keyword declares a block-scoped variable that cannot be reassigned?', ['const', 'var', 'let', 'static']],
  ['JavaScript', 'arrays', 'basic', 'What does [1, 2, 3].map(n => n * 2) return?', ['[2, 4, 6]', '[1, 2, 3]', '6', 'undefined']],
  ['JavaScript', 'arrays', 'intermediate', 'Which array method returns a NEW array containing only the elements that pass a test?', ['filter', 'forEach', 'find', 'splice']],
  ['JavaScript', 'arrays', 'intermediate', 'What does [1, 2, 3].reduce((a, b) => a + b, 10) return?', ['16', '6', '10', '[1, 2, 3, 10]']],
  ['JavaScript', 'functions', 'intermediate', 'What is a closure?', ['A function that keeps access to variables from the scope where it was created', 'A function that runs immediately after it is defined', 'A function with no parameters', 'A method that closes a file']],
  ['JavaScript', 'promises', 'intermediate', 'If one promise passed to Promise.all([p1, p2]) rejects, what happens?', ['The returned promise rejects with that reason', 'It waits for all promises, then resolves', 'The rejection is ignored', 'Only p1 is awaited']],
  ['JavaScript', 'async', 'intermediate', 'What does an async function always return?', ['A Promise', 'The raw return value', 'undefined', 'A callback']],
  ['JavaScript', 'async', 'advanced', "What is the output order?\n\nconsole.log('a');\nsetTimeout(() => console.log('b'), 0);\nPromise.resolve().then(() => console.log('c'));\nconsole.log('d');", ['a d c b', 'a b c d', 'a c d b', 'a d b c']],
  ['JavaScript', 'scope', 'advanced', 'What does this log?\n\nfor (var i = 0; i < 3; i++) setTimeout(() => console.log(i));', ['3 3 3', '0 1 2', '2 2 2', 'undefined x3']],
  // ---- React ----
  ['React', 'props', 'basic', 'How does a parent component pass data to a child component?', ['Through props', 'Through global variables only', 'By calling the child’s setState', 'By editing the DOM']],
  ['React', 'state', 'basic', 'Which hook adds local state to a function component?', ['useState', 'useRef', 'useMemo', 'useContext']],
  ['React', 'components', 'basic', 'What is JSX?', ['A syntax extension that compiles to JavaScript calls that create elements', 'A separate templating language run on the server', 'A CSS preprocessor', 'A browser API']],
  ['React', 'state', 'intermediate', 'Why should you avoid mutating state directly, for example items.push(x)?', ['React may not detect the change, so the UI might not re-render; create a new array instead', 'It is a syntax error', 'It makes the array immutable', 'It deletes the other items']],
  ['React', 'hooks', 'intermediate', 'What does useEffect(fn, []) do?', ['Runs fn after the first render only', 'Runs fn after every render', 'Runs fn before the first render', 'Never runs fn']],
  ['React', 'rendering', 'intermediate', 'Why do items in a rendered list need a stable key prop?', ['It lets React identify which items changed, moved or were removed', 'It sets the CSS id', 'It is required for styling', 'It encrypts the list']],
  ['React', 'state', 'intermediate', 'With count = 0, a handler calls setCount(count + 1) three times. What is count after the next render?', ['1', '3', '0', '2']],
  ['React', 'props', 'intermediate', 'Which statement about props is true?', ['They are read-only inside the receiving component', 'A child may reassign them freely', 'They can only hold strings', 'They are only for class components']],
  ['React', 'rendering', 'advanced', 'What can cause a component to re-render?', ['Its state or props change, or its parent re-renders', 'Only a page refresh', 'Only changes to props', 'Only calls to useEffect']],
  ['React', 'hooks', 'advanced', 'A setInterval callback inside useEffect keeps showing a stale count. What is a sound fix?', ['Use the functional update form setCount(c => c + 1), or list count in the dependency array', 'Wrap the callback in try/catch', 'Call useEffect inside the interval', 'Make count a global variable']],
  // ---- Node.js & Express ----
  ['Node.js & Express', 'routes', 'basic', "Which call registers a handler for GET requests to /users in Express?", ["app.get('/users', handler)", "app.fetch('/users', handler)", "app.route.get = '/users'", "express.get(handler)"]],
  ['Node.js & Express', 'requests', 'basic', 'What does res.json(obj) do?', ['Sends obj as a JSON response with the right Content-Type', 'Reads JSON from the request body', 'Writes obj to a file', 'Closes the server']],
  ['Node.js & Express', 'node', 'basic', 'What is Node.js?', ['A JavaScript runtime built on the V8 engine that runs outside the browser', 'A browser framework', 'A database', 'A CSS tool']],
  ['Node.js & Express', 'middleware', 'intermediate', 'What does a middleware function call to hand control to the next handler?', ['next()', 'res.next()', 'return true', 'app.continue()']],
  ['Node.js & Express', 'errors', 'intermediate', 'Which function signature marks Express error-handling middleware?', ['(err, req, res, next)', '(req, res)', '(req, res, next)', '(error) => void']],
  ['Node.js & Express', 'requests', 'intermediate', 'Why add express.json() to an app?', ['It parses JSON request bodies into req.body', 'It sends JSON responses automatically', 'It validates JSON files on disk', 'It formats logs']],
  ['Node.js & Express', 'async-io', 'intermediate', 'What can block the Node.js event loop?', ['Long-running synchronous work, such as a huge loop', 'Awaiting a database call', 'Using promises', 'Reading a request header']],
  ['Node.js & Express', 'requests', 'intermediate', 'Which HTTP status code best fits “resource created” after a successful POST?', ['201', '200', '204', '301']],
  ['Node.js & Express', 'errors', 'advanced', 'Where should a catch-all error-handling middleware be registered?', ['After all routes and other middleware', 'Before all routes', 'Inside each route only', 'It does not matter']],
  ['Node.js & Express', 'async-io', 'advanced', 'Why prefer fs.promises.readFile over fs.readFileSync inside a request handler?', ['It does not block the event loop while the file is read', 'It reads files faster than any other method', 'readFileSync does not exist', 'Promises encrypt the file']],
  // ---- SQL ----
  ['SQL', 'filtering', 'basic', 'Which clause filters individual rows before any grouping?', ['WHERE', 'HAVING', 'ORDER BY', 'LIMIT']],
  ['SQL', 'filtering', 'basic', 'What does SELECT DISTINCT do?', ['Removes duplicate rows from the result', 'Sorts the result', 'Deletes duplicates from the table', 'Counts rows']],
  ['SQL', 'keys', 'basic', 'What uniquely identifies each row in a table?', ['A primary key', 'A foreign key', 'An index name', 'A view']],
  ['SQL', 'joins', 'intermediate', 'What does an INNER JOIN return?', ['Only rows with matching values in both tables', 'All rows from the left table', 'All rows from both tables', 'Only unmatched rows']],
  ['SQL', 'joins', 'intermediate', 'What does a LEFT JOIN return?', ['All rows from the left table, with NULLs where the right has no match', 'Only matching rows', 'All rows from the right table', 'Only rows with NULLs']],
  ['SQL', 'grouping', 'intermediate', 'Which clause filters groups after aggregation?', ['HAVING', 'WHERE', 'GROUP BY', 'DISTINCT']],
  ['SQL', 'keys', 'intermediate', 'What does a foreign key enforce?', ['Values must exist in the referenced table (referential integrity)', 'Values must be unique', 'Values must be NULL', 'The table is read-only']],
  ['SQL', 'grouping', 'intermediate', 'How does COUNT(column) differ from COUNT(*)?', ['COUNT(column) skips rows where the column is NULL', 'They are always identical', 'COUNT(*) skips NULL rows', 'COUNT(column) counts only distinct values']],
  ['SQL', 'transactions', 'advanced', 'What does atomicity mean for a transaction?', ['All its statements succeed together or none take effect', 'It runs faster than other statements', 'It locks the entire database permanently', 'It can only contain one statement']],
  ['SQL', 'transactions', 'advanced', 'Why use parameterised queries?', ['They keep data separate from SQL text and prevent SQL injection', 'They make queries run in parallel', 'They remove the need for indexes', 'They auto-create tables']],
];

export function seedQuestions() {
  if (one<{ n: number }>('SELECT COUNT(*) n FROM mcq_questions')!.n > 0) return;
  const ins = db.prepare('INSERT INTO mcq_questions VALUES(?,?,?,?,?,?,?,1)');
  BANK.forEach(([skill, topic, diff, text, options], i) => ins.run(`q-${skill.replace(/\W/g, '').toLowerCase()}-${i}`, skill, topic, diff, text, JSON.stringify(options), 0));
}

/** Fixed blueprint: 3 basic, 5 intermediate, 2 advanced where the bank allows (Proposed; scaled for smaller MCQ_PER_SKILL). */
export function pickQuestions(skill: string, count: number): { id: string; text: string; options: string[]; answer_idx: number }[] {
  const rows = all<{ id: string; difficulty: string; text: string; options: string; answer_idx: number }>('SELECT * FROM mcq_questions WHERE skill=? ORDER BY rowid', skill);
  const share = { basic: Math.round(count * 0.3), advanced: Math.round(count * 0.2), intermediate: 0 };
  share.intermediate = count - share.basic - share.advanced;
  const out: typeof rows = [];
  for (const d of ['basic', 'intermediate', 'advanced'] as const) out.push(...rows.filter((r) => r.difficulty === d).slice(0, share[d]));
  return out.map((r) => ({ id: r.id, text: r.text, options: JSON.parse(r.options), answer_idx: r.answer_idx }));
}
void newId; void run;
