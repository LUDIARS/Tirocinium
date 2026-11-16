#include "app/version.hpp"

#include "io/env.hpp"

namespace tr::app {

EnvLookup process_env() {
    return [](const std::string& key) { return io::read_env(key); };
}

std::string service_version(const EnvLookup& env) {
    // JS の ?? と同じく「未設定」だけを飛ばす (空文字はそのまま採用する)。
    for (const char* key : {"EXCUBITOR_SERVICE_VERSION", "TIROCINIUM_SERVICE_VERSION", "npm_package_version"}) {
        if (auto v = env(key)) return *v;
    }
    return "unknown";
}

}  // namespace tr::app
