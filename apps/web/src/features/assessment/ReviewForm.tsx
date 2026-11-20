import { useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import { ErrorNote } from '../../components/ui';

/** Candidates can flag something wrong. They cannot edit findings or scores; a person reviews the request. */
export function ReviewForm({ assessmentId, target, label, skill, reference }: { assessmentId: string; target: 'SKILLS' | 'EVIDENCE' | 'SCORECARD'; label: string; skill?: string; reference?: string }) {
  const [open, setOpen] = useState(false); const [msg, setMsg] = useState('');
  const [state, setState] = useState<'idle' | 'sent'>('idle'); const [err, setErr] = useState<unknown>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.review(assessmentId, { target, skill, reference, message: msg }); setState('sent'); setMsg(''); } catch (x) { setErr(x); }
  };
  if (state === 'sent') return <p className="alert info" role="status">Thanks. Your request was saved for review. Affected tasks wait until it is resolved.</p>;
  if (!open) return <button className="btn2" type="button" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="card col" onSubmit={send} style={{ flex: '1 1 360px' }}>
      <label className="lbl" htmlFor={`rv-${target}-${reference ?? ''}`}>What looks wrong?</label>
      <textarea id={`rv-${target}-${reference ?? ''}`} className="ta" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} required minLength={3} />
      <ErrorNote error={err} />
      <div className="row"><button className="btn" disabled={msg.trim().length < 3}>Send for review</button><button type="button" className="btn2" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
