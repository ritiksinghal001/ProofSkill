// Creates labelled demo data by driving the real API with scripted answers. Cards are flagged SAMPLE.
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { config, one, run, newId, now, seedQuestions } from '@proof/server-core';
import { createApp } from './app.ts';
import { driveCandidate, drain } from './demo.ts';

seedQuestions();
const fx = path.resolve(import.meta.dirname, '../../../tests/fixtures');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const demos = [
  { email: 'demo-a@example.test', resume: 'resume-a.txt', project: 'shopping-cart.zip', quality: 'strong' as const, mcqCorrectRatio: 0.8 },
  { email: 'demo-b@example.test', resume: 'resume-b.txt', project: 'mini-api.zip', quality: 'mixed' as const, mcqCorrectRatio: 0.9 },
  { email: 'demo-c@example.test', resume: 'resume-c.txt', project: 'shopping-cart.zip', quality: 'strong' as const, mcqCorrectRatio: 0.7 },
];
for (const d of demos) {
  const out = await driveCandidate(base, { ...d, password: 'demo-password-1', resume: path.join(fx, d.resume), project: path.join(fx, d.project) });
  run('UPDATE assessments SET is_sample=1 WHERE id=?', out.assessmentId);
  console.log(`${d.email}: assessment ${out.assessmentId}, overall ${out.card.overall.value ?? 'not complete'}, ${out.card.skills.map((s) => `${s.skill}=${s.final?.toFixed(1) ?? s.status}`).join(', ')}`);
}
await drain();
if (!one('SELECT 1 x FROM users WHERE role=?', 'OPERATOR')) {
  const salt = crypto.randomBytes(16).toString('hex');
  run('INSERT INTO users VALUES(?,?,?,?,?,?)', newId(), 'operator@example.test', salt, crypto.scryptSync('operator-password-1', salt, 64).toString('hex'), 'OPERATOR', now());
}
console.log('\nDemo accounts (local dev only, password "demo-password-1"): demo-a@example.test, demo-b@example.test');
console.log('Operator: operator@example.test / operator-password-1  (data dir:', config.dataDir + ')');
server.close();
