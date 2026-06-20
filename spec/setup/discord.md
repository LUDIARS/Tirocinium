# Discord Bridge setup

Tr can run interview input/output through Discord when the server has a Discord bot token.

## Secret source — Excubitor secret-agent (推奨)

Discord bot token 等は **Excubitor secret-agent から起動時に取得**できる (env 不使用)。
`apps/server` は boot 時に `hydrateSecrets()` で service code `tirocinium` の以下を agent から引き、
`config.discord.*` に注入する (memory-only、 agent 不通時は下記 env 値に fallback):

```
TIROCINIUM_DISCORD_BOT_TOKEN, TIROCINIUM_DISCORD_GUILD_ID, TIROCINIUM_DISCORD_CATEGORY_ID,
TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS, TIROCINIUM_DISCORD_COMMAND_PREFIX
```

Excubitor 側で service `tirocinium` の Infisical マッピングを設定し、 Infisical に上記キーを入れる
(詳細は `spec/interface/notion/README.md` §3 / Excubitor `spec/secret-agent.md`)。`@tirocinium/secrets` 経由。

## Environment (agent を使わない場合の dev fallback)

agent 不使用なら従来通り env で渡す。 `apps/server` 起動前に設定:

```bat
set TIROCINIUM_DISCORD_BOT_TOKEN=<bot-token>
set TIROCINIUM_DISCORD_COMMAND_PREFIX=!tr
```

Optional:

```bat
set TIROCINIUM_DISCORD_GUILD_ID=<guild-id>
set TIROCINIUM_DISCORD_CATEGORY_ID=<category-id-for-mtg-rooms>
set TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS=<channel-id-1>,<channel-id-2>
```

The bot needs these Gateway intents enabled in the Discord Developer Portal:

- Server Members Intent is not required.
- Message Content Intent is required.
- Guild Messages and Guilds are used by the bridge.

## Commands

- `!tr text [target]` starts a text interview in the current channel.
- `!tr voice [target]` creates a Discord MTG voice channel and starts the interview flow.
- `!tr end` ends the active interview for the current channel.

After a session starts, Tr sends the first interviewer message. Non-command messages in that channel are treated as candidate answers until `!tr end`.

## 裏口 Bot B (卒業生面、 Bot A とは別管理)

裏口 (`spec/feature/web/backdoor.md`) は **本体/面接の Bot A とは別 token の Bot B** で動かす。
別 application/bot として Discord Developer Portal で作成し、 卒業生用サーバに招待する。
token 未設定なら Bot B は起動しない (裏口 API/view は Bot 無しでも動くが、 マジックリンク配布が無効)。

agent / env で渡すキー (`config.discordBackdoor.*` に注入される):

```bat
set TIROCINIUM_BACKDOOR_BOT_TOKEN=<bot-b-token>
set TIROCINIUM_BACKDOOR_COMMAND_PREFIX=!ob
set TIROCINIUM_BACKDOOR_APP_BASE_URL=https://<裏口 view の公開ホスト>
```

Optional:

```bat
set TIROCINIUM_BACKDOOR_GUILD_ID=<guild-id>
set TIROCINIUM_BACKDOOR_TEXT_CHANNEL_IDS=<channel-id-1>,<channel-id-2>
set TIROCINIUM_BACKDOOR_LINK_TTL_MIN=15
set TIROCINIUM_BACKDOOR_SESSION_TTL_MIN=720
```

Bot B も Message Content Intent + Guild Messages + Guilds が必要。 DM 送信のため、 卒業生は
当該サーバ経由の DM を許可しておく (`!ob link` が DM でマジックリンクを送る)。

### Bot B commands

- `!ob link` : 裏口ページを開くワンタイムリンクを DM で受け取る
- `!ob company <社名>` / `!ob students <本文>` / `!ob industry <本文>` : 各項目を投稿
- `!ob name <表示名>` / `!ob hide students|industry` / `!ob show` / `!ob delete`

## Current voice boundary

Voice mode currently creates the MTG room only. Discord voice receive/send is not wired into `@tirocinium/voice` yet, so answers continue through text in the same Discord channel.

The next implementation step is:

1. Join the created voice channel as the bot.
2. Receive user audio frames from Discord voice.
3. Convert audio into the PCM format expected by `SessionRuntime` `audio_chunk`.
4. Send interviewer responses back as TTS audio, or keep text fallback when TTS is unavailable.
