// es-review/discord-relay.test.ts と discord/commands.test.ts の移植 + 連絡先検出の境界テスト。
// 仲介の DB 操作は偽物 (Node 版の vi.mock と同じ)。
#include <chrono>
#include <mutex>

#include <boost/asio/thread_pool.hpp>
#include <optional>

#include "check.hpp"
#include "app/discord_bridge.hpp"
#include "core/domain/domain.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

struct Fake {
    std::vector<std::pair<std::string, std::string>> sent;
    int fail_sends = 0;  // 先頭から何回の送信を失敗させるか
    int relay_calls = 0, pairing_calls = 0, claim_calls = 0;
    std::optional<app::ReviewRoute> destination =
        app::ReviewRoute{"internal-request", "student", "fedcba9876543210", "private-ob"};
    bool claim_result = true;
    std::vector<std::pair<std::string, std::string>> finished;

    app::DiscordSend send() {
        return [this](const std::string& ch, const std::string& text) {
            if (fail_sends > 0) {
                --fail_sends;
                throw std::runtime_error("private body");
            }
            sent.emplace_back(ch, text);
        };
    }
    app::ReviewRouting routing() {
        app::ReviewRouting r;
        r.consume_pairing = [this](const std::string&, const std::string&) -> std::optional<app::ReviewRoute> {
            ++pairing_calls;
            return std::nullopt;
        };
        r.relay_destination = [this](const std::string&, const std::string&) {
            ++relay_calls;
            return destination;
        };
        r.claim_delivery = [this](const std::string&, const std::string&) {
            ++claim_calls;
            return claim_result;
        };
        r.finish_delivery = [this](const std::string& id, const std::string& state) { finished.emplace_back(id, state); };
        return r;
    }
};

Json message() {
    return Json{{"id", "event-1"},
                {"channel_id", "private-student"},
                {"author", Json{{"id", "student-account"}}},
                {"content", "!tr es reply 0123456789abcdef 添削をお願いします。"}};
}

TEST_CASE("private ES relay: never routes guild messages or attachments") {
    Fake f;
    Json guild = message();
    guild["guild_id"] = "shared";
    Json attach = message();
    attach["attachments"] = Json::array({Json::object()});
    check(app::handle_review_message(guild, "!tr", f.send(), f.routing()), "handled");
    check(app::handle_review_message(attach, "!tr", f.send(), f.routing()), "handled");
    check_eq(f.relay_calls, 0, "relayDestination not called");
    check_eq(f.pairing_calls, 0, "consumePairing not called");
}

TEST_CASE("private ES relay: labels the sender by role and uses the recipient alias without account metadata") {
    Fake f;
    app::handle_review_message(message(), "!tr", f.send(), f.routing());
    check(!f.sent.empty(), "sent");
    check_eq(f.sent[0].first, std::string("private-ob"), "recipient channel");
    check(f.sent[0].second.find("fedcba9876543210") != std::string::npos, "recipient alias");
    check(f.sent[0].second.find("学生から") != std::string::npos, "role label");
    check(f.sent[0].second.find("student-account") == std::string::npos, "no account id");
    check(f.sent[0].second.find("0123456789abcdef") == std::string::npos, "no sender alias");
    check(f.finished.size() == 1 && f.finished[0] == std::make_pair(std::string("event-1"), std::string("sent")), "finish sent");
}

TEST_CASE("private ES relay: rejects an unbound or closed destination before claiming delivery") {
    Fake f;
    f.destination.reset();
    app::handle_review_message(message(), "!tr", f.send(), f.routing());
    check_eq(f.claim_calls, 0, "claimDelivery not called");
}

TEST_CASE("private ES relay: does not resend duplicate gateway events") {
    Fake f;
    f.claim_result = false;
    app::handle_review_message(message(), "!tr", f.send(), f.routing());
    check(f.sent.empty(), "nothing sent");
}

