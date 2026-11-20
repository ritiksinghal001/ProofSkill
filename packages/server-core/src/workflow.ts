// Stage machine, round logic, job handlers and scorecard construction. The server is the only place scores are computed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  POLICY_VERSION, RUBRIC_VERSION, DICTIONARY_VERSION, type AllowedAction, type AssessmentDto, type EvidenceDto, type McqAttemptDto,
  type ScorecardDto, type SkillResult, type ScoreComponent, type Stage, type TaskDto, type HistoryClass,
} from '@proof/contracts';
import { calculateSkillScore, componentFromSlots, formulaText, mcqPercent, overall, responsePercent, SCORER_VERSION, round1 } from '@proof/scoring';
import { all, audit, newId, now, one, run, tx, sha256, type Row } from './db.ts';
import { config } from './config.ts';
import { DICTIONARY, extractSkills } from './skills.ts';
import { extractResumeText, ResumeError } from './resume.ts';
import { downloadGithubArchive, extractZipToSnapshot, fetchCommits, parseGithubUrl, resolveGithub, validateRef, GithubError, SnapshotError, type Manifest } from './snapshot.ts';
import { analyzeSnapshot } from './analysis.ts';
import { classifyHistory, HISTORY_RUBRIC_VERSION } from './history.ts';
import { enqueue, jobsFor, PermanentJobError } from './jobs.ts';
import { pickQuestions, seedQuestions } from './questions.ts';
import { ensureLifecycleTasks, ensureMutationTasks, ensureVivaTasks, plannedTopics, usableEvidence, type Rubric } from './tasks.ts';
import { evaluate, PROMPT_VERSION, TransientAiError, validateEvaluation, type EvalTask } from './ai.ts';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>, public retryable = false) { super(message); }
}
const SKILL_ORDER = DICTIONARY.map((d) => d.name);
const MB = 1024 * 1024;

export function setStage(id: string, stage: Stage) { run('UPDATE assessments SET stage=?, updated_at=? WHERE id=?', stage, now(), id); }
export function getAssessment(id: string): Row | undefined { return one('SELECT * FROM assessments WHERE id=?', id); }
const inScope = (id: string) => all('SELECT * FROM skills WHERE assessment_id=? AND supported=1 AND status=\'IN_SCOPE\'', id).sort((a, b) => SKILL_ORDER.indexOf(a.name) - SKILL_ORDER.indexOf(b.name));
const scopeFrozen = (id: string) => !!one('SELECT 1 x FROM mcq_attempts WHERE assessment_id=?', id);

// ---------- creation / resume ----------
export function createAssessment(userId: string, isSample = false): string {
  const id = newId();
  run('INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)', id, userId, 'DRAFT', POLICY_VERSION, null, null, isSample ? 1 : 0, now(), now());
  audit('assessment.created', userId, id);
  return id;
}

