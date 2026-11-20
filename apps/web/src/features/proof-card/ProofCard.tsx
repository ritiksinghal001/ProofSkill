import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ScorecardDto, ScoreComponent, SkillResult } from '@proof/contracts';
import { useCurrent } from '../../app/App';
import { api, ApiError } from '../../services/api';
import { Backing, ErrorNote, fmtScore, Loading } from '../../components/ui';
import { ReviewForm } from '../assessment/ReviewForm';

export function ProofCardPage() {
  const { a } = useCurrent();
  const [card, setCard] = useState<ScorecardDto | null>(null); const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    let stop = false; let t: number;
    const go = async () => {
      try { const c = await api.scorecard(a.id); if (!stop) { setCard(c); setErr(null); } }
      catch (e) { if (stop) return; setErr(e as ApiError); if ((e as ApiError).status === 409) t = window.setTimeout(go, 2000); }
    };
    void go(); return () => { stop = true; window.clearTimeout(t); };
  }, [a.id, a.stage]);
  if (!card) return <><div><p className="eyebrow">Step 8 · Proof card</p><h1 className="h1">Your proof of skill</h1></div>{err?.status === 409 ? <p className="alert info" role="status">Your proof card is being prepared. Answers are being evaluated, and this page updates by itself.</p> : <ErrorNote error={err} />}{!err && <Loading />}</>;
  const { overall } = card;
  return (
    <>
      <div className="row between"><div><p className="eyebrow">Step 8 · Proof card · revision {card.revision}</p><h1 className="h1">Your proof of skill</h1></div>
        {card.isSample ? <span className="demo" role="note">Sample proof card · scripted answers, example scores only</span> : <span className="demo" role="note">Scored by {card.context.evaluator}</span>}</div>

      <section className="card dark row between" style={{ gap: 24 }}>
        <div className="col" style={{ flex: '1 1 380px', gap: 8 }}>
          <p className="eyebrow">Overall</p>
          <h2 style={{ fontSize: 28, margin: 0 }}>{overall.complete ? `${fmtScore(overall.value)} out of 100` : 'Not complete yet'}</h2>
          <p style={{ color: '#c4d2e4', maxWidth: 560 }}>{overall.reason}</p>
        </div>
        <div className="row" style={{ gap: 28 }}>
          {card.skills.map((s) => <div key={s.skill}><p className="stat" style={{ color: s.final == null ? '#f6c768' : '#fff' }}>{fmtScore(s.final)}</p><p className="small" style={{ color: '#9fb3cc', marginTop: 4 }}>{s.skill}</p></div>)}
        </div>
      </section>

      <div className="grid2">
        <section className="card col" style={{ flex: '1.6 1 560px', gap: 20 }}>
          <h2 className="h2">Skills and how each score was built</h2>
          {card.skills.map((s, i) => <SkillBlock key={s.skill} s={s} openWhy={i === 0} />)}
          {card.unsupportedScope.length > 0 && <p className="alert warn small"><strong>Not assessed (outside current catalogue):</strong> {card.unsupportedScope.join(', ')}. Shown for completeness; no score is assigned.</p>}
        </section>
        <div className="col" style={{ flex: '1 1 320px', gap: 24 }}>
          <section className="card col pad-sm"><h2 className="h2">Context, not marks</h2>
            <p className="small"><strong>Project:</strong> {card.project?.label} <span className="mono muted">({card.project?.snapshotRef})</span></p>
            <p className="small"><strong>History:</strong> {card.context.historyClass?.toLowerCase() ?? 'n/a'}. {card.context.historyReason}</p>
            <p className="small"><strong>Lifecycle explanation:</strong> {card.context.lifecycleCompleted ? 'completed' : 'not needed'}</p>
            <p className="small"><strong>Mutation:</strong> assessed proposal. No code was executed.</p>
            <p className="muted small">None of this changes a score.</p></section>
          <section className="card col pad-sm"><h2 className="h2">Versions</h2>
            <p className="small mono muted">{card.policyVersion} · {card.rubricVersion} · {card.scorerVersion}</p>
            <p className="muted small">The same saved inputs always give the same scores. Scores shown here are exactly what the server stored.</p></section>
          <Link className="btn" to="/compare">Compare with another card</Link>
          <ReviewForm assessmentId={a.id} target="SCORECARD" label="Request a review of this card" />
        </div>
      </div>
    </>
  );
}

const compText = (c: ScoreComponent) => c.state === 'COMPLETE' ? fmtScore(c.percent) : c.state === 'NEEDS_REVIEW' ? 'Needs review' : 'Incomplete';

function SkillBlock({ s, openWhy }: { s: SkillResult; openWhy: boolean }) {
  const rows: [string, string, ScoreComponent][] = [['MCQs', '20%', s.mcq], ['Viva', '35%', s.viva], ['Mutation', '45%', s.mutation]];
  const statusPill = s.status === 'COMPLETE' ? <span className="b sup">Complete</span> : s.status === 'KNOWLEDGE_ONLY' ? <span className="b inc">Knowledge only</span> : s.status === 'NEEDS_REVIEW' ? <span className="b fail">Needs review</span> : <span className="b pend">Incomplete</span>;
  return (
    <article className="col" style={{ paddingTop: 18, borderTop: '1px solid var(--line-2)' }}>
      <div className="row between"><div className="row"><h3 className="h2">{s.skill}</h3><Backing value={s.backing} />{statusPill}</div><p className="mono" style={{ fontSize: 22, fontWeight: 500, color: 'var(--navy)' }}>{s.final == null ? '—' : fmtScore(s.final)}</p></div>
      {rows.map(([name, w, c]) => (
        <div key={name} className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="muted small" style={{ flex: '0 0 120px' }}>{name} · {w}</span>
          <div className="bar" role="img" aria-label={`${name}: ${compText(c)}`}><i style={{ width: `${c.percent ?? 0}%`, background: c.state === 'COMPLETE' ? undefined : 'var(--amber-ink)' }} /></div>
          <span className="mono small" style={{ flex: '0 0 96px', textAlign: 'right' }}>{compText(c)}</span>
        </div>
      ))}
      {rows.filter(([, , c]) => c.reason).slice(0, 1).map(([n, , c]) => <p key={n} className="muted small">{c.reason}</p>)}
      <p className="small"><strong>Confidence: {s.confidence.label} support.</strong> <span className="muted">{s.confidence.reasons.join(' ')}</span></p>
      <details open={openWhy}>
        <summary>Why this result · {s.skill}</summary>
        <div className="col small" style={{ padding: '4px 0 16px' }}>
          {s.why.formula ? <p><strong>Formula:</strong> <span className="mono">{s.why.formula}</span></p> : <p><strong>No final score:</strong> every part must be complete and validated. Missing parts are never counted as zero.</p>}
          {s.why.findings.map((f, i) => <p key={i}><strong>{f.kind}:</strong> {f.text}{f.ref && <> <span className="mono muted">{f.ref}</span></>}</p>)}
        </div>
      </details>
      {s.actions.length > 0 && <div><p className="small" style={{ fontWeight: 600 }}>Next steps to improve</p><ul className="small" style={{ margin: '4px 0 0', paddingLeft: 20 }}>{s.actions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
    </article>
  );
}
