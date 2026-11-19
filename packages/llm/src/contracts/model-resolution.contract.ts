import { MODEL_ROLES, readRoleMap } from '@ludiars/one-shot';

export default {
  post: (model: string, selection: string, provider: 'claude' | 'codex', env = process.env): true | string => {
    const roles: readonly string[] = MODEL_ROLES[provider];
    if (!roles.includes(selection)) return model === selection || 'explicit model changed';
    const expected = env[`LUDIARS_ONESHOT_MODEL_${selection.toUpperCase()}`] || readRoleMap(env)?.[provider]?.[selection];
    return (Boolean(expected) && model === expected) || 'request did not use the configured model ID';
  },
};
