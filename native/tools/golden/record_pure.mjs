// Node 実装の純関数に合成データを入れ、入出力を golden JSON に記録する (互換性テストの正解)。
// 使い方 (リポ直下で):
//   node --experimental-transform-types --import ./native/tools/golden/ts-loader.mjs \
//        native/tools/golden/record_pure.mjs native/tests/fixtures/golden_pure.json
// 入力はすべて合成データ。ネットワーク・DB・LLM には触れない。
import { writeFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const mod = (p) => import(new URL(p, root).href);

const rng = await mod('packages/llm/src/rng.ts');
const phase = await mod('packages/llm/src/phase.ts');
const plan = await mod('packages/llm/src/question-plan.ts');
const topics = await mod('packages/llm/src/technical-topics.ts');
const roles = await mod('packages/llm/src/role-aliases.ts');
const response = await mod('packages/llm/src/response.ts');
const brain = await mod('packages/llm/src/brain.ts');
const sprofile = await mod('packages/llm/src/specialist-profile.ts');
const sfocus = await mod('packages/llm/src/specialist-focus.ts');
const sprompts = await mod('packages/llm/src/specialist-prompts.ts');
const evaluator = await mod('packages/llm/src/evaluator.ts');
const judge = await mod('packages/llm/src/judge.ts');
const coerce = await mod('packages/llm/src/coerce.ts');
const summarizer = await mod('packages/llm/src/summarizer.ts');
const icli = await mod('packages/llm/src/interviewer-cli.ts');
const weakness = await mod('apps/server/src/feedback/weakness-math.ts');
const tick = await mod('apps/server/src/reservation/tick-rules.ts');
const slot = await mod('apps/server/src/reservation/slot.ts');
const personaPrompt = await mod('apps/server/src/persona/prompt.ts');
const sufficiency = await mod('apps/server/src/brief/sufficiency-gate.ts');
const sources = await mod('apps/server/src/brief/sources.ts');
const cqc = await mod('apps/server/src/brief/company-question-candidates.ts');
const briefBuilder = await mod('apps/server/src/brief/brief-builder.ts');
const policy = await mod('apps/server/src/materials/material-policy.ts');
const reader = await mod('apps/server/src/materials/material-reader.ts');
const mbrief = await mod('apps/server/src/materials/material-brief.ts');
const commands = await mod('apps/server/src/discord/commands.ts');
const gateway = await mod('apps/server/src/discord/gateway-client.ts');
const normalize = await mod('packages/companies/src/normalize.ts');
const skills = await mod('apps/server/src/materials/consult-skills.ts');

const cases = [];
function rec(fn, input, run) {
  try {
    const output = run();
    cases.push({ fn, input, output: output === undefined ? null : JSON.parse(JSON.stringify(output)) });
  } catch (err) {
    cases.push({ fn, input, error: String(err?.message ?? err) });
  }
}

// ---- rng / shuffle ----
for (const seed of [0, 1, 42, 123456789, 4294967295]) {
  rec('mulberry32', { seed, n: 12 }, () => { const r = rng.mulberry32(seed); return Array.from({ length: 12 }, () => r()); });
  rec('shuffled', { seed, items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, () => rng.shuffled(['a', 'b', 'c', 'd', 'e', 'f', 'g'], rng.mulberry32(seed)));
}

// ---- phase ----
for (const pressure of [2, 4, 5]) {
  for (const pattern of ['none', 'synth', 'resolve', 'mixed']) {
    let s = phase.initialPhaseState(pressure);
    const steps = [];
    for (let i = 0; i < 24; i++) {
      const signals = pattern === 'none' ? phase.DEFAULT_SIGNALS
        : pattern === 'synth' ? { synthesisReached: i % 3 === 2, contradictionOpen: true }
        : pattern === 'resolve' ? { synthesisReached: true, contradictionOpen: false }
        : { synthesisReached: i % 2 === 0, contradictionOpen: i % 4 === 0 };
      rec('nextPhase', { state: s, signals }, () => phase.nextPhase(s, signals));
      s = phase.nextPhase(s, signals);
      steps.push(s.phase);
    }
  }
}
rec('nextPhase', { state: { phase: 'closing', phaseTurnNo: 0, turnBudget: 1, personaPressure: 3 }, signals: phase.DEFAULT_SIGNALS },
  () => phase.nextPhase({ phase: 'closing', phaseTurnNo: 0, turnBudget: 1, personaPressure: 3 }, phase.DEFAULT_SIGNALS));

// ---- question plan ----
const C = (theme, origin, extra = {}) => ({ theme, question: `${theme} の質問`, followups: [], axes: ['clarity'], origin, ...extra });
const candidates = [
  C('志望動機', 'company', { axes: ['target_fit'] }),
  C('ガクチカ', 'seed', { followups: ['数字は?'], axes: ['self_understanding', 'clarity'] }),
  C('チーム開発', 'ob', { followups: ['衝突は?'], axes: ['consistency'] }),
  C('技術選定', 'newgrad', { followups: ['代替案は?', '計測は?'], axes: ['depth_resilience'] }),
  C('自己紹介', 'company'),
  C('失敗経験', 'seed', { followups: ['再発防止は?'], axes: ['depth_resilience', 'self_understanding'] }),
  C('志望動機', 'seed'),
  C('企業カラー', 'company', { required: 'company-color', evidence: [{ url: 'https://example.test/a', fetchedAt: 'x', publishedAt: null, excerpt: 'e' }] }),
  C('AI 戦略', 'seed', { required: 'ai-strategy' }),
  C('技術ランダム: X', 'seed', { required: 'random-technical', topicId: 'programmer:0', selectionReason: 'r' }),
  C('ポートフォリオ', 'newgrad', { followups: ['担当範囲は?'] }),
  C('逆境', 'ob', { axes: ['depth_resilience'] }),
  C('将来像', 'seed', { axes: ['target_fit', 'self_understanding'] }),
  C('趣味', 'seed', { followups: ['なぜ?'] }),
  C('リーダー経験', 'company', { followups: ['反対意見は?'], axes: ['consistency', 'depth_resilience'] }),
];
for (const seed of [0, 7, 99, 2024]) {
  for (const weak of [[], ['depth_resilience'], ['target_fit', 'self_understanding', 'clarity']]) {
    const brief = { stage: 'hr', role: 'programmer', companyName: 'テスト社', candidates };
    rec('compileQuestionPlan', { brief, weakTop3: weak, seed }, () => plan.compileQuestionPlan(brief, weak, rng.mulberry32(seed)));
  }
}
{
  const p = plan.compileQuestionPlan({ stage: 'hr', role: null, companyName: null, candidates }, [], rng.mulberry32(5));
  for (const ph of ['opening', 'probe', 'pressure', 'closing', 'ended']) {
    for (const n of [0, 1, 3, 20]) rec('nextSlot', { plan: p, phase: ph, cursor: { [ph]: n } }, () => plan.nextSlot(p, ph, { [ph]: n }));
  }
}

// ---- technical topics / roles ----
for (const role of ['programmer', 'planner', 'designer', 'sound', 'general']) {
  for (const level of ['entry', 'experienced']) {
    for (const seen of [[], [`${role}:0`, `${role}:1`], [0, 1, 2, 3, 4, 5].map((i) => `${role}:${i}`)]) {
      for (const seed of [3, 77]) {
        rec('selectTechnicalTopic', { role, level, seen, seed }, () => topics.selectTechnicalTopic(role, level, seen, rng.mulberry32(seed)));
      }
    }
  }
}
for (const input of [null, '', 'Programmer', ' プログラマー志望 ', 'UI', 'ui', 'uiデザイナー', 'サウンドクリエイター', 'SE', 'se', 'ゲームデザイナー', 'TA', 'テクニカルアーティスト', '営業', 'Unity エンジニア', 'ＰＲＯＧＲＡＭＭＥＲ']) {
  rec('canonicalRole', input, () => roles.canonicalRole(input));
}
for (const terms of [['UE', 'Unity'], ['プログラマー', 'c++'], ['  ML ', 'ml', 'AI'], ['se', 'サウンド'], []]) {
  rec('expandTerms', terms, () => roles.expandTerms(terms));
}
for (const text of ['ゲーム会社の、プログラマー（新卒）。Unity/C++・UE 【募集】 a', '  ', 'x y zz 「技術」']) {
  rec('splitKeywords', text, () => roles.splitKeywords(text));
}

// ---- prompts ----
const persona = { display_name: '佐藤 (テスト)', stage: 'lead-tech', role_lens: 'programmer', temperament: '論理的', pressure: 4,
  tics: ['なるほど', 'つまり'], bio: '架空の会社のテックリード', evaluation_bias: { depth_resilience: 1.3, clarity: 1 } };
const personaAny = { ...persona, stage: 'unknown-stage', role_lens: 'any', pressure: 7, tics: [], evaluation_bias: {} };
rec('buildInterviewerPromptBlock', persona, () => response.buildInterviewerPromptBlock(persona));
rec('buildInterviewerPromptBlock', personaAny, () => response.buildInterviewerPromptBlock(personaAny));
const sp = { role: 'programmer', level: 'entry', interviewer: 'field' };
const spSenior = { role: 'sound', level: 'experienced', interviewer: 'senior' };
for (const opts of [
  { interviewer: persona },
  { interviewer: persona, phase: 'opening', weakTop3: ['clarity', 'target_fit'], ragBlock: '1. (es) 抜粋', refineBlock: '次の論点' },
  { interviewer: persona, phase: 'probe', specialist: sp, focusBlock: '## 聞きたい要点\n- a' },
  { interviewer: persona, phase: 'pressure', briefMd: '# ブリーフ\n本文', refineBlock: 'r', specialist: spSenior },
  { interviewer: personaAny, phase: 'closing', briefMd: '# B', focusBlock: 'F' },
  { interviewer: persona, phase: 'ended' },
]) {
  rec('buildSystemPrompt', opts, () => response.buildSystemPrompt(opts));
}
rec('buildWeaknessBlock', ['a', 'b'], () => response.buildWeaknessBlock(['a', 'b']));
for (const s of [candidates[1], { ...candidates[0], followups: [] }, { theme: 't', question: 'q', followups: ['x', 'y'], axes: [], origin: 'seed', phase: 'probe' }]) {
  rec('renderSlotBlock', s, () => brain.renderSlotBlock(s));
}

// ---- specialist ----
for (const v of ['__undefined__', null, {}, [], { role: 'programmer', level: 'entry' }, { role: 'sound', level: 'experienced' },
  { role: 'planner', level: 'entry', interviewer: 'senior' }, { role: 'x', level: 'entry' }, { role: 'designer', level: 'mid' },
  { role: 'designer', level: 'entry', interviewer: 'boss' }, { role: 'designer', level: 'entry', interviewer: null }, 'string']) {
  rec('parseSpecialistProfile', v, () => sprofile.parseSpecialistProfile(v === '__undefined__' ? undefined : v) ?? '__undefined__');
}
for (const p of [sp, spSenior, { role: 'planner', level: 'experienced', interviewer: 'field' }, { role: 'designer', level: 'entry', interviewer: 'senior' }]) {
  rec('specialistPersona', p, () => sprofile.specialistPersona(p));
  rec('specialistQuestionPrompt', p, () => sprompts.specialistQuestionPrompt(p));
  rec('specialistEvaluationPrompt', { profile: p, summary: false }, () => sprompts.specialistEvaluationPrompt(p, false));
  rec('specialistEvaluationPrompt', { profile: p, summary: true }, () => sprompts.specialistEvaluationPrompt(p, true));
  const newgrad = { summary: '自走できる人', themes: ['挑戦', ' ', '品質へのこだわり', 'x'.repeat(200)] };
  rec('fallbackFocusPoints', { profile: p, newgrad: null }, () => sfocus.fallbackFocusPoints(p, null));
  rec('fallbackFocusPoints', { profile: p, newgrad }, () => sfocus.fallbackFocusPoints(p, newgrad));
  rec('focusPointsPrompt', { profile: p, newgrad, materials: ' ES 抜粋 ' }, () => sfocus.focusPointsPrompt({ profile: p, newgrad, materials: ' ES 抜粋 ' }));
  rec('focusPointsPrompt', { profile: p, newgrad: null, materials: '' }, () => sfocus.focusPointsPrompt({ profile: p, newgrad: null, materials: '' }));
  const pts = sfocus.fallbackFocusPoints(p, newgrad);
  rec('renderFocusBlock', { points: pts, profile: p }, () => sfocus.renderFocusBlock(pts, p));
}
rec('specialistQuestionPrompt', null, () => sprompts.specialistQuestionPrompt(undefined));
for (const text of ['前置き {"senior":["a  b\n c","  "], "field":["f"]} 後', '{"senior":[],"field":["x"]}', 'no json', '{"senior":["s"],"field":[1,"ok"]}',
  `{"senior":${JSON.stringify(Array.from({ length: 9 }, (_, i) => `項目${i} ${'長'.repeat(170)}`))},"field":["y"]}`]) {
  rec('parseFocusPoints', text, () => sfocus.parseFocusPoints(text));
}

// ---- outputs ----
const turns = [{ turn_no: 1, role: 'interviewer', text: '自己紹介を' }, { turn_no: 2, role: 'user', text: 'はい、\n佐藤です' }];
rec('serializeHistory', turns, () => evaluator.serializeHistory(turns));
const texts = [
  '```json\n{"a":1}\n```', '前置き ```{"b":2}``` 後', '```json```{"c":3}', '```\n\n```{"d":4}', 'x {"e":5} y }', 'no braces',
  '```json {"f":6} and no close', '```jsonfoo```', '````', '{"g":7} ```{"h":8}```', '``` json\n{"i":9}```',
];
for (const t of texts) rec('extractJsonBlock', t, () => evaluator.extractJsonBlock(t));
const evals = [
  '```json\n{"axes":{"consistency":3.5,"clarity":"4","demeanor":9,"self_understanding":-1,"target_fit":null},"comment":"turn 2 で良い","hints":["a"," ","b",3,"c","d"]}\n```',
  '{"axes":[],"comment":1}', '{"comment":"x"}', 'nothing', '{"axes":{"consistency":2.5,"clarity":true,"demeanor":[4],"self_understanding":"0x3","target_fit":"","depth_resilience":"abc"}}',
];
for (const t of evals) rec('parseEvaluation', t, () => evaluator.parseEvaluation(t));
const signals = ['{"specificity":2.6,"synthesis_reached":true,"contradiction_open":0,"followup_hint":"  深掘り  "}',
  '{"specificity":"9","synthesisReached":1,"contradictionOpen":"yes","followup_hint":"   "}', '[1]', '{"specificity":null,"synthesis_reached":null,"synthesisReached":true}'];
for (const t of signals) rec('parseAnswerSignals', t, () => { const s = judge.parseAnswerSignals(t); return { ...s, followupHint: s.followupHint ?? '__undefined__' }; });
for (const v of [null, '  ', ' x ', 3]) rec('coerceFocus', v, () => coerce.coerceFocus(v) ?? '__null__');
rec('averageAxes', [{ consistency: 3, clarity: 4, demeanor: 2, self_understanding: 5, target_fit: 0, depth_resilience: 1 },
  { consistency: 4, clarity: 4, demeanor: 3, self_understanding: 4, target_fit: 1, depth_resilience: 2 }],
  () => evaluator.averageAxes([{ consistency: 3, clarity: 4, demeanor: 2, self_understanding: 5, target_fit: 0, depth_resilience: 1 },
    { consistency: 4, clarity: 4, demeanor: 3, self_understanding: 4, target_fit: 1, depth_resilience: 2 }]));
const summaries = ['{"headline":"h","highlights":[],"axes_summary":{"final":{}},"growth_points":[],"carry_over":[],"interviewer_note":"n"}',
  '{"headline":"h","highlights":[],"axes_summary":0,"growth_points":[],"carry_over":[],"interviewer_note":"n"}', '{}'];
for (const t of summaries) rec('parseSummary', t, () => summarizer.parseSummary(t));
const opusOk = JSON.stringify([{ type: 'system' }, { type: 'result', subtype: 'success', is_error: false, result: '  質問です  ' }]);
const opusTool = JSON.stringify([{ message: { content: [{ type: 'tool_use' }] } }, { type: 'result', subtype: 'success', result: 'q' }]);
const opusErr = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'x' });
const solOk = ['{"type":"thread.started"}', '{"type":"item.completed","item":{"type":"reasoning","text":"r"}}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"質問 A"}}', '{"type":"turn.completed"}'].join('\n');
const solTool = ['{"type":"item.completed","item":{"type":"command_execution"}}', '{"type":"turn.completed"}'].join('\n');
const solFail = ['{"type":"turn.failed"}'].join('\n');
for (const [model, out] of [['opus', opusOk], ['opus', opusTool], ['opus', opusErr], ['opus', '{bad'], ['sol', solOk], ['sol', solTool], ['sol', solFail], ['sol', '']]) {
  rec('parseInterviewerOutput', { model, stdout: out }, () => icli.parseInterviewerOutput(model, out));
}

