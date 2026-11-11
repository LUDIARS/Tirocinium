#pragma once

namespace tr::app {

// プロセス全体の組み立て。SIGINT/SIGTERM で止まるまで戻らない。
int run_server(int argc, char** argv);

}  // namespace tr::app
