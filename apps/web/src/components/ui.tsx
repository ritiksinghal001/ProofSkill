import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EVIDENCE_LABEL, type AssessmentDto, type EvidenceClass } from '@proof/contracts';
import { api, ApiError } from '../services/api';

const BADGE: Record<EvidenceClass, string> = { SUPPORTED: 'sup', PARTIAL: 'par', NOT_DETECTED: 'nd', INCONCLUSIVE: 'inc' };
export const Backing = ({ value }: { value: EvidenceClass | null }) =>
  value ? <span className={`b ${BADGE[value]}`}>{EVIDENCE_LABEL[value]}</span> : <span className="b pend">Not checked yet</span>;

export const Pill = ({ tone, children }: { tone: 'sup' | 'par' | 'nd' | 'inc' | 'pend' | 'fail'; children: ReactNode }) => <span className={`b ${tone}`}>{children}</span>;

export const ErrorNote = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="alert err" role="alert">
      {e.message || 'Something went wrong.'}
      {onRetry && (e.retryable ?? true) ? <> <button className="btn2" style={{ marginLeft: 8, minHeight: 36 }} onClick={onRetry}>Try again</button></> : null}
    </div>
  );
};

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <p className="muted" role="status">{label}</p>;

export const CodeBlock = ({ text, startLine, label }: { text: string; startLine: number; label: string }) => (
  <div className="code" role="region" aria-label={label} tabIndex={0}>
    {text.split('\n').map((l, i) => (
      <div key={i}><span className="ln">{startLine + i}</span>{l}</div>
    ))}
  </div>
);

export function SavedStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const text = state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Saved' : state === 'error' ? 'Not saved. Your text is kept here, retrying…' : '';
  return <p className="small" style={{ fontWeight: 600, color: state === 'error' ? 'var(--red)' : 'var(--teal-ink)', minHeight: 20 }} role="status" aria-live="polite">{text}</p>;
}

/** Loads one assessment and keeps it fresh while background work is pending (server-backed stage, never a browser guess). */
export function useAssessment(id: string) {
  const [a, setA] = useState<AssessmentDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => { try { setA(await api.get(id)); setError(null); } catch (e) { setError(e); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const busy = !!a && (['PROJECT_SUBMITTED', 'MUTATION_COMPLETED', 'EVALUATING'].includes(a.stage) || a.jobs.some((j) => j.state === 'QUEUED' || j.state === 'RUNNING'));
  useEffect(() => {
    if (!busy) return;
    let delay = 1000; let t: number;
    const tick = async () => { await load(); delay = Math.min(delay * 1.3, 4000); t = window.setTimeout(tick, delay); }; // polling with backoff
    t = window.setTimeout(tick, delay);
    return () => window.clearTimeout(t);
  }, [busy, load]);
  return { a, error, reload: load };
}

/** Debounced autosave. Keeps the latest value locally if a request fails and retries on the next change. */
export function useAutosave<T>(save: (v: T) => Promise<void>, delay = 700) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<number>(0); const latest = useRef<T | null>(null); const inflight = useRef(false);
  const run = useCallback(async () => {
    if (inflight.current || latest.current == null) return;
    inflight.current = true; const v = latest.current; latest.current = null; setState('saving');
    try { await save(v); setState(latest.current == null ? 'saved' : 'saving'); }
    catch (e) { if ((e as ApiError).status === 409) { setState('error'); } else { latest.current = latest.current ?? v; setState('error'); } }
    finally { inflight.current = false; if (latest.current != null) timer.current = window.setTimeout(run, 1500); }
  }, [save]);
  const push = useCallback((v: T) => { latest.current = v; window.clearTimeout(timer.current); timer.current = window.setTimeout(run, delay); }, [run, delay]);
  const flush = useCallback(async () => { window.clearTimeout(timer.current); await run(); }, [run]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { state, push, flush };
}

export const fmtScore = (n: number | null | undefined) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));
