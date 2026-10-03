# Shared subscription CLI launch

Both full-response and streaming CLI calls in `@tirocinium/llm` use Lapilli's
`@ludiars/one-shot`. The existing Sonnet/Opus/Haiku assignments remain; Lapilli
resolves those roles into the centrally maintained model IDs. Omitted models use
the common Sonnet default instead of an implicit CLI default.

Lapilli owns shell-free executable resolution and subscription auth environment.
Tirocinium retains prompt construction, stdin, stream output and cancellation.
The direct API and local Ollama backends are separate and remain unchanged.

Initialize `lib/lapilli` before npm install. Revisor's `setup-lapilli` obtains the
gitlink before existing checks. Restore the consumer and dependency pin together.
Tests and live inference are not run by the implementation session.
