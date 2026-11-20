import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TaskDto } from '@proof/contracts';
import { useCurrent } from '../app/App';
import { api } from '../services/api';
import { CodeBlock, ErrorNote, Loading, SavedStatus, useAutosave } from './ui';

interface Props { kind: 'lifecycle' | 'viva' | 'mutation'; eyebrow: string; title: string; intro: string; sourceLabel: string; requestLabel: string }

/** Shared runner for lifecycle, viva and mutation: source on the left (read-only), question and answer on the right. */
export function TaskRound({ kind, eyebrow, title, intro, sourceLabel, requestLabel }: Props) {
  const { a, reload } = useCurrent();
  const [tasks, setTasks] = useState<TaskDto[] | null>(null); const [err, setErr] = useState<unknown>(null); const [cur, setCur] = useState(0);
  const load = useCallback(async () => {
    try { const t = await api.roundStart(a.id, kind); setTasks(t); setErr(null); } catch (e) { setErr(e); }
  }, [a.id, kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tasks) { const i = tasks.findIndex((t) => t.response?.status !== 'FINAL'); setCur(i >= 0 ? i : 0); } }, [tasks?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tasks) return <><div><p className="eyebrow">{eyebrow}</p><h1 className="h1">{title}</h1></div><ErrorNote error={err} onRetry={load} />{!err && <Loading />}</>;
  const finalCount = tasks.filter((t) => t.response?.status === 'FINAL').length;
  const done = tasks.length > 0 && finalCount === tasks.length;
  const t = tasks[cur];
  const bySkill = tasks.reduce<Record<string, number[]>>((m, x, i) => { (m[x.skill ?? 'all'] ??= []).push(i); return m; }, {});
  return (
    <>
      <div className="row between"><div><p className="eyebrow">{eyebrow}{t?.skill ? ` · ${t.skill}` : ''}</p><h1 className="h1">{title}</h1></div>
        {kind === 'mutation' && <span className="demo" role="note">Assessed as a proposal · your code is not run</span>}</div>
      <ErrorNote error={err} onRetry={load} />
      {tasks.length === 0 && <div className="alert warn" role="status"><strong>Nothing to ask here.</strong> No project context could be grounded for your skills, so this round has no questions. Those components stay incomplete (not zero). <Link to={a.nextAction?.path ?? `/a/${a.id}`}>Continue</Link></div>}
      {tasks.length > 0 && <p className="muted" style={{ maxWidth: 760 }}>{intro}</p>}
      {tasks.length > 1 && (
        <nav className="row" aria-label="Questions" style={{ gap: 18 }}>
          {Object.entries(bySkill).map(([skill, idxs]) => (
            <div key={skill} className="row" style={{ gap: 8 }}>
              {skill !== 'all' && <span className="muted small" style={{ fontWeight: 600 }}>{skill}</span>}
              {idxs.map((i) => <button key={i} className={`q${tasks[i].response?.status === 'FINAL' ? ' done' : ''}${i === cur ? ' cur' : ''}`} aria-current={i === cur ? 'step' : undefined} aria-label={`Question ${i + 1}${tasks[i].response?.status === 'FINAL' ? ', submitted' : ''}`} onClick={() => setCur(i)}>{i + 1}</button>)}
            </div>
          ))}
        </nav>
      )}
      {t && <TaskForm key={t.id} task={t} sourceLabel={sourceLabel} requestLabel={requestLabel} index={cur} total={tasks.length} onNext={() => setCur(Math.min(cur + 1, tasks.length - 1))} onSubmitted={async () => { await load(); await reload(); }} />}
      {done && <div className="alert info" role="status"><strong>This round is complete.</strong> {kind === 'lifecycle' ? 'Lifecycle answers get no direct score.' : 'Answers are being evaluated.'} <Link to={a.nextAction?.path ?? `/a/${a.id}`}>Continue assessment</Link></div>}
    </>
  );
}

