import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { STAGES } from '@proof/contracts';
import { useCurrent } from '../../app/App';
import { Backing, ErrorNote } from '../../components/ui';
import { api } from '../../services/api';

const PROGRESS: Record<string, number> = { DRAFT: 0, SKILLS_EXTRACTED: 1, PROJECT_SUBMITTED: 2, EVIDENCE_READY: 3, MCQ_COMPLETED: 4, HISTORY_CHECKED: 4, LIFECYCLE_COMPLETED: 5, VIVA_COMPLETED: 6, MUTATION_COMPLETED: 7, EVALUATING: 7, COMPLETED: 8, PROVISIONAL: 8 };
const TITLES: Record<string, string> = {
  RESUME: 'Upload your resume', PROJECT: 'Submit your project', MCQ: 'Answer skill questions', LIFECYCLE: 'Explain how you built it',
  VIVA: 'Explain how your code works', MUTATION: 'Adapt your code to a new requirement', CARD: 'Your proof card', EVIDENCE: 'Review project evidence',
};

export function Home() {
  const { a } = useCurrent(); const nav = useNavigate(); const [err, setErr] = useState<unknown>(null);
  const next = a.nextAction; const step = PROGRESS[a.stage] ?? 0;
  const failed = a.jobs.find((j) => j.state === 'FAILED');
  const inScope = a.skills.filter((s) => s.status === 'IN_SCOPE');
  const startNew = async () => { try { nav(`/a/${(await api.create()).id}/resume`); } catch (e) { setErr(e); } };
  return (
    <>
      <div className="row between"><div><p className="eyebrow">Candidate home</p><h1 className="h1">Your assessment</h1></div>
        <span className="demo" hidden={!a.mode || a.mode.ai !== 'FIXTURE'} title="Answers are scored by a transparent keyword heuristic until a live AI provider is configured.">Evaluator: fixture (not an AI model)</span></div>
      <ErrorNote error={err} />
      {failed && <div className="alert err" role="alert"><strong>A background step failed:</strong> {failed.error ?? 'Please try again.'}</div>}

      <section className="hero">
        <div className="col" style={{ flex: '1 1 420px', gap: 14 }}>
          <p className="eyebrow">Step {Math.min(step + 1, 8)} of 8 · {a.stage.replace(/_/g, ' ').toLowerCase()}</p>
          <h2 style={{ fontSize: 26, margin: 0, color: '#fff' }}>{next ? TITLES[next.type] ?? next.label : 'Done'}</h2>
          <div className="progress" role="img" aria-label={`Progress: step ${step} of 8 complete`}><i style={{ width: `${(step / 8) * 100}%` }} /></div>
          <p className="small" style={{ color: '#9fb3cc' }}>The next step comes from the server, so it is always the right one. Answers save as you type.</p>
        </div>
        <div className="col" style={{ flex: '0 0 240px' }}>
          {next && (next.blocked
            ? <button className="btn btn-lg" aria-disabled="true" disabled>{next.label}</button>
            : <Link className="btn btn-lg" to={next.path} style={{ background: 'var(--teal-bright)', color: '#06302c' }}>Continue assessment</Link>)}
          {next?.blocked && <p className="small" role="status" style={{ color: '#c4d2e4' }}>{next.blocked}. This page updates by itself.</p>}
          {a.stage === 'EVIDENCE_READY' && <Link className="btn2 btn-ghost-dark" to={`/a/${a.id}/evidence`}>Review project evidence</Link>}
        </div>
      </section>

      <div className="grid2">
        <section className="card" style={{ flex: '2 1 520px' }}>
          <div className="row between"><h2 className="h2">Skills from your resume</h2><span className="muted small">Read from your resume · nothing to select</span></div>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>Each skill is scored on MCQs, viva and mutation. Project backing shows what we found in your code and carries no marks.</p>
          {a.skills.length === 0 && <p className="muted" style={{ padding: '14px 0' }}>No skills yet. Upload your resume to begin.</p>}
          {a.skills.map((s) => (
            <div key={s.id} className="skillrow">
              <div style={{ flex: '1 1 180px' }} className="col"><strong style={{ fontSize: 16, color: 'var(--navy)' }}>{s.name}</strong>
                {s.status === 'IN_SCOPE' ? <span><Backing value={s.backing} /></span> : <span className="chip">{s.status === 'UNSUPPORTED' ? 'Outside current catalogue · not assessed' : 'Mentioned as learning · not a claim'}</span>}</div>
              <p className="muted small" style={{ flex: '1 1 200px' }}>Found as <span className="mono">{s.alias}</span> · {s.where}</p>
            </div>
          ))}
        </section>
        <div className="col" style={{ flex: '1 1 320px', gap: 24 }}>
          <section className="card col pad-sm">
            <h2 className="h2">Submitted project</h2>
            {a.project ? <><p style={{ fontWeight: 600 }}>{a.project.label} <span className="muted" style={{ fontWeight: 400 }}>· {a.project.method === 'ZIP' ? 'ZIP upload' : 'GitHub'}</span></p>
              <p className="muted small mono">snapshot {a.project.snapshotRef ?? 'pending'} · {a.project.status.toLowerCase()}</p>
              {a.historyClass && <p className="muted small">History: <strong>{a.historyClass.toLowerCase()}</strong>. {a.historyReason}</p>}</> : <p className="muted">No project submitted yet.</p>}
          </section>
          <section className="card col pad-sm">
            <h2 className="h2">What earns marks</h2>
            <div style={{ display: 'flex', height: 34, borderRadius: 10, overflow: 'hidden', fontSize: 12, fontWeight: 700 }} role="img" aria-label="Weights: MCQs 20 percent, viva 35 percent, mutation 45 percent">
              <div style={{ flex: 20, background: '#bfe3de', color: '#08433d', display: 'grid', placeItems: 'center' }}>20</div>
              <div style={{ flex: 35, background: '#5cb8ae', color: '#052e2a', display: 'grid', placeItems: 'center' }}>35</div>
              <div style={{ flex: 45, background: '#0f766e', color: '#fff', display: 'grid', placeItems: 'center' }}>45</div>
            </div>
            <div className="row between small muted"><span>MCQs</span><span>Viva</span><span>Mutation</span></div>
            <p className="muted small">Project evidence and Git history give context only. They never add or remove marks.</p>
          </section>
          <button className="btn2" onClick={startNew}>Start a separate new attempt</button>
          <p className="muted small">{inScope.length} skill(s) in scope · policy {a.policyVersion} · {STAGES.length} internal stages</p>
        </div>
      </div>
    </>
  );
}
