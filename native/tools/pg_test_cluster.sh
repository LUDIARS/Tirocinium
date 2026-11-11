#!/usr/bin/env bash
# テスト用の一時 Postgres クラスタ (利用者権限)。DB のテスト (pg_*) はこれを使う。
#   native/tools/pg_test_cluster.sh start [dir] [port]   → TR_TEST_DATABASE_URL を表示
#   native/tools/pg_test_cluster.sh stop  [dir]
# 本物の DB には接続しない。データは dir の中だけ。root で実行した場合は postgres 利用者で動かす
# (initdb は root を拒否するため)。
set -euo pipefail
cmd="${1:-start}"
port="${3:-55433}"
dir="${2:-/tmp/tirocinium-pg-test-$port}"
bin="${PG_BIN:-/usr/lib/postgresql/16/bin}"
as_pg=()
if [ "$(id -u)" = "0" ]; then
  as_pg=(runuser -u postgres --)
fi
case "$cmd" in
  start)
    if [ ! -f "$dir/PG_VERSION" ]; then
      mkdir -p "$dir"
      if [ "${#as_pg[@]}" -gt 0 ]; then chown postgres "$dir"; fi
      "${as_pg[@]}" "$bin/initdb" -D "$dir" -U tirocinium --auth=trust -E UTF8 --locale=C >/dev/null
    fi
    "${as_pg[@]}" "$bin/pg_ctl" -D "$dir" -o "-p $port -k $dir -c listen_addresses=127.0.0.1" -l "$dir/server.log" -w start >/dev/null
    psql -h 127.0.0.1 -p "$port" -U tirocinium -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='tirocinium_test'" | grep -q 1 \
      || psql -h 127.0.0.1 -p "$port" -U tirocinium -d postgres -c "CREATE DATABASE tirocinium_test" >/dev/null
    echo "TR_TEST_DATABASE_URL=postgres://tirocinium@127.0.0.1:$port/tirocinium_test"
    ;;
  stop)
    "${as_pg[@]}" "$bin/pg_ctl" -D "$dir" -m fast stop >/dev/null || true
    ;;
  reset)
    psql -h 127.0.0.1 -p "$port" -U tirocinium -d postgres -c "DROP DATABASE IF EXISTS tirocinium_test" >/dev/null
    psql -h 127.0.0.1 -p "$port" -U tirocinium -d postgres -c "CREATE DATABASE tirocinium_test" >/dev/null
    ;;
  *)
    echo "usage: $0 start|stop|reset [dir] [port]" >&2
    exit 2
    ;;
esac
