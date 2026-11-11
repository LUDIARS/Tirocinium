cmake_minimum_required(VERSION 3.24)
project(TirociniumNative VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(FetchContent)
include(CTest)

# Lorica の適用をビルドの結果から確かめる ctest (tests/lorica_applied.cmake) が compile_commands.json を読む。
if(PROJECT_IS_TOP_LEVEL)
  set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
endif()

# Older dependency releases predate CMake 4's removal of pre-3.5 policy modes.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

find_package(OpenSSL 3 REQUIRED)
find_package(Threads REQUIRED)
# libpq only (PostgreSQL client). The server headers are not required.
find_package(PostgreSQL REQUIRED)

set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
set(JSON_Install OFF CACHE BOOL "" FORCE)
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d)
# The zip release (header-only use). SOURCE_SUBDIR points to a directory that does not exist so
# that Boost's own CMake build is never configured: only Asio/Beast headers are used.
FetchContent_Declare(boost URL https://github.com/boostorg/boost/releases/download/boost-1.87.0/boost-1.87.0-b2-nodocs.zip
  URL_HASH SHA256=40efbb1f38b8cf186fd7bb12809f561ae1c233bae0f75146862e9bfce77d0d42
  SOURCE_SUBDIR tirocinium-header-only)
FetchContent_MakeAvailable(json boost)

