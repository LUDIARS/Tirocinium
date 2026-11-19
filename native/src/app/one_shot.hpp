#pragma once
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

OneShotLaunch prepare_one_shot(std::string file, std::vector<std::string> args, const EnvList& base_env);

}  // namespace tr::app
