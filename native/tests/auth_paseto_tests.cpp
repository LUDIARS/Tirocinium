// PASETO v4.public の検証と cernereAuth / ws authenticate の移植テスト。
// TS 側の対応: routes/auth.test.ts (公開鍵セットの読み方)、auth/cernere.ts の振る舞い。
#include "check.hpp"
#include "support/paseto_signer.hpp"
#include "app/auth.hpp"
#include "core/encoding.hpp"
#include "core/paseto.hpp"
#include "core/time.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

std::string unhex(const std::string& h) {
    std::string out;
    for (std::size_t i = 0; i + 1 < h.size(); i += 2) out.push_back(static_cast<char>(std::stoi(h.substr(i, 2), nullptr, 16)));
    return out;
}

std::string claims(const std::string& aud, EpochMs exp, const std::string& sub = "u1") {
    Json p;
    p["sub"] = sub;
    p["aud"] = aud;
    p["iat"] = iso_from_ms(now_ms() - 1000);
    p["exp"] = iso_from_ms(exp);
    p["kind"] = "user_for_project";
    return js_stringify(p);
}

http::Request bearer(const std::string& token) {
    http::Request r;
    r.method = "GET";
    r.path = "/api/v1/reservations/me";
    r.headers.set("authorization", "Bearer " + token);
    return r;
}

}  // namespace

TEST_CASE("PAE matches the PASETO specification examples") {
    check_eq(hex_encode(paseto::pae({})), std::string("0000000000000000"), "empty list");
    check_eq(hex_encode(paseto::pae({std::string_view()})), std::string("01000000000000000000000000000000"), "one empty");
    check_eq(hex_encode(paseto::pae({"test"})), std::string("0100000000000000040000000000000074657374"), "test");
}

TEST_CASE("official v4.public test vector 4-S-1 verifies") {
    auto key = crypto::Ed25519PublicKey::from_raw(unhex("1eb9dbbbbc047c03fd70604e0071f0987e16b28b757225c11f00415d0e20b1a2"));
    check(key.has_value(), "key");
    const std::string token =
        "v4.public.eyJkYXRhIjoidGhpcyBpcyBhIHNpZ25lZCBtZXNzYWdlIiwiZXhwIjoiMjAyMi0wMS0wMVQwMDowMDowMCswMDowMCJ9bg_XBBzds8lTZ"
        "ShVlwwKSgeKpLT3yukTw6JUz3W4h_ExsQV-P0V54zemZDcAxFaSeef1QlXEFtkqxT1ciiQEDA";
    auto parts = paseto::split_v4_public(token);
    check(parts.has_value(), "split");
    check(key->verify(paseto::signing_input(*parts), parts->signature), "signature");
    // exp は 2022-01-01 なので、その前の時刻では有効、後では期限切れ。
    auto payload = paseto::parse_payload(parts->message);
    check(!paseto::assert_payload(*payload, std::nullopt, *parse_iso_ms("2021-12-31T00:00:00Z")).has_value(), "valid before exp");
    check_eq(*paseto::assert_payload(*payload, std::nullopt, *parse_iso_ms("2022-01-01T00:00:00Z")), std::string("token is expired"),
             "exp <= now is expired");
}

TEST_CASE("verify_v4_public: audience, tamper, wrong key, malformed") {
    trtest::TestSigner signer;
    auto key = *crypto::Ed25519PublicKey::from_raw(signer.public_raw());
    const auto good = signer.sign(claims("tirocinium", now_ms() + 600000), R"({"kid":"v1"})");
    check(app::verify_v4_public(good, key, "tirocinium", now_ms()).has_value(), "valid with footer");
    check(!app::verify_v4_public(good, key, "other", now_ms()).has_value(), "audience mismatch");
    std::string tampered = good;
    tampered[20] = tampered[20] == 'A' ? 'B' : 'A';
    check(!app::verify_v4_public(tampered, key, "tirocinium", now_ms()).has_value(), "tampered payload");
    trtest::TestSigner other;
    check(!app::verify_v4_public(other.sign(claims("tirocinium", now_ms() + 600000)), key, "tirocinium", now_ms()),
          "other key");
    check(!app::verify_v4_public("v4.local.abc", key, "tirocinium", now_ms()), "v4.local is not accepted");
    check(!app::verify_v4_public("v4.public.a.b.c", key, "tirocinium", now_ms()), "3 parts");
    check(!app::verify_v4_public("v4.public.%%%", key, "tirocinium", now_ms()), "bad base64url");
    check(!app::verify_v4_public("v4.public." + base64url_encode(std::string(63, 'x')), key, "tirocinium", now_ms()),
          "shorter than a signature");
    const auto not_object = signer.sign("[1,2]");
    check(!app::verify_v4_public(not_object, key, "tirocinium", now_ms()), "payload must be an object");
    const auto future_iat = signer.sign(R"({"sub":"u","aud":"tirocinium","iat":"2999-01-01T00:00:00Z"})");
    check(!app::verify_v4_public(future_iat, key, "tirocinium", now_ms()), "issued in the future");
    const auto bad_exp = signer.sign(R"({"sub":"u","aud":"tirocinium","exp":123})");
    check(!app::verify_v4_public(bad_exp, key, "tirocinium", now_ms()), "exp must be a string");
}

