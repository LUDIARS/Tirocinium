// Composite ログインの PKCE (RFC 7636 S256) と state。
// verifier はこの画面のメモリにだけ置き、ログイン 1 回ごとに作り直す (保存しない)。
// 公開済みの @ludiars/cernere-composite 0.6.0 には createCompositePkce が入っていないため、同じ規則をここで持つ
// (Cernere packages/composite/src/ui/pkce.ts と同じ: 32 バイトの乱数を base64url、challenge = base64url(SHA-256(verifier)))。

export type CompositePkce = { codeVerifier: string; codeChallenge: string; state: string };

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createCompositePkce(): Promise<CompositePkce> {
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return {
    codeVerifier,
    codeChallenge: base64url(new Uint8Array(digest)),
    state: base64url(crypto.getRandomValues(new Uint8Array(32))),
  };
}
