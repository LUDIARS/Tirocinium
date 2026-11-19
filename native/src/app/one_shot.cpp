#include "app/one_shot.hpp"

#include <lapilli/one_shot.hpp>

namespace tr::app {

OneShotLaunch prepare_one_shot(std::string file, std::vector<std::string> args, const EnvList& base_env) {
    auto launch = lapilli::one_shot::prepare(std::move(file), std::move(args),
        {.policy = lapilli::one_shot::Policy::allow_node_entry, .env = base_env, .lookup = std::nullopt});
    return {std::move(launch.file), std::move(launch.args), std::move(launch.env)};
}

}  // namespace tr::app
