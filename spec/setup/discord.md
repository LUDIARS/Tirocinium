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

## 裏口 (卒業生/OB 面) — Discord Bot は無し

裏口 (`spec/feature/web/backdoor.md`) の認証は **Cernere に統一**した。 旧 Bot B (`!ob` / マジックリンク) は
撤去済み。 OB は裏口 view (`/backdoor`) に Cernere ログイン (`cernere_token` Bearer) して自己投稿・求人投稿・
ES 相談の引き受けを行う。 OB への到達通知は Nuntius (`NUNTIUS_URL` / `NUNTIUS_API_KEY`) で配送する。

`TIROCINIUM_BACKDOOR_*` の env / secret は不要になった (hydrate から除去済み)。

## Current voice boundary

Voice mode currently creates the MTG room only. Discord voice receive/send is not wired into `@tirocinium/voice` yet, so answers continue through text in the same Discord channel.

The next implementation step is:

1. Join the created voice channel as the bot.
2. Receive user audio frames from Discord voice.
3. Convert audio into the PCM format expected by `SessionRuntime` `audio_chunk`.
4. Send interviewer responses back as TTS audio, or keep text fallback when TTS is unavailable.