TEST_CASE("private ES relay: marks uncertain delivery and never echoes raw errors") {
    Fake f;
    f.fail_sends = 1;
    app::handle_review_message(message(), "!tr", f.send(), f.routing());
    check(f.finished.size() == 1 && f.finished[0].second == "unknown", "finish unknown");
    check(!f.sent.empty(), "fixed notice sent");
    check(f.sent[0].second.find("private body") == std::string::npos, "raw error not echoed");
}

TEST_CASE("private ES relay: rejects contact links before looking up a destination") {
    Fake f;
    Json m = message();
    m["content"] = m["content"].get<std::string>() + " https://discord.gg/example";
    app::handle_review_message(m, "!tr", f.send(), f.routing());
    check_eq(f.relay_calls, 0, "relayDestination not called");
}

TEST_CASE("private ES relay: prefix matching, bot authors, connect codes, usage") {
    Fake f;
    Json other = message();
    other["content"] = "!tr esx";
    check(!app::handle_review_message(other, "!tr", f.send(), f.routing()), "not ours");
    Json bot = message();
    bot["author"]["bot"] = true;
    check(app::handle_review_message(bot, "!tr", f.send(), f.routing()), "bot swallowed");
    check(f.sent.empty(), "bot gets no reply");
    Json connect = message();
    connect["content"] = "!tr es connect " + std::string(64, 'a');
    app::handle_review_message(connect, "!tr", f.send(), f.routing());
    check_eq(f.pairing_calls, 1, "pairing attempted");
    check(f.sent.back().second.find("接続コードが無効") != std::string::npos, "invalid code notice");
    Json bad = message();
    bad["content"] = "!tr es connect " + std::string(63, 'a');
    app::handle_review_message(bad, "!tr", f.send(), f.routing());
    check_eq(f.pairing_calls, 1, "short code is not a pairing");
    check(f.sent.back().second.find("接続コードを取得") != std::string::npos, "usage notice");
    Json bare = message();
    bare["content"] = "!tr es";
    app::handle_review_message(bare, "!tr", f.send(), f.routing());
    check(f.sent.back().second.find("接続コードを取得") != std::string::npos, "usage for bare command");
    Json empty_body = message();
    empty_body["content"] = "!tr es reply 0123456789abcdef";
    app::handle_review_message(empty_body, "!tr", f.send(), f.routing());
    check(f.sent.back().second.find("接続コードを取得") != std::string::npos, "reply without body is usage");
}

TEST_CASE("private ES relay: body length limit counts UTF-16 units") {
    Fake f;
    Json ok = message();
    std::string body;
    for (int i = 0; i < 1400; ++i) body += "あ";
    ok["content"] = "!tr es reply 0123456789abcdef " + body;
    app::handle_review_message(ok, "!tr", f.send(), f.routing());
    check_eq(f.relay_calls, 1, "1400 chars accepted");
    Json long_body = message();
    long_body["content"] = "!tr es reply 0123456789abcdef " + body + "あ";
    app::handle_review_message(long_body, "!tr", f.send(), f.routing());
    check_eq(f.relay_calls, 1, "1401 chars rejected");
}

TEST_CASE("contact detection: same matches as the Node regular expression") {
    using app::review_body_has_contact;
    for (const char* yes : {"see http://x", "HTTPS://X", "www.example", "discord.gg/abc", "DISCORD.COM", "<@123>", "<#9>",
                            "mail a@b", "@x", "@.", "@-", "tel 03-1234-5678", "090ー1234ー5678", "あ12-34-567", "12-34-567あ",
                            "x 1234-5678-9012 y"}) {
        check(review_body_has_contact(yes), std::string("should match: ") + yes);
    }
    for (const char* no : {"普通の文章です", "@ only", "1-23-456", "12345-678-9012", "12-34-56", "a12-34-567", "12-34-567a",
                           "12-34-56789", "123-4567", "discord .gg", "@あ", "2024年4月"}) {
        check(!review_body_has_contact(no), std::string("should not match: ") + no);
    }
}

