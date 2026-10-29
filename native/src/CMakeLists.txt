# tr_core: 副作用のない業務判断と小さな共通処理 (ネットワーク・DB・環境変数に触れない)。
add_library(tr_core STATIC
  core/json.cpp
  core/text.cpp
  core/time.cpp
  http/message.cpp
  http/router.cpp
  http/cors.cpp)
target_include_directories(tr_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tr_core PUBLIC nlohmann_json::nlohmann_json Lorica::boundary)
lorica_harden_target(tr_core)

# tr_io: 外部 I/O の adapter (Beast の HTTP/WS)。
add_library(tr_io STATIC
  io/http_server.cpp)
target_link_libraries(tr_io PUBLIC tr_core tr_boost OpenSSL::SSL OpenSSL::Crypto Threads::Threads)
lorica_harden_target(tr_io)

# tr_app: 経路・use case の組み立て。
add_library(tr_app STATIC
  app/config.cpp
  app/version.cpp
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
