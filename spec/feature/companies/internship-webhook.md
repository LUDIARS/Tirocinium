# 毎朝のインターン情報とDiscord Webhook

Actio: `0662baee-da77-4b33-9962-b00d06467d05`。
necoの依頼: VANMACでTrを起動し、ゲームメーカーズや就職サイトのインターン情報を毎朝探し、Discord Webhookで通知する。

## 設定と反映

秘密は既存secret-agent / 暗号化configで設定し、URLをソース・ログ・台帳に保存しない。

| キー | 値 |
|---|---|
| COMPANY_JOB_NEWS_ENABLED | `1`で定期収集（既定無効） |
| COMPANY_JOB_NEWS_DAILY_HOUR | `0..23`、既定6 |
| COMPANY_JOB_NEWS_TIME_ZONE | IANA timezone、既定Asia/Tokyo |
| COMPANY_JOB_NEWS_DISCORD_WEBHOOK_URL | Discordのincoming webhook URL |

実装だけでは通知を有効化しない。Webhookと運用時刻の決定、migration 027、VANMACへの反映・Excubitor起動・実送信確認が残る。
起動時に有効な定期収集の時刻/タイムゾーン/指定されたWebhookを検証する。
Webhook未設定時は既存のWeb収集/Nuntius運用を維持する。Webhook設定時はNuntiusへの二重配信をしない。

## 収集と配信

- [ゲームメーカーズRSS](https://gamemakers.jp/feed/)を追加。2026-10-08にRSS応答とrobotsを確認。
- [キャリタスのゲーム業界インターン一覧](https://job.career-tasu.jp/intern-search/lst-industryL-800000/lst-industryM-802000/lst-industryS-802020/)を追加。
  公開ページとrobotsを同日に確認。既存の礼節fetch層でrobots、間隔、SSRF制約を適用し、ログインや応募はしない。
- RSSの採用判定と求人抽出にインターン・仕事体験・オープンカンパニーを追加する。
  Webhook対象はタイトル/雇用形態/短い説明に該当語があるもの。一般求人もWebでは従来通り表示する。
- 投稿はタイトル・企業・職種・締切（掲載情報）・情報源・URLのみ。記事本文を転載しない。
  メンションと埋め込みを無効にし、締切不明や募集状況は掲載元での確認を案内する。
  フィード記事が募集終了を反映しない場合もあるため、情報の現行性を保証しない。
- 求人一覧の取得に一部でも失敗した場合、前回snapshotを削除しない。

## 日次実行と重複防止

`company-research` が収集・選別・配送台帳を所有する。設定は `service-runtime`。
日次取得は指定timezoneの日付をDBへ原子的にclaimし、プロセス再起動や複数workerでも同日に再実行しない。
予定時刻後の起動なら当日分を取得する。途中失敗・プロセス終了時の当日分は自動再実行せず、次の日に進む。

Webhook台帳はsnapshotの行IDではなくdedup_keyを主キーにし、求人の削除・再掲載と独立する。
未配送・明確なHTTP4xx拒否の候補を新着順に最大500件取得し、1件ずつ最大100件送信する。
明確なYYYY-MM-DDの締切はJSTの当日末として扱い、過去なら送信しない。
送信前の原子的claimで並行配送を排除し、成功はsent、4xxはfailed、通信断・5xxはunknownとする。
failedは次回収集時に再試行可能。1件失敗した時点でその回の配信を止める（429への即時再送を避ける）。
sendingのままクラッシュしたものとunknownは、Discord側の配送結果を人間が確認するまで再送しない。
台帳に秘密URLや本文は持たず、dedup_key/state/更新時刻のみを保持する。
同じ求人の別チャンネルへの再配信や、送信済み求人の更新通知は本実装の対象外。

## 検証

timezone境界、投稿文字数、通知対象、秘密URLの検証、HTTP成功/拒否/結果不明をテストケース化。
実送信・マイグレーション・サービス起動テストは人間の実行許可を得て本体フォルダからExcubitor経由で行う。
