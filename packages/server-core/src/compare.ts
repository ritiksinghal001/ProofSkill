// Optional, consent-based comparison of two proof cards. Access is by revocable, expiring, hashed invitation, never by an assessment ID alone.
import crypto from 'node:crypto';
import type { ComparisonDto, ScorecardDto } from '@proof/contracts';
import { compareCards, type CardForComparison } from '@proof/scoring';
import { all, audit, newId, now, one, run, sha256 } from './db.ts';
import { AppError } from './workflow.ts';

const hashToken = (t: string) => sha256(t);

const cardRow = (id: string) => one('SELECT s.*, a.user_id FROM scorecards s JOIN assessments a ON a.id=s.assessment_id WHERE s.id=?', id);
const toCard = (row: any, label: string): CardForComparison => {
  const b: ScorecardDto = JSON.parse(row.body);
  return { label, policyVersion: b.policyVersion, rubricVersion: b.rubricVersion, scorerVersion: b.scorerVersion,
    skills: b.skills.map((s) => ({ skill: s.skill, complete: s.status === 'COMPLETE', mcq: s.mcq.percent, viva: s.viva.percent, mutation: s.mutation.percent })) };
};

export function myCards(userId: string) {
  return all(`SELECT s.id, s.revision, s.created_at, s.body, a.is_sample FROM scorecards s JOIN assessments a ON a.id=s.assessment_id
              WHERE a.user_id=? AND s.revision=(SELECT MAX(revision) FROM scorecards WHERE assessment_id=s.assessment_id) ORDER BY s.created_at DESC`, userId)
    .map((r) => { const b: ScorecardDto = JSON.parse(r.body); return { id: r.id, revision: r.revision, createdAt: r.created_at, isSample: !!r.is_sample, skills: b.skills.map((s) => ({ skill: s.skill, complete: s.status === 'COMPLETE' })), project: b.project?.label ?? null }; });
}

export function createInvitation(userId: string, scorecardId: string, label: string, days: number) {
  const c = cardRow(scorecardId);
  if (!c || c.user_id !== userId) throw new AppError(404, 'NOT_FOUND', 'Proof card not found.');
  const token = crypto.randomBytes(32).toString('base64url'); // shown once; only the hash is stored
  const id = newId();
  run('INSERT INTO comparison_invitations VALUES(?,?,?,?,?,?,NULL,NULL,?)', id, userId, scorecardId, hashToken(token), label, new Date(Date.now() + days * 86400_000).toISOString(), now());
  audit('comparison.invitation.created', userId, c.assessment_id, { invitationId: id });
  return { id, token, expiresAt: new Date(Date.now() + days * 86400_000).toISOString() };
}

const live = (inv: any) => inv && !inv.revoked_at && new Date(inv.expires_at) > new Date();

export function acceptInvitation(userId: string, token: string) {
  const inv = one('SELECT * FROM comparison_invitations WHERE token_hash=?', hashToken(token));
  if (!live(inv)) throw new AppError(404, 'NOT_FOUND', 'This invitation is invalid, expired or revoked.');
  if (inv!.owner_user_id === userId) throw new AppError(409, 'CONFLICT', 'You cannot accept your own invitation.');
  if (inv!.accepted_user_id && inv!.accepted_user_id !== userId) throw new AppError(404, 'NOT_FOUND', 'This invitation is invalid, expired or revoked.');
  run('UPDATE comparison_invitations SET accepted_user_id=? WHERE id=?', userId, inv!.id);
  audit('comparison.invitation.accepted', userId, null, { invitationId: inv!.id });
  return { invitationId: inv!.id, scorecardId: inv!.scorecard_id, label: inv!.label };
}

export function revokeInvitation(userId: string, id: string) {
  const inv = one('SELECT * FROM comparison_invitations WHERE id=? AND owner_user_id=?', id, userId);
  if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
  run('UPDATE comparison_invitations SET revoked_at=? WHERE id=?', now(), id);
  audit('comparison.invitation.revoked', userId, null, { invitationId: id });
}

export function listSharing(userId: string) {
  return {
    created: all('SELECT id, scorecard_id, label, expires_at, revoked_at, accepted_user_id IS NOT NULL accepted FROM comparison_invitations WHERE owner_user_id=? ORDER BY created_at DESC', userId)
      .map((i) => ({ id: i.id, scorecardId: i.scorecard_id, label: i.label, expiresAt: i.expires_at, revoked: !!i.revoked_at, accepted: !!i.accepted })),
    shared: all('SELECT id, scorecard_id, label, expires_at, revoked_at FROM comparison_invitations WHERE accepted_user_id=? ORDER BY created_at DESC', userId)
      .filter((i) => live(i)).map((i) => ({ invitationId: i.id, scorecardId: i.scorecard_id, label: i.label, expiresAt: i.expires_at })),
  };
}

function toDto(run_: any, aLabel: string, bLabel: string): ComparisonDto {
  return { id: run_.id, createdAt: run_.created_at, policyVersion: run_.policy_version, a: { label: aLabel }, b: { label: bLabel }, result: JSON.parse(run_.result) };
}

export function createComparison(userId: string, ownId: string, sharedId: string): ComparisonDto {
  const own = cardRow(ownId);
  if (!own || own.user_id !== userId) throw new AppError(404, 'NOT_FOUND', 'Proof card not found.');
  const inv = one('SELECT * FROM comparison_invitations WHERE scorecard_id=? AND accepted_user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC', sharedId, userId, now());
  const shared = cardRow(sharedId);
  if (!inv || !shared) throw new AppError(404, 'NOT_FOUND', 'That proof card has not been shared with you, or access was revoked.'); // an ID alone never grants access
  const result = compareCards(toCard(own, 'You'), toCard(shared, inv.label));
  const id = newId();
  run('INSERT INTO comparison_runs VALUES(?,?,?,?,?,?,?,?)', id, userId, ownId, sharedId, inv.id, own.policy_version ?? 'policy', JSON.stringify(result), now());
  audit('comparison.created', userId, null, { id });
  const row = one('SELECT * FROM comparison_runs WHERE id=?', id)!;
  return toDto({ ...row, policy_version: JSON.parse(own.body).policyVersion }, 'You', inv.label);
}

export function getComparison(userId: string, id: string): ComparisonDto {
  const r = one('SELECT * FROM comparison_runs WHERE id=? AND user_id=?', id, userId);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Comparison not found.');
  const inv = one('SELECT * FROM comparison_invitations WHERE id=?', r.invitation_id);
  if (!live(inv)) throw new AppError(403, 'FORBIDDEN', 'Access to the shared proof card was revoked or has expired. Anything you already saw cannot be recalled.'); // revocation blocks saved results too
  return toDto(r, 'You', inv!.label);
}
