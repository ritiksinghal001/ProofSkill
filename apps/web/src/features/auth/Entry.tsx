import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../../app/App';

export function Entry() {
  const { setUser } = useAuth(); const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setUser(await (mode === 'login' ? api.login(email, password) : api.register(email, password))); nav('/home'); }
    catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  };
  return (
    <div className="entry">
      <section className="left">
        <p className="eyebrow">ProofSkill</p>
        <h1 style={{ fontSize: 40, lineHeight: 1.15, letterSpacing: '-0.02em', margin: 0 }}>Prove what you can do with the project you built.</h1>
        <p style={{ color: '#c4d2e4', maxWidth: 520, fontSize: 17 }}>Upload your resume and one project. Answer questions about your own code, adapt it to a new requirement, and get a proof card that shows how each score was built.</p>
        <div className="card" style={{ background: '#0f2a4d', borderColor: '#1e3a63', color: '#fff', maxWidth: 520 }}>
          <div className="row between"><strong>React</strong><span className="demo">Sample · example scores only</span></div>
          <p className="mono" style={{ fontSize: 13, color: '#9fb3cc', margin: '10px 0' }}>0.20×80 + 0.35×70 + 0.45×90 = 81.0</p>
          <p className="small" style={{ color: '#c4d2e4' }}>MCQs 20% · Project viva 35% · Mutation 45%. Project evidence and Git history give context and never add marks.</p>
        </div>
      </section>
      <section className="right">
        <h2 className="h1" style={{ fontSize: 26 }}>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
        <form className="col" onSubmit={submit} noValidate>
          <div><label className="lbl" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />{err?.fieldErrors?.email && <p className="field-err">{err.fieldErrors.email}</p>}</div>
          <div><label className="lbl" htmlFor="pw">Password (8+ characters)</label><input id="pw" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />{err?.fieldErrors?.password && <p className="field-err">{err.fieldErrors.password}</p>}</div>
          {err && !err.fieldErrors && <div className="alert err" role="alert">{err.message}</div>}
          <button className="btn btn-lg" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="btn2" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}>{mode === 'login' ? 'I need an account' : 'I already have an account'}</button>
        <p className="small muted">Local development sign-in. A managed identity provider is a pending integration. Signing in only proves ownership; you still give separate consent before any project is analysed.</p>
      </section>
    </div>
  );
}
