import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import {
  acceptInvitationBody, comparisonBody, consentBody, credentialsBody, githubProjectBody, invitationBody, mcqSaveBody, reviewRequestBody, textAnswerBody,
  type ApiErrorBody, type ErrorCode,
} from '@proof/contracts';
import * as core from '@proof/server-core';
import { all, one, run, newId, now, audit, sha256, config, AppError } from '@proof/server-core';

declare module 'express-serve-static-core' { interface Request { user?: { id: string; email: string; role: string }; requestId: string } }

const COOKIE = 'ps_session';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(config.MAX_ZIP_MB, config.MAX_RESUME_MB) * 1024 * 1024, files: 1 } });

// ---- tiny in-memory fixed-window rate limiter (single process; use a shared store when scaled out) ----
const hits = new Map<string, { n: number; reset: number }>();
const limit = (name: string, max: number, windowMs = 60_000) => (req: Request, _res: Response, next: NextFunction) => {
  const key = `${name}:${req.user?.id ?? req.ip}`; const t = Date.now(); const h = hits.get(key);
  if (!h || h.reset < t) hits.set(key, { n: 1, reset: t + windowMs });
  else if (++h.n > max) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment.', undefined, true);
  next();
};

const parse = <T,>(schema: ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join('.') || 'body'] = i.message;
  throw new AppError(400, 'BAD_REQUEST', 'Some fields are invalid.', fieldErrors);
};

const hashPw = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 64).toString('hex');
function newSession(res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions VALUES(?,?,?)', sha256(token), userId, new Date(Date.now() + 7 * 86400_000).toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', maxAge: 7 * 86400_000, path: '/' });
}
const cookieOf = (req: Request, name: string) => req.headers.cookie?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token = cookieOf(req, COOKIE);
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  const row = one('SELECT u.id, u.email, u.role, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', sha256(decodeURIComponent(token)));
  if (!row || new Date(row.expires_at) < new Date()) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  req.user = { id: row.id, email: row.email, role: row.role };
  next();
}
const requireOperator = (req: Request, _res: Response, next: NextFunction) => { if (req.user?.role !== 'OPERATOR') throw new AppError(403, 'FORBIDDEN', 'Operator access required.'); next(); };

/** Candidate ownership is resolved on every request. IDs are identifiers, never permission grants; foreign records answer 404. */
function owned(req: Request, id = req.params.id as string) {
  const a = one('SELECT * FROM assessments WHERE id=? AND user_id=?', id, req.user!.id);
  if (!a) throw new AppError(404, 'NOT_FOUND', 'Assessment not found.');
  return a;
}
const ownerOf = (req: Request, table: 'tasks' | 'mcq_attempts', id: string) => {
  const r = one(`SELECT t.assessment_id FROM ${table} t JOIN assessments a ON a.id=t.assessment_id WHERE t.id=? AND a.user_id=?`, id, req.user!.id);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  return r.assessment_id as string;
};

