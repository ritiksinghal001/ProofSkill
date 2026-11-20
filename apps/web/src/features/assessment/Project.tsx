import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCurrent } from '../../app/App';
import { api, ApiError, type EvidenceInfo } from '../../services/api';
import { ErrorNote } from '../../components/ui';

export function ProjectPage() {
  const { a, reload } = useCurrent();
  const [method, setMethod] = useState<'ZIP' | 'GITHUB'>('ZIP');
  const [agree, setAgree] = useState(a.consent); const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState(''); const [branch, setBranch] = useState('');
  const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<EvidenceInfo | null>(null);
  const analysing = a.stage === 'PROJECT_SUBMITTED';
  const frozen = !['SKILLS_EXTRACTED', 'PROJECT_SUBMITTED', 'EVIDENCE_READY'].includes(a.stage);
  useEffect(() => { api.evidence(a.id).then(setInfo).catch(() => {}); }, [a.id, a.stage]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.consent(a.id, method === 'ZIP' ? 'ZIP_UPLOAD' : 'GITHUB_REPO');
      if (method === 'ZIP') await api.submitZip(a.id, file!); else await api.submitGithub(a.id, url.trim(), branch.trim() || undefined);
      await reload();
    } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  };
  const ready = agree && (method === 'ZIP' ? !!file : url.trim().length > 10);
  return (
    <>
      <div><p className="eyebrow">Step 2 · Consent &amp; project</p><h1 className="h1">Submit the project we will ask about</h1></div>
      {analysing && <div className="alert info" role="status"><strong>Analysing your project…</strong> We fetch a fixed snapshot, scan it without running any code, and prepare evidence. This page updates by itself.</div>}
      {info?.project?.status === 'FAILED' && <div className="alert err" role="alert"><strong>The last submission could not be used:</strong> {info.project.error} You can fix it and submit again.</div>}
      {a.stage === 'EVIDENCE_READY' && <div className="alert info" role="status">Your project is ready (snapshot <span className="mono">{a.project?.snapshotRef}</span>). <Link to={`/a/${a.id}/evidence`}>Review the evidence</Link> or <Link to={`/a/${a.id}/mcq`}>start the MCQs</Link>. Submitting again replaces it until MCQs begin.</div>}
      {frozen ? <p className="alert info">The project snapshot is frozen now that scored rounds have begun.</p> : (
        <form className="grid2" onSubmit={submit}>
          <section className="card col" style={{ flex: '2 1 520px' }}>
            <h2 className="h2">Choose how to submit</h2>
            <div className="tabs" role="group" aria-label="Submission method">
              <button type="button" className="tab" aria-pressed={method === 'ZIP'} onClick={() => setMethod('ZIP')}>ZIP upload</button>
              <button type="button" className="tab" aria-pressed={method === 'GITHUB'} onClick={() => setMethod('GITHUB')}>Public GitHub repository</button>
            </div>
            {method === 'ZIP' ? (
              <div><label className="lbl" htmlFor="zip">Project ZIP</label><input id="zip" className="filebox" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {err?.fieldErrors?.file && <p className="field-err">{err.fieldErrors.file}</p>}
                <p className="muted small" style={{ marginTop: 6 }}>No Git history is read from a ZIP, so you will explain how you built it. That has no score effect.</p></div>
            ) : (
              <div className="col">
                <div><label className="lbl" htmlFor="gh">Repository URL</label><input id="gh" className="input" inputMode="url" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} />{err?.fieldErrors?.repositoryUrl && <p className="field-err">{err.fieldErrors.repositoryUrl}</p>}</div>
                <div><label className="lbl" htmlFor="br">Branch (optional)</label><input id="br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" /></div>
                <p className="muted small">Only public repositories are supported. We pin the exact commit so later pushes cannot change what is assessed.</p>
              </div>
            )}
            <label className="checkrow"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span><strong>I consent</strong> to this project being analysed and to relevant excerpts being sent to the evaluation service (currently <strong>{a.mode.ai === 'LIVE' ? 'a live AI provider' : 'a local fixture evaluator, nothing leaves this server'}</strong>) for questions and scoring. Revoking stops future analysis.</span></label>
            {err && !err.fieldErrors && <div className="alert err" role="alert">{err.message}</div>}
            <div><button className="btn btn-lg" disabled={!ready || busy || analysing}>{busy ? 'Submitting…' : 'Submit project'}</button></div>
          </section>
          <section className="card col" style={{ flex: '1 1 300px' }}>
            <h2 className="h2">Limits we enforce</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }} className="small">
              <li>ZIP up to {a.limits.maxZipMb} MB, {a.limits.maxExtractedMb} MB extracted</li>
              <li>At most {a.limits.maxEntries} files</li>
              <li>Each source file up to {a.limits.maxFileMb} MB</li>
              <li>One archive level; no nested extraction</li>
            </ul>
            <p className="muted small">We skip <span className="mono">node_modules</span>, build output, binaries and secrets. We never install dependencies or run your code.</p>
          </section>
        </form>
      )}
    </>
  );
}
