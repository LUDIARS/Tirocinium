#pragma once
// @ludiars/one-shot (lib/lapilli 98ed6a2) の起動規則の移植。claude -p / codex exec を 1 回だけ起動する境界。
// - 子の環境から API キー・クラウド選択子・親セッションの束縛を外す (subscriptionEnvironment)。
// - モデルの役割名 (opus/sonnet/haiku/fable/astra/sol/luna) を中央の既定値で解決する
//   (LUDIARS_ONESHOT_MODEL_<ROLE> で上書き可)。
// - シェルは使わない。cmd /c の包みは本物の CLI に読み替え、.cmd/.bat は起動しない。
// - 再試行しない (応答を失っても同じ仕事を 2 回走らせない)。

#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace tr::app {

using EnvList = std::vector<std::pair<std::string, std::string>>;

struct OneShotLaunch {
    std::string file;
    std::vector<std::string> args;
    EnvList env;
};

// 例外: Unsupported CLI shell wrapper / One-shot launch requires claude print mode or codex exec /
// Invalid one-shot model / Claude requires a Claude model / Codex requires a GPT model / Missing model argument。
OneShotLaunch prepare_one_shot(std::string file, std::vector<std::string> args, const EnvList& base_env);

EnvList subscription_environment(const EnvList& source);
std::string resolve_model(const std::optional<std::string>& role_or_id, const std::string& provider, const EnvList& env);
std::vector<std::string> resolve_model_args(std::vector<std::string> args, const std::string& provider, const EnvList& env);

}  // namespace tr::app
