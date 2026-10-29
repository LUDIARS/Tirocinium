// tirocinium-server: apps/server (Node) の C++ 版。起動順は Node 版と同じ
// (秘密の読み込み → 認証設定の検査 → 公開鍵の取得 → DB → HTTP/WS → 常駐処理)。

#include <exception>
#include <iostream>

#include "app/server_main.hpp"

int main(int argc, char** argv) {
    try {
        return tr::app::run_server(argc, argv);
    } catch (const std::exception& e) {
        std::cerr << "[tirocinium] fatal: " << e.what() << '\n';
        return 1;
    }
}
