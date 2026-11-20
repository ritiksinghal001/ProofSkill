import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EVIDENCE_LABEL } from '@proof/contracts';
import { useCurrent } from '../../app/App';
import { api, type EvidenceInfo } from '../../services/api';
import { Backing, CodeBlock, ErrorNote, Loading } from '../../components/ui';
import { ReviewForm } from './ReviewForm';

export function EvidencePage() {
  const { a } = useCurrent();
  const [info, setInfo] = useState<EvidenceInfo | null>(null); const [err, setErr] = useState<unknown>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { api.evidence(a.id).then((x) => { setInfo(x); setSel((s) => s ?? x.evidence[0]?.id ?? null); }).catch(setErr); }, [a.id, a.stage]);
  if (err) return <ErrorNote error={err} />;
  if (!info) return <Loading />;
  if (!info.project || info.project.status !== 'READY') return <><div><p className="eyebrow">Step 3 · Evidence review</p><h1 className="h1">Project evidence</h1></div><p className="alert info">Evidence appears once your project has been analysed. <Link to={`/a/${a.id}/project`}>Go to project</Link></p></>;
  const chosen = info.evidence.find((e) => e.id === sel);
  const scoped = info.skills.filter((s) => s.status === 'IN_SCOPE');
  return (
    <>
      <div><p className="eyebrow">Step 3 · Evidence review</p><h1 className="h1">How your project backs each skill</h1></div>
      <section className="card row between">
        <div className="row" style={{ gap: 32 }}>
          <div><p className="muted small">Project</p><p style={{ fontWeight: 600 }}>{a.project?.label}</p></div>
          <div><p className="muted small">Snapshot</p><p className="mono" style={{ fontWeight: 500 }}>{info.project.snapshotRef}</p></div>
          <div><p className="muted small">Files inspected</p><p style={{ fontWeight: 600 }}>{info.coverage?.parsed ?? '—'} parsed of {info.coverage?.files ?? '—'}</p></div>
          <div><p className="muted small">Skipped</p><p style={{ fontWeight: 600 }}>{info.coverage?.skipped ?? 0} files</p></div>
        </div>
        <p className="muted small" style={{ maxWidth: 360 }}>Backing shows what we found in your code. It carries no marks, and “Not detected” never means you lack the skill.</p>
      </section>
      {info.coverage?.failed.length ? <div className="alert warn">Some files could not be parsed ({info.coverage.failed.join(', ')}), so related findings may be Inconclusive.</div> : null}

      <div className="grid2">
        <section className="col" style={{ flex: '1 1 380px' }}>
          {scoped.map((s) => {
            const recs = info.evidence.filter((e) => e.skill === s.name);
            return (
              <article key={s.id} className="card col pad-sm">
                <div className="row between"><h2 className="h2">{s.name}</h2><Backing value={s.backing} /></div>
                <p className="small muted">{info.coverage?.backingReason?.[s.name]}</p>
                {recs.map((e) => (
                  <button key={e.id} className="q" style={{ height: 'auto', padding: '10px 12px', justifyContent: 'flex-start', textAlign: 'left', gap: 10, width: '100%', ...(sel === e.id ? { background: '#eef9f7', borderColor: 'var(--teal)' } : {}) }} onClick={() => setSel(e.id)} aria-pressed={sel === e.id}>
                    <span style={{ flex: 1, fontWeight: 500 }}><strong>{e.topic}</strong>: {e.findings}</span>
                    <span className={`b ${e.classification === 'SUPPORTED' ? 'sup' : 'par'}`}>{EVIDENCE_LABEL[e.classification]}</span>
                  </button>
                ))}
                {!recs.length && <p className="small">No finding in inspected files.</p>}
              </article>
            );
          })}
          {info.skills.filter((s) => s.status === 'UNSUPPORTED').length > 0 && <p className="muted small">Not assessed (outside the current catalogue): {info.skills.filter((s) => s.status === 'UNSUPPORTED').map((s) => s.name).join(', ')}.</p>}
        </section>

        <section className="card col" style={{ flex: '1.3 1 460px' }}>
          {chosen ? <>
            <div className="row between"><h2 className="h2">{chosen.skill} · {chosen.topic}</h2><span className="mono muted small">rule {chosen.ruleId} v{chosen.ruleVersion}</span></div>
            <p className="mono muted small">{chosen.refs[0].path} · lines {chosen.refs[0].startLine}–{chosen.refs[0].endLine} · read-only · hash {chosen.refs[0].hash.slice(0, 8)}</p>
            {chosen.excerpt && <CodeBlock text={chosen.excerpt} startLine={chosen.refs[0].startLine} label={`Read-only source excerpt from ${chosen.refs[0].path}`} />}
            <p className="small"><strong>Finding:</strong> {chosen.findings}</p>
            <p className="small muted"><strong>Limits:</strong> {chosen.limitations}</p>
            <div className="row">
              <ReviewForm assessmentId={a.id} target="EVIDENCE" skill={chosen.skill} reference={`${chosen.refs[0].path}:${chosen.refs[0].startLine}-${chosen.refs[0].endLine}`} label="Flag a wrong reference or interpretation" />
            </div>
            <p className="muted small">Flags go to review and affected tasks wait until resolved. You cannot edit findings yourself.</p>
          </> : <p className="muted">Select a finding to see the exact source behind it.</p>}
        </section>
      </div>
      <div className="row"><Link className="btn" to={a.nextAction?.path ?? `/a/${a.id}/mcq`}>Continue assessment</Link><Link className="btn2" to={`/a/${a.id}`}>Back to home</Link></div>
    </>
  );
}
