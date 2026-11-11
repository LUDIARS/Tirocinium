# 「Lorica を使っているか」をビルドの結果から確かめる ctest (job cpp-lorica-20261111 の作業 B)。
# configure 時の網羅の確認 (native/CMakeLists.txt の tr_check_lorica_coverage) とは別に、出来上がったものを見る:
#   tirocinium.lorica_applied.baseline            翻訳単位の中から: 強制 include・標準ライブラリの検査・FORTIFY・Lorica::boundary
#   tirocinium.lorica_applied.extended            同じものを tr_lorica(... SERVER) で (EXTENDED の印も)
#   tirocinium.lorica_applied.unsafe_api_rejected std::strcpy を使う単位のコンパイルが Lorica の文言で止まること
#   tirocinium.lorica_applied.compile_commands    全ての自前の単位のコンパイルコマンド (cmake -P)
#   tirocinium.lorica_applied.verify_binary.*     Lorica の tools/verify_binary.py (python3 があるときだけ)
# tests/CMakeLists.txt から include する (tr_test と同じディレクトリ)。

get_property(tr_lorica_header GLOBAL PROPERTY LORICA_UNSAFE_API_HEADER)
if(NOT EXISTS "${tr_lorica_header}")
  message(FATAL_ERROR "Tirocinium: Lorica's unsafe_api.hpp is unknown (LORICA_UNSAFE_API_HEADER)")
endif()
cmake_path(GET tr_lorica_header PARENT_PATH tr_lorica_include)      # <Lorica>/include/lorica
cmake_path(GET tr_lorica_include PARENT_PATH tr_lorica_include)     # <Lorica>/include
cmake_path(GET tr_lorica_include PARENT_PATH tr_lorica_root)        # <Lorica>

# この構成で Lorica が付ける _FORTIFY_SOURCE (LoricaHardening.cmake の _lorica_linux_capabilities と同じ条件:
# Linux の GCC / Clang、Release / RelWithDebInfo / MinSizeRel、コンパイラ 12 以上で 3、それより前は 2)。
set(tr_lorica_toolchain unsupported)
set(tr_lorica_toolchain_reason "${CMAKE_SYSTEM_NAME} ${CMAKE_CXX_COMPILER_ID}")
set(tr_lorica_fortify_level 0)
if(MSVC AND WIN32)
  set(tr_lorica_toolchain msvc)
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_CXX_COMPILER_ID MATCHES "^(GNU|Clang)$")
  set(tr_lorica_toolchain linux)
  set(tr_lorica_fortify_level 2)
  if(CMAKE_CXX_COMPILER_VERSION VERSION_GREATER_EQUAL 12)
    set(tr_lorica_fortify_level 3)
  endif()
endif()
set(tr_lorica_fortify "$<IF:$<CONFIG:Release,RelWithDebInfo,MinSizeRel>,${tr_lorica_fortify_level},0>")
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64|ARM64)$")
  set(tr_lorica_cfi_flag -mbranch-protection=standard)
else()
  set(tr_lorica_cfi_flag -fcf-protection=full)
endif()