// ---- server pure ----
let profile = { axes_ema: { consistency: 3, clarity: 3, demeanor: 3, self_understanding: 3, target_fit: 3, depth_resilience: 3 },
  axes_variance: { consistency: 0, clarity: 0, demeanor: 0, self_understanding: 0, target_fit: 0, depth_resilience: 0 },
  weak_top3: [], hint_history: [], session_count: 0 };
for (const [axes, hints] of [[{ clarity: 1, target_fit: 5 }, ['h1']], [{ consistency: 0, demeanor: 4.5, self_understanding: 2 }, ['h2', 'h3']],
  [{}, Array.from({ length: 60 }, (_, i) => `x${i}`)], [{ depth_resilience: 2, clarity: 'x' }, []]]) {
  rec('applyEvaluationToProfile', { cur: profile, axes, hints }, () => weakness.applyEvaluationToProfile(profile, axes, hints));
  profile = weakness.applyEvaluationToProfile(profile, axes, hints);
}
const start = Date.parse('2026-10-29T03:00:00.000Z');
for (const offsetMin of [-40, -31, -30, -6, -5, -4.9, 0, 0.1, 12.9, 13, 15, 17, 17.1, 60]) {
  for (const notify of [false, true]) {
    const now = new Date(start - offsetMin * 60000);
    const r = { id: 'r1', user_id: 'u1', slot_start: new Date(start), status: 'held', notify_sent: notify };
    rec('decideActionsFor', { reservation: { ...r, slot_start: r.slot_start.toISOString() }, now: now.toISOString(), noShowTimeoutMin: 5, notifyLeadMin: 15 },
      () => tick.decideActionsFor(r, { now, noShowTimeoutMin: 5, notifyLeadMin: 15 }).map((a) => ({ kind: a.kind, id: a.reservation.id, leadMin: a.leadMin ?? null })));
  }
}
rec('decideActionsFor', { reservation: { id: 'c', user_id: 'u', slot_start: new Date(start).toISOString(), status: 'canceled', notify_sent: false }, now: new Date(start).toISOString(), noShowTimeoutMin: 5, notifyLeadMin: 15 }, () => []);
for (const iso of ['2026-10-29T03:00:00.000Z', '2026-10-29T03:29:59.999Z', '2026-10-29T03:30:00.000Z', '2026-10-29T23:45:12.345Z', '2026-12-31T23:59:59.000Z']) {
  rec('currentSlotStart', iso, () => slot.currentSlotStart(new Date(iso)).toISOString());
  rec('nextSlotStart', iso, () => slot.nextSlotStart(new Date(iso)).toISOString());
}
const row = { id: 'i1', display_name: '面接官 A', stage: 'final', role_lens: 'any', temperament: '厳格', pressure: 5, tics: ['ふむ'], bio: '架空', evaluation_bias: { clarity: 1.2 } };
rec('interviewerToSystemPrompt', row, () => personaPrompt.interviewerToSystemPrompt(row));
rec('interviewerToSystemPrompt', { ...row, role_lens: 'planner', stage: 'x', tics: [], pressure: 2 }, () => personaPrompt.interviewerToSystemPrompt({ ...row, role_lens: 'planner', stage: 'x', tics: [], pressure: 2 }));
const ex = { id: 'e1', display_name: '受験者 B', background: '情報系学部', target_role: 'programmer', weakness_axes: { clarity: 3, depth_resilience: 4.5 }, strengths: ['C++', 'Unity'], speech_style: 'nervous', intentional_flaws: ['結論が遅い', '数字が無い'], bio: '' };
rec('examineeToSystemPrompt', ex, () => personaPrompt.examineeToSystemPrompt(ex));
rec('examineeToSystemPrompt', { ...ex, weakness_axes: {}, strengths: [], intentional_flaws: [], speech_style: 'robot' }, () => personaPrompt.examineeToSystemPrompt({ ...ex, weakness_axes: {}, strengths: [], intentional_flaws: [], speech_style: 'robot' }));
for (const c of [{ companyResolved: false, hasNewgradImage: true, companyQuestionCount: 5, obPatternCount: 0 }, { companyResolved: true, hasNewgradImage: true, companyQuestionCount: 2, obPatternCount: 1 },
  { companyResolved: true, hasNewgradImage: false, companyQuestionCount: 1, obPatternCount: 0 }, { companyResolved: true, hasNewgradImage: true, companyQuestionCount: 0, obPatternCount: 0 },
  { companyResolved: true, hasNewgradImage: false, companyQuestionCount: 0, obPatternCount: 0 }]) {
  rec('assessSufficiency', c, () => sufficiency.assessSufficiency(c));
}
rec('newgradThemeCandidates', ['挑戦', ' ', ' 品質 '], () => sources.newgradThemeCandidates(['挑戦', ' ', ' 品質 ']));
const ai = { status: 'unavailable', checkedAt: '2026-10-29T00:00:00.000Z', evidence: [], failures: [], checkedUrls: [], scope: 'Company unresolved; no company strategy confirmed.' };
const aiFound = { ...ai, status: 'mentions_found', evidence: [{ url: 'https://ex.test/ai', title: 't', fetchedAt: '2026-10-29T00:00:00.000Z', publishedAt: null, excerpt: '生成 AI を活用', dimensions: ['deployment'], interpretation: 'quoted_mention_only' }] };
const prof = { company_id: 'c1', philosophy: '遊びを届ける', values: '["誠実","挑戦"]', business: 'ゲーム開発', ir_summary: '', sources: '["https://ex.test/ir","ftp://x","https://ex.test/about"]', fetched_at: '2026-10-01 12:00:00' };
rec('companyQuestionCandidates', { companyName: 'テスト社', profile: null, ai }, () => cqc.companyQuestionCandidates('テスト社', null, ai));
rec('companyQuestionCandidates', { companyName: 'テスト社', profile: prof, ai: aiFound }, () => cqc.companyQuestionCandidates('テスト社', prof, aiFound));
rec('companyQuestionCandidates', { companyName: null, profile: { ...prof, values: 'not json', sources: null, fetched_at: 'bad' }, ai }, () => cqc.companyQuestionCandidates(null, { ...prof, values: 'not json', sources: null, fetched_at: 'bad' }, ai));
for (const meta of [{ plan: { stage: 'hr', role: 'programmer', company_name: 'X' }, candidates: [C('a', 'seed')] }, { plan: {}, candidates: [] }, { candidates: [] }, { plan: { stage: 'hr' } }]) {
  rec('planBriefFromSourceMeta', meta, () => briefBuilder.planBriefFromSourceMeta(meta) ?? '__null__');
}
const b64 = (s) => Buffer.from(s).toString('base64');
for (const raw of [null, [], { kind: 'cv' }, { kind: 'es' }, { kind: 'es', mime: 'application/zip', data_base64: 'AA==' }, { kind: 'es', mime: ' Text/Plain ', data_base64: '' },
  { kind: 'es', mime: 'text/plain', data_base64: b64('ES 本文') }, { kind: 'portfolio', mime: 'image/png', data_base64: ' iVBO\nRw0K ' }, { kind: 'es', mime: 'text/plain', data_base64: '!!!' },
  { kind: 'es', mime: 'text/plain', data_base64: 'A'.repeat(7 * 1024 * 1024) }, { kind: 'es', mime: 'text/markdown', data_base64: '====' }]) {
  const shown = raw && typeof raw === 'object' && typeof raw.data_base64 === 'string' && raw.data_base64.length > 1000 ? { ...raw, data_base64: `A*${raw.data_base64.length}` } : raw;
  rec('parseMaterialUpload', shown, () => { const r = policy.parseMaterialUpload(raw); return typeof r === 'string' ? r : { kind: r.kind, mime: r.mime, extension: r.extension, bytes_base64: r.bytes.toString('base64') }; });
}
for (const t of ['前置き\r\n## 資料の種類\nES\n## 深掘りしたい点\n- a\n## 質問の候補\n- q\n', '## 資料の種類\nx', 'none', `## 資料の種類\n## 深掘りしたい点\n## 質問の候補\n${'字'.repeat(7000)}`]) {
  rec('normalizeDigest', t, () => reader.normalizeDigest(t) ?? '__null__');
}
rec('buildReaderPrompt', { skill: 'SKILL', kind: 'portfolio', file: 'material.pdf' }, () => reader.buildReaderPrompt('SKILL', 'portfolio', 'material.pdf'));
rec('renderMaterialBrief', { kind: 'es', digest: ' 要点 ', interviewerSkill: ' スキル ' }, () => mbrief.renderMaterialBrief({ kind: 'es', digest: ' 要点 ', interviewerSkill: ' スキル ' }));
for (const t of ['﻿---\r\nname: x\r\n---\r\n本文\n', 'no front', '---\nunclosed\n本文']) rec('stripFrontmatter', t, () => skills.stripFrontmatter(t));
for (const [content, prefix] of [['!tr', '!tr'], ['!tr help', '!tr'], ['!tr end', '!tr'], ['!tr text  任天堂 プランナー', '!tr'], ['!tr voice', '!tr'], ['!tr bogus', '!tr'], ['hello', '!tr'], ['  !tr   end  ', '!tr'], ['!trx', '!tr']]) {
  rec('parseDiscordCommand', { content, prefix }, () => commands.parseDiscordCommand(content, prefix));
}
rec('renderDiscordHelp', '!iv', () => commands.renderDiscordHelp('!iv'));
for (const c of ['', '  ', 'short', 'あ'.repeat(4000), `${'a'.repeat(1899)}😀b`]) rec('chunkContent', c.length > 100 ? `len:${c.length}:${c.slice(-3)}` : c, () => gateway.chunkContent(c).map((x) => ({ len: x.length, head: x.slice(0, 2).toWellFormed(), tail: x.slice(-2).toWellFormed() })));
for (const n of ['株式会社テスト', 'グリー株式会社（グリーホールディングス株式会社）', 'Princeton Inc.', 'ＡＢＣ　Co., Ltd.', 'ディー・エヌ・エー', 'Foo Corp (旧 Bar)', '[有限会社] 【ほげ】']) {
  rec('normalizeName', n, () => normalize.normalizeName(n));
}

writeFileSync(process.argv[2], JSON.stringify({ generated_by: 'native/tools/golden/record_pure.mjs', cases }, null, 1) + '\n');
console.log(`recorded ${cases.length} cases → ${process.argv[2]}`);