TEST_CASE("CERNERE_PUBLIC_KEY accepts PASERK k4.public and PEM") {
    trtest::TestSigner signer;
    const std::string paserk = "k4.public." + base64url_encode(signer.public_raw());
    check(crypto::Ed25519PublicKey::from_config_string(paserk).has_value(), "paserk");
    // SPKI PEM = 302a300506032b6570032100 || raw
    const std::string der = unhex("302a300506032b6570032100") + signer.public_raw();
    const std::string pem = "-----BEGIN PUBLIC KEY-----\n" + base64_encode(der) + "\n-----END PUBLIC KEY-----\n";
    auto key = crypto::Ed25519PublicKey::from_config_string(pem);
    check(key.has_value(), "pem");
    check(app::verify_v4_public(signer.sign(claims("tirocinium", now_ms() + 60000)), *key, "tirocinium", now_ms()).has_value(),
          "pem key verifies");
    check(!crypto::Ed25519PublicKey::from_config_string("garbage").has_value(), "garbage");
}

TEST_CASE("parsePublicKeySet: raw 32-byte base64 keys, EdDSA only, invalid length throws") {
    trtest::TestSigner a;
    Json body = {{"keys", Json::array({{{"kid", "v1"}, {"alg", "EdDSA"}, {"public_key", base64_encode(a.public_raw())}},
                                       {{"kid", "x"}, {"alg", "RS256"}, {"public_key", "ignored"}},
                                       {{"kid", "v0"}, {"public_key", base64_encode(a.public_raw())}}})}};
    check_eq(app::parse_public_key_set(body).size(), std::size_t{2}, "two EdDSA keys");
    check(app::parse_public_key_set(Json::object()).empty(), "no keys");
    Json bad = {{"keys", Json::array({{{"public_key", base64_encode("short")}}})}};
    trtest::check_throws([&] { (void)app::parse_public_key_set(bad); }, "length != 32");
}

TEST_CASE("cernereAuth: 401 without bearer, 503 without keys, 401 invalid, ok with rotated key") {
    app::Config cfg;
    app::CernereKeys keys;
    app::Authenticator auth(cfg, keys);
    http::Context ctx;
    http::Request none;
    check_eq(auth.require(none, ctx)->status, 401, "no header");
    trtest::TestSigner current, previous;
    auto req = bearer(previous.sign(claims("tirocinium", now_ms() + 60000)));
    check_eq(auth.require(req, ctx)->status, 503, "no keys → 503 auth_not_configured");
    keys.set_fetched({*crypto::Ed25519PublicKey::from_raw(current.public_raw())});
    auto res = auth.require(req, ctx);
    check(res && res->status == 401 && res->body == R"({"error":"invalid_token"})", "previous key not yet known");
    keys.set_fetched({*crypto::Ed25519PublicKey::from_raw(current.public_raw()),
                      *crypto::Ed25519PublicKey::from_raw(previous.public_raw())});
    check(!auth.require(req, ctx).has_value(), "rotation: old key still verifies");
    check_eq(*ctx.user_id, std::string("u1"), "user id from sub");
    auto expired = bearer(current.sign(claims("tirocinium", now_ms() - 1)));
    check_eq(auth.require(expired, ctx)->body, std::string(R"({"error":"invalid_token"})"), "expired token is invalid_token");
    auto no_sub = bearer(current.sign(R"({"aud":"tirocinium"})"));
    check_eq(auth.require(no_sub, ctx)->status, 401, "token without sub is rejected");
}

TEST_CASE("cernereAuth: configured key that cannot be read still counts as a key (401, not 503)") {
    app::Config cfg;
    app::CernereKeys keys;
    keys.set_configured("not a key");
    app::Authenticator auth(cfg, keys);
    trtest::TestSigner s;
    auto req = bearer(s.sign(claims("tirocinium", now_ms() + 60000)));
    http::Context ctx;
    check_eq(auth.require(req, ctx)->status, 401, "invalid configured key");
}

TEST_CASE("dev auth only on loopback") {
    app::Config cfg;
    cfg.dev_auth = true;
    cfg.host = "0.0.0.0";
    app::CernereKeys keys;
    app::Authenticator auth(cfg, keys);
    trtest::check_throws([&] { auth.assert_safe_config(); }, "non-loopback dev auth");
    cfg.host = "127.0.0.1";
    http::Request none;
    http::Context ctx;
    check(!auth.require(none, ctx).has_value(), "dev user passes");
    check_eq(*ctx.user_id, cfg.dev_user_id, "dev user id");
}

TEST_CASE("ws authenticate: bearer or ?token=, configured key only, malformed escape throws") {
    trtest::TestSigner s;
    app::Config cfg;
    cfg.cernere_public_key = "k4.public." + base64url_encode(s.public_raw());
    app::CernereKeys keys;
    app::Authenticator auth(cfg, keys);
    const auto token = s.sign(claims("tirocinium", now_ms() + 60000, "user-7"));
    http::Request q;
    q.target = "/api/v1/ws/session/00000000-0000-0000-0000-000000000000?token=" + token;
    check_eq(*auth.authenticate_ws(q), std::string("user-7"), "query token");
    http::Request h;
    h.target = "/api/v1/ws/session/x";
    h.headers.set("authorization", "Bearer " + token);
    check_eq(*auth.authenticate_ws(h), std::string("user-7"), "bearer");
    http::Request bad;
    bad.target = "/x?token=%E9%9D";
    trtest::check_throws([&] { (void)auth.authenticate_ws(bad); }, "URIError → 500");
    cfg.cernere_public_key.clear();
    check(!auth.authenticate_ws(q).has_value(), "no configured key → 401 (fetched keys are not used here)");
}

TEST_MAIN()
