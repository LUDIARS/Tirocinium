#!/usr/bin/env tsx
// judge blackbox のレビュー CLI (spec §7.1 — trial ルールの人間 OK/NG と卒業状況の確認)。
//
//   npx tsx scripts/judge-blackbox stats            # 卒業メトリクス
//   npx tsx scripts/judge-blackbox rules            # ルール一覧 (state / 影評価カウンタ)
//   npx tsx scripts/judge-blackbox pending          # レビュー待ち判断
//   npx tsx scripts/judge-blackbox verdict 12 ok    # 判断 #12 を OK (trial 昇格の信頼を積む)
//   npx tsx scripts/judge-blackbox verdict 13 ng    # NG (閾値到達で撤回)
//
// 対象 DB は data/judge-blackbox.sqlite (--db <path> で上書き)。

import { getJudgeBlackbox, JUDGE_DOMAIN } from '../../apps/server/src/judge-blackbox/index.js';

function usageExit(): never {
  console.error('usage: judge-blackbox <stats|rules|pending|verdict <id> <ok|ng>> [--db <path>]');
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);
  const dbIdx = argv.indexOf('--db');
  const dbPath = dbIdx >= 0 ? argv[dbIdx + 1] : undefined;
  const args = dbIdx >= 0 ? [...argv.slice(0, dbIdx), ...argv.slice(dbIdx + 2)] : argv;
  const cmd = args[0];
  if (!cmd) usageExit();

  const bb = dbPath ? getJudgeBlackbox(dbPath) : getJudgeBlackbox();

  switch (cmd) {
    case 'stats': {
      console.log(JSON.stringify(bb.stats(JUDGE_DOMAIN), null, 2));
      return;
    }
    case 'rules': {
      const rules = bb.rules.listByDomain(JUDGE_DOMAIN);
      if (rules.length === 0) {
        console.log('(ルールなし)');
        return;
      }
      for (const r of rules) {
        console.log(
          `[${r.state}] ${r.id} ${r.description}\n` +
            `    shadow ${r.shadowAgreements}✓/${r.shadowConflicts}✗  review ${r.approvals}ok/${r.rejections}ng  ` +
            `confidence ${r.confidence}  source ${r.source}`,
        );
      }
      return;
    }
    case 'pending': {
      const pending = bb.ledger.listPending(JUDGE_DOMAIN, 20);
      if (pending.length === 0) {
        console.log('(レビュー待ちなし)');
        return;
      }
      for (const d of pending) {
        console.log(
          `#${d.id} [${d.source}${d.ruleId ? `:${d.ruleId}` : ''}] ${d.createdAt}\n` +
            `    features: ${JSON.stringify(d.features)}\n` +
            `    output:   ${JSON.stringify(d.output)}\n` +
            `    根拠: ${d.rationale}`,
        );
      }
      console.log('\n→ npx tsx scripts/judge-blackbox verdict <id> <ok|ng>');
      return;
    }
    case 'verdict': {
      const id = Number.parseInt(args[1] ?? '', 10);
      const verdict = args[2];
      if (!Number.isFinite(id) || (verdict !== 'ok' && verdict !== 'ng')) usageExit();
      const result = bb.engine.recordVerdict(id, verdict);
      if (!result.ok) {
        console.error(`判断 #${id} が見つからないか、既にレビュー済みです`);
        process.exit(1);
      }
      console.log(`#${id} → ${verdict}`);
      if (result.ruleUpdated) {
        console.log(`rule ${result.ruleUpdated.id} → state=${result.ruleUpdated.state}`);
      }
      return;
    }
    default:
      usageExit();
  }
}

main();
