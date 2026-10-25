# Existing raw NUL separators block security preflight

- Date: 2026-10-25
- Status: fixed in working tree; Revisor reinspection pending
- Area: company source deduplication / security inspection

Revisor local PR #3458 stopped before registered tests: Praesidium security
preflight returned error/exit 2, inspection incomplete, with no findings/checks.
This is an inspection failure, not a passing security review.

Read-only source inventory found 400 source files / 2,834,879 bytes, below the
scanner's limits. Three existing UTF-8 source files contained seven raw NUL bytes:
`packages/companies/src/ob-sheet.ts` (3), `ob.ts` (3), `provenance.ts` (1).
All were template-string separators in deduplication keys. Praesidium rejects
source containing raw NUL, before executing registered tests. These separators
predate this voice-call change; their introduction has not been investigated.

Replace only those seven bytes with the JavaScript source escape `\u0000`.
The template evaluates to the same NUL-separated key. Keep scanner boundaries
and policy intact. UTF-8 decoding, byte locations and exact reverse replacement
were inspected without executing the application or tests.

Verification: build:server (TypeScript compilation) passed after this correction. Unit/integration,
startup and live-call tests remain unexecuted without user permission. Revisor
must complete security inspection and its registered review checks.

Actio progress update to delegated returned explicit 503 actio_unavailable for
both linked tasks; progress remains unconfirmed, and the write was not repeated.

This log is included in the task worktree because the user's shared-checkout
isolation/main-edit rule takes precedence over the problem-log skill's default
of placing logs directly in the registered repository main checkout.