function TaskForm({ task, sourceLabel, requestLabel, index, total, onNext, onSubmitted }: { task: TaskDto; sourceLabel: string; requestLabel: string; index: number; total: number; onNext: () => void; onSubmitted: () => void | Promise<void> }) {
  const final = task.response?.status === 'FINAL';
  const [fields, setFields] = useState<Record<string, string>>(task.response?.fields ?? {});
  const rev = useRef(task.response?.revision ?? 0); const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const save = useCallback(async (v: Record<string, string>) => { const r = await api.taskDraft(task.id, rev.current, v); rev.current = r.revision; }, [task.id]);
  const auto = useAutosave(save);
  const change = (id: string, v: string) => { const n = { ...fields, [id]: v }; setFields(n); auto.push(n); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await auto.flush(); await api.taskSubmit(task.id); await onSubmitted(); } catch (e) { setErr(e); } finally { setBusy(false); setConfirm(false); }
  };
  const empty = Object.values(fields).every((v) => !v?.trim());
  return (
    <div className="grid2" style={{ alignItems: 'stretch' }}>
      {task.source && (
        <section className="card col" style={{ flex: '1 1 440px', padding: 20 }}>
          <div className="row between"><h2 className="h2" style={{ fontSize: 16 }}>{sourceLabel} <span className="muted mono small" style={{ fontWeight: 400 }}>{task.source.path} · {task.source.startLine}–{task.source.endLine}</span></h2><span className="mono muted small">read-only · snapshot {task.source.snapshotRef}</span></div>
          <CodeBlock text={task.source.excerpt} startLine={task.source.startLine} label={`Read-only source excerpt from ${task.source.path}`} />
          <p className="muted small">This is the exact stored excerpt this question was written from. {task.kind === 'MUTATION' ? 'Your proposal is stored separately and never edits the snapshot or your repository.' : ''} There is no Run button because code is not executed.</p>
        </section>
      )}
      <section className="card col" style={{ flex: '1 1 440px', padding: 20 }}>
        <span className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{task.kind === 'MUTATION' ? requestLabel : 'Question'} {index + 1} of {total}</span>
        <h2 style={{ fontSize: 20, lineHeight: 1.4, fontWeight: 600, color: 'var(--navy)' }}>{task.prompt}</h2>
        {task.fields.map((f) => (
          <div key={f.id}>
            <label className="lbl" htmlFor={`${task.id}-${f.id}`}>{f.label}</label>
            <textarea id={`${task.id}-${f.id}`} className={`ta${f.code ? ' code' : ''}`} rows={f.code ? 7 : task.fields.length > 1 ? 3 : 8} spellCheck={!f.code} readOnly={final} value={fields[f.id] ?? ''} maxLength={8000} onChange={(e) => change(f.id, e.target.value)} />
            {f.hint && <p className="muted small" style={{ marginTop: 4 }}>{f.hint}</p>}
          </div>
        ))}
        <ErrorNote error={err} onRetry={submit} />
        <div className="row between">
          {final ? <span className="b sup">Submitted{task.evaluation ? (task.evaluation.reviewStatus === 'VALIDATED' ? ' · evaluated' : ' · needs review') : task.kind === 'LIFECYCLE' ? '' : ' · evaluating'}</span> : <SavedStatus state={auto.state} />}
          <div className="row">
            {index < total - 1 && <button className="btn2" onClick={onNext} type="button">Next question</button>}
            {!final && !confirm && <button className="btn" onClick={() => setConfirm(true)}>Submit answer</button>}
          </div>
        </div>
        {!final && confirm && (
          <div className="alert warn col" role="alertdialog" aria-label="Confirm submission">
            <p><strong>Submit this answer?</strong> It is final and cannot be changed.{empty ? ' It is empty, so it will be scored as submitted but blank.' : ''}</p>
            <div className="row"><button className="btn" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Yes, submit'}</button><button className="btn2" onClick={() => setConfirm(false)}>Keep editing</button></div>
          </div>
        )}
        {!final && <p className="muted small">{task.kind === 'LIFECYCLE' ? 'Lifecycle answers give context only and carry no marks.' : 'One clarifying follow-up is part of the design but is not built yet. Nothing here adds extra attempts.'}</p>}
      </section>
    </div>
  );
}
