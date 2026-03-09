# Logicly Chat(急了么)

A real-time AI debate/argument assist + analysis + summary platform, built with Next.js + LiveKit + Deepgram + PostgreSQL.

## Features

- User registration/login, room create/join, real-time voice communication, and text transcription
- Room creators can end a conversation; ended rooms become read-only (history visible, no more text/voice input)
- User-owned LiveKit/Deepgram keys are supported and stored encrypted in PostgreSQL
- User-owned OpenAI-compatible LLM settings are supported and stored separately for analysis
- Realtime AI analysis announcements and end-of-room AI summary (`mock` or OpenAI-compatible provider)

## Environment Variables

Copy `.env.example` to `.env`, then fill values based on comments.

Key settings:

- `USER_PROVIDER_KEYS_MODE`: `false | true | full`
  - `false`: only system/env keys are used, all user-saved credentials are ignored
  - `true`: user keys are preferred per provider group, with system fallback when that group is missing
  - `full`: only user keys are used, system keys are ignored for both voice and analysis
- `LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / DEEPGRAM_API_KEY`
  - Used as system keys for voice/transcription when `USER_PROVIDER_KEYS_MODE=false/true`
- `APP_ENCRYPTION_SECRET`
  - Used to encrypt user keys; must be a strong random string
- `CONVERSATION_LLM_PROVIDER`
  - `mock | openai-compatible`
- `CONVERSATION_LLM_OPENAI_BASE_URL / CONVERSATION_LLM_OPENAI_API_KEY / CONVERSATION_LLM_OPENAI_MODEL`
  - Platform default analysis LLM config for `CONVERSATION_LLM_PROVIDER=openai-compatible`
  - In `USER_PROVIDER_KEYS_MODE=true`, room owner LLM settings override these three fields independently from LiveKit/Deepgram
- `CONVERSATION_REALTIME_PROMPT_STYLE / CONVERSATION_SUMMARY_PROMPT_STYLE`
  - Select prompt style profiles for realtime analysis and final summary modes

## Local Development

```bash
pnpm install
pnpm prisma generate
pnpm prisma db push --accept-data-loss
pnpm dev
```

Dynamic worker behavior (enabled by default):

- Entering a room triggers a background warmup for the matching LiveKit transcriber worker
- Clicking "Start Voice" ensures worker readiness before token + dispatch
- If `LIVEKIT_TRANSCRIBER_ENABLED=false`, warmup/worker startup and transcription dispatch are skipped
- Text/transcript messages are enqueued into a shared analysis queue and consumed by a cross-room analysis worker
- Realtime analysis trigger uses debounce (`ANALYZER_REALTIME_DEBOUNCE_MS`, default 10000ms)

---

## 中文说明

急了么，一个实时的 AI 辩论/吵架辅助 + 分析 + 总结平台。  
技术栈：Next.js + LiveKit + Deepgram + PostgreSQL。

### 核心功能

- 用户注册/登录，创建/加入房间，实时语音通信和文字转录
- 创建者可结束对话；结束后房间只读（可看历史，不可发消息/语音）
- 支持用户保存自己的 LiveKit/Deepgram key（加密存 PostgreSQL）

### 环境变量

复制 `.env.example` 为 `.env`，按注释填写。

关键配置：

- `USER_PROVIDER_KEYS_MODE`：`false | true | full`
  - `false`：只用平台（env）key，忽略用户 key
  - `true`：优先用户 key，缺失时回退平台 key
  - `full`：只用用户 key，完全忽略平台 key
- `LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / DEEPGRAM_API_KEY`
  - 在 `USER_PROVIDER_KEYS_MODE=false/true` 时作为平台 key 使用
- `APP_ENCRYPTION_SECRET`
  - 用于加密用户 key，必须是高强度随机字符串

### 本地运行

```bash
pnpm install
pnpm prisma generate
pnpm prisma db push --accept-data-loss
pnpm dev
```

默认已支持动态 worker：

- 进入房间后会后台 warmup 对应 LiveKit 项目的 transcriber worker
- 点击“开启语音”时会确保 worker 就绪，再执行 token + dispatch
- 若 `LIVEKIT_TRANSCRIBER_ENABLED=false`，不会 warmup/启动 worker，也不会发起转写 dispatch
