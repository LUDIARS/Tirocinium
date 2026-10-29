#include "app/version.hpp"

#include <cstdlib>

namespace tr::app {

EnvLookup process_env() {
    return [](const std::string& key) -> std::optional<std::string> {
#ifdef _WIN32
        char* value = nullptr;
        std::size_t len = 0;
        if (_dupenv_s(&value, &len, key.c_str()) != 0 || value == nullptr) return std::nullopt;
        std::string out(value);
        std::free(value);
        return out;
#else
        const char* value = std::getenv(key.c_str());
        if (value == nullptr) return std::nullopt;
        return std::string(value);
#endif
    };
}

std::string service_version(const EnvLookup& env) {
    // JS の ?? と同じく「未設定」だけを飛ばす (空文字はそのまま採用する)。
    for (const char* key : {"EXCUBITOR_SERVICE_VERSION", "TIROCINIUM_SERVICE_VERSION", "npm_package_version"}) {
        if (auto v = env(key)) return *v;
    }
    return "unknown";
}

}  // namespace tr::app
