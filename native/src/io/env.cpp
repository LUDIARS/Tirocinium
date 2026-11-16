#include "io/env.hpp"

#include <cstdlib>
#include <memory>

namespace tr::io {

std::optional<std::string> read_env(const std::string& name) {
#ifdef _WIN32
    char* raw = nullptr;
    std::size_t len = 0;
    if (_dupenv_s(&raw, &len, name.c_str()) != 0) return std::nullopt;
    const std::unique_ptr<char, decltype(&std::free)> value(raw, &std::free);
    if (!value) return std::nullopt;
    return std::string(value.get());
#else
    const char* value = std::getenv(name.c_str());
    if (value == nullptr) return std::nullopt;
    return std::string(value);
#endif
}

}  // namespace tr::io
