import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { SessionWebSocket, type ServerFrame } from '../ws/SessionWebSocket.js';
import { useSessionApi } from '../api/sessions.js';
import { MicCapture } from '../audio/mic-capture.js';

type Turn = { turn_no: number; role: 'interviewer' | 'user'; text: string };

export function SessionLive() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const api = useSessionApi();
  const wsRef = useRef<SessionWebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentResp, setCurrentResp] = useState('');
  const [currentTurnNo, setCurrentTurnNo] = useState(0);
  const [draft, setDraft] = useState('');
  const [latestEval, setLatestEval] = useState<unknown>(null);
  const micRef = useRef<MicCapture | null>(null);
  const seqRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    const ws = new SessionWebSocket(id, token, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onFrame: (f: ServerFrame) => {
        if (f.kind === 'session_ready') {
          setCurrentTurnNo(f.turn_no);
        } else if (f.kind === 'stt_final') {
          setTurns((t) => [...t, { turn_no: f.turn_no, role: 'user', text: f.text }]);
        } else if (f.kind === 'response_token') {
          setCurrentResp((s) => s + f.token);
        } else if (f.kind === 'response_end') {
          setCurrentResp((s) => {
            if (s.length > 0) {
              setTurns((t) => [...t, { turn_no: f.turn_no, role: 'interviewer', text: s }]);
            }
            return '';
          });
        } else if (f.kind === 'eval') {
          setLatestEval(f.evaluation);
        } else if (f.kind === 'system') {
          console.log('[ws] system', f.code, f.message);
        }
      },
    });
    ws.open();
    wsRef.current = ws;
    return () => ws.close();
  }, [id, token]);

  // マイク取得は session 終了/離脱時に必ず止める
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
    try {
      await api.end(id);
    } catch {
      // ignore
    }
    navigate(`/session/${id}/summary`);
  };

  return (
    <div>
      <h2>Session Live <small>({connected ? 'connected' : 'disconnected'})</small></h2>
      <div className="card" style={{ maxHeight: 360, overflow: 'auto' }}>
        {turns.length === 0 && currentResp.length === 0 && <p>まだ会話なし</p>}
        {turns.map((t) => (
          <div key={t.turn_no} style={{ marginBottom: 8 }}>
            <strong>{t.role === 'interviewer' ? '面接官' : '自分'}</strong>
            <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap' }}>{t.text}</p>
          </div>
        ))}
        {currentResp.length > 0 && (
          <div>
            <strong>面接官 (…)</strong>
            <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap', opacity: 0.85 }}>{currentResp}</p>
          </div>
        )}
      </div>
      <div className="card">
        <label>
          発言テキスト (またはマイクで音声入力):
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={toggleMic}
            disabled={!connected}
            style={recording ? { background: '#c62828', color: 'white' } : undefined}
          >
            {recording ? '⏹ 録音停止' : '🎤 録音開始'}
          </button>
          <button onClick={send} disabled={!connected || !draft.trim()}>送信</button>
          <button onClick={() => wsRef.current?.sendBargeIn()} disabled={!connected}>
            割り込み
          </button>
          <button onClick={end} disabled={!connected}>終了 → サマリ</button>
          {recording && <span style={{ color: '#c62828', fontSize: 12 }}>● 録音中</span>}
        </div>
        {micError && <p style={{ color: '#c62828', fontSize: 12 }}>マイク: {micError}</p>}
      </div>
      {latestEval != null ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>直近の評価</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(latestEval, null, 2)}</pre>
        </div>
      ) : null}
      <p>turn_no: {currentTurnNo}</p>
    </div>
  );
}
