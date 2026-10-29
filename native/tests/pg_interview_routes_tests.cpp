// routes/{reservations,sessions,summary,personas,feedback,ft_runs,training}.ts の結合テスト (一時 Postgres)。
#include "check.hpp"
#include "support/app_fixture.hpp"
#include "app/routes/interview_routes.hpp"
#include "core/domain/domain.hpp"
#include "core/text.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
using trtest::kUserA;
using trtest::kUserB;

namespace {

trtest::AppFixture& fixture() {
    static trtest::AppFixture f;
    static bool registered = false;
    if (!registered) {
        app::register_interview_routes(f.router, *f.services);
        registered = true;
    }
    return f;
}

}  // namespace

TEST_CASE("auth prefix: 401 without bearer, even for unknown sub-paths (hono use('*') order)") {
    auto& f = fixture();
    check_eq(f.call("GET", "/api/v1/reservations/me").status, 401, "me");
    check_eq(f.call("GET", "/api/v1/sessions/x/y/z").status, 401, "unknown sub path under the prefix");
    check_eq(f.call("GET", "/api/v1/sessions/x/y/z", f.token_for(kUserA)).status, 404, "authed unknown path → 404");
}

TEST_CASE("sessions: start, owner check, invalid ids, validation, specialist metadata") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const auto tb = f.token_for(kUserB);
    check_eq(f.call("POST", "/api/v1/sessions", ta, "[]").status, 400, "array body");
    check_eq(f.call("POST", "/api/v1/sessions", ta, R"({"interviewer_id":null})").status, 400, "null is not a string");
    check_eq(trtest::AppFixture::body_of(f.call("POST", "/api/v1/sessions", ta, R"({"specialist_interview":{"role":"x","level":"entry"}})"))["error"],
             Json("invalid_specialist_interview"), "bad specialist");
    check_eq(trtest::AppFixture::body_of(f.call("POST", "/api/v1/sessions", ta,
                                                R"({"specialist_interview":{"role":"programmer","level":"entry"},"target_role":"planner"})"))["error"],
             Json("specialist_role_or_interviewer_conflict"), "role conflict");
    auto res = f.call("POST", "/api/v1/sessions", ta,
                      R"({"specialist_interview":{"role":"programmer","level":"entry"},"target_role":"programmer","target_company":"テスト社"})");
    check_eq(res.status, 200, "start");
    const Json body = trtest::AppFixture::body_of(res);
    const std::string sid = body["session_id"];
    check_eq(body["ws_url"].get<std::string>(), "/api/v1/ws/session/" + sid, "ws url");
    auto meta = f.pool->query("SELECT metadata, target_company, target_role FROM sessions WHERE id = $1", {sid});
    check(meta[0]["metadata"]["specialist_interview"]["interviewer"] == "field", "specialist stored with default interviewer");
    check(meta[0]["metadata"].contains("session_seed"), "seed kept by the patch");
    check(meta[0]["target_company"] == "テスト社", "target company");
    auto get = f.call("GET", "/api/v1/sessions/" + sid, ta);
    check_eq(get.status, 200, "owner get");
    check(trtest::AppFixture::body_of(get)["session"]["started_at"].get<std::string>().back() == 'Z', "ISO timestamp");
    check_eq(f.call("GET", "/api/v1/sessions/" + sid, tb).status, 403, "other user forbidden");
    check_eq(f.call("GET", "/api/v1/sessions/not-a-uuid", ta).status, 404, "non-uuid id is not found (not a 500)");
}

TEST_CASE("sessions: call ticket (no-store), end once, materials boundaries") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const std::string sid = trtest::AppFixture::body_of(f.call("POST", "/api/v1/sessions", ta, "{}"))["session_id"];
    auto t = f.call("POST", "/api/v1/sessions/" + sid + "/call-ticket", ta);
    check_eq(t.status, 200, "ticket");
    check_eq(*t.headers.get("cache-control"), std::string("private, no-store"), "no-store");
    const std::string ticket = trtest::AppFixture::body_of(t)["ticket"];
    check(f.tickets.consume(ticket, sid, now_ms()) == std::optional<std::string>(kUserA), "consumable once");
    check(!f.tickets.consume(ticket, sid, now_ms()).has_value(), "second use fails");
    check_eq(f.call("POST", "/api/v1/sessions/" + sid + "/call-ticket", f.token_for(kUserB)).status, 404, "not owner");
    check_eq(trtest::AppFixture::body_of(f.call("POST", "/api/v1/sessions/" + sid + "/materials", ta, "{oops"))["error"],
             Json("invalid_material_request"), "broken json");
    check_eq(f.call("POST", "/api/v1/sessions/" + sid + "/materials", ta,
                    R"({"kind":"es","mime":"application/zip","data_base64":"AA=="})").status,
             415, "unsupported type");
    http::Request big;
    big.method = "POST";
    big.target = "/api/v1/sessions/" + sid + "/materials";
    http::split_target(big.target, big.path, big.raw_query);
    big.headers.set("authorization", "Bearer " + ta);
    big.body_too_large = true;
    auto r413 = app::handle_request(f.router, big, nullptr);
    check(r413.status == 413 && r413.body == R"({"error":"material_too_large"})", "7 MiB limit → material_too_large");
    check_eq(f.call("POST", "/api/v1/sessions/" + sid + "/end", ta).status, 200, "end");
    check_eq(f.call("POST", "/api/v1/sessions/" + sid + "/end", ta).status, 404, "end twice");
}

