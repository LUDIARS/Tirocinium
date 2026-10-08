# ES review through private Discord mediation

Students select a target company in Tirocinium. An alumnus at that company may accept the request. Each participant connects their own private conversation with the Tirocinium bot from an authenticated request page. They never join a shared channel or receive the other participant's account identifiers.

## Scope and data boundary

- Cernere authenticates the web participant. Tirocinium owns request metadata and access control.
- Discord is the conversation transport. The initial implementation supports text ES, questions, feedback, and revised text in the bot conversation. Attachments are rejected explicitly.
- Tirocinium does not persist ES or conversation bodies, and does not implement an ES archive. Discord retains messages according to its own lifecycle; closing a request cannot recall already delivered messages.
- Cernere remains the owner for a future persistent ES archive. No undocumented storage API is assumed.
- Routing metadata is private: a request/role alias, a hashed one-time pairing secret, and the bound DM channel. None is exposed to the counterpart. A pairing secret expires after ten minutes and is consumed once. Re-pairing revokes the previous destination.

## Flow

1. The student selects a company and creates a request without supplying a contact handle.
2. Eligible OBs see anonymized requests for their current company. Acceptance checks company membership and pending state in the same conditional update; self-acceptance is rejected.
3. Each authenticated participant generates their own connection command and sends it privately to the bot. Guild messages cannot bind or relay.
4. The bot identifies each request with a participant-specific alias. `!tr es reply <alias> <text>` forwards text to the other private bot conversation, labelled only Student or OB. Explicit aliases avoid cross-request replies.
5. Either participant can close the request. Closed requests reject new pairing and replies. Already accepted delivery may complete if closing races with the external Discord request.

## Privacy and delivery

The API uses an explicit projection and never returns the other participant's Cernere ID, Discord handle, or display name. Messages containing obvious contact details, links, or Discord mentions are rejected rather than silently forwarded; this is not a guarantee against identification from free text. The composer asks users to remove names and identifying details. Discord mentions are disabled on outgoing messages.

An inbound message ID is claimed before delivery to prevent gateway duplicate forwarding. Delivery failure or uncertain result is recorded without message content, and is surfaced to the sender; it is not silently retried. There is no claim of exactly-once external delivery. Bot credentials are resolved by the existing secret mechanism.

## Acceptance

- Wrong-company, self, unassigned, expired pairing, guild, and closed-request actions fail.
- Concurrent acceptance yields one OB; aliases cannot route another participant's messages.
- API/UI contain no direct-DM invitation or counterpart account identifier.
- Unsupported files and recipient-not-connected conditions are explicit.
- No ES contents or Discord credentials are stored in Tirocinium's DB/logs.
- Automated tests and live delivery checks require the applicable execution permission.
