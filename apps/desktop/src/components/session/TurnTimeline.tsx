import { useEffect, useRef } from 'react';
import type { Turn } from '../../types/session.js';

type Props = {
  turns: Turn[];
  streamingText: string;
};

export function TurnTimeline({ turns, streamingText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, streamingText]);

  if (turns.length === 0 && !streamingText) {
    return (
      <div className="turn-timeline">
        <p className="turn-empty">面接官の第一声を待っています…</p>
      </div>
    );
  }

  return (
    <div className="turn-timeline">
      {turns.map((t) => (
        <div key={t.turn_no} className={`turn-row turn-row-${t.role}`}>
          <div className="turn-label">
            {t.role === 'interviewer' ? '面接官' : 'あなた'}
          </div>
          <div className={`turn-bubble turn-bubble-${t.role}`}>
            <p>{t.text}</p>
          </div>
        </div>
      ))}
      {streamingText && (
        <div className="turn-row turn-row-interviewer">
          <div className="turn-label">面接官</div>
          <div className="turn-bubble turn-bubble-interviewer turn-bubble-streaming">
            <p>{streamingText}</p>
            <span className="turn-cursor" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