TEST_CASE("sessions: per-user rate limit returns 429 with Retry-After") {
    trtest::AppFixture& f = fixture();
    const std::string user = "33333333-3333-4333-8333-333333333333";
    const auto tok = f.token_for(user);
    int last = 0;
    std::optional<std::string> retry;
    for (int i = 0; i < 11; ++i) {
        auto r = f.call("POST", "/api/v1/sessions", tok, "[]");
        last = r.status;
        retry = r.headers.get("retry-after");
    }
    check_eq(last, 429, "11th request limited (max 10 / 60s)");
    check(retry.has_value(), "Retry-After");
}

TEST_CASE("summary: 404 before generation, 503 when LLM roles are disabled, 404/403 owner checks") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const std::string sid = f.pool->query("SELECT id FROM sessions WHERE user_id = $1 LIMIT 1", {kUserA})[0]["id"];
    check_eq(trtest::AppFixture::body_of(f.call("GET", "/api/v1/sessions/" + sid + "/summary", ta))["error"],
             Json("summary_not_yet_generated"), "not yet");
    check_eq(trtest::AppFixture::body_of(f.call("POST", "/api/v1/sessions/" + sid + "/summary", ta))["error"],
             Json("llm_not_configured"), "no LLM");
    check_eq(trtest::AppFixture::body_of(f.call("GET", "/api/v1/sessions/" + sid + "/summary", f.token_for(kUserB)))["error"],
             Json("forbidden"), "other user");
    check_eq(trtest::AppFixture::body_of(f.call("GET", "/api/v1/sessions/00000000-0000-4000-8000-000000000000/summary", ta))["error"],
             Json("session_not_found"), "missing");
}

TEST_CASE("reservations: reserve, list, cancel, cannot cancel twice, invalid slot") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const std::string slot = iso_from_ms(domain::current_slot_start(now_ms() + 3 * 3600 * 1000, 30));
    auto res = f.call("POST", "/api/v1/reservations", ta, R"({"slot_start":")" + slot + R"("})");
    check_eq(res.status, 200, "reserve");
    const std::string rid = trtest::AppFixture::body_of(res)["id"];
    auto me = trtest::AppFixture::body_of(f.call("GET", "/api/v1/reservations/me", ta));
    check(me["reservations"].size() >= 1 && me["reservations"][0]["status"] == "held", "listed");
    auto slots = trtest::AppFixture::body_of(f.call("GET", "/api/v1/reservations/slots?hours=48", ta));
    check(slots["slots"].is_array(), "slots");
    check_eq(f.call("DELETE", "/api/v1/reservations/" + rid, ta).status, 200, "cancel");
    check_eq(trtest::AppFixture::body_of(f.call("DELETE", "/api/v1/reservations/" + rid, ta))["error"], Json("cannot_cancel"), "twice");
    check_eq(f.call("POST", "/api/v1/reservations", ta, "{}").status, 400, "slot_start required");
    check_eq(trtest::AppFixture::body_of(f.call("POST", "/api/v1/reservations", ta, R"({"slot_start":"nope"})"))["detail"],
             Json("Invalid time value"), "invalid date");
    check_eq(f.call("GET", "/api/v1/reservations/slots?from=nope", ta).status, 500, "invalid from → 500 like Node");
}

