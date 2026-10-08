// 専門面接の出題・講評方針。spec/feature/inference/specialist-interviews.md
import { SPECIALIST_INTERVIEWERS, SPECIALIST_ROLES, type SpecialistProfile } from './specialist-profile.js';

function scope(profile: SpecialistProfile): string {
  const role = SPECIALIST_ROLES[profile.role];
  return `対象職種: ${role.label}\n経験: ${profile.level === 'entry' ? '学生・未経験。学習や自主制作の経験を使い、実務経験を必須にしない' : '実務経験者。担当範囲、制約、代替案、成果を深掘りする'}\n面接官: ${SPECIALIST_INTERVIEWERS[profile.interviewer].label}\n出題領域: ${role.topics}\n専門観点: ${role.criteria}`;
}

/** 逆質問への答え方。模擬面接なので、知らない社内事情も面接官として自然に即答する。 */
export const REVERSE_QUESTION_RULE = `逆質問には、この会社で働く面接官として具体的に答える。
開発体制・チーム規模・使っている技術・新人研修・評価やキャリアの道筋など、手元の資料に無いことも、
「わからない」「お答えできない」で済ませず、ゲーム会社の現場としてもっともらしい内容をその場で答える。
同じ面接の中で前に答えた内容と矛盾させない。答えた後に、質問の意図を一言返すか、次の逆質問を促す。
合否・内定・待遇の確約や、実在の人物・未公開タイトルの具体名は出さない。`;

export function specialistQuestionPrompt(profile?: SpecialistProfile): string {
  if (!profile) return '';
  return `## 専門面接\n${scope(profile)}
最初に専門分野と制作・学習経験を一問で確認し、回答から扱う領域を選ぶ。全領域の経験を必須にしない。
既存の進行フェーズに従い、基礎の理解→具体的な設計・制作課題→不具合や品質問題の切り分け→検証と代替案を順に扱う。
質問スロットや参考資料もこの職種・経験に適合させる。一度に一問。回答を受けて理由・制約・検証方法のいずれかを深掘りする。
答えを先に教えず、詰まった場合はヒントを一つ示し、ヒント後の回答と自力の回答を区別する。
コード実行・作品閲覧・音声試聴をしていない場合、それらを検証済みと述べない。機密のソースや未公開作品の提出を求めない。
終結では根拠のある強みと次の練習を伝える。採用可否は断定しない。
${REVERSE_QUESTION_RULE}`;
}

export function specialistEvaluationPrompt(profile?: SpecialistProfile, summary = false): string {
  if (!profile) return '';
  return `\n## 専門分野の講評\n${scope(profile)}
共通6軸の定義とJSON形式は維持する。専門能力を独立した数値として捏造したり、6軸を専門点数に置き換えたりしない。
${summary ? 'interviewer_note に「専門講評」として' : 'comment に「専門講評」として'}、専門観点ごとの確認できた点・改善点・未確認事項を記す。根拠には実際の回答のturn番号を添える。
未出題・未回答の専門観点は未確認とし、不正解や能力不足と断定しない。ヒント利用も明記する。
${summary ? 'growth_points と carry_over' : 'hints'} に、根拠のある改善点と次に取り組む具体的な練習を示す。
実行していないコードや見ていない作品を検証済みと扱わず、採用可否を判定しない。`;
}
