# GLab browser voice call

Value: authenticated students can start a Tirocinium interview voice call from GLab,
independently of Odeum presentation sessions. Existing interview-engine, STT/TTS
providers and slot admission remain authoritative. No new recording storage.

Domains: realtime-channel owns call tickets/WS lifecycle; http-api owns authenticated
session routes; GLab careers owns the entry and browser audio lifecycle.

1. On an explicit start click, GLab requests microphone access and starts a session
   through its existing Cernere downstream token provider (`projectKey=tirocinium`).
2. GLab's authenticated same-origin HTTP/SSE bridge obtains
   `POST /api/v1/sessions/:id/call-ticket` for the active session owner. It
   returns a random 256-bit capability, 30 second TTL, single use, held in memory.
3. The GLab server connects to `/api/v1/ws/call/:id` and sends `{ticket}` as the first text frame within
   five seconds. No ticket/bearer in URL, logs or browser persistent storage. Then
   use existing PCM audio_chunk/start_interview/barge_in/end_session frames.
4. Disconnect, explicit end and error release runtime audio and mark the session
   ended, returning its active slot. A failed start ends any created session.
5. GLab releases microphone tracks, WebSocket, worklet and playback resources on
   stop, navigation, page exit and all failure paths. Mute stops outgoing capture.

Configuration: GLab uses existing `TIROCINIUM_URL` from Excubitor topology/catalog
for server HTTP and WS. Browser audio/control POSTs and fetch SSE stay on GLab's
authenticated origin; no new public Tr listener/URL or Corpus changes are needed.
Cernere downstream audience and Tr `CERNERE_AUDIENCE` must match the registered Tr
URL. Browser microphone access requires HTTPS outside loopback.

Acceptance plan (not executed without permission): owner/other-user authorization,
expired/reused/wrong-session tickets, failed microphone/API/WS setup cleanup,
disconnect slot release, mute/barge-in/end, independent concurrent Odeum use and
existing session regression. No tests or service starts authorized for this change.
