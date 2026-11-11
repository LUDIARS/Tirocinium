// ws/session-runtime-helpers.test.ts と ws/call-tickets.test.ts の移植 (DB 不要)。
#include "check.hpp"
#include "app/session_runtime.hpp"
#include "app/session_state.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

std::optional<app::PhaseProgress> progress(const Json& v) { return app::as_phase_progress(&v); }

TEST_CASE("asPhaseProgress: a valid snapshot is restored as is") {
    const auto p = progress(Json{{"phase", "pressure"}, {"phaseTurnNo", 2}, {"turnBudget", 7}, {"planCursor", Json{{"opening", 1}, {"probe", 6}}}});
    check(p.has_value(), "restored");
    check(p->phase == llm::Phase::Pressure && p->phase_turn_no == 2 && p->turn_budget == 7, "fields");
    check(p->plan_cursor == std::map<std::string, int>{{"opening", 1}, {"probe", 6}}, "cursor");
}

TEST_CASE("asPhaseProgress: null/undefined/broken values degrade to nullopt without throwing") {
    check(!app::as_phase_progress(nullptr), "undefined");
    check(!progress(Json(nullptr)), "null");
    check(!progress(Json::object()), "{}");
    check(!progress(Json{{"phase", "probe"}}), "missing fields");
    check(!progress(Json{{"phase", 1}, {"phaseTurnNo", 1}, {"turnBudget", 1}}), "phase type");
    check(!progress(Json("probe")), "string");
    check(!progress(Json::array({"probe"})), "array");
}

TEST_CASE("asPhaseProgress: only numeric planCursor entries are kept; missing cursor is empty") {
    const auto p = progress(Json{{"phase", "probe"}, {"phaseTurnNo", 1}, {"turnBudget", 10},
                                 {"planCursor", Json{{"opening", 1}, {"probe", "bogus"}, {"pressure", 2}}}});
    check(p && p->plan_cursor == std::map<std::string, int>{{"opening", 1}, {"pressure", 2}}, "filtered");
    const auto q = progress(Json{{"phase", "opening"}, {"phaseTurnNo", 0}, {"turnBudget", 20}});
    check(q && q->plan_cursor.empty(), "empty cursor");
}

TEST_CASE("resolveSessionSeed: 0 and numbers are kept, missing/broken values are re-seeded, numeric strings accepted") {
    const Json zero(0), n42(42), str("123"), bad("not-a-number"), null(nullptr);
    auto z = app::resolve_session_seed(&zero);
    check(z.seed == 0 && !z.is_new, "0 is valid");
    auto f = app::resolve_session_seed(&n42);
    check(f.seed == 42 && !f.is_new, "number");
    check(app::resolve_session_seed(&null).is_new, "null");
    check(app::resolve_session_seed(nullptr).is_new, "undefined");
    check(app::resolve_session_seed(&bad).is_new, "broken");
    auto s = app::resolve_session_seed(&str);
    check(s.seed == 123 && !s.is_new, "numeric string");
}

TEST_CASE("call tickets: bound to owner and consumed once; other session burns it; reissue revokes; TTL; capacity") {
    app::CallTickets t;
    const EpochMs now = 1'000'000;
    const auto a = t.issue("owned-session", "owner", now);
    check(t.consume(a, "owned-session", now) == std::optional<std::string>("owner"), "owner");
    check(!t.consume(a, "owned-session", now), "once");
    const auto b = t.issue("session-a", "owner", now);
    check(!t.consume(b, "session-b", now), "other session");
    check(!t.consume(b, "session-a", now), "burned");
    const auto old = t.issue("reissued", "owner", now);
    const auto cur = t.issue("reissued", "owner", now);
    check(!t.consume(old, "reissued", now), "old revoked");
    check(t.consume(cur, "reissued", now) == std::optional<std::string>("owner"), "current");
    const auto late = t.issue("ttl", "owner", now);
    check(!t.consume(late, "ttl", now + app::CallTickets::kTtlMs + 1), "expired");
    check_eq(a.size() >= 43, true, "at least 32 random bytes");
    app::CallTickets full;
    for (std::size_t i = 0; i < app::CallTickets::kMaxTickets; ++i) full.issue("s" + std::to_string(i), "u", now);
    trtest::check_throws([&] { full.issue("one-more", "u", now); }, "capacity");
}

}  // namespace

TEST_MAIN()
