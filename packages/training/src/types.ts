export type TrainingDocKind = 'es' | 'portfolio' | 'past_qa' | 'self_intro';

export type TrainingDocInput = {
  user_id: string;
  kind: TrainingDocKind;
  body: string;        // 本文 (Memoria 側で永続化される本体)
  tags?: string[];
};

export type TrainingDocRef = {
  /** Tirocinium 側 training_data_refs の id (UUID) */
  id: string;
  user_id: string;
  kind: TrainingDocKind;
  memoria_uri: string;
  embedding_id: string;
  tags: string[];
};

export type RagQuery = {
  user_id: string;
  query: string;
  /** filter (任意): kind / tags / 志望企業 等 */
  filter?: {
    kinds?: TrainingDocKind[];
    tags?: string[];
  };
  topK?: number;
};

export type RagResultItem = {
  embedding_id: string;
  memoria_uri: string;
  kind: TrainingDocKind;
  tags: string[];
  excerpt: string;
  score: number;
};

export type RagResult = {
  items: RagResultItem[];
};
