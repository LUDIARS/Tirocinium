#include "core/rate_limit.hpp"

#include <algorithm>
#include <cmath>

namespace tr {

void FixedWindowLimiter::sweep(EpochMs now) {
    for (auto it = store_.begin(); it != store_.end();) {
        if (it->second.reset_at <= now) it = store_.erase(it);
        else ++it;
    }
    last_sweep_ = now;
}

FixedWindowLimiter::Decision FixedWindowLimiter::hit(const std::string& key, EpochMs now) {
    std::lock_guard lock(mu_);
    if (now - last_sweep_ >= std::max(window_ms_, 1000)) sweep(now);
    auto it = store_.find(key);
    if (it == store_.end() || it->second.reset_at <= now) {
        if (it == store_.end() && store_.size() >= max_keys_) {
            sweep(now);
            if (store_.size() >= max_keys_) return Decision{false, std::max(1, window_ms_ / 1000)};
        }
        store_[key] = Bucket{0, now + window_ms_};
        it = store_.find(key);
    }
    it->second.count += 1;
    if (it->second.count > max_) {
        const int retry = std::max(1, static_cast<int>(std::ceil(static_cast<double>(it->second.reset_at - now) / 1000.0)));
        return Decision{false, retry};
    }
    return Decision{true, 0};
}

std::size_t FixedWindowLimiter::size() const {
    std::lock_guard lock(mu_);
    return store_.size();
}

}  // namespace tr
