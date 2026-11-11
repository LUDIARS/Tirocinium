# 外からの入力を読む部分の fuzz の入口 (libFuzzer 形式の LLVMFuzzerTestOneInput)。
# - TR_FUZZ=ON (Clang): fuzz_<name> を libFuzzer + ASan/UBSan でビルドする。短時間の動作確認用。
#     例: native/build-fuzz/fuzz/fuzz_json -max_total_time=30 native/fuzz/corpus/json
# - BUILD_TESTING (GCC を含む): 同じ入口を固定の入力 (corpus/<name>) で 1 回ずつ呼ぶ fuzz_<name>_replay を
#   ctest に入れる (回帰用。libFuzzer は使わない)。
# どちらのビルド単位にも Lorica (boundary・harden・deprecate_unsafe_apis) を入れる。

set(TR_FUZZ_ENTRIES json http_request material wav url paseto text)

foreach(name IN LISTS TR_FUZZ_ENTRIES)
  if(BUILD_TESTING)
    add_executable(fuzz_${name}_replay fuzz_${name}.cpp replay_main.cpp)
    target_link_libraries(fuzz_${name}_replay PRIVATE tr_app)
    tr_lorica(fuzz_${name}_replay)
    add_test(NAME tirocinium.fuzz_${name}_replay
             COMMAND fuzz_${name}_replay ${CMAKE_CURRENT_SOURCE_DIR}/corpus/${name})
  endif()
  if(TR_FUZZ)
    add_executable(fuzz_${name} fuzz_${name}.cpp)
    target_link_libraries(fuzz_${name} PRIVATE tr_app)
    target_link_options(fuzz_${name} PRIVATE -fsanitize=fuzzer)
    tr_lorica(fuzz_${name})
  endif()
endforeach()
