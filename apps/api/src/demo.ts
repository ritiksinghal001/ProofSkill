// Scripted candidate driver over the real HTTP API. Used by `npm run seed` and the integration tests.
// It reads answer keys from the database ON PURPOSE to script MCQ answers. Real candidates can never do this (keys are server-only).
// Written answers are built from rubric keywords, so cards produced this way are labelled SAMPLE (scripted answers, fixture evaluator).
import fs from 'node:fs';
import * as core from '@proof/server-core';
import type { McqAttemptDto, TaskDto, ScorecardDto } from '@proof/contracts';

export class Client {
  cookie = '';
  constructor(public base: string) {}
  async raw(method: string, path: string, body?: unknown, form?: FormData) {
    const headers: Record<string, string> = { 'x-requested-with': 'proofskill' };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const set = res.headers.getSetCookie?.()[0];
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  async ok<T = any>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const r = await this.raw(method, path, body, form);
    if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json?.error)}`);
    return r.json.data as T;
  }
}

export async function drain(maxMs = 20000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const j = core.claimNext();
    if (j) { await core.runJob(j, core.handlers); continue; }
    if (!core.one<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE state IN ('QUEUED','RUNNING')`)!.n) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('worker queue did not drain');
}

const blob = (file: string, type: string) => new Blob([fs.readFileSync(file)], { type });

export type Quality = 'strong' | 'mixed' | 'weak';
const take = { strong: 6, mixed: 3, weak: 1 } as const;
function scripted(taskId: string, fieldIds: string[], q: Quality): Record<string, string> {
  const t = core.one('SELECT rubric FROM tasks WHERE id=?', taskId)!;
  const criteria = JSON.parse(t.rubric).criteria as { fields: string[]; keywords: string[] }[];
  const out: Record<string, string> = {};
  for (const f of fieldIds) {
    const kws = [...new Set(criteria.filter((c) => c.fields.includes(f)).flatMap((c) => c.keywords))];
    out[f] = `Scripted sample answer. The relevant points are ${kws.slice(0, take[q] * 2).join(', ')}, and this explanation covers them in order.`;
  }
  return out;
}

export interface DriveOpts { email: string; password: string; resume: string; project: string; quality: Quality; mcqCorrectRatio?: number }
export async function driveCandidate(base: string, o: DriveOpts) {
  const c = new Client(base);
  const reg = await c.raw('POST', '/auth/register', { email: o.email, password: o.password });
  if (reg.status === 409) await c.ok('POST', '/auth/login', { email: o.email, password: o.password });
  const { id } = await c.ok<{ id: string }>('POST', '/assessments');
  const f1 = new FormData(); f1.append('file', blob(o.resume, 'text/plain'), 'resume.txt');
  await c.ok('POST', `/assessments/${id}/resume`, undefined, f1); await drain();
  await c.ok('POST', `/assessments/${id}/consents`, { scope: 'ZIP_UPLOAD', acceptExternalAi: true, acceptAnalysis: true });
  const f2 = new FormData(); f2.append('file', blob(o.project, 'application/zip'), 'project.zip');
  await c.ok('POST', `/assessments/${id}/projects`, undefined, f2); await drain();

  const attempts = await c.ok<McqAttemptDto[]>('POST', `/assessments/${id}/mcq/start`);
  for (const at of attempts) {
    const answers: Record<string, number> = {};
    at.questions.forEach((q, i) => {
      const key = core.one('SELECT answer_idx FROM mcq_questions WHERE id=?', q.id)!.answer_idx;
      const orders = JSON.parse(core.one('SELECT orders FROM mcq_attempts WHERE id=?', at.id)!.orders)[q.id] as number[];
      const correctPos = orders.findIndex((orig) => orig === key);
      const wantCorrect = i < Math.round(at.questions.length * (o.mcqCorrectRatio ?? 0.8));
      answers[q.id] = wantCorrect ? correctPos : (correctPos + 1) % q.options.length;
    });
    await c.ok('PUT', `/mcq-attempts/${at.id}/responses`, { revision: 0, answers });
    await c.ok('POST', `/mcq-attempts/${at.id}/submit`);
  }
  const answerAll = async (kind: 'lifecycle' | 'viva' | 'mutation') => {
    const tasks = await c.ok<TaskDto[]>('POST', `/assessments/${id}/${kind}/start`);
    for (const t of tasks) {
      const fields = kind === 'lifecycle' ? { answer: 'I built the project in stages: first the data model, then the screens, then fixes after testing it by hand.' } : scripted(t.id, t.fields.map((x) => x.id), o.quality);
      await c.ok('PUT', `/tasks/${t.id}/draft`, { revision: 0, fields });
      await c.ok('POST', `/tasks/${t.id}/submit`);
    }
  };
  const a1 = await c.ok<any>('GET', `/assessments/${id}`);
  if (['LIMITED', 'UNAVAILABLE'].includes(a1.historyClass)) await answerAll('lifecycle');
  await answerAll('viva');
  await answerAll('mutation'); await drain();
  const card = await c.ok<ScorecardDto>('GET', `/assessments/${id}/scorecard`);
  return { client: c, assessmentId: id, card };
}
