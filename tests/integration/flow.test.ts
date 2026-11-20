import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { zipSync, strToU8 } from 'fflate';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-test-'));
process.env.DATA_DIR = tmp; process.env.DB_FILE = path.join(tmp, 't.sqlite'); process.env.MCQ_PER_SKILL = '10';
const core = await import('@proof/server-core');
const { createApp } = await import('../../apps/api/src/app.ts');
const { driveCandidate, drain, Client } = await import('../../apps/api/src/demo.ts');
const { calculateSkillScore, round1 } = await import('@proof/scoring');

const fx = path.resolve(import.meta.dirname, '../fixtures');
let server: ReturnType<ReturnType<typeof createApp>['listen']>; let base = '';
let A: Awaited<ReturnType<typeof driveCandidate>>; let B: Awaited<ReturnType<typeof driveCandidate>>; let C: Awaited<ReturnType<typeof driveCandidate>>;

before(async () => {
  core.seedQuestions();
  server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  A = await driveCandidate(base, { email: 'a@t.test', password: 'password-123', resume: path.join(fx, 'resume-a.txt'), project: path.join(fx, 'shopping-cart.zip'), quality: 'strong', mcqCorrectRatio: 0.8 });
  B = await driveCandidate(base, { email: 'b@t.test', password: 'password-123', resume: path.join(fx, 'resume-b.txt'), project: path.join(fx, 'mini-api.zip'), quality: 'mixed', mcqCorrectRatio: 0.9 });
  C = await driveCandidate(base, { email: 'c2@t.test', password: 'password-123', resume: path.join(fx, 'resume-c.txt'), project: path.join(fx, 'shopping-cart.zip'), quality: 'strong', mcqCorrectRatio: 0.7 });
});
after(() => { server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* sqlite file stays locked on Windows until exit */ } });

test('resume: aliases map to skills, learning claims are not claims, unsupported skills stay visible', async () => {
  const a = await A.client.ok<any>('GET', `/assessments/${A.assessmentId}`);
  const by = Object.fromEntries(a.skills.map((s: any) => [s.name, s]));
  for (const n of ['React', 'JavaScript', 'Node.js & Express', 'SQL']) assert.equal(by[n].status, 'IN_SCOPE', n);
  assert.equal(by['Docker'].status, 'UNSUPPORTED');
  assert.equal(by['TypeScript'].status, 'IGNORED_LEARNING');
  assert.equal(by['Python'].status, 'IGNORED_LEARNING');
});

test('evidence: dependency-only is not backing, connected implementation is, SQL without source is Inconclusive', async () => {
  const a = await A.client.ok<any>('GET', `/assessments/${A.assessmentId}`);
  const by = Object.fromEntries(a.skills.map((s: any) => [s.name, s.backing]));
  assert.equal(by['React'], 'SUPPORTED'); assert.equal(by['JavaScript'], 'SUPPORTED'); assert.equal(by['Node.js & Express'], 'SUPPORTED');
  assert.equal(by['SQL'], 'INCONCLUSIVE');
  const ev = await A.client.ok<any>('GET', `/assessments/${A.assessmentId}/evidence`);
  const state = ev.evidence.find((e: any) => e.ruleId === 'react-state');
  assert.ok(state.refs[0].path.endsWith('Cart.jsx') && state.excerpt.includes('setItems'));
});

test('history: a ZIP takes the lifecycle route without any score penalty', async () => {
  const a = await A.client.ok<any>('GET', `/assessments/${A.assessmentId}`);
  assert.equal(a.historyClass, 'UNAVAILABLE');
  assert.equal(A.card.context.lifecycleCompleted, true);
  assert.ok(A.card.skills.every((s) => s.mcq.state === 'COMPLETE'));
});

test('MCQ payloads never contain answer keys', async () => {
  const at = await A.client.ok<any[]>('GET', `/assessments/${A.assessmentId}/mcq`);
  assert.ok(!JSON.stringify(at).match(/answer_?idx|is_?correct|correct_?option/i));
  assert.equal(at[0].questions.length, 10);
});

