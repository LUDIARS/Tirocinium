import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { SessionWebSocket, type ServerFrame } from '../ws/SessionWebSocket.js';
import { useSessionApi } from '../api/sessions.js';
import { MicCapture } from '../audio/mic-capture.js';
import { TurnTimeline } from '../components/session/TurnTimeline.js';
import { VoicePanel } from '../components/session/VoicePanel.js';
import { EvalPanel } from '../components/session/EvalPanel.js';
import { ModelBadge } from '../components/session/ModelBadge.js';
import type { Turn, Evaluation } from '../types/session.js';

export function SessionLive() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const api = useSessionApi();
  const wsRef = useRef<SessionWebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const seqRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [draft, setDraft] = useState('');
  const [latestEval, setLatestEval] = useState<Evaluation | null>(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    const ws = new SessionWebSocket(id, token, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onFrame: (f: ServerFrame) => {
        if (f.kind === 'stt_final') {
          setTurns((t) => [...t, { turn_no: f.turn_no, role: 'user', text: f.text }]);
        } else if (f.kind === 'response_token') {
          setStreamingText((s) => s + f.token);
        } else if (f.kind === 'response_end') {
          setStreamingText((s) => {
            if (s.length > 0) {
              setTurns((t) => [...t, { turn_no: f.turn_no, role: 'interviewer', text: s }]);
            }
            return '';
          });
        } else if (f.kind === 'eval') {
          setLatestEval(f.evaluation as Evaluation);
        }
      },
    });
    ws.open();
    wsRef.current = ws;
    return () => ws.close();
  }, [id, token]);

  useEffect(() => () => { void micRef.current?.stop(); }, []);

  const send = () => {
    if (!draft.trim() || !wsRef.current) return;
    wsRef.current.sendSttFinal(draft.trim());
    setDraft('');
  };

  const toggleMic = async () => {
    if (recording) {
      await micRef.current?.stop();
      micRef.current = null;
      setRecording(false);
      return;
    }
    try {
      setMicError(null);
      const mic = new MicCapture();
      await mic.start((bytes) => {
        wsRef.current?.sendAudioChunk(bytes, seqRef.current++);
      });
      micRef.current = mic;
      setRecording(true);
    } catch (e) {
      setMicError(e instanceof Error ? e.message : 'マイク取得に失敗しました');
    }
  };

  const end = async () => {
    await micRef.current?.stop();
    micRef.current = null;
    setRecording(false);
    wsRef.current?.sendEndSession();
    try { await api.end(id); } catch { /* ignore */ }
    navigate(`/session/${id}/summary`);
  };

  return (
    <div className="session-live">
      <div className="session-live-header">
        <span className={`connection-badge ${connected ? 'connection-badge-ok' : 'connection-badge-off'}`}>
          {connected ? '● 接続中' : '○ 未接続'}
        </span>
        <ModelBadge mode="server" />
      </div>

      <div className="session-live-body">
        <div className="session-live-main">
          <TurnTimeline turns={turns} streamingText={streamingText} />
        </div>
        <div className="session-live-sidebar">
          <EvalPanel evaluation={latestEval} />
        </div>
      </div>

      <div className="session-live-footer">
        <VoicePanel
          connected={connected}
          recording={recording}
          micError={micError}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          onToggleMic={toggleMic}
          onBargeIn={() => wsRef.current?.sendBargeIn()}
          onEnd={end}
        />
      </div>
    </div>
  );
}
