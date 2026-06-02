import { describe, it, expect } from 'vitest';
import { createSttProvider } from './stt-provider.js';
import { SttGrpcClient } from './stt-grpc-client.js';

describe('createSttProvider', () => {
  it('returns null when no backend is configured', () => {
    expect(createSttProvider({})).toBeNull();
  });

  it('returns null when backend is explicitly off', () => {
    expect(createSttProvider({ TIROCINIUM_STT_BACKEND: 'off' })).toBeNull();
  });

  it('infers grpc when TIROCINIUM_STT_GRPC is set', () => {
    const p = createSttProvider({ TIROCINIUM_STT_GRPC: 'localhost:50051' });
    expect(p).toBeInstanceOf(SttGrpcClient);
  });

  it('selects grpc explicitly (default addr)', () => {
    const p = createSttProvider({ TIROCINIUM_STT_BACKEND: 'grpc' });
    expect(p).toBeInstanceOf(SttGrpcClient);
  });

  it('selects api when key present', () => {
    const p = createSttProvider({ TIROCINIUM_STT_BACKEND: 'api', OPENAI_API_KEY: 'sk-test' });
    expect(p).not.toBeNull();
  });

  it('throws for api without a key', () => {
    expect(() => createSttProvider({ TIROCINIUM_STT_BACKEND: 'api' })).toThrow(/requires/);
  });

  it('throws for an unknown backend', () => {
    expect(() => createSttProvider({ TIROCINIUM_STT_BACKEND: 'bogus' })).toThrow(/Unknown/);
  });
});
