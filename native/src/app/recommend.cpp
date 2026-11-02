#include "app/recommend.hpp"

#include <cmath>
#include <limits>
#include <map>
#include <set>

#include "app/companies_repo.hpp"
#include "app/memoria.hpp"
#include "core/text.hpp"

namespace tr::app {

std::size_t js_slice_count(std::size_t length, double end) {
    if (std::isnan(end)) return 0;
    const double t = std::trunc(end);
    const double len = static_cast<double>(length);
    if (t < 0) return static_cast<std::size_t>(std::max(len + t, 0.0));
    return static_cast<std::size_t>(std::min(t, len));
}

namespace {

std::vector<std::string> weak_axes_of(db::Database& db, const std::string& user_id) {
    auto rows = db.query("SELECT weak_top3 FROM weakness_profiles WHERE user_id = $1", {user_id});
    std::vector<std::string> out;
    if (rows.empty()) return out;
    if (const Json* w = member(rows[0], "weak_top3"); w && w->is_array()) {
        for (const auto& x : *w) {
            if (x.is_string()) out.push_back(x);
        }
    }
    return out;
}

std::string es_material_from_memoria(Services& s, const std::string& user_id, const std::string& query,
                                     const std::vector<std::string>& tags) {
    if (!memoria_base_url(s)) return "";
    try {
        const Json res = memoria_rag(s, user_id, query.empty() ? "ES 強み 志望" : query, {"es", "portfolio", "self_intro"},
                                     tags.empty() ? std::nullopt : std::optional<std::vector<std::string>>(tags), 6);
        return render_rag_block(res);
    } catch (const std::exception& e) {
        if (s.log) s.log(std::string("[recommend] memoria rag failed: ") + e.what());
        return "";
    }
}

Json llm_recommend(Services& s, const std::string& model, const domain::ApplicantProfile& profile, const std::vector<Json>& companies,
                   double top_k) {
    const auto candidates = domain::rank_candidates(profile, companies, 30);
    if (candidates.empty()) return Json{{"method", "llm"}, {"model", model}, {"items", Json::array()}};
    std::map<std::string, std::string> names;
    std::set<std::string> valid;
    for (const auto& c : candidates) {
        const std::string id = string_or(c.company, "id");
        valid.insert(id);
        names.emplace(id, string_or(c.company, "name"));
    }
    const std::string body = domain::render_profile(profile) + "\n\n## 候補企業\n" + domain::render_candidates(candidates);
    CliRunOptions o;
    o.model = model;
    o.extra_args = claude_text_args();
    o.timeout = std::chrono::milliseconds(120'000);
    const std::string text = s.llm->run_claude(std::string(domain::kRecommendInstruction) + "\n\n" + body, o);
    auto items = domain::parse_recommendation(text, valid);
    for (auto& it : items) {
        if (auto n = names.find(it["company_id"].get<std::string>()); n != names.end()) it["name"] = n->second;
    }
    Json out = Json::array();
    const std::size_t n = js_slice_count(items.size(), top_k);
    for (std::size_t i = 0; i < n; ++i) out.push_back(items[i]);
    return Json{{"method", "llm"}, {"model", model}, {"items", out}};
}

}  // namespace

RecommendOutcome run_recommend(Services& s, const RecommendRequest& req) {
    std::vector<std::string> tags;
    for (const auto& t : req.tags) {
        std::string v = js_trim(t);
        if (!v.empty()) tags.push_back(std::move(v));
    }
    const auto weak = weak_axes_of(s.db, req.user_id);
    std::string es = js_trim(req.es_text.value_or(""));
    if (es.empty()) {
        std::vector<std::string> parts;
        if (req.target_role && !req.target_role->empty()) parts.push_back(*req.target_role);
        if (req.target_company && !req.target_company->empty()) parts.push_back(*req.target_company);
        for (const auto& t : tags) parts.push_back(t);
        for (const auto& w : weak) {
            if (!w.empty()) parts.push_back(w);
        }
        es = es_material_from_memoria(s, req.user_id, join(parts, " "), tags);
    }
    domain::ApplicantProfile profile;
    profile.es_text = es;
    profile.target_role = req.target_role;
    profile.target_company = req.target_company;
    profile.tags = tags;
    profile.weak_axes = weak;

    const auto companies = all_companies_for_scoring(s.db);
    const double top_k = req.top_k.value_or(8);
    auto heuristic = [&] {
        const std::size_t positive = domain::rank_candidates(profile, companies, std::numeric_limits<std::size_t>::max()).size();
        return domain::recommend_heuristic(profile, companies, js_slice_count(positive, top_k));
    };
    Json result;
    if (s.config.llm_backend == "api" && s.llm && s.llm->anthropic_enabled()) {
        const std::string model = s.llm->models().at("RECOMMENDER");
        try {
            result = llm_recommend(s, model, profile, companies, top_k);
        } catch (const std::exception& e) {
            if (s.log) s.log(std::string("[recommend] llm rerank failed, fallback to heuristic: ") + e.what());
            result = heuristic();
        }
    } else {
        result = heuristic();
    }
    Json query = Json::object();
    if (req.target_role) query["target_role"] = *req.target_role;
    if (req.target_company) query["target_company"] = *req.target_company;
    query["tags"] = tags;
    query["weak_axes"] = weak;
    return {result, query, !es.empty()};
}

Json save_recommendation(db::Database& db, const std::string& user_id, const Json& query, const Json& result) {
    auto rows = db.query(
        "INSERT INTO company_recommendations (user_id, query, method, model, items) VALUES ($1, $2, $3, $4, $5) "
        "RETURNING id, user_id, created_at, query, method, model, items",
        {user_id, db::JsonParam{query}, string_or(result, "method"), string_or(result, "model"),
         db::JsonParam{result.value("items", Json::array())}});
    return rows.at(0);
}

db::Rows list_recommendations(db::Database& db, const std::string& user_id, long long limit) {
    return db.query(
        "SELECT id, user_id, created_at, query, method, model, items FROM company_recommendations WHERE user_id = $1 "
        "ORDER BY created_at DESC LIMIT $2",
        {user_id, static_cast<std::int64_t>(std::min<long long>(std::max<long long>(limit, 1), 50))});
}

void register_recommend_routes(http::Router& r, Services& s) {
    r.use("/api/v1/recommend/*", s.auth.middleware());

    r.post("/api/v1/recommend", [&s](http::Request& req, http::Context& ctx) {
        const std::string& uid = user_id(ctx);
        const auto body = read_json_body(req);
        auto field = [&](const char* k) -> const Json* { return body && body->is_object() ? member(*body, k) : nullptr; };
        RecommendRequest in;
        in.user_id = uid;
        if (const Json* v = field("target_role"); v && v->is_string()) in.target_role = v->get<std::string>();
        if (const Json* v = field("target_company"); v && v->is_string()) in.target_company = v->get<std::string>();
        if (const Json* v = field("tags"); v && v->is_array()) {
            for (const auto& t : *v) {
                if (t.is_string()) in.tags.push_back(t);
            }
        }
        if (const Json* v = field("es_text"); v && v->is_string()) in.es_text = v->get<std::string>();
        if (const Json* v = field("topK"); v && v->is_number()) in.top_k = v->get<double>();
        ensure_user(s.db, uid);
        const auto outcome = run_recommend(s, in);
        const Json saved = save_recommendation(s.db, uid, outcome.query, outcome.result);
        return http::Response::json(
            Json{{"recommendation", saved}, {"method", outcome.result["method"]}, {"has_es_material", outcome.has_es_material}}, 201);
    });

    r.get("/api/v1/recommend", [&s](http::Request& req, http::Context& ctx) {
        const auto limit = req.query("limit");
        long long n = 10;
        if (limit && !limit->empty()) {
            if (auto v = js_parse_int(*limit)) n = *v;
        }
        Json rows = Json::array();
        for (auto& row : list_recommendations(s.db, user_id(ctx), n)) rows.push_back(std::move(row));
        return http::Response::json(Json{{"recommendations", rows}});
    });
}

}  // namespace tr::app
