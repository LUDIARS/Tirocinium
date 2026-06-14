import { sql } from '../db/index.js';
import type { TrainingDocKind, TrainingDocRef } from '@tirocinium/training';

// 遅延評価: sql は initSql() 後にしか呼べない (module-load 時点では未初期化)。
const selectCols = () => sql`id, user_id, kind, memoria_uri, embedding_id, tags`;

export async function listRefs(userId: string): Promise<TrainingDocRef[]> {
  return sql<TrainingDocRef[]>`
    SELECT ${selectCols()} FROM training_data_refs
    WHERE user_id = ${userId}
    ORDER BY added_at DESC
  `;
}

export type CreateRefInput = {
  userId: string;
  kind: TrainingDocKind;
  memoriaUri: string;
  embeddingId: string;
  tags: string[];
};

export async function createRef(input: CreateRefInput): Promise<TrainingDocRef> {
  const rows = await sql<TrainingDocRef[]>`
    INSERT INTO training_data_refs (user_id, kind, memoria_uri, embedding_id, tags)
    VALUES (${input.userId}, ${input.kind}, ${input.memoriaUri}, ${input.embeddingId}, ${input.tags})
    RETURNING ${selectCols()}
  `;
  return rows[0]!;
}

export async function deleteRef(userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM training_data_refs
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}
