# Discord Bridge setup

Tr can run interview input/output through Discord when the server has a Discord bot token.

## Environment

Set these variables before starting `apps/server`.

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

## Current voice boundary

Voice mode currently creates the MTG room only. Discord voice receive/send is not wired into `@tirocinium/voice` yet, so answers continue through text in the same Discord channel.

The next implementation step is:

1. Join the created voice channel as the bot.
2. Receive user audio frames from Discord voice.
3. Convert audio into the PCM format expected by `SessionRuntime` `audio_chunk`.
4. Send interviewer responses back as TTS audio, or keep text fallback when TTS is unavailable.