TEST_CASE("contact detection: linear on long adversarial input") {
    std::string s;
    for (int i = 0; i < 200'000; ++i) s += "12-";
    const auto t0 = std::chrono::steady_clock::now();
    (void)app::review_body_has_contact(s);
    std::string at(400'000, '@');
    (void)app::review_body_has_contact(at + " ");
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    check(ms < 2000, "finishes quickly (" + std::to_string(ms) + " ms)");
}

TEST_CASE("snowflake check guards REST paths") {
    check(app::is_snowflake("123456789012345678"), "digits");
    check(!app::is_snowflake(""), "empty");
    check(!app::is_snowflake("12/../x"), "path");
    check(!app::is_snowflake(std::string(26, '1')), "too long");
}

// discord/bridge.test.ts の RuntimeDiscordSocket と chunkMessage
struct SinkProbe {
    boost::asio::thread_pool pool{1};
    std::mutex mu;
    std::vector<std::string> sent;
    std::shared_ptr<app::FrameSink> sink = app::make_discord_sink(
        "100",
        [this](const std::string&, const std::string& text) {
            std::lock_guard lock(mu);
            sent.push_back(text);
        },
        pool);
    std::vector<std::string> drain() {
        pool.join();
        std::lock_guard lock(mu);
        return sent;
    }
};

TEST_CASE("RuntimeDiscordSocket: accumulates response_token and flushes on response_end") {
    SinkProbe p;
    p.sink->send(R"({"kind":"response_token","token":"Hello ","turn_no":1})");
    p.sink->send(R"({"kind":"response_token","token":"world","turn_no":1})");
    p.sink->send(R"({"kind":"response_end","turn_no":1})");
    const auto sent = p.drain();
    check(sent.size() == 1 && sent[0] == "Hello world", "flushed once");
}

TEST_CASE("RuntimeDiscordSocket: empty buffer is not sent; system closing and errors are") {
    SinkProbe p;
    p.sink->send(R"({"kind":"response_token","token":"  ","turn_no":1})");
    p.sink->send(R"({"kind":"response_end","turn_no":1})");
    p.sink->send(R"({"kind":"system","code":"closing"})");
    p.sink->send(R"({"kind":"system","code":"error","message":"llm not configured"})");
    p.sink->send(R"({"kind":"system","code":"error"})");
    p.sink->send("not json");
    const auto sent = p.drain();
    check(sent.size() == 2 && sent[0] == "Tr interview ended." && sent[1] == "Tr system: llm not configured", "system frames");
}

TEST_CASE("chunkMessage: short stays one, empty becomes (empty), long splits at 1900") {
    check(domain::chunk_content("hello") == std::vector<std::string>{"hello"}, "short");
    check(domain::chunk_content("") == std::vector<std::string>{"(empty)"}, "empty");
    check(domain::chunk_content("   ") == std::vector<std::string>{"(empty)"}, "blank");
    const auto chunks = domain::chunk_content(std::string(3800, 'a'));
    check(chunks.size() == 2 && chunks[0].size() == 1900 && chunks[1].size() == 1900, "two chunks");
}

// discord/commands.test.ts
TEST_CASE("discord commands: parses text and voice interview starts") {
    auto c = domain::parse_discord_command("!tr text planner", "!tr");
    check(c.kind == "start" && c.mode == "text" && c.target == "planner", "text");
    c = domain::parse_discord_command("!tr voice  game  designer ", "!tr");
    check(c.kind == "start" && c.mode == "voice" && c.target == "game designer", "voice target");
    check_eq(domain::parse_discord_command("!tr end", "!tr").kind, std::string("end"), "end");
    check_eq(domain::parse_discord_command("!tr", "!tr").kind, std::string("help"), "help");
    check_eq(domain::parse_discord_command("!tr unknown", "!tr").kind, std::string("help"), "unknown is help");
    check_eq(domain::parse_discord_command("hello", "!tr").kind, std::string("none"), "none");
    check(domain::render_discord_help("!tr").find("`!tr voice [target]`") != std::string::npos, "help text");
}

}  // namespace

TEST_MAIN()
