cmake_minimum_required(VERSION 3.24)
project(TirociniumNative VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(FetchContent)
include(CTest)

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
