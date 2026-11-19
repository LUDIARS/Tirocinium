export default {
  post: (launch: { file: string; args: string[] }, env: NodeJS.ProcessEnv): true | string => {
    const model = launch.args.indexOf('--model');
    const toolsDisabled = ['shell_tool', 'unified_exec'].every(tool =>
      launch.args.some((arg, index) => arg === '--disable' && launch.args[index + 1] === tool),
    );
    return (
      launch.file === 'codex'
      && launch.args[0] === 'exec'
      && model > 0
      && launch.args[model + 1] === (env['OPENAI_MODEL_REFINE'] || 'luna')
      && toolsDisabled
      && launch.args.includes('--json')
      && launch.args.at(-1) === '-'
    ) || 'REFINE must use the requested Codex model in tool-free JSON stdin mode';
  },
};
