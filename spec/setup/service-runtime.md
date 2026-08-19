# サービスとしての起動と観測

Tirocinium を Excubitor 管理下のサービスとして起動し、版と死活を観測するための契約。
業務ロジック (面接 / 企業DB / 音声) はここでは扱わない。

## Excubitor catalog 断片

サービス定義の正本はリポ直下の `excubitor.catalog.yaml` で、Excubitor が
`${ARS_ROOT}` 配下を走査して集積する (`Excubitor/catalog/FRAGMENTS.md`)。
top-level は `services:` のみで、`project_versions` 等の全体設定は持てない。

| code | 役割 | port | command |
|---|---|---|---|
| `tirocinium` | backend | 8084 | `npm run dev:server` |
| `tirocinium-desktop` | frontend (Vite) | 5178 | `npm run dev:desktop` |

- port は `scripts/dev.mjs` の `SERVER_PORT` / `DESKTOP_PORT` と同じ値を宣言する。
  片方だけ変えると Excubitor の死活判定が別のポートを見に行くため、必ず対で変える。
- desktop は API/WS を同一オリジン (Vite proxy → server) で受ける。`VITE_SERVER_URL` /
  `VITE_WS_URL` に絶対 URL を入れるとブラウザがクロスオリジンになり CORS で弾かれるので、
  catalog では proxy の転送先 (`VITE_PROXY_TARGET`) だけを渡す。
- git worktree は catalog の探索対象外。断片の変更は本体 checkout の main に載って初めて効く。

## 版と死活の契約

正本は AIFormat `RULE_SRE.md` §2。

### SPEC-SERVICE-RUNTIME-VERSION

- **版の宣言先は `package.json` の `version`**。Excubitor は catalog の `cwd` にある
  package.json から版を解決し、`EXCUBITOR_SERVICE_VERSION` として子プロセスへ注入する
  (`Excubitor/src/process/service-version.ts`, SPEC-SERVICE-RUNTIME-VERSION)。

### SPEC-SERVICE-RUNTIME-HEALTH

- `GET /api/health` は `ok` / `service` / `version` の 3 フィールドを返す。版の解決順は
  `EXCUBITOR_SERVICE_VERSION` → `TIROCINIUM_SERVICE_VERSION` → `npm_package_version` →
  `'unknown'`。**版をコードにハードコードしない** — ディスク上の実体とずれると
  「注入した版」との突合が意味を失う。

### SPEC-SERVICE-RUNTIME-READINESS

- health を重くしない。DB / downstream HTTP / ファイル I/O / 外部プロセス / ロック取得を
  ハンドラに置かない (判定基準は「同期のまま返せること」)。依存の生死は
  `GET /api/readiness` が持ち、DB が落ちていれば 503 を返す。
- `GET /health` は移行期の alias。旧パスを見ている監視・スクリプトが無くなったら外す。
