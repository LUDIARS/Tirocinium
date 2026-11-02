#pragma once
// /api/v1/companies (routes/companies.ts)。
// DB の読み出し・クロールの投入 (crawl_jobs への INSERT)・ゲーム起点の関連探索・技術での検索・地図 (geocode) は C++。
// HTML/RSS の取得・解析・LLM 抽出 (crawl-listing / job-news / contribute / enrich)・Sheets 同期・重複マージ・
// OB スタジオ (系列の NFKC 正規化と localeCompare を要する) は Node の企業 worker に頼む
// (worker が無ければ書き込み系は Node 版と同じ形の 502、読み出し系は 503)。

#include "app/companies_worker.hpp"
#include "app/services.hpp"

namespace tr::app {

// worker は nullptr 可 (起動しない構成・テスト)。
void register_companies_routes(http::Router& r, Services& s, CompaniesWorker* worker);

// 企業 worker の処理ごとの待ち時間。
std::chrono::milliseconds companies_op_timeout(const std::string& op);

}  // namespace tr::app
