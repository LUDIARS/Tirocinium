# @tirocinium/training

Memoria 側の RAG / embedding API を叩く client。 仕様確定前の skeleton。

## 想定 API (Memoria 側に追加してもらう or 既存利用)

```
POST /api/v1/tirocinium/training/upsert
  body: { user_id, kind, body, tags? }
  resp: TrainingDocRef

POST /api/v1/tirocinium/rag/search
  body: { user_id, query, filter?, topK? }
  resp: RagResult
```

## 環境変数

- `MEMORIA_URL` — `http://localhost:3300` 等
- `MEMORIA_PROJECT_TOKEN` — Cernere `project-token` (per-user × per-project)

`MEMORIA_URL` 未設定なら `createMemoriaClient()` は null を返し、
apps/server 側は **一般解 QA seed のみ** で session を回す fallback に倒れる。

## 利用ポイント

- training_data_refs の永続化時に `MemoriaClient.upsertTrainingDoc()`
- session 開始時に `rag()` で本人素材 + 一般解 (Memoria 側にも入れておけば一括検索可)
- 結果を `renderRagBlock()` で system prompt の (3) スロット用に整形

## 次フェーズ

- Memoria 側 API 仕様確定 (LUDIARS/Memoria リポと擦り合わせ)
- 一般解 QA seed を Memoria に流し込む batch script
- apps/server の session 開始時の RAG fetch を wire-up
- training_data_refs CRUD route を apps/server に追加
