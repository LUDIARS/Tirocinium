// @ludiars/encrypted-config (Node) で暗号化した config を記録する。C++ の復号が同じ値を返すかの互換性テスト用。
// 使い方: node native/tools/golden/record_encrypted_config.mjs <encrypted-config の src/crypto.ts> <出力 JSON>
// 値は合成データ (秘密ではない)。マスター鍵も固定の試験値。
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const [, , cryptoTs, out] = process.argv;
const { encryptJson } = await import(pathToFileURL(cryptoTs).href);
const master = 'test-master-key-not-a-secret';
const config = {
  plain: { TIROCINIUM_PORT: '8084', TIROCINIUM_HOST: '127.0.0.1' },
  secrets: {
    ANTHROPIC_API_KEY: encryptJson('synthetic-test-value-1', master),
    TIROCINIUM_DISCORD_BOT_TOKEN: encryptJson('日本語のテスト値', master),
  },
};
writeFileSync(out, JSON.stringify({ master, config, expected: {
  TIROCINIUM_PORT: '8084', TIROCINIUM_HOST: '127.0.0.1',
  ANTHROPIC_API_KEY: 'synthetic-test-value-1', TIROCINIUM_DISCORD_BOT_TOKEN: '日本語のテスト値',
} }, null, 2) + '\n');
console.log(`wrote ${out}`);
