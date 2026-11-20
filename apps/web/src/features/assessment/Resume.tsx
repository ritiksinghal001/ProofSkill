import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCurrent } from '../../app/App';
import { api, type SkillsInfo } from '../../services/api';
import { Backing, ErrorNote } from '../../components/ui';
import { ReviewForm } from './ReviewForm';

export function ResumePage() {
  const { a, reload } = useCurrent();
  const [info, setInfo] = useState<SkillsInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const loadInfo = () => api.skills(a.id).then(setInfo).catch(setErr);
  useEffect(() => { void loadInfo(); }, [a.id, a.stage, a.jobs.length, a.jobs[0]?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const queued = info?.resume?.status === 'QUEUED';
  const frozen = a.stage !== 'DRAFT' && a.stage !== 'SKILLS_EXTRACTED' && a.stage !== 'PROJECT_SUBMITTED' && a.stage !== 'EVIDENCE_READY';
  const upload = async (e: FormEvent) => {
    e.preventDefault(); if (!file) return; setBusy(true); setErr(null);
    try { await api.uploadResume(a.id, file); setFile(null); await reload(); await loadInfo(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  useEffect(() => { if (!queued) return; const t = setInterval(() => { void loadInfo(); void reload(); }, 1200); return () => clearInterval(t); }, [queued]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = info?.skills.filter((s) => s.status === 'IN_SCOPE') ?? [];
  return (
    <>
      <div><p className="eyebrow">Step 1 · Resume &amp; skills</p><h1 className="h1">Skills we read from your resume</h1></div>
      <ErrorNote error={err} />
      <div className="grid2">
        <section className="card col" style={{ flex: '1 1 340px' }}>
          <h2 className="h2">Your resume</h2>
          {info?.resume && <div className="row" style={{ padding: 14, borderRadius: 12, background: '#f3f7fb', border: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontWeight: 600 }}>{info.resume.original_name}</p>
              <p className="muted small">{queued ? 'Reading your resume…' : info.resume.status === 'EXTRACTED' ? 'Text read successfully' : info.resume.error}</p></div>
            <span className={`b ${queued ? 'pend' : info.resume.status === 'EXTRACTED' ? 'sup' : 'fail'}`}>{queued ? 'Extracting' : info.resume.status === 'EXTRACTED' ? 'Extracted' : 'Needs attention'}</span>
          </div>}
          {info?.resume && ['FAILED', 'NO_SUPPORTED_SKILLS'].includes(info.resume.status) && <div className="alert err" role="alert">{info.resume.error} Please upload a different file.</div>}
          {!frozen ? (
            <form className="col" onSubmit={upload}>
              <div><label className="lbl" htmlFor="resume">{info?.resume ? 'Replace resume' : 'Upload resume'}</label>
                <input id="resume" className="filebox" type="file" accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <p className="muted small" style={{ marginTop: 6 }}>PDF or DOCX with selectable text, up to {a.limits.maxResumeMb} MB. (.txt works for testing.) Scanned images are not supported yet.</p></div>
              <div><button className="btn" disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload and read skills'}</button></div>
            </form>
          ) : <p className="alert info">Your assessment scope is frozen now that scored rounds have begun. Start a new attempt to change your resume.</p>}
        </section>

        <section className="card" style={{ flex: '2 1 520px' }}>
          <h2 className="h2">Assessment scope</h2>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>These skills are your assessment. There is nothing to pick or confirm: just continue. If something looks wrong, ask for a review.</p>
          {!info?.skills.length && <p className="muted" style={{ padding: '14px 0' }}>{queued ? 'Reading…' : 'Skills appear here after your resume is read.'}</p>}
          {info?.skills.map((s) => (
            <div key={s.id} className="skillrow">
              <strong style={{ flex: '0 0 170px', fontSize: 16, color: 'var(--navy)' }}>{s.name}</strong>
              <p className="muted small" style={{ flex: '1 1 220px' }}>Found as <span className="mono">{s.alias}</span> · {s.where}</p>
              {s.status === 'IN_SCOPE' ? <span className="b sup">In scope</span> : s.status === 'UNSUPPORTED' ? <span className="b nd">Not assessed (outside catalogue)</span> : <span className="b nd">Learning · not counted</span>}
              {s.backing && <Backing value={s.backing} />}
            </div>
          ))}
          <p className="muted small" style={{ marginTop: 10 }}>Skills outside the current catalogue stay visible and are never silently dropped or scored. Dictionary v1.</p>
        </section>
      </div>
      <div className="row">
        {scoped.length > 0 && <Link className="btn" to={`/a/${a.id}/project`}>Continue to project</Link>}
        <ReviewForm assessmentId={a.id} target="SKILLS" label="Ask for a skills review" />
      </div>
    </>
  );
}
