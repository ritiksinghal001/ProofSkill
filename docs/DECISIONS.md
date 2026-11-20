# Decisions log

Reversible implementation defaults. Items marked Proposed in the handoff stay proposals; nothing here changes the agreed flow or the 20/35/45 weights.

| ID | Date | Decision | Why | Revisit when |
| --- | --- | --- | --- | --- |
| D-001 | 2026-10-31 | Local store is SQLite via `node:sqlite`, behind `packages/server-core/src/db.ts`. The spec's PostgreSQL + Prisma is **not** implemented. | No Postgres or Docker was available, and the owner needs something runnable now. | Before staging. Port the schema in `db.ts` to `prisma/schema.prisma`; every query lives in server-core. |
| D-002 | 2026-10-31 | Authentication is local email + password (scrypt, hashed session tokens, HttpOnly SameSite=Lax cookie, custom CSRF header). Role is never taken from a request. | A managed provider needs a selection and credentials. | Before real candidate data. |
| D-003 | 2026-10-31 | The evaluator default is a transparent keyword heuristic labelled "fixture". A live Anthropic adapter exists (`ai.ts`) but is untested. Confidence is capped at Moderate under the fixture. | No provider credentials. We do not present heuristic scores as AI judgement. | When a key is available: run both against human-rated answers. |
| D-004 | 2026-10-31 | Viva and mutation tasks are template-generated from evidence, with rubrics fixed before serving. | Deterministic and reference-valid. LLM generation is a later swap behind the same table. | Pilot review of question quality. |
| D-005 | 2026-10-31 | Viva = 3 questions per skill over at least 2 evidenced topics (slots: 2+1). Mutation = 2 per skill with distinct topics. A skill with under 2 evidenced topics gets no viva and stays Incomplete, never zero. | Matches the Proposed minimums. | After a pilot. |
| D-006 | 2026-10-31 | MCQ bank: 10 per skill (3 basic, 5 intermediate, 2 advanced), authored for the demo. Not a reviewed production bank. | Needed to run the flow. | Before publishing real assessments. |
| D-007 | 2026-10-31 | Viva and mutation answers use generic `PUT /tasks/:id/draft` and `POST /tasks/:id/submit` instead of `/viva-sessions` and `/mutation-sessions`. Round starts use `/assessments/:id/{lifecycle,viva,mutation}/start` as in the spec. | One implementation for three rounds. | If clients need the spec paths. |
| D-008 | 2026-10-31 | History rubric v0: sufficient needs 4+ inspected commits adding source across 2+ files with no commit holding over 70% of additions. ZIPs are always lifecycle. | Qualitative rule needs a first concrete version. Counts are not the only gate. | After review on real repositories. |
| D-009 | 2026-10-31 | Skills outside the supported catalogue (e.g. Docker) are listed as not assessed and excluded from the overall average. Overall is shown only when every supported in-scope skill is complete. | Visible, never scored, never silently dropped. | Policy decision on whether they should block completeness. |
| D-010 | 2026-10-31 | Common skills for comparison are those on both cards. Any incomplete common skill, or differing policy/rubric/scorer version, withholds the winner. | Follows the comparison policy exactly. | — |
| D-011 | 2026-10-31 | Sample cards are produced by driving the real API with scripted answers built from rubric keywords, flagged `is_sample`, and labelled as such. | Honest demo data without fabricating results. | — |
