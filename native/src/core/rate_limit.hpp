#pragma once
// middleware/rate-limit.ts の固定窓レート制限 (インメモリ・単一プロセス)。
// 期限切れの窓は max(windowMs, 1s) ごとに掃除する。キー数には上限を設け、超えたら新しいキーは拒否する
// (認証済みの利用者 ID がキーなので通常は届かない。メモリを無制限に使わせないための保険)。

#include <cstddef>
#include <mutex>
#include <string>
#include <unordered_map>

#include "core/time.hpp"

namespace tr {

class FixedWindowLimiter {
public:
    FixedWindowLimiter(int window_ms, int max, std::size_t max_keys = 100'000)
        : window_ms_(window_ms), max_(max), max_keys_(max_keys) {}

    struct Decision {
        bool allowed = true;
        int retry_after_sec = 0;
    };

    Decision hit(const std::string& key, EpochMs now);
    [[nodiscard]] std::size_t size() const;

private:
    struct Bucket {
        int count = 0;
        EpochMs reset_at = 0;
    };
    void sweep(EpochMs now);

    int window_ms_;
    int max_;
    std::size_t max_keys_;
    mutable std::mutex mu_;
    std::unordered_map<std::string, Bucket> store_;
    EpochMs last_sweep_ = 0;
};

}  // namespace tr
