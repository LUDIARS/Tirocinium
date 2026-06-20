# persona モジュール

面接官 / 受験者 の 2 種のペルソナを扱う。 DESIGN §3.5 / §3.6 の実装視点。

---

## 責務範囲

| 持つ | 持たない |
|---|---|
| ペルソナのカタログ (seed + user 追加) | 本人 ES / portfolio / 過去 Q&A (Memoria 側) |
| 面接官の話し方パラメータ (pressure / tics) | 個別 LLM の重み |
| 受験者の弱点バイアスの実装 | 弱点プロファイルの本体 (weakness_profiles 表) |

---

## interviewer_personas

DESIGN §3.5 参照。 API:

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/v1/personas/interviewers` | 一覧 (filter: stage / role_lens / temperament) |
| GET    | `/api/v1/personas/interviewers/:id` | 詳細 |
| POST   | `/api/v1/personas/interviewers` | user 追加 (is_seed=false) |
| PATCH  | `/api/v1/personas/interviewers/:id` | user 自作分のみ編集可 |

### system prompt への変換

```ts
function interviewerToPromptBlock(p: InterviewerPersona): string {
  return `
あなたは ${p.display_name} という面接官です。
所属: ${p.bio}
担当面接タイプ: ${stageLabel(p.stage)} ${p.role_lens !== 'any' ? `(${p.role_lens} 志望者向け)` : ''}
性格傾向: ${p.temperament}
圧の強さ: ${p.pressure}/5  (${pressureLabel(p.pressure)})
口癖や癖: ${p.tics.join(', ') || '特になし'}

評価バイアス: ${JSON.stringify(p.evaluation_bias)}
- 各軸の重みに従って、 軸が高めに設定されているものを念入りに探る。
`.trim();
}
```

### pressure の挙動マッピング

| pressure | Sonnet 挙動 | 沈黙 | 深掘り粘り |
|---|---|---|---|
| 1 (穏やか) | 相槌多め / 言い換えで引き出す | 短め | 1 回 |
| 2 | 穏やか + 軽く深掘り | 普通 | 1-2 回 |
| 3 (中立) | 質問は淡白、 反応控えめ | 中 | 2 回 |
| 4 | 「それは本当に?」 系の押し | 長め | 3 回 |
| 5 (厳しい) | 反論を含む、 矛盾を突く | 戦略的に挿入 | 4 回以上 |

---

## examinee_personas (テスト/FT loop 用)

DESIGN §3.6 参照。 API:

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/v1/personas/examinees` | 一覧 |
| GET    | `/api/v1/personas/examinees/:id` | 詳細 |
| POST   | `/api/v1/personas/examinees` | テスト用に追加 (user 単位) |

### Examinee simulator

`packages/llm/src/examinee.ts` で実装。 Haiku を主、 Sonnet を fallback。

```ts
class ExamineeSimulator {
  constructor(opts: { persona: ExamineePersona, llm: AnthropicClient });
  async respond(question: string, history: Turn[]): Promise<string>;
}
```

system prompt の組み立て:

```
あなたは ${persona.display_name} という面接候補者を演じます。
背景: ${persona.background}
志望: ${persona.target_role}
話し方: ${speechStyleLabel(persona.speech_style)}
得意分野: ${persona.strengths.join(', ')}

意図的な弱点 (リアルな就活生再現):
- 弱い軸: ${weaknessAxesLabel(persona.weakness_axes)}
- 顕在化する癖: ${persona.intentional_flaws.join(', ')}

ルール:
- 質問に答える時、 弱い軸では「結論先出しが弱い」 「具体例が薄い」 等の癖を再現
- 強い分野では明瞭に答えてよい (実際の就活生もムラがある)
- ハルシネーション禁止: 経歴・経験は persona.background 範囲内で創作
```

---

## seed の置き場

LUDIARS 提供の seed は `data/general/persona/interviewer/` と
`data/general/persona/examinee/` の Markdown frontmatter で配布。
インストール時 (or migration の seed phase) で DB に流し込む。

---

## ローカルモード

ローカルモードは `interviewer_personas` の seed のみ SQLite に同梱、
`examinee_personas` は持たない (FT loop はサーバーモード専用)。
