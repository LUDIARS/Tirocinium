#pragma once
// /api/v1/companies (routes/companies.ts)。
// DB の読み出しとクロールの投入 (crawl_jobs への INSERT) は C++。HTML/RSS の取得・解析・LLM 抽出・
// 地図の geocode・ゲームの関連探索は Node の企業 worker に頼む (worker が無ければ 502/503 で断る)。

#include "app/companies_worker.hpp"
#include "app/services.hpp"

namespace tr::app {

// worker は nullptr 可 (起動しない構成・テスト)。
void register_companies_routes(http::Router& r, Services& s, CompaniesWorker* worker);

// 企業 worker の処理ごとの待ち時間。
std::chrono::milliseconds companies_op_timeout(const std::string& op);

}  // namespace tr::app
