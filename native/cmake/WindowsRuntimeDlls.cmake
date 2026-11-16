# Windows: 実行ファイルが読み込む外部 DLL (libpq とその依存、OpenSSL) をビルド時に実行ファイルの横へ置く。
# FindPostgreSQL / FindOpenSSL の imported target は import library (.lib) しか持たず
# TARGET_RUNTIME_DLLS では拾えないので、DLL を名前で探して POST_BUILD で複写する。
#
# 探す場所 (先に見つかったものを使う):
#   TR_RUNTIME_DLL_DIRS (任意の追加ディレクトリ)
#   libpq 系:   <libpq.lib の場所>/../bin   (PostgreSQL のインストール先の bin)
#   OpenSSL 系: <OpenSSL の include>/../bin (OpenSSL のインストール先の bin)
# OpenSSL は find_package(OpenSSL) が見つけたものと同じ版を置く (PostgreSQL 同梱の libssl は使わない)。
#
# tr_copy_runtime_dlls(<target>): <target> の出力ディレクトリへ DLL を複写する (Windows 以外は何もしない)。

set(TR_RUNTIME_DLL_DIRS "" CACHE PATH "Extra directories searched first for runtime DLLs (Windows)")

set(TR_RUNTIME_DLLS "")
if(WIN32)
  set(tr_pg_lib "${PostgreSQL_LIBRARY_RELEASE}")
  if(NOT tr_pg_lib)
    set(tr_pg_lib "${PostgreSQL_LIBRARY}")
  endif()
  cmake_path(GET tr_pg_lib PARENT_PATH tr_pg_libdir)
  cmake_path(GET tr_pg_libdir PARENT_PATH tr_pg_root)
  cmake_path(GET OPENSSL_INCLUDE_DIR PARENT_PATH tr_ssl_root)

  # <名前> <主に探す bin>
  set(tr_runtime_dll_specs
    "libpq.dll|${tr_pg_root}/bin"
    "libintl-9.dll|${tr_pg_root}/bin"
    "libiconv-2.dll|${tr_pg_root}/bin"
    "libssl-3-x64.dll|${tr_ssl_root}/bin"
    "libcrypto-3-x64.dll|${tr_ssl_root}/bin")
  set(tr_missing_dlls "")
  foreach(spec IN LISTS tr_runtime_dll_specs)
    string(REPLACE "|" ";" spec "${spec}")
    list(GET spec 0 dll_name)
    list(GET spec 1 dll_dir)
    string(MAKE_C_IDENTIFIER "TR_DLL_${dll_name}" dll_var)
    find_file(${dll_var} NAMES ${dll_name} PATHS ${TR_RUNTIME_DLL_DIRS} "${dll_dir}" NO_DEFAULT_PATH)
    if(${dll_var})
      list(APPEND TR_RUNTIME_DLLS "${${dll_var}}")
    else()
      list(APPEND tr_missing_dlls "${dll_name} (looked in ${dll_dir} ${TR_RUNTIME_DLL_DIRS})")
    endif()
  endforeach()
  if(tr_missing_dlls)
    list(JOIN tr_missing_dlls "\n  " tr_missing_dlls)
    message(FATAL_ERROR "Tirocinium: runtime DLLs not found (set TR_RUNTIME_DLL_DIRS):\n  ${tr_missing_dlls}")
  endif()
  message(STATUS "Tirocinium: runtime DLLs copied next to executables: ${TR_RUNTIME_DLLS}")
endif()

function(tr_copy_runtime_dlls target)
  if(NOT TR_RUNTIME_DLLS)
    return()
  endif()
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${TR_RUNTIME_DLLS} "$<TARGET_FILE_DIR:${target}>"
    VERBATIM)
endfunction()