/** Idempotency-Key support for starts and final submissions, scoped to actor and operation. */
async function idem<T>(req: Request, op: string, fn: () => T | Promise<T>): Promise<T> {
  const k = req.header('idempotency-key');
  if (!k) return fn();
  const key = `${req.user!.id}:${op}:${k}`;
  const hit = one('SELECT response FROM idempotency WHERE key=?', key);
  if (hit) return JSON.parse(hit.response);
  const out = await fn();
  run('INSERT OR IGNORE INTO idempotency VALUES(?,?,?)', key, JSON.stringify(out ?? null), now());
  return out;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('x-request-id', req.requestId); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('cache-control', 'no-store'); next(); });
  app.use(express.json({ limit: '256kb' }));
  // CSRF defence for cookie auth: SameSite=Lax cookie plus a required custom header on every state-changing request.
  app.use((req, _res, next) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.header('x-requested-with') !== 'proofskill') throw new AppError(403, 'FORBIDDEN', 'Missing request header.'); next(); });
  const ok = (req: Request, res: Response, data: unknown, status = 200) => res.status(status).json({ data, requestId: req.requestId });

  const r = express.Router();
  r.get('/health', (_q, s) => s.json({ live: true }));
  r.get('/ready', (_q, s) => { one('SELECT 1'); s.json({ ready: true, aiMode: config.aiMode }); });

  // ---- auth (LOCAL DEV AUTH: email + password. A managed provider is a pending integration, see docs/DECISIONS.md D-002) ----
  r.post('/auth/register', limit('auth', 20), (req, res) => {
    const b = parse(credentialsBody, req.body);
    if (one('SELECT 1 x FROM users WHERE email=?', b.email)) throw new AppError(409, 'CONFLICT', 'An account with this email already exists.');
    const id = newId(); const salt = crypto.randomBytes(16).toString('hex');
    run('INSERT INTO users VALUES(?,?,?,?,?,?)', id, b.email, salt, hashPw(b.password, salt), 'CANDIDATE', now()); // role is never taken from the request
    newSession(res, id); ok(req, res, { id, email: b.email, role: 'CANDIDATE' }, 201);
  });
  r.post('/auth/login', limit('auth', 20), (req, res) => {
    const b = parse(credentialsBody, req.body);
    const u = one('SELECT * FROM users WHERE email=?', b.email);
    const good = u && crypto.timingSafeEqual(Buffer.from(hashPw(b.password, u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex'));
    if (!good) throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
    newSession(res, u.id); ok(req, res, { id: u.id, email: u.email, role: u.role });
  });
  r.post('/auth/logout', (req, res) => { const t = cookieOf(req, COOKIE); if (t) run('DELETE FROM sessions WHERE token_hash=?', sha256(decodeURIComponent(t))); res.clearCookie(COOKIE); ok(req, res, { ok: true }); });
  r.get('/auth/me', requireUser, (req, res) => ok(req, res, req.user));

  r.use(requireUser);

  // ---- assessments ----
  r.post('/assessments', limit('create', 20), async (req, res) => ok(req, res, { id: await idem(req, 'assessment.create', () => core.createAssessment(req.user!.id)) }, 201));
  r.get('/assessments', (req, res) => ok(req, res, all('SELECT id FROM assessments WHERE user_id=? ORDER BY created_at DESC', req.user!.id).map((x) => core.assessmentDto(core.getAssessment(x.id)!))));
  r.get('/assessments/:id', (req, res) => ok(req, res, core.assessmentDto(owned(req))));
  r.get('/assessments/:id/skills', (req, res) => { const a = core.assessmentDto(owned(req)); ok(req, res, { skills: a.skills, resume: one('SELECT status, error, original_name FROM resumes WHERE assessment_id=?', a.id) ?? null, dictionaryVersion: 'dict-1' }); });

  r.post('/assessments/:id/resume', limit('upload', 15), upload.single('file'), (req, res) => {
    const a = owned(req);
    if (!req.file) throw new AppError(400, 'BAD_REQUEST', 'Choose a resume file.', { file: 'required' });
    const jobId = core.storeResume(a.id, req.user!.id, req.file.buffer, req.file.originalname);
    ok(req, res, { processingJobId: jobId, processingStatus: 'QUEUED' }, 202);
  });
  r.post('/assessments/:id/consents', (req, res) => { const a = owned(req); const b = parse(consentBody, req.body); core.recordConsent(a.id, req.user!.id, b.scope); ok(req, res, { recorded: true }, 201); });

  r.post('/assessments/:id/projects', limit('upload', 15), (req, res, next) => (req.is('multipart/form-data') ? upload.single('file')(req, res, next) : next()), async (req, res) => {
    const a = owned(req);
    if (req.is('multipart/form-data')) {
      if (!req.file) throw new AppError(400, 'BAD_REQUEST', 'Choose a ZIP file.', { file: 'required' });
      const out = core.submitZipProject(a.id, req.user!.id, req.file.buffer, req.file.originalname);
      return ok(req, res, { projectId: out.projectId, processingJobId: out.jobId, processingStatus: 'QUEUED' }, 202);
    }
    const b = parse(githubProjectBody, req.body);
    const out = await core.submitGithubProject(a.id, req.user!.id, b.repositoryUrl, b.branch);
    ok(req, res, { projectId: out.projectId, processingJobId: out.jobId, processingStatus: 'QUEUED' }, 202);
  });
  r.get('/assessments/:id/evidence', (req, res) => {
    const a = owned(req); const p = one('SELECT status, error, snapshot_ref, manifest FROM projects WHERE assessment_id=?', a.id);
    const m = p?.manifest ? JSON.parse(p.manifest) : null;
    ok(req, res, { project: p ? { status: p.status, error: p.error, snapshotRef: p.snapshot_ref } : null, evidence: core.evidenceFor(a.id), skills: core.assessmentDto(a).skills,
      coverage: m ? { files: m.files.length, skipped: m.skipped.length, parsed: m.coverage?.parsed, failed: m.coverage?.failed ?? [], truncated: m.truncated, backingReason: m.backingReason } : null });
  });
  r.get('/projects/:id/evidence', (req, res) => { const p = one('SELECT assessment_id FROM projects WHERE id=?', req.params.id); if (!p) throw new AppError(404, 'NOT_FOUND', 'Project not found.'); owned(req, p.assessment_id); ok(req, res, core.evidenceFor(p.assessment_id)); });
  r.get('/processing-jobs/:id', (req, res) => {
    const j = one('SELECT id, assessment_id, type, state, attempts, error FROM jobs WHERE id=?', req.params.id);
    if (!j?.assessment_id) throw new AppError(404, 'NOT_FOUND', 'Job not found.'); owned(req, j.assessment_id);
    ok(req, res, { id: j.id, type: j.type, state: j.state, attempts: j.attempts, error: j.error });
  });

  // ---- MCQs ----
  r.post('/assessments/:id/mcq/start', async (req, res) => { const a = owned(req); ok(req, res, await idem(req, `mcq.start:${a.id}`, () => core.startMcq(a.id))); });
  r.get('/assessments/:id/mcq', (req, res) => ok(req, res, core.mcqAttempts(owned(req).id)));
  r.put('/mcq-attempts/:id/responses', (req, res) => { const aid = ownerOf(req, 'mcq_attempts', req.params.id as string); const b = parse(mcqSaveBody, req.body); ok(req, res, { revision: core.saveMcq(req.params.id as string, aid, b.revision, b.answers), savedAt: now() }); });
  r.post('/mcq-attempts/:id/submit', async (req, res) => { const aid = ownerOf(req, 'mcq_attempts', req.params.id as string); ok(req, res, await idem(req, `mcq.submit:${req.params.id}`, () => core.submitMcq(req.params.id as string, aid))); });

  // ---- lifecycle, viva, mutation (generic task endpoints; see DECISIONS D-007 for the path deviation from /viva-sessions) ----
  for (const kind of ['lifecycle', 'viva', 'mutation'] as const) {
    r.post(`/assessments/:id/${kind}/start`, async (req, res) => { const a = owned(req); ok(req, res, await idem(req, `${kind}.start:${a.id}`, () => core.startRound(a.id, kind.toUpperCase() as any))); });
    r.get(`/assessments/:id/${kind}`, (req, res) => ok(req, res, core.tasksDto(owned(req).id, kind.toUpperCase() as any)));
  }
  r.put('/tasks/:id/draft', (req, res) => { const aid = ownerOf(req, 'tasks', req.params.id as string); const b = parse(textAnswerBody, req.body); ok(req, res, { revision: core.saveDraft(req.params.id as string, aid, b.revision, b.fields), savedAt: now() }); });
  r.post('/tasks/:id/submit', async (req, res) => { const aid = ownerOf(req, 'tasks', req.params.id as string); ok(req, res, await idem(req, `task.submit:${req.params.id}`, () => core.submitAnswer(req.params.id as string, aid))); });

  r.get('/assessments/:id/scorecard', (req, res) => {
    const a = owned(req); const c = core.scorecardDto(a.id);
    if (!c) throw new AppError(409, 'EVALUATION_PENDING_REVIEW' as ErrorCode, 'Your proof card is not ready yet.', undefined, true);
    ok(req, res, c);
  });
  r.post('/assessments/:id/review-requests', limit('review', 10), (req, res) => {
    const a = owned(req); const b = parse(reviewRequestBody, req.body);
    run('INSERT INTO review_requests VALUES(?,?,?,?,?,?,?,?,?)', newId(), a.id, req.user!.id, b.target, b.skill ?? null, b.reference ?? null, b.message, 'OPEN', now());
    audit('review.requested', req.user!.id, a.id, { target: b.target }); ok(req, res, { recorded: true }, 201);
  });

  // ---- comparison ----
  r.get('/comparison/cards', (req, res) => ok(req, res, { mine: core.myCards(req.user!.id), sharing: core.listSharing(req.user!.id) }));
  r.post('/scorecards/:id/comparison-invitations', (req, res) => { const b = parse(invitationBody, req.body); ok(req, res, core.createInvitation(req.user!.id, req.params.id as string, b.displayLabel, b.expiresInDays), 201); });
  r.post('/comparison-invitations/accept', limit('accept', 10), (req, res) => ok(req, res, core.acceptInvitation(req.user!.id, parse(acceptInvitationBody, req.body).token)));
  r.delete('/comparison-invitations/:id', (req, res) => { core.revokeInvitation(req.user!.id, req.params.id as string); ok(req, res, { revoked: true }); });
  r.post('/candidate-comparisons', (req, res) => { const b = parse(comparisonBody, req.body); ok(req, res, core.createComparison(req.user!.id, b.ownScorecardId, b.sharedScorecardId), 201); });
  r.get('/candidate-comparisons/:id', (req, res) => ok(req, res, core.getComparison(req.user!.id, req.params.id as string)));

  // ---- restricted operational support (candidate data is not browsable) ----
  r.get('/ops/failed-jobs', requireOperator, (req, res) => ok(req, res, all(`SELECT id, type, attempts, error, updated_at FROM jobs WHERE state='FAILED' ORDER BY updated_at DESC LIMIT 50`)));
  r.get('/ops/review-requests', requireOperator, (req, res) => ok(req, res, all(`SELECT id, assessment_id, target, skill, message, status, created_at FROM review_requests WHERE status='OPEN' ORDER BY created_at LIMIT 50`)));

  app.use('/api/v1', r);
  app.use('/api', (_q, _s, next) => next(new AppError(404, 'NOT_FOUND', 'Unknown endpoint.')));

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    let status = 500; let code: ErrorCode = 'BAD_REQUEST'; let message = 'Something went wrong. Please try again.'; let fieldErrors: Record<string, string> | undefined; let retryable = true;
    if (err instanceof AppError) { status = err.status; code = err.code as ErrorCode; message = err.message; fieldErrors = err.fieldErrors; retryable = err.retryable; }
    else if (err instanceof ZodError) { status = 400; message = 'Invalid input.'; retryable = false; }
    else if (err?.code === 'LIMIT_FILE_SIZE') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'The file is larger than the allowed limit.'; retryable = false; }
    else if (err?.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON.'; retryable = false; }
    else { console.error(`[${req.requestId}]`, err?.message ?? err); } // never leak stack traces or provider errors
    const body: ApiErrorBody = { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}), retryable }, requestId: req.requestId };
    res.status(status).json(body);
  });
  return app;
}
