import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ComparisonDto } from '@proof/contracts';
import { api, type CardListItem, type Sharing } from '../../services/api';
import { ErrorNote, fmtScore, Loading } from '../../components/ui';

export function ComparePage() {
  const [cards, setCards] = useState<CardListItem[] | null>(null); const [sharing, setSharing] = useState<Sharing | null>(null);
  const [err, setErr] = useState<unknown>(null); const [result, setResult] = useState<ComparisonDto | null>(null);
  const load = useCallback(() => api.cards().then((r) => { setCards(r.mine); setSharing(r.sharing); }).catch(setErr), []);
  useEffect(() => { void load(); }, [load]);
  const [own, setOwn] = useState(''); const [shared, setShared] = useState('');
  const [label, setLabel] = useState(''); const [days, setDays] = useState(7); const [token, setToken] = useState<string | null>(null);
  const [paste, setPaste] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (cards?.length && !own) setOwn(cards[0].id); }, [cards, own]);
  useEffect(() => { if (sharing?.shared.length && !shared) setShared(sharing.shared[0].scorecardId); }, [sharing, shared]);
  if (!cards || !sharing) return <><ErrorNote error={err} /><Loading /></>;

  const invite = async (e: FormEvent) => { e.preventDefault(); setErr(null); try { const r = await api.invite(own, label, days); setToken(r.token); await load(); } catch (x) { setErr(x); } };
  const accept = async (e: FormEvent) => { e.preventDefault(); setErr(null); setMsg(null); try { const r = await api.accept(paste.trim()); setMsg(`Accepted: ${r.label}. It is now available to compare.`); setPaste(''); await load(); } catch (x) { setErr(x); } };
  const compare = async () => { setErr(null); try { setResult(await api.compare(own, shared)); } catch (x) { setErr(x); } };
  const revoke = async (id: string) => { setErr(null); try { await api.revoke(id); await load(); } catch (x) { setErr(x); } };

  return (
    <>
      <div><p className="eyebrow">Optional · after your proof card</p><h1 className="h1">Compare two proof cards</h1></div>
      <p className="muted" style={{ maxWidth: 760 }}>Comparison is not an extra assessment round and not a hiring verdict. You can only compare with a card its owner has explicitly shared with you. Access is by a private, expiring, revocable invitation.</p>
      <ErrorNote error={err} />
      {cards.length === 0 && <p className="alert info">You have no finished proof card yet. Complete an assessment first.</p>}

      <div className="grid2">
        <section className="card col" style={{ flex: '1 1 380px' }}>
          <h2 className="h2">1 · Share one of your cards</h2>
          <form className="col" onSubmit={invite}>
            <div><label className="lbl" htmlFor="own">Your proof card</label>
              <select id="own" className="input" value={own} onChange={(e) => setOwn(e.target.value)}>{cards.map((c) => <option key={c.id} value={c.id}>{c.project ?? 'Proof card'} · {c.isSample ? 'sample · ' : ''}{new Date(c.createdAt).toLocaleDateString()}</option>)}</select></div>
            <div><label className="lbl" htmlFor="lbl">Display label the other person will see</label><input id="lbl" className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required /><p className="muted small" style={{ marginTop: 4 }}>Not your email. Names and personal details are not part of any calculation.</p></div>
            <div><label className="lbl" htmlFor="days">Expires after (days)</label><input id="days" className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
            <div><button className="btn" disabled={!own || !label.trim()}>Create invitation</button></div>
          </form>
          {token && <div className="alert warn col" role="status"><p><strong>Copy this now. It is shown once.</strong> Only a hash is stored.</p><code className="mono" style={{ wordBreak: 'break-all' }}>{token}</code><div><button className="btn2" type="button" onClick={() => navigator.clipboard?.writeText(token)}>Copy token</button></div></div>}
          {sharing.created.length > 0 && <div className="col" style={{ gap: 8 }}><h3 className="small" style={{ fontWeight: 700 }}>Your invitations</h3>
            {sharing.created.map((i) => <div key={i.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}><span className="small">{i.label} · {i.revoked ? 'revoked' : new Date(i.expiresAt) < new Date() ? 'expired' : i.accepted ? 'accepted' : 'waiting'}</span>{!i.revoked && <button className="btn2" style={{ minHeight: 36 }} onClick={() => revoke(i.id)}>Revoke</button>}</div>)}</div>}
        </section>

        <section className="card col" style={{ flex: '1 1 380px' }}>
          <h2 className="h2">2 · Accept someone’s invitation</h2>
          <form className="col" onSubmit={accept}>
            <div><label className="lbl" htmlFor="tok">Invitation token</label><input id="tok" className="input mono" value={paste} onChange={(e) => setPaste(e.target.value)} autoComplete="off" /></div>
            <div><button className="btn" disabled={paste.trim().length < 20}>Accept</button></div>
          </form>
          {msg && <p className="alert info" role="status">{msg}</p>}
          <h2 className="h2" style={{ marginTop: 8 }}>3 · Compare</h2>
          <div><label className="lbl" htmlFor="sh">Card shared with you</label>
            <select id="sh" className="input" value={shared} onChange={(e) => setShared(e.target.value)} disabled={!sharing.shared.length}>{sharing.shared.length ? sharing.shared.map((s) => <option key={s.invitationId} value={s.scorecardId}>{s.label}</option>) : <option>None yet</option>}</select></div>
          <div><button className="btn btn-lg" onClick={compare} disabled={!own || !shared || !sharing.shared.length}>Compare cards</button></div>
        </section>
      </div>

      {result && <Result r={result} />}
    </>
  );
}

