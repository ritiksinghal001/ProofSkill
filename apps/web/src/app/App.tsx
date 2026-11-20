import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { STAGES, type AssessmentDto, type Stage } from '@proof/contracts';
import { api, type User } from '../services/api';
import { ErrorNote, Loading, useAssessment } from '../components/ui';
import { Entry } from '../features/auth/Entry';
import { Home } from '../features/assessment/Home';
import { ResumePage } from '../features/assessment/Resume';
import { ProjectPage } from '../features/assessment/Project';
import { EvidencePage } from '../features/assessment/Evidence';
import { McqPage } from '../features/mcq/Mcq';
import { LifecyclePage } from '../features/lifecycle/Lifecycle';
import { VivaPage } from '../features/viva/Viva';
import { MutationPage } from '../features/mutation/Mutation';
import { ProofCardPage } from '../features/proof-card/ProofCard';
import { ComparePage } from '../features/comparison/Compare';

interface AuthCtx { user: User | null; setUser: (u: User | null) => void }
const Auth = createContext<AuthCtx>({ user: null, setUser: () => {} });
export const useAuth = () => useContext(Auth);
const AssessmentCtx = createContext<{ a: AssessmentDto; reload: () => Promise<void> } | null>(null);
export const useCurrent = () => useContext(AssessmentCtx)!;

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="main"><Loading /></div>;
  return (
    <Auth.Provider value={{ user, setUser }}>
      <a className="skip" href="#main">Skip to content</a>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/home" replace /> : <Entry />} />
        <Route element={user ? <Protected /> : <Navigate to="/" replace />}>
          <Route path="/home" element={<Shell><Landing /></Shell>} />
          <Route path="/compare" element={<Shell><ComparePage /></Shell>} />
          <Route path="/a/:id" element={<AssessmentLayout />}>
            <Route index element={<Home />} />
            <Route path="resume" element={<ResumePage />} />
            <Route path="project" element={<ProjectPage />} />
            <Route path="evidence" element={<EvidencePage />} />
            <Route path="mcq" element={<McqPage />} />
            <Route path="lifecycle" element={<LifecyclePage />} />
            <Route path="viva" element={<VivaPage />} />
            <Route path="mutation" element={<MutationPage />} />
            <Route path="card" element={<ProofCardPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Auth.Provider>
  );
}

const Protected = () => <Outlet />;

function Landing() {
  const nav = useNavigate(); const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      try { const list = await api.list(); if (list.length) nav(`/a/${list[0].id}`, { replace: true }); } catch (e) { setErr(e); }
    })();
  }, [nav]);
  const start = async () => { try { const { id } = await api.create(); nav(`/a/${id}/resume`); } catch (e) { setErr(e); } };
  return (
    <>
      <div><p className="eyebrow">Welcome</p><h1 className="h1">Start your assessment</h1></div>
      <ErrorNote error={err} />
      <section className="card col">
        <p>Upload a resume, submit one project, and answer questions about it. Nothing to pick up front: we read your skills from your resume.</p>
        <div><button className="btn btn-lg" onClick={start}>Start a new assessment</button></div>
      </section>
    </>
  );
}

function AssessmentLayout() {
  const { id } = useParams();
  const { a, error, reload } = useAssessment(id!);
  if (error && !a) return <Shell><ErrorNote error={error} onRetry={reload} /><Link to="/home">Back to home</Link></Shell>;
  if (!a) return <Shell><Loading /></Shell>;
  return (
    <AssessmentCtx.Provider value={{ a, reload }}>
      <Shell assessment={a}><Outlet /></Shell>
    </AssessmentCtx.Provider>
  );
}

const idx = (s: Stage) => STAGES.indexOf(s);
interface Step { key: string; label: string; path: string; doneFrom: Stage; action: string }
const STEPS: Step[] = [
  { key: 'resume', label: 'Resume & skills', path: 'resume', doneFrom: 'SKILLS_EXTRACTED', action: 'RESUME' },
  { key: 'project', label: 'Consent & project', path: 'project', doneFrom: 'EVIDENCE_READY', action: 'PROJECT' },
  { key: 'evidence', label: 'Evidence review', path: 'evidence', doneFrom: 'MCQ_COMPLETED', action: 'EVIDENCE' },
  { key: 'mcq', label: 'Skill MCQs', path: 'mcq', doneFrom: 'MCQ_COMPLETED', action: 'MCQ' },
  { key: 'lifecycle', label: 'Lifecycle', path: 'lifecycle', doneFrom: 'LIFECYCLE_COMPLETED', action: 'LIFECYCLE' },
  { key: 'viva', label: 'Project viva', path: 'viva', doneFrom: 'VIVA_COMPLETED', action: 'VIVA' },
  { key: 'mutation', label: 'Mutation', path: 'mutation', doneFrom: 'MUTATION_COMPLETED', action: 'MUTATION' },
  { key: 'card', label: 'Proof card', path: 'card', doneFrom: 'COMPLETED', action: 'CARD' },
];

function Shell({ children, assessment }: { children: ReactNode; assessment?: AssessmentDto }) {
  const { user, setUser } = useAuth(); const nav = useNavigate();
  const signOut = async () => { await api.logout().catch(() => {}); setUser(null); nav('/'); };
  const a = assessment;
  return (
    <div className="app">
      <nav className="side" aria-label="Assessment stages">
        <Link className="brand" to="/home"><span className="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06302c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>ProofSkill</Link>
        <NavLink className={({ isActive }) => `ni${isActive && !a ? ' on' : ''}`} to={a ? `/a/${a.id}` : '/home'} end><span className="dot">⌂</span>Candidate home</NavLink>
        {a && <div className="sep" />}
        {a && STEPS.map((s, i) => {
          const si = idx(a.stage); const lifecycleOff = s.key === 'lifecycle' && a.historyClass === 'SUFFICIENT';
          const done = si >= idx(s.doneFrom) && !(s.key === 'card' && !['COMPLETED', 'PROVISIONAL'].includes(a.stage)) && !(lifecycleOff);
          const now = a.nextAction?.type === s.action;
          const reachable = done || now || (s.key === 'evidence' && si >= idx('EVIDENCE_READY')) || (s.key === 'card' && ['COMPLETED', 'PROVISIONAL'].includes(a.stage)) || (s.key === 'resume' && si < idx('MCQ_COMPLETED') && !a.skills.length);
          const status = lifecycleOff ? 'Not needed' : done ? 'Done' : now ? 'Now' : 'Locked';
          const cls = `ni${done ? ' done' : ''}${now ? ' now' : ''}`;
          const inner = <><span className="dot">{done ? '✓' : lifecycleOff ? '–' : i + 1}</span>{s.label}<span className="st">{status}</span></>;
          return reachable && !lifecycleOff ? <NavLink key={s.key} to={`/a/${a.id}/${s.path}`} className={({ isActive }) => `${cls}${isActive ? ' on' : ''}`}>{inner}</NavLink> : <div key={s.key} className={cls} aria-disabled="true">{inner}</div>;
        })}
        <div className="sep" />
        <NavLink className={({ isActive }) => `ni${isActive ? ' on' : ''}`} to="/compare"><span className="dot">⇄</span>Compare cards</NavLink>
        <div className="userbox">{user?.email}<br /><button className="ni" style={{ padding: '6px 0', width: 'auto' }} onClick={signOut}>Sign out</button></div>
      </nav>
      <main id="main" className="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
