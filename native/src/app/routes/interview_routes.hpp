#pragma once
// routes/{reservations,sessions,summary,personas,feedback,ft_runs,training}.ts の移植。

#include "app/services.hpp"
#include "http/router.hpp"

namespace tr::app {

void register_interview_routes(http::Router& router, Services& services);

// summary/generator.ts: 'ok' / 'anthropic_api_key_missing' / 'no_turns' / 'session_not_found' / 例外。
std::string generate_summary_for_session(Services& s, const std::string& session_id);

}  // namespace tr::app
