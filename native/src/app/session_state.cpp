#include "app/session_state.hpp"

#include <stdexcept>

#include "core/encoding.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {

std::string CallTickets::issue(const std::string& session_id, const std::string& user_id, EpochMs now) {
    std::lock_guard lock(mu_);
    for (auto it = tickets_.begin(); it != tickets_.end();) {
        if (it->second.expires_at <= now || it->second.session_id == session_id) it = tickets_.erase(it);
        else ++it;
    }
    if (tickets_.size() >= kMaxTickets) throw std::runtime_error("call_ticket_capacity");
    const std::string ticket = base64url_encode(crypto::random_bytes(32));
    tickets_[ticket] = Ticket{session_id, user_id, now + kTtlMs};
    return ticket;
}

std::optional<std::string> CallTickets::consume(const std::string& ticket, const std::string& session_id, EpochMs now) {
    std::lock_guard lock(mu_);
    auto it = tickets_.find(ticket);
    if (it == tickets_.end()) return std::nullopt;
    Ticket t = it->second;
    tickets_.erase(it);
    if (t.session_id == session_id && t.expires_at > now) return t.user_id;
    return std::nullopt;
}

void MaterialStore::sweep(EpochMs now) {
    for (auto it = entries_.begin(); it != entries_.end();) {
        if (it->second.expires_at <= now) it = entries_.erase(it);
        else ++it;
    }
}

void MaterialStore::put(const std::string& session_id, const std::string& user_id, MaterialDigest value, EpochMs now) {
    std::lock_guard lock(mu_);
    sweep(now);
    entries_.erase(session_id);
    if (entries_.size() >= kMaxEntries) throw std::runtime_error("material_store_capacity");
    entries_[session_id] = Entry{std::move(value), user_id, now + kTtlMs};
}

std::optional<MaterialDigest> MaterialStore::get(const std::string& session_id, const std::string& user_id, EpochMs now) {
    std::lock_guard lock(mu_);
    auto it = entries_.find(session_id);
    if (it == entries_.end()) return std::nullopt;
    if (it->second.expires_at <= now) {
        entries_.erase(it);
        return std::nullopt;
    }
    if (it->second.user_id != user_id) return std::nullopt;
    return it->second.value;
}

bool MaterialStore::has(const std::string& session_id) {
    std::lock_guard lock(mu_);
    return entries_.count(session_id) > 0;
}

void MaterialStore::clear(const std::string& session_id) {
    std::lock_guard lock(mu_);
    entries_.erase(session_id);
}

bool MaterialStore::begin_reading(const std::string& session_id) {
    std::lock_guard lock(mu_);
    return reading_.insert(session_id).second;
}

void MaterialStore::end_reading(const std::string& session_id) {
    std::lock_guard lock(mu_);
    reading_.erase(session_id);
}

bool MaterialStore::is_reading(const std::string& session_id) {
    std::lock_guard lock(mu_);
    return reading_.count(session_id) > 0;
}

}  // namespace tr::app