function Result({ r }: { r: ComparisonDto }) {
  const x = r.result;
  return (
    <section className="col" aria-label="Comparison result">
      <div className="card dark row between" style={{ gap: 24 }}>
        <div className="col" style={{ flex: '1 1 320px', gap: 8 }}>
          <p className="eyebrow">Result on common skills</p>
          <h2 style={{ fontSize: 26, margin: 0 }}>{x.headline.replace('Card A', 'You').replace('Card B', r.b.label)}</h2>
          {x.status === 'COMPARABLE' && <p style={{ color: '#c4d2e4' }}>{x.winner === 'TIE' ? 'The averages are equal at one decimal.' : `Lead: ${fmtScore(Math.abs((x.averageA ?? 0) - (x.averageB ?? 0)))} points.`} This is not a hiring recommendation.</p>}
        </div>
        {x.status === 'COMPARABLE' && <div className="row" style={{ gap: 32 }}><div><p className="small" style={{ color: '#9fb3cc' }}>You</p><p className="stat">{fmtScore(x.averageA)}</p></div><div><p className="small" style={{ color: '#9fb3cc' }}>{r.b.label}</p><p className="stat" style={{ color: '#9fb3cc' }}>{fmtScore(x.averageB)}</p></div></div>}
      </div>
      {x.reasons.length > 0 && <div className={`alert ${x.status === 'COMPARABLE' ? 'info' : 'warn'}`}><ul style={{ margin: 0, paddingLeft: 20 }}>{x.reasons.map((t) => <li key={t}>{t}</li>)}</ul></div>}
      {x.perSkill.map((p) => (
        <div key={p.skill} className="card col">
          <h3 className="h2">{p.skill}, part by part</h3>
          <div style={{ overflowX: 'auto' }}>
            <table><thead><tr><th scope="col">Part</th><th scope="col" className="n">You</th><th scope="col" className="n">{r.b.label}</th><th scope="col" className="n">Gap</th></tr></thead>
              <tbody>{(['mcq', 'viva', 'mutation'] as const).map((k) => <tr key={k}><th scope="row">{k === 'mcq' ? 'MCQs · 20%' : k === 'viva' ? 'Viva · 35%' : 'Mutation · 45%'}</th><td className="n">{fmtScore(p.a[k])}</td><td className="n">{fmtScore(p.b[k])}</td><td className="n">{p.a[k] - p.b[k] > 0 ? '+' : ''}{fmtScore(p.a[k] - p.b[k])}</td></tr>)}
                <tr><th scope="row" style={{ fontWeight: 700 }}>Weighted score</th><td className="n" style={{ fontWeight: 700 }}>{fmtScore(p.a.final)}</td><td className="n">{fmtScore(p.b.final)}</td><td className="n" style={{ fontWeight: 700 }}>{p.diff > 0 ? '+' : ''}{fmtScore(p.diff)}</td></tr></tbody></table>
          </div>
        </div>
      ))}
      <div className="grid2">
        <div className="card col pad-sm" style={{ flex: '1 1 300px' }}><h3 className="h2">Compared skills</h3><p className="small">{x.common.length ? x.common.join(', ') : 'None'}</p>
          <p className="small muted">Only skills both cards completed are compared. Unmatched on your card: {x.unmatchedA.join(', ') || 'none'}. Unmatched on theirs: {x.unmatchedB.join(', ') || 'none'}.</p></div>
        <div className="card col pad-sm" style={{ flex: '1 1 300px' }}><h3 className="h2">Limits</h3><ul className="small" style={{ margin: 0, paddingLeft: 20 }}>{x.limitations.map((l) => <li key={l}>{l}</li>)}<li>College, gender, age, location and names are never used.</li></ul></div>
      </div>
    </section>
  );
}
