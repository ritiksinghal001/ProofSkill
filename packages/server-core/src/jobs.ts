// Durable job table: atomic claims, leases, bounded retries with exponential backoff and jitter. Permanent errors are not retried.
import { all, newId, now, one, run, tx, type Row } from './db.ts';
import { config } from './config.ts';

export class PermanentJobError extends Error { constructor(public code: string, message: string) { super(message); } }

export function enqueue(type: string, assessmentId: string | null, payload: object, idemKey?: string): string {
  if (idemKey) { const ex = one<{ id: string }>('SELECT id FROM jobs WHERE idem_key=?', idemKey); if (ex) return ex.id; }
  const id = newId();
  run('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, assessmentId, type, JSON.stringify(payload), 'QUEUED', 0, now(), null, null, idemKey ?? null, now(), now());
  return id;
}

export function claimNext(): Row | undefined {
  return tx(() => {
    const t = now();
    const job = one(`SELECT * FROM jobs WHERE (state='QUEUED' AND run_at<=?) OR (state='RUNNING' AND lease_until<?) ORDER BY created_at LIMIT 1`, t, t);
    if (!job) return undefined;
    const lease = new Date(Date.now() + 60_000).toISOString();
    run(`UPDATE jobs SET state='RUNNING', attempts=attempts+1, lease_until=?, updated_at=? WHERE id=?`, lease, t, job.id);
    return { ...job, attempts: job.attempts + 1 };
  });
}

export async function runJob(job: Row, handlers: Record<string, (payload: any, job: Row) => Promise<void>>) {
  const h = handlers[job.type];
  try {
    if (!h) throw new PermanentJobError('NO_HANDLER', `No handler for ${job.type}`);
    await h(JSON.parse(job.payload), job);
    run(`UPDATE jobs SET state='SUCCEEDED', lease_until=NULL, error=NULL, updated_at=? WHERE id=?`, now(), job.id);
  } catch (e: any) {
    const permanent = e instanceof PermanentJobError || job.attempts >= config.JOB_MAX_ATTEMPTS;
    const safe = e instanceof PermanentJobError || e?.code ? String(e.message).slice(0, 300) : 'A temporary problem occurred. It will be retried.';
    if (permanent) run(`UPDATE jobs SET state='FAILED', lease_until=NULL, error=?, updated_at=? WHERE id=?`, safe, now(), job.id);
    else {
      const delay = Math.min(30_000, 500 * 2 ** job.attempts) + Math.random() * 400;
      run(`UPDATE jobs SET state='QUEUED', lease_until=NULL, error=?, run_at=?, updated_at=? WHERE id=?`, safe, new Date(Date.now() + delay).toISOString(), now(), job.id);
    }
    if (!(e instanceof PermanentJobError)) console.error(`[job ${job.type}] attempt ${job.attempts}:`, e?.message ?? e);
  }
}

export const jobsFor = (assessmentId: string) =>
  all<{ id: string; type: string; state: string; error: string | null }>('SELECT id,type,state,error FROM jobs WHERE assessment_id=? ORDER BY created_at DESC LIMIT 8', assessmentId);
