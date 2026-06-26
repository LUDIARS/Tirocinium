#!/bin/bash
# Tirocinium 起動ランチャー (macOS)
#
# Finder からダブルクリックすると Terminal が開いてこのスクリプトが走る。
# 旧 start-tirocinium.bat (Windows) の Mac 版。中身は `npm run dev` (= scripts/dev.mjs) に委譲し、
# ポート掃除 → migrate → seed → server/desktop 起動までを一括で面倒見る。
#
# 終了は Ctrl-C。dev.mjs がプロセスツリーごと kill する。

set -euo pipefail

# スクリプトの置き場所 = リポジトリルートへ移動 (ダブルクリック時の CWD はホームになるため)
cd "$(dirname "$0")"

# node / npm の存在確認 (GUI 起動時は PATH が最小なので分かりやすく出す)
if ! command -v npm >/dev/null 2>&1; then
  echo "npm が見つかりません。Node.js をインストールしてください: https://nodejs.org/"
  echo "Enter キーで閉じます。"
  read -r _
  exit 1
fi

# 依存が無ければ入れる (clone 直後のダブルクリックでも動くように)
if [ ! -d node_modules ]; then
  echo "[start] node_modules が無いので npm install します..."
  npm install
fi

echo "[start] Tirocinium dev を起動します (停止は Ctrl-C)"
npm run dev