TEST_CASE("personas: create 201, duplicate 409, missing 400, filter list, 404") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const std::string body =
        R"({"id":"t-1","display_name":"テスト面接官","stage":"hr","temperament":"穏やか","pressure":2,"bio":"架空","tics":["ええと"]})";
    auto c = f.call("POST", "/api/v1/personas/interviewers", ta, body);
    check_eq(c.status, 201, "created");
    check(trtest::AppFixture::body_of(c)["persona"]["role_lens"] == "any", "default role_lens");
    check_eq(f.call("POST", "/api/v1/personas/interviewers", ta, body).status, 409, "duplicate id");
    check_eq(f.call("POST", "/api/v1/personas/interviewers", ta, R"({"id":"x"})").status, 400, "missing fields");
    auto list = trtest::AppFixture::body_of(f.call("GET", "/api/v1/personas/interviewers?stage=hr", ta));
    check(list["personas"].size() == 1, "filtered");
    check_eq(f.call("GET", "/api/v1/personas/interviewers/nope", ta).status, 404, "not found");
    auto bad = f.call("POST", "/api/v1/personas/interviewers", ta,
                      R"({"id":"t-2","display_name":"x","stage":"ceo","temperament":"y","pressure":3,"bio":"b"})");
    check(bad.status == 500 && trtest::AppFixture::body_of(bad)["error"] == "create_failed", "check constraint → create_failed");
}

TEST_CASE("feedback: append (BIGSERIAL id is a string like postgres.js), validation, session filter") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    auto c = f.call("POST", "/api/v1/feedback", ta, R"({"target_kind":"summary_block","target_id":"s1:headline","action":"accept"})");
    check_eq(c.status, 201, "created");
    check(trtest::AppFixture::body_of(c)["feedback"]["id"].is_string(), "int8 id as string");
    check(trtest::AppFixture::body_of(c)["feedback"]["edit_payload"].is_null(), "edit_payload null");
    check_eq(f.call("POST", "/api/v1/feedback", ta, R"({"target_kind":"x","target_id":"s","action":"accept"})").status, 400, "kind");
    check_eq(f.call("POST", "/api/v1/feedback", ta, R"({"target_kind":"rag_ref","target_id":"s","action":"maybe"})").status, 400, "action");
    auto list = trtest::AppFixture::body_of(f.call("GET", "/api/v1/feedback?session_id=s1", ta));
    check_eq(list["feedback"].size(), std::size_t{1}, "LIKE s1:%");
}

TEST_CASE("training: placeholder ref without Memoria, Memoria upsert via HTTP, delete") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    auto c = f.call("POST", "/api/v1/training", ta, R"({"kind":"es","tags":["a",1,"b"]})");
    check_eq(c.status, 201, "created");
    const Json ref = trtest::AppFixture::body_of(c)["ref"];
    check(starts_with(ref["memoria_uri"].get<std::string>(), "local:training:es:"), "placeholder uri");
    check(ref["tags"] == Json::array({"a", "b"}), "non-string tags dropped");
    check_eq(f.call("POST", "/api/v1/training", ta, R"({"kind":"cv"})").status, 400, "invalid kind");
    f.services->env = {{"MEMORIA_URL", "http://memoria.test/"}, {"MEMORIA_PROJECT_TOKEN", "tok"}};
    f.fake_http = [](const io::HttpClientRequest&) {
        io::HttpClientResponse r;
        r.status = 200;
        r.body = R"({"memoria_uri":"memoria://doc/1","embedding_id":"e1"})";
        return r;
    };
    auto m = f.call("POST", "/api/v1/training", ta, R"({"kind":"portfolio","body":"本文"})");
    check(trtest::AppFixture::body_of(m)["ref"]["memoria_uri"] == "memoria://doc/1", "memoria ref");
    check_eq(f.outbound.back().url, std::string("http://memoria.test/api/v1/tirocinium/training/upsert"), "memoria url");
    f.fake_http = [](const io::HttpClientRequest&) {
        io::HttpClientResponse r;
        r.status = 500;
        r.body = "boom";
        return r;
    };
    check_eq(f.call("POST", "/api/v1/training", ta, R"({"kind":"es","body":"x"})").status, 502, "memoria failure → 502");
    f.services->env.clear();
    f.fake_http = nullptr;
    const std::string id = ref["id"];
    check_eq(f.call("DELETE", "/api/v1/training/" + id, ta).status, 200, "delete");
    check_eq(f.call("DELETE", "/api/v1/training/" + id, ta).status, 404, "delete again");
}

TEST_CASE("ft-runs: list, 404, POST 501") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    check(trtest::AppFixture::body_of(f.call("GET", "/api/v1/ft-runs?limit=5", ta))["runs"].is_array(), "list");
    check_eq(f.call("GET", "/api/v1/ft-runs/00000000-0000-4000-8000-000000000000", ta).status, 404, "missing");
    check_eq(f.call("POST", "/api/v1/ft-runs", ta).status, 501, "not implemented");
}

TEST_MAIN()
