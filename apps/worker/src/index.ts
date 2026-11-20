import { claimNext, config, handlers, runJob, seedQuestions, run, now } from '@proof/server-core';

seedQuestions();
console.log(`Worker started (AI evaluator: ${config.aiMode}, poll ${config.WORKER_POLL_MS} ms)`);
let beat = 0;
let stopping = false;
process.on('SIGINT', () => { stopping = true; });

while (!stopping) {
  const job = claimNext();
  if (job) { await runJob(job, handlers); continue; }
  if (++beat % 40 === 0) run('UPDATE jobs SET updated_at=updated_at WHERE 0'); // visible heartbeat hook; real metrics are a release item
  void now;
  await new Promise((r) => setTimeout(r, config.WORKER_POLL_MS));
}
