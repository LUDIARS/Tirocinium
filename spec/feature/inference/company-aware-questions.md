# Seeded technical, company-color and official AI-strategy questions

Actio: `4fd5f3a3-74e1-42bb-9fdd-0364922294a1`.

Implementation references: `technical-topics.ts` performs seeded role/level
selection; `question-plan.ts` reserves the three probe slots; `brief-builder.ts`
and `sources.ts` snapshot the company data and recent selected-topic history.
`company-question-candidates.ts` preserves missing/invalid metadata states.
`ai-evidence.ts` preserves source context and restricts official hosts;
`interview-research.ts` bounds discovery; `fetcher.ts` bounds HTTP, robots,
throttle and resolver wait latency. `interviewer-cli.ts` and `brain.ts` enforce
Opus/Sol composition without tools or Sonnet fallback. `session-runtime.ts`
reuses the snapshot and normal phase cursor.

Interview-engine owns role/experience-scoped technical topics, seeded selection,
reserved question slots and the immutable brief. Company-research owns public
company profile and bounded official-site research. llm-access owns question
composition via Opus/Sol. Existing personal Memoria RAG remains memory-only.

The brief reads Tr's resolved company/profile, never manufactures a missing
company. One technical topic, one company-color question and one AI-strategy
question are reserved before ordinary probe candidates. Technical topics are
independent of the portfolio, with injected RNG, topic ID and selection reason.
Recent selected topics are excluded when alternatives exist; reconnect reuses
the saved candidate snapshot and cursor rather than rolling again.

AI research follows only the resolved company's official site (including its
subdomains), using existing SSRF-protected/robots-aware HTTP fetching. It has
bounded pages, response bytes and time. Third-party recruitment hosts such as
HRMOS are outside this automatic scope even when an official company links to
them. Official profile source URLs are preferred; discovered links remain
same-site. Generic link-cache text is neither overwritten nor treated as HTML. Source
URL/title/publication date (unknown if unavailable)/retrieval date/excerpt,
fetch failures and scope limitations are frozen in the brief source metadata.

AI policy, hiring, trials, deployment, effects and investment are separate
evidence dimensions, not a single enthusiasm score. A keyword hit only proves
that the quoted text mentions the topic, not adoption or endorsement. Negative
statements remain intact. No evidence/robots/timeout/HTTP failure means unknown,
never low commitment. The reserved AI slot remains a clearly hypothetical
development-use/quality/rights/confidentiality/measurement question if evidence
cannot be obtained. Model questions cite their evidence and distinguish fact,
interpretation and unknowns. Source text is untrusted data, never instructions.

Question-plan is enabled by default. Explicit `TIROCINIUM_QUESTION_PLAN=0` keeps
legacy unplanned sessions and therefore does not provide reserved-slot guarantees.
Composition uses existing subscription one-shot CLIs, default Sol (current user
instruction), optional Opus through `TIROCINIUM_INTERVIEWER_MODEL=sol|opus`.
No Sonnet substitution; invalid model or unavailable CLI/auth fails explicitly.
Other roles (judge/refine/evaluate/focus preparation) retain existing behavior.
Spoken composition uses CLI regardless of the legacy API/CLI focus backend.
Normal phase budgets retain at least three probe turns; early termination,
shortened budgets and generation failures cannot guarantee delivery of all slots.
Snapshots retain at most six 1200-character AI excerpts; scope omissions are recorded.

Acceptance plan: deterministic seeds; role/level bounds; seen-topic exclusion;
reserved slots survive crowded company pools; snapshot/reconnect stability;
official host/redirect/response/page limits; failed/missing/negative evidence;
source date/URL preservation; source-instruction boundary; Opus/Sol launch and
malformed-output failure. Add unit regressions, run type/build/Anatomia static
verification; unit/integration/live/startup tests are delegated to Revisor until
explicit session permission. No schema migration or service start is required.
