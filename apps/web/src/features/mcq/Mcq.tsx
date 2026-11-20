import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { McqAttemptDto } from '@proof/contracts';
import { useCurrent } from '../../app/App';
import { api } from '../../services/api';
import { ErrorNote, Loading, SavedStatus, useAutosave } from '../../components/ui';

export function McqPage() {
  const { a, reload } = useCurrent();
  const [attempts, setAttempts] = useState<McqAttemptDto[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [active, setActive] = useState(0); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.mcq(a.id).then(setAttempts).catch(setErr), [a.id]);
  useEffect(() => { void load(); }, [load]);
  const canStart = a.stage === 'EVIDENCE_READY' && attempts?.length === 0;
  const start = async () => { setBusy(true); try { setAttempts(await api.mcqStart(a.id)); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (!attempts) return <><ErrorNote error={err} /><Loading /></>;
  const allDone = attempts.length > 0 && attempts.every((x) => x.status === 'SUBMITTED');
  return (
    <>
      <div><p className="eyebrow">Step 4 · Skill MCQs</p><h1 className="h1">Skill questions</h1></div>
      <ErrorNote error={err} />
      {canStart || (attempts.length === 0 && a.stage === 'EVIDENCE_READY') ? (
        <section className="card col">
          <h2 className="h2">Before you start</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            <li>One section per skill from your resume. Equal marks, no negative marking.</li>
            <li>Answers save as you go. Submitting a section is final, and unanswered questions count as incorrect.</li>
            <li>{a.mode.mcqTimed ? 'Each section has a server-enforced time limit.' : 'Timing is switched off in this build. A time limit can be enabled by configuration.'}</li>
          </ul>
          <div><button className="btn btn-lg" onClick={start} disabled={busy}>{busy ? 'Preparing…' : 'Start MCQs'}</button></div>
        </section>
      ) : attempts.length === 0 ? <p className="alert info">MCQs open after your project evidence is ready. <Link to={`/a/${a.id}/project`}>Go to project</Link></p> : (
        <>
          <div className="tabs" role="tablist" aria-label="Skills">
            {attempts.map((x, i) => <button key={x.id} role="tab" aria-selected={i === active} className="tab" onClick={() => setActive(i)}>{x.skill} {x.status === 'SUBMITTED' ? '✓' : ''}</button>)}
          </div>
          <Section key={attempts[active].id} attempt={attempts[active]} onSubmitted={async () => { await load(); await reload(); const n = attempts.findIndex((y, i) => i > active && y.status !== 'SUBMITTED'); if (n >= 0) setActive(n); }} />
          {allDone && <div className="alert info" role="status">All sections are submitted. <Link to={a.nextAction?.path ?? `/a/${a.id}`}>Continue assessment</Link></div>}
        </>
      )}
    </>
  );
}

function Section({ attempt, onSubmitted }: { attempt: McqAttemptDto; onSubmitted: () => void | Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, number>>(attempt.answers);
  const rev = useRef(attempt.revision); const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const submitted = attempt.status === 'SUBMITTED';
  const latest = useRef(answers); latest.current = answers;
  const save = useCallback(async (v: Record<string, number>) => { const r = await api.mcqSave(attempt.id, rev.current, v); rev.current = r.revision; }, [attempt.id]);
  const auto = useAutosave(save);
  const pick = (q: string, o: number) => { if (submitted) return; const next = { ...answers, [q]: o }; setAnswers(next); auto.push(next); };
  const done = Object.keys(answers).length;
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await auto.flush(); await api.mcqSubmit(attempt.id); await onSubmitted(); } catch (e) { setErr(e); } finally { setBusy(false); setConfirm(false); }
  };
  return (
    <section className="col">
      <div className="row between card pad-sm">
        <div><strong style={{ color: 'var(--navy)' }}>{attempt.skill}</strong> <span className="muted small">· {done} of {attempt.questions.length} answered</span></div>
        {submitted ? <span className="b sup">Submitted</span> : <SavedStatus state={auto.state} />}
      </div>
      {attempt.questions.map((q, i) => (
        <fieldset key={q.id} className="card col" style={{ margin: 0 }} disabled={submitted}>
          <legend className="sr">Question {i + 1}</legend>
          <p className="qtext"><span className="muted">{i + 1}. </span>{q.text}</p>
          {q.options.map((o) => (
            <label key={o.id} className={`opt${answers[q.id] === o.id ? ' sel' : ''}`}>
              <input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => pick(q.id, o.id)} /><span>{o.text}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <ErrorNote error={err} onRetry={submit} />
      {!submitted && (confirm
        ? <div className="alert warn col" role="alertdialog" aria-label="Confirm submission"><p><strong>Submit {attempt.skill}?</strong> This is final. {attempt.questions.length - done > 0 ? `${attempt.questions.length - done} unanswered question(s) will count as incorrect.` : 'All questions are answered.'}</p>
          <div className="row"><button className="btn" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Yes, submit section'}</button><button className="btn2" onClick={() => setConfirm(false)}>Keep working</button></div></div>
        : <div><button className="btn btn-lg" onClick={() => setConfirm(true)}>Submit {attempt.skill} section</button></div>)}
    </section>
  );
}
