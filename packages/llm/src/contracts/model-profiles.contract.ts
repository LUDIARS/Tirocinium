export default {
  post: (models: Record<string, string>, env = process.env): true | string => {
    const profile = env['TIROCINIUM_MODEL_PROFILE']?.toLowerCase();
    const evaluator = env['TIROCINIUM_MODEL_EVALUATOR'] || (profile === 'economy' ? 'sonnet' : 'opus');
    const judge = env['TIROCINIUM_MODEL_JUDGE'] || (profile === 'opus-only' ? 'opus' : 'haiku');
    return models['EVALUATOR'] === evaluator && models['JUDGE'] === judge
      ? true
      : 'profile or override precedence did not match';
  },
};