export function storeResume(assessmentId: string, userId: string, buf: Buffer, name: string) {
  const a = getAssessment(assessmentId)!;
  if (scopeFrozen(assessmentId)) throw new AppError(409, 'INVALID_STAGE', 'Assessment scope is frozen once scored rounds begin. Start a new attempt to change your resume.');
  if (buf.length > config.MAX_RESUME_MB * MB) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Resume is larger than ${config.MAX_RESUME_MB} MB.`);
  const key = `resumes/${assessmentId}-${crypto.randomBytes(8).toString('hex')}`; // generated key; the user's filename is only metadata
  fs.mkdirSync(path.join(config.dataDir, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(config.dataDir, key), buf);
  tx(() => {
    run('DELETE FROM resumes WHERE assessment_id=?', assessmentId);
    run('DELETE FROM skills WHERE assessment_id=?', assessmentId);
    run('INSERT INTO resumes VALUES(?,?,?,?,?,?,?)', assessmentId, key, name.slice(0, 120), 'QUEUED', null, null, DICTIONARY_VERSION);
    if (a.stage !== 'DRAFT' && a.stage !== 'SKILLS_EXTRACTED') throw new AppError(409, 'INVALID_STAGE', 'The resume can no longer be replaced at this stage.');
    setStage(assessmentId, 'DRAFT');
  });
  return enqueue('extract_resume', assessmentId, { assessmentId }, `extract:${assessmentId}:${key}`);
}

async function handleExtractResume({ assessmentId }: { assessmentId: string }) {
  const r = one('SELECT * FROM resumes WHERE assessment_id=?', assessmentId);
  if (!r) throw new PermanentJobError('NOT_FOUND', 'Resume record missing.');
  try {
    const text = await extractResumeText(fs.readFileSync(path.join(config.dataDir, r.file_key)), r.original_name ?? '');
    const skills = extractSkills(text);
    tx(() => {
      run('UPDATE resumes SET status=?, text=?, error=NULL WHERE assessment_id=?', 'EXTRACTED', text, assessmentId);
      for (const s of skills) run('INSERT OR REPLACE INTO skills VALUES(?,?,?,?,?,?,?,NULL)', newId(), assessmentId, s.name, s.alias, s.where, s.supported ? 1 : 0, s.status);
      if (skills.some((s) => s.status === 'IN_SCOPE')) setStage(assessmentId, 'SKILLS_EXTRACTED');
      else run('UPDATE resumes SET status=?, error=? WHERE assessment_id=?', 'NO_SUPPORTED_SKILLS', 'No supported skill (JavaScript, React, Node.js & Express, SQL) was found as a claim in the resume.', assessmentId);
    });
  } catch (e) {
    if (e instanceof ResumeError) { run('UPDATE resumes SET status=?, error=? WHERE assessment_id=?', 'FAILED', e.message, assessmentId); throw new PermanentJobError(e.code, e.message); }
    throw e;
  }
}

// ---------- consent / project ----------
export function recordConsent(assessmentId: string, userId: string, scope: string) {
  run('INSERT INTO consents VALUES(?,?,?,?,?,?,NULL)', newId(), assessmentId, userId, scope, 'notice-1', now());
  audit('consent.recorded', userId, assessmentId, { scope });
}
const hasConsent = (id: string) => !!one('SELECT 1 x FROM consents WHERE assessment_id=? AND revoked_at IS NULL', id);

function resetProject(assessmentId: string) {
  if (scopeFrozen(assessmentId)) throw new AppError(409, 'INVALID_STAGE', 'The project snapshot is frozen once scored rounds begin.');
  const a = getAssessment(assessmentId)!;
  if (!['SKILLS_EXTRACTED', 'PROJECT_SUBMITTED', 'EVIDENCE_READY'].includes(a.stage)) throw new AppError(409, 'INVALID_STAGE', 'A project can be submitted after your resume skills are extracted.');
  const old = one('SELECT * FROM projects WHERE assessment_id=?', assessmentId);
  if (old?.snapshot_dir) fs.rmSync(old.snapshot_dir, { recursive: true, force: true });
  run('DELETE FROM evidence WHERE assessment_id=?', assessmentId);
  run('DELETE FROM projects WHERE assessment_id=?', assessmentId);
  run('UPDATE skills SET backing=NULL WHERE assessment_id=?', assessmentId);
  run('UPDATE assessments SET history_class=NULL, history_reason=NULL WHERE id=?', assessmentId);
}

export function submitZipProject(assessmentId: string, userId: string, buf: Buffer, name: string) {
  if (!hasConsent(assessmentId)) throw new AppError(409, 'CONSENT_REQUIRED', 'Record consent before submitting a project.');
  if (buf.length > config.MAX_ZIP_MB * MB) throw new AppError(413, 'PROJECT_TOO_LARGE', `ZIP is larger than ${config.MAX_ZIP_MB} MB.`);
  const projectId = newId(); const key = `uploads/${projectId}.zip`;
  fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(config.dataDir, key), buf);
  return tx(() => {
    resetProject(assessmentId);
    run('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', projectId, assessmentId, 'ZIP', name.slice(0, 100) || 'uploaded.zip', null, null, null, key, null, null, null, 'QUEUED', null, now());
    setStage(assessmentId, 'PROJECT_SUBMITTED');
    return { projectId, jobId: enqueue('analyze_project', assessmentId, { projectId }, `analyze:${projectId}`) };
  });
}

export async function submitGithubProject(assessmentId: string, userId: string, url: string, branch?: string) {
  if (!hasConsent(assessmentId)) throw new AppError(409, 'CONSENT_REQUIRED', 'Record consent before submitting a project.');
  let p; try { p = parseGithubUrl(url); } catch (e: any) { throw new AppError(422, 'UNPROCESSABLE', e.message, { repositoryUrl: e.message }); }
  const projectId = newId();
  return tx(() => {
    resetProject(assessmentId);
    run('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', projectId, assessmentId, 'GITHUB', `${p.owner}/${p.repo}`, url, branch ?? p.branch ?? null, null, null, null, null, null, 'QUEUED', null, now());
    setStage(assessmentId, 'PROJECT_SUBMITTED');
    return { projectId, jobId: enqueue('analyze_project', assessmentId, { projectId }, `analyze:${projectId}`) };
  });
}

async function handleAnalyzeProject({ projectId }: { projectId: string }) {
  const proj = one('SELECT * FROM projects WHERE id=?', projectId);
  if (!proj) throw new PermanentJobError('NOT_FOUND', 'Project missing.');
  const aid = proj.assessment_id as string;
  run('UPDATE projects SET status=? WHERE id=?', 'RUNNING', projectId);
  const dir = path.join(config.dataDir, 'snapshots', projectId);
  let commits = null as Awaited<ReturnType<typeof fetchCommits>> | null; let historyNote: string | undefined;
  try {
    let zipBuf: Buffer; let commit: string | null = null; let ghOwner = '', ghRepo = '';
    if (proj.method === 'GITHUB') {
      const r = await resolveGithub(proj.repo_url, proj.branch ?? undefined);
      commit = r.commit; ghOwner = r.owner; ghRepo = r.repo;
      zipBuf = await downloadGithubArchive(r.owner, r.repo, r.commit);
      run('UPDATE projects SET branch=?, commit_id=? WHERE id=?', r.branch, r.commit, projectId);
    } else zipBuf = fs.readFileSync(path.join(config.dataDir, proj.upload_key));
    fs.rmSync(dir, { recursive: true, force: true });
    const manifest = await extractZipToSnapshot(zipBuf, dir);
    const snapshotRef = commit ? commit.slice(0, 7) : `zip-${manifest.archiveHash.slice(0, 10)}`;
    const result = analyzeSnapshot(dir, manifest);
    if (proj.method === 'GITHUB') {
      try { commits = await fetchCommits(ghOwner, ghRepo, commit!); } catch (e: any) { historyNote = `Commit history could not be retrieved (${String(e.message).slice(0, 80)}).`; }
    }
    const hist = proj.method === 'ZIP' ? classifyHistory(null) : commits ? classifyHistory(commits) : classifyHistory(null, historyNote);
    tx(() => {
      run('DELETE FROM evidence WHERE assessment_id=?', aid);
      for (const e of result.evidence) {
        const refs = e.refs.filter((r) => validateRef(dir, manifest, r)); // every reference must resolve against the stored snapshot
        if (!refs.length) continue;
        run('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', newId(), aid, projectId, snapshotRef, e.skill, e.topic, e.ruleId, e.ruleVersion, e.classification, e.findings, e.limitations, JSON.stringify(refs), e.excerpt, JSON.stringify(e.ctx), now());
      }
      for (const s of all('SELECT * FROM skills WHERE assessment_id=? AND supported=1', aid)) {
        const b = result.backing[s.name] ?? 'INCONCLUSIVE';
        run('UPDATE skills SET backing=? WHERE id=?', b, s.id);
      }
      run('UPDATE projects SET snapshot_dir=?, snapshot_ref=?, manifest=?, status=?, error=NULL WHERE id=?', dir, snapshotRef, JSON.stringify({ ...manifest, coverage: result.coverage, backingReason: result.backingReason }), 'READY', projectId);
      run('UPDATE assessments SET history_class=?, history_reason=? WHERE id=?', hist.cls, `${hist.reason}`, aid);
      setStage(aid, 'EVIDENCE_READY');
    });
    audit('project.analyzed', null, aid, { snapshotRef, history: hist.cls, rubric: HISTORY_RUBRIC_VERSION });
  } catch (e: any) {
    if (e instanceof SnapshotError || e instanceof GithubError) {
      run('UPDATE projects SET status=?, error=? WHERE id=?', 'FAILED', e.message, projectId);
      setStage(aid, 'SKILLS_EXTRACTED');
      throw new PermanentJobError(e.code, e.message);
    }
    if (e?.name === 'TimeoutError' || e?.name === 'TypeError') throw e; // transient network problem: retried with backoff
    run('UPDATE projects SET status=?, error=? WHERE id=?', 'FAILED', 'Analysis failed unexpectedly.', projectId);
    setStage(aid, 'SKILLS_EXTRACTED');
    throw new PermanentJobError('ANALYSIS_INCONCLUSIVE', 'Analysis failed unexpectedly. You can resubmit the project.');
  }
}

// ---------- views ----------
export function evidenceFor(assessmentId: string): EvidenceDto[] {
  return all('SELECT * FROM evidence WHERE assessment_id=? ORDER BY skill, topic', assessmentId).map((e) => ({
    id: e.id, skill: e.skill, topic: e.topic, ruleId: e.rule_id, ruleVersion: e.rule_version, classification: e.classification,
    findings: e.findings, limitations: e.limitations, refs: JSON.parse(e.refs), excerpt: e.excerpt,
  }));
}

const lifecycleRequired = (a: Row) => ['LIMITED', 'UNAVAILABLE'].includes(a.history_class ?? '');
export function allowedActions(a: Row): AllowedAction[] {
  const base = `/a/${a.id}`;
  const A = (type: string, label: string, p: string, blocked?: string): AllowedAction => ({ type, label, path: `${base}/${p}`, ...(blocked ? { blocked } : {}) });
  const r = one('SELECT status, error FROM resumes WHERE assessment_id=?', a.id);
  const proj = one('SELECT status, error FROM projects WHERE assessment_id=?', a.id);
  switch (a.stage as Stage) {
    case 'DRAFT': return [A('RESUME', r?.status === 'QUEUED' ? 'Reading your resume…' : 'Upload resume', 'resume', r?.status === 'QUEUED' ? 'Extraction in progress' : undefined)];
    case 'SKILLS_EXTRACTED': return [A('PROJECT', proj?.status === 'FAILED' ? 'Fix and resubmit project' : 'Submit project', 'project')];
    case 'PROJECT_SUBMITTED': return [A('PROJECT', 'Analysing your project…', 'project', 'Analysis in progress')];
    case 'EVIDENCE_READY': return [A('MCQ', scopeFrozen(a.id) ? 'Continue MCQs' : 'Start MCQs', 'mcq'), A('EVIDENCE', 'Review project evidence', 'evidence')];
    case 'MCQ_COMPLETED': case 'HISTORY_CHECKED': return lifecycleRequired(a) ? [A('LIFECYCLE', 'Explain how you built it', 'lifecycle')] : [A('VIVA', 'Start project viva', 'viva')];
    case 'LIFECYCLE_COMPLETED': return [A('VIVA', 'Start project viva', 'viva')];
    case 'VIVA_COMPLETED': return [A('MUTATION', 'Start mutation challenge', 'mutation')];
    case 'MUTATION_COMPLETED': case 'EVALUATING': return [A('CARD', 'Waiting for evaluation…', 'card', 'Evaluating your answers')];
    default: return [A('CARD', 'View proof card', 'card')];
  }
}
// The viva stage is also reachable while HISTORY_CHECKED with SUFFICIENT history; lifecycle gating lives in allowedActions.

export function assessmentDto(a: Row): AssessmentDto {
  const proj = one('SELECT * FROM projects WHERE assessment_id=?', a.id);
  const actions = allowedActions(a);
  return {
    id: a.id, stage: a.stage, createdAt: a.created_at, policyVersion: a.policy_version,
    historyClass: a.history_class, historyReason: a.history_reason,
    skills: all('SELECT * FROM skills WHERE assessment_id=?', a.id).sort((x, y) => SKILL_ORDER.indexOf(x.name) - SKILL_ORDER.indexOf(y.name))
      .map((s) => ({ id: s.id, name: s.name, alias: s.alias, where: s.where_found, supported: !!s.supported, status: s.status, backing: s.backing })),
    project: proj ? { id: proj.id, method: proj.method, label: proj.label, snapshotRef: proj.snapshot_ref, status: proj.status } : null,
    jobs: jobsFor(a.id).map((j) => ({ ...j, state: j.state as any })),
    nextAction: actions.find((x) => !x.blocked) ?? actions[0] ?? null, allowedActions: actions, consent: hasConsent(a.id),
    limits: { maxResumeMb: config.MAX_RESUME_MB, maxZipMb: config.MAX_ZIP_MB, maxExtractedMb: config.MAX_EXTRACTED_MB, maxEntries: config.MAX_ZIP_ENTRIES, maxFileMb: config.MAX_FILE_MB },
    mode: { ai: config.aiMode, auth: 'LOCAL_DEV', mcqTimed: config.MCQ_TIMED },
  };
}

// ---------- MCQ ----------
const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function startMcq(assessmentId: string): McqAttemptDto[] {
  const a = getAssessment(assessmentId)!;
  if (a.stage !== 'EVIDENCE_READY') throw new AppError(409, 'INVALID_STAGE', 'MCQs start after your project evidence is ready.');
  seedQuestions();
  tx(() => {
    for (const s of inScope(assessmentId)) {
      if (one('SELECT 1 x FROM mcq_attempts WHERE assessment_id=? AND skill=?', assessmentId, s.name)) continue;
      const qs = pickQuestions(s.name, config.MCQ_PER_SKILL);
      if (!qs.length) continue;
      const orders: Record<string, number[]> = {};
      qs.forEach((q) => (orders[q.id] = shuffle(q.options.map((_, i) => i))));
      const deadline = config.MCQ_TIMED ? new Date(Date.now() + config.MCQ_MINUTES_PER_SKILL * 60_000).toISOString() : null;
      run('INSERT INTO mcq_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', newId(), assessmentId, s.name, JSON.stringify(qs.map((q) => q.id)), JSON.stringify(orders), '{}', 'IN_PROGRESS', 0, now(), deadline, null, null, null);
    }
  });
  return mcqAttempts(assessmentId);
}

export function mcqAttempts(assessmentId: string): McqAttemptDto[] {
  return all('SELECT * FROM mcq_attempts WHERE assessment_id=?', assessmentId).sort((x, y) => SKILL_ORDER.indexOf(x.skill) - SKILL_ORDER.indexOf(y.skill)).map((at) => {
    const ids: string[] = JSON.parse(at.question_ids); const orders = JSON.parse(at.orders);
    return {
      id: at.id, skill: at.skill, status: at.status, revision: at.revision, deadline: at.deadline, answers: JSON.parse(at.answers),
      questions: ids.map((qid) => {
        const q = one('SELECT id,skill,text,options FROM mcq_questions WHERE id=?', qid)!; const opts: string[] = JSON.parse(q.options);
        return { id: q.id, skill: q.skill, text: q.text, options: (orders[qid] as number[]).map((orig, pos) => ({ id: pos, text: opts[orig] })) }; // no answer key leaves the server
      }),
    };
  });
}

export function saveMcq(attemptId: string, assessmentId: string, revision: number, answers: Record<string, number>) {
  const at = one('SELECT * FROM mcq_attempts WHERE id=? AND assessment_id=?', attemptId, assessmentId);
  if (!at) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
  if (at.status !== 'IN_PROGRESS') throw new AppError(409, 'CONFLICT', 'This section has already been submitted.');
  if (at.deadline && new Date(at.deadline) < new Date()) throw new AppError(409, 'CONFLICT', 'The time for this section has ended. Submit to finish.');
  if (at.revision !== revision) throw new AppError(409, 'CONFLICT', 'Your answers changed in another tab. Reload to continue.');
  const ids: string[] = JSON.parse(at.question_ids); const orders = JSON.parse(at.orders);
  const clean: Record<string, number> = {};
  for (const [q, v] of Object.entries(answers)) if (ids.includes(q) && v < orders[q].length) clean[q] = v;
  run('UPDATE mcq_attempts SET answers=?, revision=revision+1 WHERE id=?', JSON.stringify(clean), attemptId);
  return at.revision + 1;
}

export function submitMcq(attemptId: string, assessmentId: string) {
  return tx(() => {
    const at = one('SELECT * FROM mcq_attempts WHERE id=? AND assessment_id=?', attemptId, assessmentId);
    if (!at) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
    if (at.status === 'SUBMITTED') return { correct: at.correct, total: at.total }; // idempotent: graded once
    const ids: string[] = JSON.parse(at.question_ids); const orders = JSON.parse(at.orders); const ans = JSON.parse(at.answers);
    let correct = 0;
    for (const qid of ids) { const q = one('SELECT answer_idx FROM mcq_questions WHERE id=?', qid)!; if (ans[qid] != null && orders[qid][ans[qid]] === q.answer_idx) correct++; } // unanswered counts as incorrect
    run('UPDATE mcq_attempts SET status=?, submitted_at=?, correct=?, total=? WHERE id=?', 'SUBMITTED', now(), correct, ids.length, attemptId);
    if (!one('SELECT 1 x FROM mcq_attempts WHERE assessment_id=? AND status<>?', assessmentId, 'SUBMITTED')) advanceAfterMcq(assessmentId);
    return { correct, total: ids.length };
  });
}
function advanceAfterMcq(id: string) {
  const a = getAssessment(id)!;
  setStage(id, 'MCQ_COMPLETED');
  setStage(id, 'HISTORY_CHECKED'); // routing was computed from inspected history during analysis
  if (lifecycleRequired(a)) ensureLifecycleTasks(id);
}

// ---------- tasks (lifecycle, viva, mutation) ----------
export function tasksDto(assessmentId: string, kind: 'LIFECYCLE' | 'VIVA' | 'MUTATION'): TaskDto[] {
  return all('SELECT * FROM tasks WHERE assessment_id=? AND kind=? ORDER BY skill, idx', assessmentId, kind)
    .sort((x, y) => SKILL_ORDER.indexOf(x.skill ?? '') - SKILL_ORDER.indexOf(y.skill ?? '') || x.idx - y.idx).map((t) => {
      const r = one('SELECT * FROM responses WHERE task_id=?', t.id); const ev = r ? one('SELECT review_status FROM evaluations WHERE response_id=? ORDER BY revision DESC', r.id) : undefined;
      return {
        id: t.id, kind: t.kind, skill: t.skill, topic: t.topic, index: t.idx, prompt: t.prompt, fields: JSON.parse(t.fields), source: t.source ? JSON.parse(t.source) : null,
        response: r ? { status: r.status, revision: r.revision, fields: JSON.parse(r.fields), savedAt: r.updated_at } : null,
        evaluation: ev ? { reviewStatus: ev.review_status } : null,
      };
    });
}

const roundStage: Record<string, { from: Stage[]; label: string }> = {
  LIFECYCLE: { from: ['HISTORY_CHECKED', 'MCQ_COMPLETED'], label: 'The lifecycle explanation' },
  VIVA: { from: ['HISTORY_CHECKED', 'LIFECYCLE_COMPLETED'], label: 'The viva' },
  MUTATION: { from: ['VIVA_COMPLETED'], label: 'The mutation challenge' },
};
export function startRound(assessmentId: string, kind: 'LIFECYCLE' | 'VIVA' | 'MUTATION') {
  const a = getAssessment(assessmentId)!;
  const ok = roundStage[kind].from.includes(a.stage);
  if (!ok) { if (!getTasksExist(assessmentId, kind)) throw new AppError(409, 'INVALID_STAGE', `${roundStage[kind].label} is not available yet.`); return tasksDto(assessmentId, kind); }
  if (kind === 'LIFECYCLE') { if (!lifecycleRequired(a)) throw new AppError(409, 'INVALID_STAGE', 'A lifecycle explanation is not needed for this assessment.'); ensureLifecycleTasks(assessmentId); }
  if (kind === 'VIVA') { if (lifecycleRequired(a) && a.stage !== 'LIFECYCLE_COMPLETED') throw new AppError(409, 'INVALID_STAGE', 'Complete the lifecycle explanation first.'); ensureVivaTasks(assessmentId); }
  if (kind === 'MUTATION') ensureMutationTasks(assessmentId);
  const t = tasksDto(assessmentId, kind);
  if (!t.length) completeRound(assessmentId, kind); // nothing to ask: no project context for any skill
  return t;
}
const getTasksExist = (id: string, kind: string) => !!one('SELECT 1 x FROM tasks WHERE assessment_id=? AND kind=?', id, kind);

function taskOwned(taskId: string, assessmentId: string) {
  const t = one('SELECT * FROM tasks WHERE id=? AND assessment_id=?', taskId, assessmentId);
  if (!t) throw new AppError(404, 'NOT_FOUND', 'Task not found.');
  return t;
}
export function saveDraft(taskId: string, assessmentId: string, revision: number, fields: Record<string, string>) {
  const t = taskOwned(taskId, assessmentId);
  const allowed = new Set((JSON.parse(t.fields) as { id: string }[]).map((f) => f.id));
  const clean: Record<string, string> = {}; for (const [k, v] of Object.entries(fields)) if (allowed.has(k)) clean[k] = v;
  const r = one('SELECT * FROM responses WHERE task_id=?', taskId);
  if (!r) { run('INSERT INTO responses VALUES(?,?,?,?,?,?,?)', newId(), taskId, assessmentId, JSON.stringify(clean), 'DRAFT', 1, now()); return 1; }
  if (r.status === 'FINAL') throw new AppError(409, 'CONFLICT', 'This answer was already submitted and can no longer change.');
  if (r.revision !== revision) throw new AppError(409, 'CONFLICT', 'Your draft changed in another tab. Reload to continue.');
  run('UPDATE responses SET fields=?, revision=revision+1, updated_at=? WHERE id=?', JSON.stringify(clean), now(), r.id);
  return r.revision + 1;
}
export function submitAnswer(taskId: string, assessmentId: string) {
  return tx(() => {
    const t = taskOwned(taskId, assessmentId);
    const r = one('SELECT * FROM responses WHERE task_id=?', taskId);
    let rid = r?.id as string | undefined;
    if (!r) { rid = newId(); run('INSERT INTO responses VALUES(?,?,?,?,?,?,?)', rid, taskId, assessmentId, '{}', 'FINAL', 1, now()); }
    else if (r.status === 'DRAFT') run(`UPDATE responses SET status='FINAL', revision=revision+1, updated_at=? WHERE id=?`, now(), r.id);
    else return { alreadySubmitted: true }; // idempotent final submission
    if (t.kind !== 'LIFECYCLE') enqueue('evaluate_response', assessmentId, { responseId: rid }, `eval:${rid}`);
    const left = one<{ n: number }>(`SELECT COUNT(*) n FROM tasks t LEFT JOIN responses r ON r.task_id=t.id AND r.status='FINAL' WHERE t.assessment_id=? AND t.kind=? AND r.id IS NULL`, assessmentId, t.kind)!.n;
    if (left === 0) completeRound(assessmentId, t.kind);
    return { alreadySubmitted: false };
  });
}
function completeRound(id: string, kind: string) {
  if (kind === 'LIFECYCLE') setStage(id, 'LIFECYCLE_COMPLETED');
  else if (kind === 'VIVA') setStage(id, 'VIVA_COMPLETED');
  else if (kind === 'MUTATION') { setStage(id, 'MUTATION_COMPLETED'); setStage(id, 'EVALUATING'); enqueue('finalize_scorecard', id, { assessmentId: id }, `finalize:${id}:start`); }
}

// ---------- evaluation job ----------
async function handleEvaluate({ responseId }: { responseId: string }, job: Row) {
  const r = one('SELECT * FROM responses WHERE id=?', responseId);
  if (!r || r.status !== 'FINAL') throw new PermanentJobError('INVALID_STAGE', 'Response not final.');
  if (one('SELECT 1 x FROM evaluations WHERE response_id=?', responseId)) return;
  const t = one('SELECT * FROM tasks WHERE id=?', r.task_id)!;
  const task: EvalTask = { id: t.id, skill: t.skill, kind: t.kind, prompt: t.prompt, rubric: JSON.parse(t.rubric), source: t.source ? JSON.parse(t.source) : null };
  const fields = JSON.parse(r.fields);
  let out, problems: string[] = [];
  try { out = await evaluate(task, fields); problems = validateEvaluation(out, task); }
  catch (e) {
    if (e instanceof TransientAiError || (e as Error)?.name === 'TimeoutError') throw e;
    problems = [`unparseable evaluator output (${(e as Error)?.name})`];
  }
  if (problems.length && job.attempts < config.JOB_MAX_ATTEMPTS) throw new Error(`evaluation validation failed: ${problems.join('; ')}`); // bounded retry
  const status = problems.length ? 'NEEDS_REVIEW' : 'VALIDATED'; // never fabricate a passing result or a silent zero
  run('INSERT INTO evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', newId(), responseId, t.id, r.assessment_id, 1, RUBRIC_VERSION, out ? JSON.stringify(out.ratings) : null,
    out ? JSON.stringify(out.reasons) : null, out ? JSON.stringify({ refs: out.refs, flags: out.reviewFlags }) : null, status, out?.provider ?? config.AI_PROVIDER, out?.model ?? 'n/a', PROMPT_VERSION, JSON.stringify(problems), now());
  enqueue('finalize_scorecard', r.assessment_id, { assessmentId: r.assessment_id }, `finalize:${r.assessment_id}:${responseId}`);
}

// ---------- scorecard ----------
const parts = (id: string, skill: string, kind: 'VIVA' | 'MUTATION') => {
  const tasks = all('SELECT * FROM tasks WHERE assessment_id=? AND kind=? AND skill=? ORDER BY idx', id, kind, skill);
  return tasks.map((t) => {
    const r = one('SELECT * FROM responses WHERE task_id=?', t.id);
    const ev = r ? one('SELECT * FROM evaluations WHERE response_id=? ORDER BY revision DESC', r.id) : undefined;
    return { t, r, ev };
  });
};

function component(id: string, skill: string, kind: 'VIVA' | 'MUTATION', backing: string | null, findings: SkillResult['why']['findings']): ScoreComponent {
  const ps = parts(id, skill, kind);
  if (!ps.length) {
    const ev = usableEvidence(id); const topics = plannedTopics(skill, ev).length;
    const reason = kind === 'VIVA' && topics === 1 ? 'Only one topic was evidenced in your project; the viva needs at least two.'
      : backing === 'INCONCLUSIVE' || backing === 'NOT_DETECTED' || backing == null ? 'No usable project context for this skill, so project-based questions could not be grounded. A knowledge score is still possible.' : 'No questions could be grounded.';
    return { percent: null, state: 'INCOMPLETE', reason };
  }
  if (ps.some((p) => p.r?.status !== 'FINAL')) return { percent: null, state: 'INCOMPLETE', reason: 'Some answers have not been submitted.' };
  if (ps.some((p) => !p.ev)) return { percent: null, state: 'INCOMPLETE', reason: 'Evaluation is still running.' };
  if (ps.some((p) => p.ev?.review_status !== 'VALIDATED')) return { percent: null, state: 'NEEDS_REVIEW', reason: 'An evaluation needs review. It is not counted as zero.' };
  const slots = new Map<string, number[]>();
  for (const p of ps) {
    const ev = p.ev!; const rb: Rubric = JSON.parse(p.t.rubric); const ratings: { criterion: string; rating: number }[] = JSON.parse(ev.ratings); const reasons = JSON.parse(ev.reasons);
    const pct = responsePercent(rb.criteria.map((c) => ({ rating: ratings.find((x) => x.criterion === c.id)!.rating, weight: c.weight })));
    slots.set(p.t.topic, [...(slots.get(p.t.topic) ?? []), pct]);
    const src = p.t.source ? JSON.parse(p.t.source) : null;
    findings.push({ kind: kind === 'VIVA' ? 'Viva' : 'Mutation', text: `${p.t.prompt.slice(0, 110)}${p.t.prompt.length > 110 ? '…' : ''} → ${rb.criteria.map((c) => `${c.label}: ${ratings.find((x) => x.criterion === c.id)!.rating}/4`).join(', ')}. ${reasons[rb.criteria[0].id] ?? ''}`, ref: src ? `${src.path}:${src.startLine}-${src.endLine}` : undefined });
  }
  return { percent: componentFromSlots([...slots.values()]), state: 'COMPLETE' };
}

export function buildScorecard(id: string): Omit<ScorecardDto, 'id' | 'revision' | 'createdAt'> {
  const a = getAssessment(id)!; const proj = one('SELECT label, snapshot_ref FROM projects WHERE assessment_id=?', id);
  const skills: SkillResult[] = [];
  for (const s of inScope(id)) {
    const findings: SkillResult['why']['findings'] = [];
    const at = one('SELECT * FROM mcq_attempts WHERE assessment_id=? AND skill=?', id, s.name);
    const mcq: ScoreComponent = at?.status === 'SUBMITTED' ? { percent: mcqPercent(at.correct, at.total), state: 'COMPLETE' } : { percent: null, state: 'INCOMPLETE', reason: 'MCQs were not submitted.' };
    if (at?.status === 'SUBMITTED') findings.push({ kind: 'MCQ', text: `${at.correct} of ${at.total} correct. Unanswered questions count as incorrect.` });
    const viva = component(id, s.name, 'VIVA', s.backing, findings);
    const mutation = component(id, s.name, 'MUTATION', s.backing, findings);
    const final = calculateSkillScore({ mcq: mcq.percent, viva: viva.percent, mutation: mutation.percent });
    const review = [viva, mutation].some((c) => c.state === 'NEEDS_REVIEW');
    const status: SkillResult['status'] = final != null ? 'COMPLETE' : review ? 'NEEDS_REVIEW' : mcq.state === 'COMPLETE' && viva.state === 'INCOMPLETE' && mutation.state === 'INCOMPLETE' && !parts(id, s.name, 'VIVA').length ? 'KNOWLEDGE_ONLY' : 'INCOMPLETE';
    const reasons: string[] = []; let label: SkillResult['confidence']['label'] = 'Limited';
    if (final != null) {
      label = s.backing === 'SUPPORTED' ? 'Strong' : 'Moderate';
      reasons.push(s.backing === 'SUPPORTED' ? 'All three parts are validated and the project backs this skill.' : 'All three parts are validated, but project backing is partial.');
      if (config.aiMode === 'FIXTURE') { label = 'Moderate'; reasons.push('Answers were scored by the keyword-heuristic fixture evaluator, not a model, so confidence is capped.'); }
    } else reasons.push(viva.reason ?? mutation.reason ?? 'Components are incomplete.');
    const actions: string[] = [];
    if (s.backing === 'INCONCLUSIVE' || s.backing === 'NOT_DETECTED') actions.push(`Submit a project that uses ${s.name} so project-based questions can be asked.`);
    if (s.backing === 'PARTIAL') actions.push(`Strengthen ${s.name} in your project (for example error handling or connecting state, updates and rendering).`);
    if (viva.percent != null && viva.percent < 75) actions.push(`Practise explaining behaviour, edge cases and failure cases in your ${s.name} code.`);
    if (mutation.percent != null && mutation.percent < 75) actions.push(`Practise adapting ${s.name} code to a new requirement and describing how you would verify it.`);
    if (mcq.percent != null && mcq.percent < 70) actions.push(`Review ${s.name} fundamentals covered by the MCQ section.`);
    skills.push({ skill: s.name, backing: s.backing, final, status, mcq, viva, mutation, confidence: { label, reasons }, actions,
      why: { formula: final != null ? formulaText({ mcq: mcq.percent!, viva: viva.percent!, mutation: mutation.percent! }) : null, findings } });
  }
  const finals = skills.map((s) => s.final);
  const ov = overall(finals);
  const incompleteNames = skills.filter((s) => s.final == null).map((s) => s.skill);
  const ev = one(`SELECT provider, model FROM evaluations WHERE assessment_id=? LIMIT 1`, id);
  return {
    assessmentId: id, policyVersion: a.policy_version, rubricVersion: RUBRIC_VERSION, scorerVersion: SCORER_VERSION,
    overall: { value: ov, complete: ov != null, reason: ov != null ? 'Equal average of all assessed skills, each fully complete.' : skills.length === 0 ? 'No assessed skills.' : `Not complete: ${incompleteNames.join(', ')} still lack required parts. A partial average is never shown.` },
    skills, unsupportedScope: all('SELECT name FROM skills WHERE assessment_id=? AND status=\'UNSUPPORTED\'', id).map((s) => s.name),
    context: { historyClass: a.history_class as HistoryClass | null, historyReason: a.history_reason, lifecycleCompleted: !!one(`SELECT 1 x FROM responses r JOIN tasks t ON t.id=r.task_id WHERE r.assessment_id=? AND t.kind='LIFECYCLE' AND r.status='FINAL'`, id), mutationMode: 'ASSESSED_PROPOSAL', evaluator: ev ? `${ev.provider} / ${ev.model}` : config.aiMode === 'FIXTURE' ? 'fixture / keyword-heuristic-v1' : config.AI_PROVIDER },
    project: proj ? { label: proj.label, snapshotRef: proj.snapshot_ref } : null, isSample: !!a.is_sample,
  };
}

function finalizeIfReady(id: string) {
  const a = getAssessment(id)!;
  if (!['EVALUATING', 'COMPLETED', 'PROVISIONAL'].includes(a.stage)) return;
  const pending = one<{ n: number }>(`SELECT COUNT(*) n FROM responses r JOIN tasks t ON t.id=r.task_id WHERE r.assessment_id=? AND t.kind IN ('VIVA','MUTATION') AND r.status='FINAL' AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.response_id=r.id)`, id)!.n;
  if (pending > 0) return;
  const body = buildScorecard(id);
  const last = one('SELECT * FROM scorecards WHERE assessment_id=? ORDER BY revision DESC', id);
  if (!last || JSON.stringify(JSON.parse(last.body)) !== JSON.stringify(body)) run('INSERT INTO scorecards VALUES(?,?,?,?,?)', newId(), id, (last?.revision ?? 0) + 1, JSON.stringify(body), now());
  setStage(id, body.overall.complete ? 'COMPLETED' : 'PROVISIONAL');
}

export function scorecardDto(assessmentId: string): ScorecardDto | null {
  const r = one('SELECT * FROM scorecards WHERE assessment_id=? ORDER BY revision DESC', assessmentId);
  return r ? { ...JSON.parse(r.body), isSample: !!getAssessment(assessmentId)?.is_sample, id: r.id, revision: r.revision, createdAt: r.created_at } : null; // sample flag is read live, not frozen into the stored body
}

// ---------- worker entry ----------
export const handlers: Record<string, (p: any, job: Row) => Promise<void>> = {
  extract_resume: handleExtractResume,
  analyze_project: handleAnalyzeProject,
  evaluate_response: handleEvaluate,
  finalize_scorecard: async ({ assessmentId }) => { finalizeIfReady(assessmentId); },
};
void sha256;
