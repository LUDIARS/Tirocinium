export * from './types.js';
export { htmlToText, extractTitle, extractMetaDescription, decodeEntities } from './html.js';
export {
  normalizeName,
  normalizeRoles,
  normalizeCompany,
  dedupeCompanies,
} from './normalize.js';
export {
  EXTRACT_INSTRUCTION,
  parseCompanyExtraction,
  extractCompany,
  heuristicExtract,
} from './extract.js';
export {
  manualSource,
  seedFileSource,
  getSource,
  listSourceIds,
  dedupeSeeds,
} from './sources.js';
export {
  tokenize,
  profileKeywords,
  scoreCompany,
  rankCandidates,
  type ScoreBreakdown,
} from './score.js';
export {
  RECOMMEND_INSTRUCTION,
  renderCandidates,
  renderProfile,
  parseRecommendation,
  recommendHeuristic,
  recommend,
  type RecommendOptions,
} from './recommend.js';
