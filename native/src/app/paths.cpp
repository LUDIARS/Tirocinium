#include "app/paths.hpp"

namespace tr::app {

std::filesystem::path repo_root(const EnvLookup& env) {
    if (auto v = env("TIROCINIUM_ROOT"); v && !v->empty()) return std::filesystem::path(*v);
    return std::filesystem::current_path();
}

}  // namespace tr::app
