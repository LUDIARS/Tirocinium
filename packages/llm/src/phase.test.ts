import { describe, it, expect } from 'vitest';
import {
  initialPhaseState,
  nextPhase,
  pressureEnabled,
  type PhaseState,
  type PhaseSignals,
} from './phase.js';

function run(state: PhaseState, n: number, signals?: PhaseSignals): PhaseState {
  let s = state;
  for (let i = 0; i < n; i++) s = nextPhase(s, signals);
  return s;
}

describe('phase state machine', () => {
  it('starts in opening', () => {
    expect(initialPhaseState(5).phase).toBe('opening');
  });

  it('opening → probe after maxTurns(2)', () => {
    expect(run(initialPhaseState(5), 2).phase).toBe('probe');
  });

  it('high-pressure persona goes opening→probe→pressure', () => {
    // opening(2) + probe(10) = 12 turns
    expect(run(initialPhaseState(5), 12).phase).toBe('pressure');
  });

  it('low-pressure persona skips pressure (probe→closing)', () => {
    expect(pressureEnabled(2)).toBe(false);
    expect(run(initialPhaseState(2), 12).phase).toBe('closing');
  });

  it('probe exits early to next phase when synthesis reached after minTurns', () => {
    const probe = run(initialPhaseState(5), 2); // → probe
    const after = run(probe, 4, { synthesisReached: true, contradictionOpen: false });
    expect(after.phase).toBe('pressure'); // pressure persona → pressure
  });

  it('pressure exits to closing when contradiction resolved after minTurns', () => {
    let s = run(initialPhaseState(5), 12); // → pressure
    expect(s.phase).toBe('pressure');
    s = run(s, 2, { synthesisReached: true, contradictionOpen: false });
    expect(s.phase).toBe('closing');
  });

  it('reaches ended within the turn budget', () => {
    expect(run(initialPhaseState(5), 30).phase).toBe('ended');
  });

  it('budget exhaustion forces closing', () => {
    // 予算を小さくすると早期に closing へ
    const s = run(initialPhaseState(5, 4), 3);
    expect(['closing', 'ended']).toContain(s.phase);
  });

  it('ended is terminal', () => {
    const ended = run(initialPhaseState(5), 30);
    expect(nextPhase(ended).phase).toBe('ended');
  });
});
