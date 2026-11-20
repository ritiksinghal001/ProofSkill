// Browser-safe contracts: schemas, status names and DTO shapes. No answer keys, no scoring logic.
import { z } from 'zod';

export const POLICY_VERSION = 'policy-1.3.0';
export const RUBRIC_VERSION = 'rubric-1.0.0';
export const DICTIONARY_VERSION = 'dict-1';
export const NOTICE_VERSION = 'notice-1';

export const STAGES = [
  'DRAFT', 'SKILLS_EXTRACTED', 'PROJECT_SUBMITTED', 'EVIDENCE_READY', 'MCQ_COMPLETED',
  'HISTORY_CHECKED', 'LIFECYCLE_COMPLETED', 'VIVA_COMPLETED', 'MUTATION_COMPLETED',
  'EVALUATING', 'COMPLETED', 'PROVISIONAL',
] as const;
export type Stage = (typeof STAGES)[number];

export const EVIDENCE_CLASSES = ['SUPPORTED', 'PARTIAL', 'NOT_DETECTED', 'INCONCLUSIVE'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  SUPPORTED: 'Supported', PARTIAL: 'Partial', NOT_DETECTED: 'Not detected', INCONCLUSIVE: 'Inconclusive',
};

export const HISTORY_CLASSES = ['SUFFICIENT', 'LIMITED', 'UNAVAILABLE'] as const;
export type HistoryClass = (typeof HISTORY_CLASSES)[number];

export type JobState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type ReviewStatus = 'PENDING' | 'VALIDATED' | 'NEEDS_REVIEW';

export const ERROR_CODES = [
  'BAD_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE', 'RATE_LIMITED', 'CONSENT_REQUIRED', 'INVALID_STAGE', 'UNSUPPORTED_FILE',
  'PROJECT_TOO_LARGE', 'REPOSITORY_INACCESSIBLE', 'ANALYSIS_INCONCLUSIVE', 'EVALUATION_PENDING_REVIEW',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string>; retryable: boolean };
  requestId: string;
}
export interface ApiOk<T> { data: T; requestId: string }

// ---- request bodies ----
export const credentialsBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
export const consentBody = z.object({
  scope: z.enum(['GITHUB_REPO', 'ZIP_UPLOAD']),
  acceptExternalAi: z.literal(true),
  acceptAnalysis: z.literal(true),
});
export const githubProjectBody = z.object({
  submissionMethod: z.literal('GITHUB'),
  repositoryUrl: z.string().url().max(300),
  branch: z.string().trim().max(100).optional(),
});
export const mcqSaveBody = z.object({
  revision: z.number().int().min(0),
  answers: z.record(z.string(), z.number().int().min(0).max(9)),
});
export const textAnswerBody = z.object({
  revision: z.number().int().min(0),
  fields: z.record(z.string(), z.string().max(8000)),
});
export const reviewRequestBody = z.object({
  target: z.enum(['SKILLS', 'EVIDENCE', 'SCORECARD']),
  skill: z.string().max(80).optional(),
  reference: z.string().max(300).optional(),
  message: z.string().trim().min(3).max(1500),
});
export const invitationBody = z.object({
  displayLabel: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export const acceptInvitationBody = z.object({ token: z.string().min(20).max(200) });
export const comparisonBody = z.object({ ownScorecardId: z.string(), sharedScorecardId: z.string() });

// ---- response DTOs ----
export interface AllowedAction { type: string; label: string; path: string; blocked?: string }
export interface SkillDto {
  id: string; name: string; alias: string; where: string;
  supported: boolean; status: 'IN_SCOPE' | 'UNSUPPORTED' | 'IGNORED_LEARNING';
  backing: EvidenceClass | null;
}
export interface AssessmentDto {
  id: string; stage: Stage; createdAt: string; policyVersion: string;
  historyClass: HistoryClass | null; historyReason: string | null;
  skills: SkillDto[];
  project: null | { id: string; method: 'GITHUB' | 'ZIP'; label: string; snapshotRef: string | null; status: string };
  jobs: { id: string; type: string; state: JobState; error: string | null }[];
  nextAction: AllowedAction | null;
  allowedActions: AllowedAction[];
  consent: boolean;
  limits: { maxResumeMb: number; maxZipMb: number; maxExtractedMb: number; maxEntries: number; maxFileMb: number };
  mode: { ai: 'FIXTURE' | 'LIVE'; auth: 'LOCAL_DEV'; mcqTimed: boolean };
}
export interface EvidenceDto {
  id: string; skill: string; topic: string; ruleId: string; ruleVersion: number;
  classification: EvidenceClass; findings: string; limitations: string;
  refs: { path: string; hash: string; startLine: number; endLine: number }[];
  excerpt: string | null;
}
export interface McqQuestionDto { id: string; skill: string; text: string; options: { id: number; text: string }[] }
export interface McqAttemptDto {
  id: string; skill: string; status: 'IN_PROGRESS' | 'SUBMITTED'; revision: number;
  deadline: string | null; questions: McqQuestionDto[]; answers: Record<string, number>;
}
export interface TaskDto {
  id: string; kind: 'LIFECYCLE' | 'VIVA' | 'MUTATION'; skill: string | null; topic: string; index: number;
  prompt: string; fields: { id: string; label: string; hint?: string; code?: boolean }[];
  source: null | { path: string; startLine: number; endLine: number; snapshotRef: string; excerpt: string };
  response: { status: 'DRAFT' | 'FINAL'; revision: number; fields: Record<string, string>; savedAt: string } | null;
  evaluation: null | { reviewStatus: ReviewStatus };
}
export interface ScoreComponent { percent: number | null; state: 'COMPLETE' | 'INCOMPLETE' | 'NEEDS_REVIEW' | 'NOT_APPLICABLE'; reason?: string }
export interface SkillResult {
  skill: string; backing: EvidenceClass | null; final: number | null;
  status: 'COMPLETE' | 'INCOMPLETE' | 'KNOWLEDGE_ONLY' | 'NEEDS_REVIEW';
  mcq: ScoreComponent; viva: ScoreComponent; mutation: ScoreComponent;
  confidence: { label: 'Limited' | 'Moderate' | 'Strong'; reasons: string[] };
  why: { formula: string | null; findings: { kind: string; text: string; ref?: string }[] };
  actions: string[];
}
export interface ScorecardDto {
  id: string; assessmentId: string; revision: number; createdAt: string;
  policyVersion: string; rubricVersion: string; scorerVersion: string;
  overall: { value: number | null; complete: boolean; reason: string };
  skills: SkillResult[];
  unsupportedScope: string[];
  context: { historyClass: HistoryClass | null; historyReason: string | null; lifecycleCompleted: boolean; mutationMode: 'ASSESSED_PROPOSAL'; evaluator: string };
  project: { label: string; snapshotRef: string | null } | null;
  isSample: boolean;
}
export interface ComparisonDto {
  id: string; createdAt: string; policyVersion: string;
  a: { label: string }; b: { label: string };
  result: ComparisonResult;
}
export interface ComparisonResult {
  status: 'COMPARABLE' | 'WITHHELD' | 'NOT_COMPARABLE';
  headline: string;
  common: string[]; unmatchedA: string[]; unmatchedB: string[];
  perSkill: { skill: string; a: Parts; b: Parts; diff: number }[];
  averageA: number | null; averageB: number | null; winner: 'A' | 'B' | 'TIE' | null;
  reasons: string[]; limitations: string[];
}
export interface Parts { mcq: number; viva: number; mutation: number; final: number }
