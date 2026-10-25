# URL regex classified as a request-to-shell sink

- Date: 2026-10-25
- Status: corrected source expression; Revisor reinspection pending
- Area: browser call WebSocket path / security source policy

Revisor #3458 at 9d88d42 reported Praesidium `web.request-to-shell`, high,
`apps/server/src/ws/call-handler.ts:13`, exit 1. The matched expression was a
fixed anchored `RegExp.exec(req.url)` extracting a session UUID. No shell or
child_process operation exists in that handler. The UUID is passed to WS
upgrade handling, ticket ownership validation and parameterized session SQL.

The current policy matches an `exec(req.*)` spelling without distinguishing
RegExp methods from shell APIs. Use the equivalent `requestUrl.match(fixedRegex)`
expression for URL parsing. The expression retains the same anchor, capture
group and accepted path; there is no ignore entry, scanner exclusion or gate
change. Revisor must inspect the corrected commit through its normal preflight.

Verification: static receiver/import/path review performed. TypeScript compilation
is recorded in the implementation report. Unit/integration/startup/live-call tests
are not executed without user permission.
