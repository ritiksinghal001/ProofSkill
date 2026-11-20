# ProofSkill
Team God's Plan | Deviathon 2.0 (GLA University) | Ranked 19th out of 74 teams
Problem statement: IM-105, "Proof of skill, not a template resume" (Integraminds)

Candidate-only skill assessment from a resume and one project: resume skills, consent and project, fixed snapshot and evidence, MCQs, history routing, optional lifecycle explanation, project viva, mutation proposal, validated scoring, proof card, and optional authorised comparison.
Scoring per skill: MCQs 20%, viva 35%, mutation 45%. Evidence and Git history carry no marks. Source of truth: [docs/IMPLEMENTATION_HANDOFF.md](docs/IMPLEMENTATION_HANDOFF.md).

**Read [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) first.** It says exactly what works, what is a fixture and what is pending.

## Requirements
Node.js 22.13+ (developed on 24). No database server needed: local development uses SQLite via `node:sqlite` (see DECISIONS D-001).

## Run it
```bash
npm install
npm run fixtures     # builds the sample ZIPs in tests/fixtures
npm run seed         # optional: three labelled SAMPLE candidates (scripted answers)
npm run dev          # API :4000, worker, web :5173
```
Open http://localhost:5173. Demo logins after seeding (local dev only): `demo-a@example.test`, `demo-b@example.test`, `demo-c@example.test`, password `demo-password-1`.
Or register a new account and upload `tests/fixtures/resume-a.txt` then `tests/fixtures/shopping-cart.zip`.

Copy `.env.example` to `.env` to change settings. Run the three processes separately with `npm run dev:api`, `npm run dev:worker`, `npm run dev:web`.

## Checks
```bash
npm test             # scoring unit tests + full-flow integration tests (HTTP API, worker, ownership, comparison)
npm run typecheck    # backend + web
npm run build        # production web bundle (API serves it when apps/web/dist exists)
```

## Layout
`apps/web` React + Vite UI · `apps/api` Express API · `apps/worker` durable job worker · `packages/contracts` browser-safe schemas · `packages/scoring` pure scoring and comparison · `packages/server-core` database, analysis, workflow, AI boundary · `tests/` integration tests and fixtures · `docs/` handoff, decisions, status.