test('scorecard: SQL is knowledge-only, overall is withheld while incomplete, scores reproduce from saved components', () => {
  const c = A.card;
  const sql = c.skills.find((s) => s.skill === 'SQL')!;
  assert.equal(sql.status, 'KNOWLEDGE_ONLY'); assert.equal(sql.final, null); assert.equal(sql.viva.state, 'INCOMPLETE');
  assert.equal(c.overall.complete, false); assert.equal(c.overall.value, null);
  assert.deepEqual(c.unsupportedScope, ['Docker']);
  for (const s of c.skills.filter((x) => x.final != null)) {
    assert.equal(round1(s.final!), round1(calculateSkillScore({ mcq: s.mcq.percent, viva: s.viva.percent, mutation: s.mutation.percent })!));
    assert.ok(s.final! > 0 && s.final! <= 100);
  }
  assert.equal(c.context.mutationMode, 'ASSESSED_PROPOSAL');
  assert.equal(c.isSample, false);
});

test('scorecard: a candidate with SQL project context completes SQL; Node is complete for both', () => {
  const sql = B.card.skills.find((s) => s.skill === 'SQL')!;
  assert.equal(sql.status, 'COMPLETE');
  assert.ok(B.card.skills.every((s) => s.status === 'COMPLETE'));
  assert.equal(B.card.overall.complete, true);
});

test('ownership: other candidates get 404 for assessments, tasks, attempts and scorecards', async () => {
  for (const p of [`/assessments/${A.assessmentId}`, `/assessments/${A.assessmentId}/scorecard`, `/assessments/${A.assessmentId}/evidence`, `/assessments/${A.assessmentId}/mcq`]) {
    assert.equal((await B.client.raw('GET', p)).status, 404, p);
  }
  const task = core.one('SELECT id FROM tasks WHERE assessment_id=? LIMIT 1', A.assessmentId)!;
  assert.equal((await B.client.raw('PUT', `/tasks/${task.id}/draft`, { revision: 0, fields: {} })).status, 404);
  assert.equal((await B.client.raw('POST', `/tasks/${task.id}/submit`)).status, 404);
  assert.equal((await new Client(base).raw('GET', '/assessments')).status, 401);
  assert.equal((await B.client.raw('GET', '/ops/failed-jobs')).status, 403);
});

test('csrf header is required for state-changing requests; role cannot be self-assigned', async () => {
  const res = await fetch(`${base}/api/v1/assessments`, { method: 'POST', headers: { cookie: A.client.cookie } });
  assert.equal(res.status, 403);
  const r = await new Client(base).raw('POST', '/auth/register', { email: 'x@t.test', password: 'password-123', role: 'OPERATOR' });
  assert.equal(r.json.data.role, 'CANDIDATE');
});

test('finalised answers cannot change; final submission is idempotent', async () => {
  const task = core.one(`SELECT t.id FROM tasks t JOIN responses r ON r.task_id=t.id WHERE t.assessment_id=? AND t.kind='VIVA' LIMIT 1`, A.assessmentId)!;
  assert.equal((await A.client.raw('PUT', `/tasks/${task.id}/draft`, { revision: 0, fields: { answer: 'changed' } })).status, 409);
  const again = await A.client.ok<any>('POST', `/tasks/${task.id}/submit`);
  assert.equal(again.alreadySubmitted, true);
  const at = core.one(`SELECT id FROM mcq_attempts WHERE assessment_id=? LIMIT 1`, A.assessmentId)!;
  const x = await A.client.ok<any>('POST', `/mcq-attempts/${at.id}/submit`); const y = await A.client.ok<any>('POST', `/mcq-attempts/${at.id}/submit`);
  assert.deepEqual(x, y);
});

test('stage guards: viva cannot start early; scope freezes once MCQs begin', async () => {
  const c = new Client(base);
  await c.ok('POST', '/auth/register', { email: 'c@t.test', password: 'password-123' });
  const { id } = await c.ok<{ id: string }>('POST', '/assessments');
  assert.equal((await c.raw('POST', `/assessments/${id}/viva/start`)).status, 409);
  const consent = await c.raw('POST', `/assessments/${id}/projects`, { submissionMethod: 'GITHUB', repositoryUrl: 'https://github.com/a/b' });
  assert.equal(consent.json.error.code, 'CONSENT_REQUIRED');
  const f = new FormData(); f.append('file', new Blob([fs.readFileSync(path.join(fx, 'resume-a.txt'))]), 'r.txt');
  assert.equal((await A.client.raw('POST', `/assessments/${A.assessmentId}/resume`, undefined, f)).status, 409);
});

