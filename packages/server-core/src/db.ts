// Local-development store: node:sqlite. See docs/DECISIONS.md (D-001): the spec proposes PostgreSQL + Prisma,
// which needs a database server that is not available here. Access goes through this one module so a swap is contained.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';

fs.mkdirSync(config.dataDir, { recursive: true });
const file = process.env.DB_FILE ?? path.join(config.dataDir, 'proofskill.sqlite');
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'CANDIDATE', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), stage TEXT NOT NULL, policy_version TEXT NOT NULL,
  history_class TEXT, history_reason TEXT, is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resumes(assessment_id TEXT PRIMARY KEY REFERENCES assessments(id), file_key TEXT NOT NULL, original_name TEXT, status TEXT NOT NULL, text TEXT, error TEXT, dictionary_version TEXT);
CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id), name TEXT NOT NULL, alias TEXT, where_found TEXT, supported INTEGER NOT NULL, status TEXT NOT NULL, backing TEXT, UNIQUE(assessment_id, name));
CREATE TABLE IF NOT EXISTS consents(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id), user_id TEXT NOT NULL, scope TEXT NOT NULL, notice_version TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL UNIQUE REFERENCES assessments(id), method TEXT NOT NULL, label TEXT NOT NULL, repo_url TEXT, branch TEXT, commit_id TEXT, upload_key TEXT,
  snapshot_dir TEXT, snapshot_ref TEXT, manifest TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, project_id TEXT NOT NULL, snapshot_ref TEXT NOT NULL, skill TEXT NOT NULL, topic TEXT NOT NULL, rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL,
  classification TEXT NOT NULL, findings TEXT NOT NULL, limitations TEXT NOT NULL, refs TEXT NOT NULL, excerpt TEXT, ctx TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, assessment_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, run_at TEXT NOT NULL, lease_until TEXT, error TEXT, idem_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcq_questions(id TEXT PRIMARY KEY, skill TEXT NOT NULL, topic TEXT NOT NULL, difficulty TEXT NOT NULL, text TEXT NOT NULL, options TEXT NOT NULL, answer_idx INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS mcq_attempts(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, skill TEXT NOT NULL, question_ids TEXT NOT NULL, orders TEXT NOT NULL, answers TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, deadline TEXT, submitted_at TEXT, correct INTEGER, total INTEGER, UNIQUE(assessment_id, skill));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, kind TEXT NOT NULL, skill TEXT, topic TEXT NOT NULL, idx INTEGER NOT NULL, prompt TEXT NOT NULL, fields TEXT NOT NULL, source TEXT, rubric TEXT NOT NULL, evidence_id TEXT, generator TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), assessment_id TEXT NOT NULL, fields TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY, response_id TEXT NOT NULL, task_id TEXT NOT NULL, assessment_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, rubric_version TEXT NOT NULL, ratings TEXT, reasons TEXT, refs TEXT, review_status TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, validation TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scorecards(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(assessment_id, revision));
CREATE TABLE IF NOT EXISTS review_requests(id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, user_id TEXT NOT NULL, target TEXT NOT NULL, skill TEXT, reference TEXT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comparison_invitations(id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, scorecard_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, accepted_user_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comparison_runs(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, a_scorecard_id TEXT NOT NULL, b_scorecard_id TEXT NOT NULL, invitation_id TEXT NOT NULL, policy_version TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY, user_id TEXT, assessment_id TEXT, type TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, response TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, run_at);
CREATE INDEX IF NOT EXISTS idx_evidence_assessment ON evidence(assessment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assessment ON tasks(assessment_id, kind);
`);

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export type Row = Record<string, any>;
export const one = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export const all = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const audit = (type: string, userId: string | null, assessmentId: string | null, detail?: unknown) =>
  run('INSERT INTO audit_events VALUES(?,?,?,?,?,?)', newId(), userId, assessmentId, type, detail ? JSON.stringify(detail) : null, now());
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
