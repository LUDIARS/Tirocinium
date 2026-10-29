# tr_core: 副作用のない業務判断と小さな共通処理 (ネットワーク・DB・環境変数に触れない)。
add_library(tr_core STATIC
  core/json.cpp
  core/text.cpp
  core/time.cpp
  core/encoding.cpp
  core/paseto.cpp
  core/url.cpp
  core/ip_policy.cpp
  core/llm/engine.cpp
  core/llm/prompts.cpp
  core/llm/output.cpp
  core/domain/domain.cpp
  http/message.cpp
  http/router.cpp
  http/cors.cpp
  db/pg_decode.cpp)
target_include_directories(tr_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tr_core PUBLIC nlohmann_json::nlohmann_json Lorica::boundary)
lorica_harden_target(tr_core)

# tr_crypto: OpenSSL 3 の薄い包み (ハッシュ・乱数・Ed25519 検証・scrypt・AES-256-GCM)。
add_library(tr_crypto STATIC
  crypto/crypto.cpp)
target_link_libraries(tr_crypto PUBLIC tr_core OpenSSL::Crypto)
lorica_harden_target(tr_crypto)

# tr_io: 外部 I/O の adapter (Beast の HTTP/WS)。
add_library(tr_io STATIC
  io/http_server.cpp
  io/http_client.cpp
  io/tls_roots.cpp
  io/pg_pool.cpp)
target_link_libraries(tr_io PUBLIC tr_core tr_crypto tr_boost OpenSSL::SSL OpenSSL::Crypto PostgreSQL::PostgreSQL
  Threads::Threads)
if(WIN32)
  target_link_libraries(tr_io PUBLIC crypt32)
endif()
lorica_harden_target(tr_io)

# tr_app: 経路・use case の組み立て。
add_library(tr_app STATIC
  app/config.cpp
  app/auth.cpp
  app/secrets.cpp
  app/version.cpp
  app/paths.cpp
  app/migrate.cpp
  app/pipeline.cpp
  app/routes/health.cpp
  app/server_main.cpp)
target_link_libraries(tr_app PUBLIC tr_io)
lorica_harden_target(tr_app)

add_executable(tirocinium-server main.cpp)
target_link_libraries(tirocinium-server PRIVATE tr_app)
set_target_properties(tirocinium-server PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin" RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin")
lorica_harden_target(tirocinium-server)

add_executable(tirocinium-migrate migrate_main.cpp)
target_link_libraries(tirocinium-migrate PRIVATE tr_app)
set_target_properties(tirocinium-migrate PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin" RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin")
lorica_harden_target(tirocinium-migrate)