test('hostile ZIP (path traversal) is rejected with a safe message and no zero score', async () => {
  const c = new Client(base);
  await c.ok('POST', '/auth/register', { email: 'd@t.test', password: 'password-123' });
  const { id } = await c.ok<{ id: string }>('POST', '/assessments');
  const fr = new FormData(); fr.append('file', new Blob([fs.readFileSync(path.join(fx, 'resume-a.txt'))]), 'r.txt');
  await c.ok('POST', `/assessments/${id}/resume`, undefined, fr); await drain();
  await c.ok('POST', `/assessments/${id}/consents`, { scope: 'ZIP_UPLOAD', acceptExternalAi: true, acceptAnalysis: true });
  const evil = zipSync({ '../evil.js': strToU8('console.log(1)'), 'ok.js': strToU8('const a = 1;') });
  const fz = new FormData(); fz.append('file', new Blob([evil]), 'evil.zip');
  const sub = await c.ok<any>('POST', `/assessments/${id}/projects`, undefined, fz); await drain();
  const job = await c.ok<any>('GET', `/processing-jobs/${sub.processingJobId}`);
  assert.equal(job.state, 'FAILED'); assert.match(job.error, /unsafe path/);
  const a = await c.ok<any>('GET', `/assessments/${id}`);
  assert.equal(a.stage, 'SKILLS_EXTRACTED'); assert.equal(a.nextAction.type, 'PROJECT');
});

test('comparison: incomplete common skill (A has knowledge-only SQL) withholds a winner', async () => {
  const idA = core.one('SELECT id FROM scorecards WHERE assessment_id=?', A.assessmentId)!.id;
  const idB = core.one('SELECT id FROM scorecards WHERE assessment_id=?', B.assessmentId)!.id;
  const inv = await A.client.ok<any>('POST', `/scorecards/${idA}/comparison-invitations`, { displayLabel: 'Sample A', expiresInDays: 7 });
  await B.client.ok('POST', '/comparison-invitations/accept', { token: inv.token });
  const cmp = await B.client.ok<any>('POST', '/candidate-comparisons', { ownScorecardId: idB, sharedScorecardId: idA });
  assert.equal(cmp.result.status, 'WITHHELD'); assert.equal(cmp.result.winner, null);
  assert.match(cmp.result.reasons.join(' '), /SQL/);
});

test('comparison: invitation flow, common skill only, revocation blocks saved results, id alone grants nothing', async () => {
  const idB = core.one('SELECT id FROM scorecards WHERE assessment_id=?', B.assessmentId)!.id;
  const idC = core.one('SELECT id FROM scorecards WHERE assessment_id=?', C.assessmentId)!.id;
  assert.equal((await B.client.raw('POST', '/candidate-comparisons', { ownScorecardId: idB, sharedScorecardId: idC })).status, 404); // an id alone never grants access
  const inv = await C.client.ok<any>('POST', `/scorecards/${idC}/comparison-invitations`, { displayLabel: 'Candidate C', expiresInDays: 7 });
  assert.ok(inv.token.length > 30);
  assert.ok(!core.one('SELECT 1 x FROM comparison_invitations WHERE token_hash=?', inv.token), 'only the hash is stored');
  assert.equal((await C.client.raw('POST', '/comparison-invitations/accept', { token: inv.token })).status, 409); // own invitation
  await B.client.ok('POST', '/comparison-invitations/accept', { token: inv.token });
  const cmp = await B.client.ok<any>('POST', '/candidate-comparisons', { ownScorecardId: idB, sharedScorecardId: idC });
  assert.deepEqual(cmp.result.common, ['Node.js & Express']);
  assert.equal(cmp.result.status, 'COMPARABLE');
  assert.ok(['A', 'B', 'TIE'].includes(cmp.result.winner));
  assert.ok(cmp.result.unmatchedB.includes('React') && cmp.result.unmatchedA.includes('SQL'));
  assert.equal((await A.client.raw('GET', `/candidate-comparisons/${cmp.id}`)).status, 404); // not A's comparison
  await C.client.ok('DELETE', `/comparison-invitations/${inv.id}`);
  assert.equal((await B.client.raw('GET', `/candidate-comparisons/${cmp.id}`)).status, 403);
  assert.equal((await B.client.raw('POST', '/candidate-comparisons', { ownScorecardId: idB, sharedScorecardId: idC })).status, 404);
});
