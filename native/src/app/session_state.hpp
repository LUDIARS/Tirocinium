#pragma once
// プロセスのメモリだけに持つセッション付随の状態 (DB・ファイルへは書かない)。
// - CallTickets  : ws/call-tickets.ts (1 回限り・30 秒・最大 256 件、同じセッションの旧 ticket は無効化)
// - MaterialStore: materials/material-store.ts (提出資料の要点。TTL 45 分・最大 64 件・持ち主にだけ返す)
// - MaterialReading: 同じセッションへの同時提出の排他 (submit-material.ts の reading)

#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <string>

#include "core/time.hpp"

namespace tr::app {

class CallTickets {
public:
    static constexpr EpochMs kTtlMs = 30'000;
    static constexpr std::size_t kMaxTickets = 256;
    // 発行 (上限に達していれば例外 call_ticket_capacity)。
    std::string issue(const std::string& session_id, const std::string& user_id, EpochMs now);
    // 1 回だけ使える。別セッション・期限切れは null (使った ticket はどちらでも消える)。
    std::optional<std::string> consume(const std::string& ticket, const std::string& session_id, EpochMs now);

private:
    struct Ticket {
        std::string session_id;
        std::string user_id;
        EpochMs expires_at;
    };
    std::mutex mu_;
    std::map<std::string, Ticket> tickets_;
};

struct MaterialDigest {
    std::string kind;
    std::string digest;
    std::string interviewer_skill;
};

class MaterialStore {
public:
    static constexpr EpochMs kTtlMs = 45 * 60'000;
    static constexpr std::size_t kMaxEntries = 64;
    void put(const std::string& session_id, const std::string& user_id, MaterialDigest value, EpochMs now);
    std::optional<MaterialDigest> get(const std::string& session_id, const std::string& user_id, EpochMs now);
    bool has(const std::string& session_id);
    void clear(const std::string& session_id);
    // 読解中の印 (同時提出の排他)。既に読解中なら false。
    bool begin_reading(const std::string& session_id);
    void end_reading(const std::string& session_id);
    bool is_reading(const std::string& session_id);

private:
    struct Entry {
        MaterialDigest value;
        std::string user_id;
        EpochMs expires_at;
    };
    void sweep(EpochMs now);
    std::mutex mu_;
    std::map<std::string, Entry> entries_;
    std::set<std::string> reading_;
};

}  // namespace tr::app
