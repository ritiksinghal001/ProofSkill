# Implementation status

Updated 2026-10-31. Levels: **not started** · **fixture only** · **working locally** · **tested in staging** · **released**. Nothing here is above "working locally". Nothing has been deployed.

## Verified in this build
- `npm test`: 28 passing (scoring and GitHub unit tests, integration tests over the real HTTP API and worker).
- `npm run typecheck` and `npm run build`: clean.
- Browser check of sign-in, candidate home, proof card and comparison screens against seeded data. The upload and answering screens were exercised through the API tests, **not clicked through in a browser**.

## Features

| Feature | Level | Notes |
| --- | --- | --- |
| Auth, ownership, roles | working locally | Local email+password (D-002). Every record read is owner-scoped (404 otherwise); CSRF header; operator role only via seed. **Managed provider: not started.** |
| Resume upload and skill extraction | working locally | PDF, DOCX and TXT, signature-checked, via worker. Alias dictionary, "learning" claims ignored, unsupported skills shown. PDF/DOCX parsing is coded but only TXT was exercised in tests. OCR: not started. |
| Consent | working locally | Recorded per assessment. Revocation endpoint and retention/deletion: **not started**. |
| ZIP project submission | working locally | Streaming limits, unsafe-path/symlink/encrypted rejection, generated storage names, hash manifest. Hostile path test passes. |
| GitHub submission | working locally | Live-tested 2026-10-31 against 4 public repos: snapshot pinned to commit, archive download through the redirect allow-list, evidence, and history routing (observed SUFFICIENT and LIMITED). Unauthenticated GitHub allows only 60 requests/hour; one submission uses about 22, so set `GITHUB_TOKEN` in `.env`. Rate limit during analysis fails the job with a clear message and returns you to the project step, or marks history Unavailable. Private repos: not started. |
| Evidence rules | working locally | Babel rules for React state/props/effects, JS arrays/async/functions, Express routes/middleware/errors, SQL patterns. Rules are narrow and versioned (v1). Not validated against human-reviewed findings. |
| History routing | working locally | Rubric v0 (D-008), unvalidated. ZIP → lifecycle. |
| MCQs | working locally | Protected keys, per-attempt option shuffle, autosave with revision check, graded once, idempotent submit. Optional server deadline (`MCQ_TIMED`). Demo-sized bank (D-006). |
| Lifecycle explanation | working locally | Saved, no score. AI consistency feedback: **not started**. |
| Viva and mutation | working locally | Template-generated tasks (D-004) with stored excerpts and fixed rubrics. Mutation is a proposal; no code is executed. Bounded follow-up questions: **not started**. |
| Evaluation | **fixture only** | Keyword heuristic, labelled everywhere. Live Anthropic adapter written, **untested**. Validation, bounded retries and NEEDS_REVIEW exist. |
| Scoring and proof card | working locally | 20/35/45, no zero for missing parts, overall withheld until all supported skills are complete, "Why this result", confidence, improvements. Revisions stored; reviewer-driven corrections: not started. |
| Review requests | working locally | Saved for candidates. Operator list endpoints exist; no resolve workflow or UI yet. |
| Candidate comparison | working locally | Hashed expiring revocable invitations, common-skill rule, withheld/not-comparable states, revocation blocks saved results. |
| Worker and jobs | working locally | Atomic claim, lease, 3 attempts with backoff. No heartbeat metrics. |
| Database | working locally (SQLite) | **PostgreSQL + Prisma: not started** (D-001). |
| Object storage, deployment, CI | not started | Files go to `data/` on local disk. |
| Tutorial indicators | not started | Needs supplied reference data. |
| IMATS adapter | not started | Needs the real sandbox contract. No endpoints were invented. |
| Evaluation against supplied datasets | not started | Datasets not inspected. |
| Accessibility audit | not started | Labels, focus, live regions and reduced motion are built in; no screen-reader or keyboard audit done. |

## Known gaps and next steps
1. Review the history rubric on more real histories (an Express repo with only 4 qualifying commits was rated SUFFICIENT, which is borderline).
2. Add a live AI key and compare fixture vs live evaluation on human-rated answers before trusting any score.
3. Port the schema to PostgreSQL/Prisma and move storage to private object storage.
4. Replace local auth with a managed provider; define retention and deletion.
5. Browser-test every screen on phone widths; run a keyboard and screen-reader pass.
6. Author and review a production MCQ bank and pilot question counts and timing.
