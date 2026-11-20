// Versioned history routing. Counts are supporting observations only; the decision rests on inspected progression.
import type { HistoryClass } from '@proof/contracts';
import type { CommitInfo } from './snapshot.ts';

export const HISTORY_RUBRIC_VERSION = 'history-rubric-0 (proposed, needs review on real repositories)';
const SRC = /\.(jsx?|tsx?|sql|mjs|cjs)$/i;

export function classifyHistory(commits: CommitInfo[] | null, reasonIfNull = 'No Git history was available (for example an uploaded ZIP).'): { cls: HistoryClass; reason: string } {
  if (!commits) return { cls: 'UNAVAILABLE', reason: reasonIfNull };
  const meaningful = commits.filter((c) => c.files.some((f) => SRC.test(f.name) && f.additions > 0));
  if (meaningful.length < 4) return { cls: 'LIMITED', reason: `Only ${meaningful.length} inspected commit(s) changed source code. At least 4 are needed to show a progression.` };
  const total = meaningful.reduce((s, c) => s + c.files.reduce((a, f) => a + f.additions, 0), 0);
  const biggest = Math.max(...meaningful.map((c) => c.files.reduce((a, f) => a + f.additions, 0)));
  if (total > 0 && biggest / total > 0.7) return { cls: 'LIMITED', reason: 'One commit contains most of the code, so a development progression cannot be traced.' };
  const areas = new Set(meaningful.flatMap((c) => c.files.filter((f) => SRC.test(f.name)).map((f) => f.name)));
  if (areas.size < 2) return { cls: 'LIMITED', reason: 'Changes touch a single source file, which does not show feature progression.' };
  const days = new Set(meaningful.map((c) => c.date.slice(0, 10))).size;
  return { cls: 'SUFFICIENT', reason: `${meaningful.length} inspected commits add code across ${areas.size} source files over ${days} day(s), with no single commit holding most changes. Counts are supporting observations only.` };
}