# Lorica: pass -DLORICA_SOURCE_DIR=<checkout> for an existing checkout, otherwise it is fetched at a
# fixed commit.
set(LORICA_SOURCE_DIR "" CACHE PATH "Existing Lorica checkout (empty = fetch the pinned commit)")
set(LORICA_BUILD_PROTECTION OFF CACHE BOOL "" FORCE)
set(LORICA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
if(LORICA_SOURCE_DIR)
  add_subdirectory(${LORICA_SOURCE_DIR} ${CMAKE_BINARY_DIR}/_lorica EXCLUDE_FROM_ALL)
else()
  FetchContent_Declare(lorica GIT_REPOSITORY https://github.com/LUDIARS/Lorica.git
    GIT_TAG 5e8281b0e60fa16f814e16eaa620715937e8618d)
  FetchContent_MakeAvailable(lorica)
endif()

# 自分でコンパイルするビルド単位すべてに Lorica を入れる (指示書 3.3):
#   Lorica::boundary (PRIVATE)・lorica_harden_target (baseline)・lorica_deprecate_unsafe_apis。
# EXTENDED は外から入力を受ける常駐サーバ (tirocinium-server とそれを組み立てるライブラリ) で試す。
#   AUTO: 使える環境なら EXTENDED、使えなければ理由を警告して baseline (configure の出力に必ず出る)。
#   ON:   EXTENDED を必須にする (使えなければ Lorica が configure を止める)。OFF: baseline だけ。
set(TR_EXTENDED_HARDENING "AUTO" CACHE STRING "EXTENDED hardening for the resident server (AUTO/ON/OFF)")
set_property(CACHE TR_EXTENDED_HARDENING PROPERTY STRINGS AUTO ON OFF)
set(TR_USE_EXTENDED OFF)
if(TR_EXTENDED_HARDENING STREQUAL "ON")
  set(TR_USE_EXTENDED ON)
elseif(TR_EXTENDED_HARDENING STREQUAL "AUTO")
  lorica_extended_hardening_supported(TR_EXTENDED_OK)
  if(TR_EXTENDED_OK)
    set(TR_USE_EXTENDED ON)
  else()
    message(WARNING "Tirocinium: EXTENDED hardening is not available here, the server stays baseline: ${TR_EXTENDED_OK_REASON}")
  endif()
endif()
message(STATUS "Tirocinium: EXTENDED hardening for the server: ${TR_USE_EXTENDED}")

# tr_lorica(<target> [SERVER]): 1 つのビルド単位に Lorica を入れる。SERVER は常駐サーバの部品 (EXTENDED の対象)。
function(tr_lorica target)
  cmake_parse_arguments(PARSE_ARGV 1 arg "SERVER" "" "")
  target_link_libraries(${target} PRIVATE Lorica::boundary)
  if(arg_SERVER AND TR_USE_EXTENDED)
    lorica_harden_target(${target} EXTENDED)
    set_property(GLOBAL APPEND PROPERTY TR_LORICA_EXTENDED_TARGETS ${target})
  else()
    lorica_harden_target(${target})
  endif()
  lorica_deprecate_unsafe_apis(${target})
endfunction()

# configure 時の網羅の確認: このプロジェクトのディレクトリ (ビルドディレクトリの中の FetchContent の依存と、
# 外にある Lorica 自身を除く) で作る、コンパイルするターゲットすべてが tr_lorica() を通っていること。
# 抜けがあれば configure を止める (ビルドの結果の確認は tests/lorica_applied.cmake の ctest)。
function(tr_check_lorica_coverage)
  set(pending "${PROJECT_SOURCE_DIR}")
  set(missing "")
  while(pending)
    list(POP_FRONT pending dir)
    get_property(subdirs DIRECTORY "${dir}" PROPERTY SUBDIRECTORIES)
    foreach(sub IN LISTS subdirs)
      cmake_path(IS_PREFIX PROJECT_SOURCE_DIR "${sub}" NORMALIZE inside)
      cmake_path(IS_PREFIX CMAKE_BINARY_DIR "${sub}" NORMALIZE in_build)
      if(inside AND NOT in_build)
        list(APPEND pending "${sub}")
      endif()
    endforeach()
    get_property(targets DIRECTORY "${dir}" PROPERTY BUILDSYSTEM_TARGETS)
    foreach(target IN LISTS targets)
      get_target_property(kind ${target} TYPE)
      if(NOT kind MATCHES "^(EXECUTABLE|STATIC_LIBRARY|SHARED_LIBRARY|MODULE_LIBRARY|OBJECT_LIBRARY)$")
        continue()
      endif()
      get_target_property(hardened ${target} LORICA_HARDENED)
      get_target_property(deprecated ${target} LORICA_UNSAFE_APIS_DEPRECATED)
      if(NOT hardened OR NOT deprecated)
        list(APPEND missing "${target}")
      endif()
    endforeach()
  endwhile()
  if(missing)
    list(JOIN missing ", " missing)
    message(FATAL_ERROR "Tirocinium: targets built without tr_lorica() (Lorica not applied): ${missing}")
  endif()
endfunction()
cmake_language(DEFER CALL tr_check_lorica_coverage)

# sanitizer のビルド (検査用。既定は空 = 使わない)。例: -DTR_SANITIZE=address,undefined / -DTR_SANITIZE=thread
set(TR_SANITIZE "" CACHE STRING "Sanitizers for test builds (address,undefined | thread | empty)")
if(TR_SANITIZE)
  if(MSVC)
    message(FATAL_ERROR "TR_SANITIZE is for GCC/Clang")
  endif()
  add_compile_options(-fsanitize=${TR_SANITIZE} -fno-omit-frame-pointer -fno-sanitize-recover=all)
  add_link_options(-fsanitize=${TR_SANITIZE})
endif()

# libFuzzer の入口 (Clang だけ。既定 OFF で GCC の CI を壊さない)。回帰用の固定入力の実行は BUILD_TESTING で常に作る。
option(TR_FUZZ "Build libFuzzer entry points (Clang only)" OFF)
if(TR_FUZZ AND NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
  message(FATAL_ERROR "TR_FUZZ needs Clang (libFuzzer)")
endif()
if(TR_FUZZ)
  # 入口だけでなく、読み取りの本体 (tr_core / tr_app) にも網羅の計測を入れる。
  add_compile_options(-fsanitize=fuzzer-no-link,address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

add_library(tr_boost INTERFACE)
target_include_directories(tr_boost SYSTEM INTERFACE ${boost_SOURCE_DIR})
target_compile_definitions(tr_boost INTERFACE BOOST_ERROR_CODE_HEADER_ONLY BOOST_ASIO_NO_DEPRECATED
  BOOST_BEAST_USE_STD_STRING_VIEW)
if(WIN32)
  target_link_libraries(tr_boost INTERFACE ws2_32 mswsock)
endif()

if(MSVC)
  add_compile_options(/utf-8 /W4 /permissive- /bigobj /fp:precise)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
else()
  # 浮動小数点の積和を融合しない (FMA で JS と丸めが変わると決定的な結果がずれるため)。
  add_compile_options(-Wall -Wextra -Wpedantic -ffp-contract=off)
endif()

add_subdirectory(src)
if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
if(BUILD_TESTING OR TR_FUZZ)
  add_subdirectory(fuzz)
endif()
