import type {
  ApiErrorBody, AssessmentDto, ComparisonDto, EvidenceDto, McqAttemptDto, ScorecardDto, SkillDto, TaskDto,
} from '@proof/contracts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false, public fieldErrors?: Record<string, string>) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, form?: FormData, idemKey?: string): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'proofskill' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idemKey) headers['idempotency-key'] = idemKey;
  let res: Response;
  try { res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch { throw new ApiError(0, 'NETWORK', 'Could not reach the server. Your work is kept; please try again.', true); }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong.', e?.retryable ?? res.status >= 500, e?.fieldErrors);
  }
  return json.data as T;
}

export interface User { id: string; email: string; role: string }
export interface SkillsInfo { skills: SkillDto[]; resume: { status: string; error: string | null; original_name: string } | null }
export interface EvidenceInfo {
  project: { status: string; error: string | null; snapshotRef: string | null } | null; evidence: EvidenceDto[]; skills: SkillDto[];
  coverage: null | { files: number; skipped: number; parsed: number; failed: string[]; truncated: boolean; backingReason: Record<string, string> };
}
export interface CardListItem { id: string; revision: number; createdAt: string; isSample: boolean; project: string | null; skills: { skill: string; complete: boolean }[] }
export interface Sharing {
  created: { id: string; scorecardId: string; label: string; expiresAt: string; revoked: boolean; accepted: boolean }[];
  shared: { invitationId: string; scorecardId: string; label: string; expiresAt: string }[];
}

export const api = {
  me: () => call<User>('GET', '/auth/me'),
  login: (email: string, password: string) => call<User>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string) => call<User>('POST', '/auth/register', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  list: () => call<AssessmentDto[]>('GET', '/assessments'),
  create: () => call<{ id: string }>('POST', '/assessments'),
  get: (id: string) => call<AssessmentDto>('GET', `/assessments/${id}`),
  skills: (id: string) => call<SkillsInfo>('GET', `/assessments/${id}/skills`),
  uploadResume: (id: string, file: File) => { const f = new FormData(); f.append('file', file); return call<{ processingJobId: string }>('POST', `/assessments/${id}/resume`, undefined, f); },
  consent: (id: string, scope: 'GITHUB_REPO' | 'ZIP_UPLOAD') => call('POST', `/assessments/${id}/consents`, { scope, acceptExternalAi: true, acceptAnalysis: true }),
  submitGithub: (id: string, repositoryUrl: string, branch?: string) => call<{ projectId: string; processingJobId: string }>('POST', `/assessments/${id}/projects`, { submissionMethod: 'GITHUB', repositoryUrl, ...(branch ? { branch } : {}) }),
  submitZip: (id: string, file: File) => { const f = new FormData(); f.append('submissionMethod', 'ZIP'); f.append('file', file); return call<{ projectId: string; processingJobId: string }>('POST', `/assessments/${id}/projects`, undefined, f); },
  evidence: (id: string) => call<EvidenceInfo>('GET', `/assessments/${id}/evidence`),
  mcqStart: (id: string) => call<McqAttemptDto[]>('POST', `/assessments/${id}/mcq/start`, undefined, undefined, `mcq-start-${id}`),
  mcq: (id: string) => call<McqAttemptDto[]>('GET', `/assessments/${id}/mcq`),
  mcqSave: (attempt: string, revision: number, answers: Record<string, number>) => call<{ revision: number }>('PUT', `/mcq-attempts/${attempt}/responses`, { revision, answers }),
  mcqSubmit: (attempt: string) => call<{ correct: number; total: number }>('POST', `/mcq-attempts/${attempt}/submit`, undefined, undefined, `mcq-submit-${attempt}`),
  roundStart: (id: string, kind: 'lifecycle' | 'viva' | 'mutation') => call<TaskDto[]>('POST', `/assessments/${id}/${kind}/start`),
  taskDraft: (task: string, revision: number, fields: Record<string, string>) => call<{ revision: number }>('PUT', `/tasks/${task}/draft`, { revision, fields }),
  taskSubmit: (task: string) => call<{ alreadySubmitted: boolean }>('POST', `/tasks/${task}/submit`, undefined, undefined, `task-submit-${task}`),
  scorecard: (id: string) => call<ScorecardDto>('GET', `/assessments/${id}/scorecard`),
  review: (id: string, body: { target: 'SKILLS' | 'EVIDENCE' | 'SCORECARD'; skill?: string; reference?: string; message: string }) => call('POST', `/assessments/${id}/review-requests`, body),
  cards: () => call<{ mine: CardListItem[]; sharing: Sharing }>('GET', '/comparison/cards'),
  invite: (card: string, displayLabel: string, expiresInDays: number) => call<{ id: string; token: string; expiresAt: string }>('POST', `/scorecards/${card}/comparison-invitations`, { displayLabel, expiresInDays }),
  accept: (token: string) => call<{ invitationId: string; scorecardId: string; label: string }>('POST', '/comparison-invitations/accept', { token }),
  revoke: (id: string) => call('DELETE', `/comparison-invitations/${id}`),
  compare: (ownScorecardId: string, sharedScorecardId: string) => call<ComparisonDto>('POST', '/candidate-comparisons', { ownScorecardId, sharedScorecardId }),
};
