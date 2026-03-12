# Logicly Chat (急了么)

Realtime debate and discussion workspace with voice, text, transcription, and AI analysis.

一个支持语音、文字、实时转录和 AI 分析的实时辩论/讨论工作台。

## English

### Overview

Logicly Chat is a realtime room-based discussion product. Users can join the same room for voice communication, text discussion, live transcription, AI analysis, and final summaries.

### Features

- User registration, login, room creation, and room joining
- Realtime text chat and LiveKit-based voice communication
- Realtime transcription with multiple providers:
  - `deepgram`
  - `dashscope`
- Separate account-level settings for:
  - LiveKit transport
  - transcription provider keys
  - default transcription provider
  - analysis LLM
- Room owner can end a room; ended rooms become read-only
- AI realtime analysis and final summary generation
- Optional speaker switch mode for self debate on one device

### Configuration Notes

- Copy `.env.example` to `.env` before starting
- `USER_PROVIDER_KEYS_MODE` controls how runtime credentials are resolved:
  - `false`: room voice always uses platform LiveKit. When realtime transcription is enabled, it also uses the platform transcription provider selected by `TRANSCRIPTION_PROVIDER`. User-saved LiveKit and transcription keys do not participate in room voice startup.
  - `true`: room voice prefers a complete user-owned bundle from the room owner. If the owner has a complete LiveKit bundle and, when realtime transcription is enabled, valid credentials for their own default transcription provider, voice uses that user bundle. Otherwise it falls back to the complete platform voice bundle. The room runtime still chooses one source for the whole voice bundle and never mixes platform and user voice credentials.
  - `full`: room voice requires a complete user-owned bundle from the room owner. Platform voice fallback is disabled, so the owner must save LiveKit credentials and, when realtime transcription is enabled, valid credentials for their own default transcription provider.
- Analysis LLM follows the same `false` / `true` / `full` fallback pattern.
- User-managed settings are split by responsibility:
  - LiveKit transport: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  - transcription providers: `DEEPGRAM_API_KEY`, `DASHSCOPE_API_KEY`
  - analysis LLM: `CONVERSATION_LLM_OPENAI_BASE_URL`, `CONVERSATION_LLM_OPENAI_API_KEY`, `CONVERSATION_LLM_OPENAI_MODEL`


### Start

```bash
pnpm install
pnpm prisma generate
pnpm prisma db push --accept-data-loss
pnpm dev
```

## 中文说明

### 简介

急了么是一个房间制的实时讨论产品。用户可以在同一个房间里进行语音交流、文字讨论、实时转录、AI 分析和最终总结。

### 功能介绍

- 用户注册、登录、创建房间、加入房间
- 实时文字聊天和基于 LiveKit 的语音通话
- 支持多实时转录平台：
  - `deepgram`
  - `dashscope`
- 账户级配置按职责拆分：
  - LiveKit 通话配置
  - 转录平台 Key
  - 默认转录工具
  - 分析 LLM 配置
- 房主可以结束房间；结束后房间进入只读状态
- 支持 AI 实时分析和最终总结
- 支持单设备自辩场景下的说话方切换模式

### 配置注意事项

- 启动前先复制 `.env.example` 为 `.env`
- `USER_PROVIDER_KEYS_MODE` 决定运行时凭据如何解析：
  - `false`：房间语音始终只用平台 LiveKit；如果开启实时转录，还会使用 `TRANSCRIPTION_PROVIDER` 指定的平台转录工具。用户自己保存的 LiveKit 和转录 Key 不会参与房间语音启动。
  - `true`：房间语音优先使用房主自己的完整语音组合。如果房主已经保存完整的 LiveKit 配置，并且在开启实时转录时也为自己的默认转录工具保存了有效凭据，就使用用户组合；否则回退到完整的平台语音组合。整个房间语音运行时仍然只会选择一个来源，不会混用平台和用户的语音凭据。
  - `full`：房间语音必须使用房主自己的完整语音组合，不允许平台语音回退。所以房主必须保存 LiveKit 配置，并且在开启实时转录时也必须为自己的默认转录工具保存有效凭据。
- 分析 LLM 与语音遵循同样的 `false` / `true` / `full` 回退模式：
- 用户配置按职责拆分保存：
  - LiveKit 通话配置：`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`
  - 转录平台：`DEEPGRAM_API_KEY`、`DASHSCOPE_API_KEY`
  - 分析 LLM：`CONVERSATION_LLM_OPENAI_BASE_URL`、`CONVERSATION_LLM_OPENAI_API_KEY`、`CONVERSATION_LLM_OPENAI_MODEL`


### 启动方式

```bash
pnpm install
pnpm prisma generate
pnpm prisma db push --accept-data-loss
pnpm dev
```
