# 面接推論エンジン — 弁証法ベースの reactive 深掘り ＋ フェーズ状態機

Tirocinium の面接 AI が「面接として成立する」ための推論エンジン設計。
Discutere (Di) がヘーゲル弁証法 (正-反-合) を対話の駆動にしたのと同型の構造を、
面接の **1 深掘り単位** に据える。

## 1. 理論基盤

面接の質問技法の確立パターン:

| パターン | 構造 | 本エンジンでの役割 |
|---|---|---|
| ファネル法 | 広い質問 → 徐々に具体 → 確認 | **macro 進行** (phase) |
| ソクラテス的問答法 (elenchus / 産婆術) | 主張 → 反例・矛盾 → 洗練 | **micro 深掘り (弁証法サイクル)** |
| STAR / BEI | Situation→Task→Action→Result | 回答の「具体性スロット」判定基準 |
| 5 Whys | 主張 → なぜ → … | pressure phase の反の一種 |

ヘーゲル弁証法の面接における直系はソクラテス的問答法。これを **正-反-合** の
1 サイクルとしてモデル化する。

## 2. 二層構造

```
Macro: ファネル + phase 状態機 (面接全体の流れ・time-box)
   opening → probe → (pressure) → closing → ended
Micro: 弁証法サイクル 正→反→合 (各深掘り単位の駆動)
```

`stage` (hr / peer-tech / lead-tech / final = 面接の種類) と `phase`
(面接内の進行) は **直交**。stage はペルソナ選定 + RAG query、phase は会話進行。

## 3. Macro — フェーズ状態機

### 3.1 phase 定義

| phase | 意図 | turn 配分 (target 20 の例) | 反(antithesis)の強さ |
|---|---|---|---|
| `opening` | 導入 + 自己紹介を引き出す | 2 | なし (傾聴) |
| `probe` | 主題をファネルで掘る (本体) | 10 | 弱 (未踏スロット中心) |
| `pressure` | 矛盾突き・詰め (深掘り耐性を試す) | 4 | 強 (矛盾・反例) |
| `closing` | 合の確認 + 逆質問促し + 締め | 2 | なし |

- `pressure` はペルソナ `pressure >= 4` のときのみ有効。低ければ probe に吸収
  (turn 配分も probe に加算)。
- 各 phase は `{ intent, minTurns, maxTurns, antithesisStrength }` を持つ。

### 3.2 遷移 — 純関数 `nextPhase(state, signals)`

```
state   = { phase, phaseTurnNo, turnBudget, personaPressure }
signals = { synthesisReached: boolean, contradictionOpen: boolean }
```

遷移規則 (上から評価):
1. 現 phase が `maxTurns` 到達 → 次 phase へ
2. `probe` で `phaseTurnNo >= minTurns` かつ `synthesisReached` (主題が十分掘れた)
   → `pressure` (有効なら) / 無ければ `closing`
3. `turnBudget` 残 <= closing 必要分 → 強制 `closing`
4. それ以外は現 phase 継続

→ 純関数なので遷移表を単体テストできる。session-runtime は phase を状態として
持ち、interviewer turn 確定ごとに `nextPhase` を呼ぶ。

### 3.3 system prompt への反映

`buildSystemPrompt` に `phase` を渡し、①静的 root に phase ガイダンスを差し込む:

- opening: 「まず自己紹介を促し、傾聴する。深掘りはまだしない」
- probe: 「弁証法サイクル(§4)で1テーマずつ掘る。未踏スロットを優先」
- pressure: 「反を強める。矛盾・反例を1つ正面からぶつける。人格否定はしない」
- closing: 「合を確認し、逆質問を促し、120秒で締める」

## 4. Micro — 弁証法サイクル (reactive 深掘りの中核)

固定周期 (旧: GPT 10turn / Opus 5turn) をやめ、**各 user turn に反応**する。
実装方式は **(b) Sonnet 応答内蔵 + (c) 非同期補正** のハイブリッド (レイテンシ非増)。

### 4.1 (b) Sonnet 応答に内蔵する弁証法プロンプト

毎 user turn、Sonnet が 1 コールで内部的に以下を行い、**出力は次の発話(質問)のみ**:

```
正 (thesis):     直前回答から候補者の主張/自己評価を1つ抽出
反 (antithesis): phase の antithesisStrength に応じて一手だけ当てる
   - 矛盾      : 過去発言 / ES と food わない点
   - 反例/別視点: 「逆に〜なケースでは?」
   - 未踏スロット: STAR の欠け (具体例 / 数値 / あなたの担当範囲)
合 (synthesis):  候補者の統合回答を待つ。次turnで合の質を見て:
   - 深まった  → 次テーマへ (funnel を一段狭める)
   - 浅い      → 同テーマで反を一段強める
```

レイテンシ追加ゼロ (応答生成と同一コール)。`pressure` phase では反=矛盾突きを優先。

### 4.2 (c) 非同期 judge (synthesis 信号の供給) — 実装済み

各 user turn の回答を軽量モデル (Haiku) で 1 コール評価し (`packages/llm/src/judge.ts`
`assessAnswer`)、phase 状態機の signals を供給する:

```
{ specificity: 0-3, synthesis_reached: bool, contradiction_open: bool, followup_hint: string }
```

- judge は**面接官応答を送信した後**に走らせるため知覚レイテンシは増えない。
- `synthesis_reached` / `contradiction_open` が `nextPhase` の signals になり、probe→次phase や
  pressure→closing の**早期遷移**を駆動する (time-box 待ちでなく内容で進む)。
- `followup_hint` は「次に深掘るべき論点」⑤ ブロックに反映し、reactive 深掘りを補強。
- 鍵 (`ANTHROPIC_API_KEY`) が無い dev では skip → `DEFAULT_SIGNALS` の time-box 駆動に退化。

加えて GPT refine は **phase 遷移時にトリガ駆動** (旧: 10turn 固定)。

### 4.3 評価との関係

Opus 評価 (5turn) は維持。ただし評価軸「主張一貫性」「深掘り耐性」「自己理解」は
**合(synthesis) がどれだけ起きたか**の測定であり、弁証法サイクルと意味的に一致する。
`closing` 到達でサマリへ。

## 5. 実装単位 (本 PR)

| ファイル | 内容 |
|---|---|
| `packages/llm/src/phase.ts` | phase 定義 + `nextPhase` 純関数 + `initialPhaseState` |
| `packages/llm/src/judge.ts` | `assessAnswer` (Haiku judge) → phase signals (§4.2、後続 PR で追加) |
| `packages/llm/src/prompts.ts` | phase ガイダンス + 弁証法サイクル指示 (DIALECTIC_PROBE) |
| `packages/llm/src/response.ts` | `buildSystemPrompt` に phase 引数 |
| `apps/server/src/ws/session-runtime.ts` | phase 状態保持 + interviewer turn ごとに遷移、refine をトリガ駆動 |
| `packages/llm/src/phase.test.ts` | 遷移表テスト |

## 6. Di との関係

Di (Discatier の3軸対話) と Tr は「弁証法的問答」という共通理論基盤を持つ。
コード結合はしないが、`prompts.ts` に `DIALECTIC_PROBE` として名前付き概念を明示し、
将来パターンを共有参照にできる余地を残す。

## 7. 非目標 (本エンジン外)

- モデル構成見直し (論点 A) / 評価堅牢化 (D) / 本人特化 ingest (E)
- 自動 VAD バージイン