# 1. 翻訳単位の中から確かめる 2 本。
function(tr_lorica_applied_test target kind)
  add_executable(${target} ${target}.cpp)
  target_include_directories(${target} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  set(expect_extended 0)
  if(kind STREQUAL "extended")
    tr_lorica(${target} SERVER)
    if(TR_USE_EXTENDED)
      set(expect_extended 1)
    else()
      target_compile_definitions(${target} PRIVATE TR_LORICA_EXTENDED_SKIP=1
        "TR_LORICA_EXTENDED_SKIP_REASON=\"TR_EXTENDED_HARDENING=${TR_EXTENDED_HARDENING}\"")
    endif()
  else()
    tr_lorica(${target})
  endif()
  target_compile_definitions(${target} PRIVATE TR_LORICA_EXPECT_EXTENDED=${expect_extended}
    TR_LORICA_EXPECT_FORTIFY=${tr_lorica_fortify})
  add_test(NAME tirocinium.lorica_applied.${kind} COMMAND ${target})
  set_tests_properties(tirocinium.lorica_applied.${kind} PROPERTIES SKIP_RETURN_CODE 77)
endfunction()
tr_lorica_applied_test(lorica_applied_tests baseline)
tr_lorica_applied_test(lorica_applied_extended_tests extended)

# 2. unsafe API の拒否が実際に効くこと: 既定のビルドに入らない単位を ctest の中でビルドし、Lorica の文言で
#    止まることを見る (通ってしまえば文言が出ないので失敗する)。
add_executable(lorica_unsafe_api_probe EXCLUDE_FROM_ALL lorica_unsafe_api_probe.cpp)
tr_lorica(lorica_unsafe_api_probe)
add_test(NAME tirocinium.lorica_applied.unsafe_api_rejected
  COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --config $<CONFIG> --target lorica_unsafe_api_probe)
if(tr_lorica_toolchain STREQUAL "msvc")
  set(tr_lorica_unsafe_regex "error C4996")
else()
  set(tr_lorica_unsafe_regex "error: [^\n]*strcpy[^\n]*deprecated[^\n]*Lorica: unbounded copy")
endif()
set_tests_properties(tirocinium.lorica_applied.unsafe_api_rejected PROPERTIES
  PASS_REGULAR_EXPRESSION "${tr_lorica_unsafe_regex}")

# 3. 全ての自前の翻訳単位のコンパイルコマンド。EXTENDED の対象は tr_lorica(... SERVER) が記録したターゲットの
#    ソース (このファイルは src/ の後に読まれるので、サーバの部品はすべて揃っている)。
set(tr_lorica_extended_sources "")
if(TR_USE_EXTENDED)
  get_property(tr_lorica_extended_targets GLOBAL PROPERTY TR_LORICA_EXTENDED_TARGETS)
  foreach(target IN LISTS tr_lorica_extended_targets)
    get_target_property(sources ${target} SOURCES)
    get_target_property(source_dir ${target} SOURCE_DIR)
    foreach(source IN LISTS sources)
      cmake_path(ABSOLUTE_PATH source BASE_DIRECTORY "${source_dir}" NORMALIZE)
      if(source MATCHES "\\.(c|cc|cpp|cxx)$")
        list(APPEND tr_lorica_extended_sources "${source}")
      endif()
    endforeach()
  endforeach()
endif()
list(JOIN tr_lorica_extended_sources "\n" tr_lorica_extended_text)
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/lorica_extended_sources.txt" "${tr_lorica_extended_text}\n")
add_test(NAME tirocinium.lorica_applied.compile_commands
  COMMAND ${CMAKE_COMMAND}
    "-DTR_CC_JSON=${CMAKE_BINARY_DIR}/compile_commands.json"
    "-DTR_GENERATOR=${CMAKE_GENERATOR}"
    "-DTR_SOURCE_ROOT=${PROJECT_SOURCE_DIR}"
    "-DTR_BINARY_ROOT=${CMAKE_BINARY_DIR}"
    "-DTR_TOOLCHAIN=${tr_lorica_toolchain}"
    "-DTR_TOOLCHAIN_REASON=${tr_lorica_toolchain_reason}"
    "-DTR_LORICA_INCLUDE=${tr_lorica_include}"
    "-DTR_LORICA_HEADER=${tr_lorica_header}"
    "-DTR_FORTIFY=${tr_lorica_fortify}"
    "-DTR_CFI_FLAG=${tr_lorica_cfi_flag}"
    "-DTR_EXTENDED_LIST=${CMAKE_CURRENT_BINARY_DIR}/lorica_extended_sources.txt"
    -P ${CMAKE_CURRENT_SOURCE_DIR}/lorica_compile_commands_check.cmake)
set_tests_properties(tirocinium.lorica_applied.compile_commands PROPERTIES
  SKIP_REGULAR_EXPRESSION "TR_LORICA_SKIP:")

# 4. 実行ファイルの点検 (Lorica の tools/verify_binary.py。実行ファイルを実行はしない)。python3 があるときだけ。
find_package(Python3 COMPONENTS Interpreter QUIET)
if(Python3_Interpreter_FOUND)
  set(tr_verify_binary "${tr_lorica_root}/tools/verify_binary.py")
  if(NOT EXISTS "${tr_verify_binary}")
    message(FATAL_ERROR "Tirocinium: Lorica's tools/verify_binary.py is missing: ${tr_verify_binary}")
  endif()
  foreach(exe tirocinium-server tirocinium-migrate)
    add_test(NAME tirocinium.lorica_applied.verify_binary.${exe}
      COMMAND ${Python3_EXECUTABLE} ${tr_verify_binary} $<TARGET_FILE:${exe}>)
  endforeach()
  message(STATUS "Tirocinium: verify_binary ctest registered for tirocinium-server and tirocinium-migrate (${Python3_EXECUTABLE})")
else()
  message(STATUS "Tirocinium: python3 not found, verify_binary ctest is not registered")
endif()
