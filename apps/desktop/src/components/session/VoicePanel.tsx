import { useState } from 'react';

type Props = {
  connected: boolean;
  recording: boolean;
  micError: string | null;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onToggleMic: () => void;
  onBargeIn: () => void;
  onEnd: () => void;
};

export function VoicePanel({
  connected,
  recording,
  micError,
  draft,
  onDraftChange,
  onSend,
  onToggleMic,
  onBargeIn,
  onEnd,
}: Props) {
  const [showText, setShowText] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="voice-panel">
      <div className="voice-panel-main">
        <button
          className={`mic-btn${recording ? ' mic-btn-active' : ''}`}
          onClick={onToggleMic}
          disabled={!connected}
          title={recording ? '録音停止' : '録音開始'}
        >
          {recording ? (
            <>
              <span className="mic-stop-icon">■</span>
              <span className="mic-pulse" />
            </>
          ) : (
            <span className="mic-icon">🎤</span>
          )}
        </button>

        <div className="voice-panel-actions">
          {recording && (
            <span className="recording-indicator">● 録音中</span>
          )}
          <button
            className="fd-btn-secondary"
            onClick={onBargeIn}
            disabled={!connected}
          >
            割り込み
          </button>
          <button
            className="fd-btn-ghost"
            onClick={() => setShowText((s) => !s)}
          >
            {showText ? 'テキスト非表示' : 'テキスト入力'}
          </button>
          <button
            className="fd-btn-ghost end-btn"
            onClick={onEnd}
            disabled={!connected}
          >
            面接終了 →
          </button>
        </div>
      </div>

      {micError && (
        <p className="voice-panel-error">マイク: {micError}</p>
      )}

      {showText && (
        <div className="voice-text-input">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="テキストで発言 (Enter で送信)"
            disabled={!connected}
          />
          <button onClick={onSend} disabled={!connected || !draft.trim()}>
            送信
          </button>
        </div>
      )}
    </div>
  );
}
