import { WS_URL } from '../config.js';

export type ServerFrame =
  | { kind: 'session_ready'; session_id: string; turn_no: number }
  | { kind: 'stt_partial'; text: string }
  | { kind: 'stt_final'; text: string; turn_no: number }
  | { kind: 'response_token'; token: string; turn_no: number }
  | { kind: 'response_end'; turn_no: number; text_uri: string }
  | { kind: 'tts_chunk'; turn_no: number; pcm: number[]; sample_rate: number; channels: number }
  | { kind: 'tts_end'; turn_no: number }
  | { kind: 'eval'; evaluation: unknown }
  | { kind: 'system'; code: string; message?: string };

export type SessionWebSocketHandlers = {
  onFrame?: (frame: ServerFrame) => void;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Event) => void;
};

export class SessionWebSocket {
  private ws: WebSocket | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly token: string,
    private readonly handlers: SessionWebSocketHandlers = {},
  ) {}

  open(): void {
    const url = `${WS_URL}/api/v1/ws/session/${this.sessionId}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.handlers.onOpen?.();
    this.ws.onclose = (e) => this.handlers.onClose?.(e.code, e.reason);
    this.ws.onerror = (e) => this.handlers.onError?.(e);
    this.ws.onmessage = (e) => {
      try {
        const f = JSON.parse(e.data as string) as ServerFrame;
        this.handlers.onFrame?.(f);
      } catch {
        // ignore non-JSON frames
      }
    };
  }

  sendSttFinal(text: string): void {
    this.send({ kind: 'stt_final', text });
  }

  sendBargeIn(): void {
    this.send({ kind: 'barge_in' });
  }

  sendEndSession(): void {
    this.send({ kind: 'end_session' });
  }

  sendAudioChunk(pcm: number[], seq: number): void {
    this.send({ kind: 'audio_chunk', pcm, seq });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }
}
