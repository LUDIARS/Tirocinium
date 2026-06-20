/*
 * Tirocinium ドメイン / 機能 / 連携サービスの関係グラフ データ。
 * cat: external (LUDIARS 連携) / surface (3 面) / domain (ドメイン) / feature (機能)
 * status: ok | partial | no | spec  (spec↔code レビュー結果)
 */
window.TIROCINIUM_GRAPH = {
  categories: [
    { id: 'surface', label: '面 (Surface)', color: '#d2a8ff' },
    { id: 'domain', label: 'ドメイン', color: '#58a6ff' },
    { id: 'feature', label: '機能', color: '#7ee787' },
    { id: 'external', label: 'LUDIARS 連携', color: '#e3b341' },
  ],
  nodes: [
    // ===== Surfaces =====
    { id: 'srf-main', label: '本体', cat: 'surface', desc: '認証なしの Tr ビュー。企業探索・資料閲覧。Bot A (!tr)。', status: 'ok' },
    { id: 'srf-interview', label: '面接', cat: 'surface', desc: 'Cernere 認証付き Tr ビュー。音声面接の本体。Bot A (!tr)。', status: 'ok' },
    { id: 'srf-backdoor', label: '裏口', cat: 'surface', desc: '卒業生の自己投稿面 (/backdoor)。Discord マジックリンク認証。Bot B (!ob)。', status: 'ok' },

    // ===== External LUDIARS services =====
    { id: 'ext-cernere', label: 'Cernere (Cr)', cat: 'external', desc: 'ユーザ identity / 認証。PASETO V4 トークン検証。', status: 'ok' },
    { id: 'ext-imperativus', label: 'Imperativus (Iv)', cat: 'external', desc: '音声 STT / TTS の窓口。gRPC stt-service を流用。', status: 'partial' },
    { id: 'ext-nuntius', label: 'Nuntius (Nt)', cat: 'external', desc: '予約成立 / 開始 / 求人新着の push 通知。', status: 'partial' },
    { id: 'ext-memoria', label: 'Memoria (Mm)', cat: 'external', desc: 'ES / 面接ログの永続化 + embedding (RAG 検索)。', status: 'partial' },
    { id: 'ext-synergos', label: 'Synergos (Sy)', cat: 'external', desc: 'サーバーモードの WS 経路 (検討中)。', status: 'spec' },
    { id: 'ext-excubitor', label: 'Excubitor', cat: 'external', desc: 'secret-agent。env を使わず memory-only で秘密を hydrate。', status: 'ok' },
    { id: 'ext-canalis', label: 'Canalis', cat: 'external', desc: '@ludiars/canalis。依存ゼロの Notion fetch ソース。', status: 'ok' },
    { id: 'ext-anthropic', label: 'Anthropic', cat: 'external', desc: 'Sonnet (応答) / Opus (評価) / Haiku (judge・受験者)。', status: 'ok' },
    { id: 'ext-openai', label: 'OpenAI', cat: 'external', desc: 'GPT-5.5 で深掘り誘導 (現状 gpt-4o 代替で待機)。', status: 'partial' },
    { id: 'ext-discord', label: 'Discord', cat: 'external', desc: 'Bot A (本体/面接) と Bot B (裏口) を別 token・別 gateway で運用。', status: 'ok' },

    // ===== Domains =====
    { id: 'dom-reservation', label: '予約', cat: 'domain', desc: 'GPU/LLM 枠が埋まると 30 分 slot に予約誘導。slot 確保アルゴリズム + 行ロック。', status: 'ok' },
    { id: 'dom-runtime', label: '面接ランタイム', cat: 'domain', desc: 'WS 駆動の SessionRuntime。turn パイプライン (user→Sonnet→judge→refine→eval)。', status: 'ok' },
    { id: 'dom-llm', label: 'LLM オーケストレータ', cat: 'domain', desc: '役割別モデル割当 (default/opus-only/economy)。5 段重ね system prompt。', status: 'ok' },
    { id: 'dom-inference', label: '推論エンジン', cat: 'domain', desc: 'Interviewer engine + Dialectic engine。phase 機 (opening→probe→pressure→closing)。', status: 'ok' },
    { id: 'dom-persona', label: 'ペルソナ', cat: 'domain', desc: '面接官ペルソナ + 受験者ペルソナ。CRUD + system prompt 変換。', status: 'ok' },
    { id: 'dom-voice', label: '音声', cat: 'domain', desc: 'VAD で発話区切り → Iv STT → TTS。token と TTS の並走。', status: 'partial' },
    { id: 'dom-training', label: '教師データ / RAG', cat: 'domain', desc: 'training_data_refs (参照のみ)。本文・embedding は Memoria 側。', status: 'partial' },
    { id: 'dom-eval', label: '評価・サマリ', cat: 'domain', desc: 'Opus が 6 軸評価 + 終了時サマリ。弱点プロファイルへ EMA 集約。', status: 'ok' },
    { id: 'dom-feedback', label: 'フィードバック', cat: 'domain', desc: 'accept/reject/edit を学習信号化。hint 履歴 + RAG weight 調整。', status: 'partial' },
    { id: 'dom-ftloop', label: 'FT-like loop', cat: 'domain', desc: '受験者×面接官のシミュレーション + Opus critique で教師データ拡張。', status: 'partial' },
    { id: 'dom-companies', label: '企業', cat: 'domain', desc: '公開情報の企業プール。クロール / listing / enrichment / ゲームグラフ / OB。', status: 'partial' },
    { id: 'dom-recommend', label: 'おすすめ企業', cat: 'domain', desc: 'ES + 弱点プロファイル + 志望条件で企業プールを採点 + Sonnet rerank。', status: 'ok' },
    { id: 'dom-analytics', label: 'アナリティクス', cat: 'domain', desc: 'page_view / company_view イベント記録 + 日次サマリ (仕様外の追加実装)。', status: 'ok' },

    // ===== Features (selected) =====
    { id: 'f-slot', label: 'slot 確保', cat: 'feature', desc: '30 分 slot, capacity/used, no-show 5 分解放。', status: 'ok' },
    { id: 'f-gate', label: 'ゲート判定', cat: 'feature', desc: '認証→quota→GPU 空き判定で即時開始 or 予約 offer。', status: 'ok' },
    { id: 'f-phase', label: 'phase 状態機', cat: 'feature', desc: 'opening→probe→pressure→closing→ended の時間box + signals 遷移。', status: 'ok' },
    { id: 'f-dialectic', label: '弁証法プローブ', cat: 'feature', desc: '正-反-合サイクルを Sonnet 応答に内蔵。', status: 'ok' },
    { id: 'f-judge', label: 'judge (非同期)', cat: 'feature', desc: 'Haiku で回答品質判定 → phase signals 供給。', status: 'ok' },
    { id: 'f-refine', label: '深掘り誘導', cat: 'feature', desc: 'GPT で system prompt を裏で補正 (5-10 turn ごと)。', status: 'partial' },
    { id: 'f-eval6', label: '6 軸評価', cat: 'feature', desc: '主張一貫性/論旨/態度/自己理解/志望適合/深掘り耐性。', status: 'ok' },
    { id: 'f-summary', label: '面接サマリ', cat: 'feature', desc: 'headline/highlights/axes/growth/carry_over/interviewer_note。', status: 'ok' },
    { id: 'f-weakness', label: '弱点プロファイル', cat: 'feature', desc: '6 軸 EMA + 最弱 top-3 + hint 履歴。session 開始時に注入。', status: 'ok' },
    { id: 'f-vad', label: 'VAD', cat: 'feature', desc: 'SimpleEnergyVad (暫定)。webrtc-vad へ置換予定。', status: 'partial' },
    { id: 'f-stt', label: 'STT backend', cat: 'feature', desc: 'grpc / api / off を切替。Iv stt-service 直結。', status: 'partial' },
    { id: 'f-tts', label: 'TTS 並走', cat: 'feature', desc: '句読点で切って queue 積み (Iv 結線は TODO)。', status: 'no' },
    { id: 'f-rag', label: 'RAG 注入', cat: 'feature', desc: '志望 tag + 弱点軸で Memoria vector search → system prompt。', status: 'partial' },
    { id: 'f-crawl', label: '企業クロール', cat: 'feature', desc: 'manual / seed-file → fetch → 抽出(Haiku) → 正規化 → upsert。', status: 'ok' },
    { id: 'f-listing', label: 'listing クロール', cat: 'feature', desc: '新卒/ゲーム企業を一覧ページから発見 (robots 遵守)。', status: 'ok' },
    { id: 'f-enrich', label: 'enrichment', cat: 'feature', desc: '企業サイト巡回で IR / 理念 / 会社概要を抽出。', status: 'ok' },
    { id: 'f-gamegraph', label: 'ゲームグラフ', cat: 'feature', desc: 'games / company_game / partner / OB placement の関係探索。', status: 'ok' },
    { id: 'f-gbiz', label: 'gBizINFO 取込', cat: 'feature', desc: '経産省 REST で中小母集団を粗取込 → HP で裏取り。', status: 'partial' },
    { id: 'f-jobnews', label: '求人ニュース', cat: 'feature', desc: 'ゲーム業界サイトを RSS/抽出でクロール → 新着 → Nuntius 通知。', status: 'ok' },
    { id: 'f-iq', label: '面接質問プール', cat: 'feature', desc: '会社別の質問プール (供給: 投稿 + Notion)。', status: 'no' },
    { id: 'f-notion', label: 'Notion 取込', cat: 'feature', desc: 'Canalis で DB row 起点に再帰クロール → 決定論マッピング。', status: 'ok' },
    { id: 'f-backdoor-auth', label: 'マジックリンク認証', cat: 'feature', desc: 'Bot B 発行 link token → session token 交換。', status: 'ok' },
  ],
  links: [
    // surface → domain
    ['srf-interview', 'dom-runtime'], ['srf-interview', 'dom-reservation'], ['srf-interview', 'ext-cernere'],
    ['srf-main', 'dom-companies'], ['srf-main', 'dom-recommend'], ['srf-main', 'dom-analytics'],
    ['srf-backdoor', 'f-backdoor-auth'], ['srf-backdoor', 'ext-discord'],
    ['srf-main', 'ext-discord'], ['srf-interview', 'ext-discord'],

    // reservation
    ['dom-reservation', 'f-slot'], ['dom-reservation', 'f-gate'], ['dom-reservation', 'ext-nuntius'],
    ['f-gate', 'dom-runtime'],

    // runtime
    ['dom-runtime', 'dom-llm'], ['dom-runtime', 'dom-voice'], ['dom-runtime', 'dom-inference'],
    ['dom-runtime', 'dom-persona'], ['dom-runtime', 'dom-eval'], ['dom-runtime', 'dom-training'],

    // llm
    ['dom-llm', 'ext-anthropic'], ['dom-llm', 'ext-openai'],
    ['dom-llm', 'f-refine'], ['f-refine', 'ext-openai'],

    // inference
    ['dom-inference', 'f-phase'], ['dom-inference', 'f-dialectic'], ['dom-inference', 'f-judge'],
    ['f-judge', 'ext-anthropic'], ['f-phase', 'dom-eval'],

    // persona
    ['dom-persona', 'dom-inference'],

    // voice
    ['dom-voice', 'f-vad'], ['dom-voice', 'f-stt'], ['dom-voice', 'f-tts'],
    ['f-stt', 'ext-imperativus'], ['f-tts', 'ext-imperativus'],

    // training / rag
    ['dom-training', 'f-rag'], ['dom-training', 'ext-memoria'], ['f-rag', 'ext-memoria'],
    ['f-rag', 'dom-runtime'],

    // eval / feedback
    ['dom-eval', 'f-eval6'], ['dom-eval', 'f-summary'], ['dom-eval', 'f-weakness'],
    ['ext-anthropic', 'f-eval6'], ['dom-eval', 'dom-feedback'],
    ['dom-feedback', 'f-weakness'], ['dom-feedback', 'dom-training'],
    ['f-weakness', 'dom-runtime'],

    // ft-loop
    ['dom-ftloop', 'dom-persona'], ['dom-ftloop', 'dom-eval'], ['dom-ftloop', 'dom-feedback'],

    // companies
    ['dom-companies', 'f-crawl'], ['dom-companies', 'f-listing'], ['dom-companies', 'f-enrich'],
    ['dom-companies', 'f-gamegraph'], ['dom-companies', 'f-gbiz'], ['dom-companies', 'f-jobnews'],
    ['dom-companies', 'f-iq'], ['dom-companies', 'f-notion'],
    ['f-crawl', 'ext-anthropic'], ['f-enrich', 'ext-anthropic'], ['f-listing', 'ext-anthropic'],
    ['f-jobnews', 'ext-nuntius'], ['f-notion', 'ext-canalis'], ['f-iq', 'ext-canalis'],

    // recommend
    ['dom-recommend', 'dom-companies'], ['dom-recommend', 'f-rag'], ['dom-recommend', 'f-weakness'],
    ['dom-recommend', 'ext-anthropic'],

    // backdoor
    ['f-backdoor-auth', 'ext-discord'],

    // secrets everywhere (anchor a few)
    ['dom-llm', 'ext-excubitor'], ['dom-companies', 'ext-excubitor'], ['ext-discord', 'ext-excubitor'],

    // runtime transport (future)
    ['dom-runtime', 'ext-synergos'],
  ],
};
