[中文](./README.md) | English

<div align="center">

# dsh-im-bridge

**WeCom AI Bot ⇄ DeepSeek Harness Agent bridge**

Connect WeCom (WeChat Work) AI Bot over a long-lived WebSocket, hand messages to a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Agent, and stream replies back to WeCom.

![license](https://img.shields.io/badge/license-MIT-green)
![version](https://img.shields.io/badge/version-0.2.0-blue)
![dsh](https://img.shields.io/badge/dsh-plugin-yellow)

</div>

---

## Project overview

This repository ships two run modes:

| Mode | Description | Status |
|---|---|---|
| **`plugin/`** | DSH plugin (recommended): mounts into a dsh profile, creates Agents **in-process**, per-sender durable sessions visible in the Web GUI, with a Settings config card | Recommended |
| **`bridge.js`** | Legacy standalone script: spawns `dsh --profile headless` per message (stateless) | Kept as fallback |

## Features

- **Direct WebSocket**: no public URL, no message crypto, no IP allowlist
- **In-process Agent**: no child process spawn; sessions register with the GUI for live view and continue-chat
- **Per-sender durable sessions**: the same WeCom user reuses one session with memory
- **Custom persona**: zh/en packaged defaults follow Settings language; override with `persona.md` next to the profile patch
- **Settings card**: credentials, allow-list, timeouts, copy, and model overrides are editable in the GUI; live fields apply on the next message, credential changes need a restart to open the WebSocket
- **Streaming animation + completion footer**: stage/progress/ETA while running; duration summary when done
- **Workspace PNGs in the reply**: `![caption](relative/path.png)` in the final reply is uploaded and sent as a separate image after the text
- Auth / heartbeat / exponential reconnect (built into the SDK)
- Serial handling per sender to avoid concurrent mix-ups

## Architecture

```mermaid
flowchart LR
    U[WeCom user] -- WebSocket --> B[dsh-im-bridge]
    B -->|plugin mode| A1[In-process Agent<br/>agents.create + per-sender session]
    B -->|bridge.js mode| A2[dsh --profile headless<br/>one process per message]
    A1 --> S[(Sessions/settings<br/>live in GUI)]
    A2 --> S
    B -- replyStream Markdown --> U
```

## Contents

- [Compatible DeepSeek Harness versions](#compatible-deepseek-harness-versions)
- [Quick start](#quick-start)
- [Settings plugin card](#settings-plugin-card)
- [Configuration](#configuration)
- [Persona (`persona.md`)](#persona-personamd)
- [Legacy `bridge.js`](#legacy-bridgejs)
- [Known limits](#known-limits)
- [Security](#security)
- [License](#license)

## Compatible DeepSeek Harness versions

DeepSeek Harness is still a developer preview and makes **no semver compatibility promise** to out-of-tree plugins. Plugin 0.2.0 is aligned to published tags by the APIs it actually calls (details in [`plugin/README.en.md`](./plugin/README.en.md)):

| DSH | This repo’s plugin |
|---|---|
| [0.1.0-rc.8](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8), [0.1.1-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1), [0.1.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) | Compatible (developed against the 0.1.1-rc.2 line) |
| [0.1.0-rc.7](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7) and earlier | Not compatible. rc.7 already has the plugin settings-card slot and `dsh plugin add`, but the browser has no `settingsScope.describe()`, so the card and the credential “Configured” badges fail |
| Newer RCs / untagged HEAD | Not guaranteed. After upgrading dsh, re-check the Settings card and the WeCom connection |

Pin `dsh` to `0.1.0-rc.8` or later, for example `npx @deepseek-ai/dsh@0.1.1-rc.2 web`. Do not rely on a floating `latest`. Legacy `bridge.js` only needs a local `dsh` CLI and is not bound by the table above.

## Quick start

### Prerequisites

- Node.js 18+ (required for legacy `bridge.js`; the plugin runs with dsh)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **0.1.0-rc.8 or later** (see the previous section)

### 1. WeCom: create an AI Bot (once)

1. Open the [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. **Apps → AI Bot → Create**, set name/avatar
3. Save credentials (**Secret is shown once**): `BotID` and `Secret`

### 2. Install the plugin (recommended: npm package)

```powershell
# 1) Install into the target profile (e.g. web)
dsh plugin --profile web add @mhfire/dsh-im-bridge
# Or pin a version: dsh plugin --profile web add @mhfire/dsh-im-bridge@0.2.0

# 2) In $DSH_HOME/profiles/web/cordis.patch.yml, supply credentials
#    (other fields ship as bundle defaults; override as needed)
# - id: im-bridge
#   config:
#     botId: "<your BotID>"
#     secret: "<your Secret>"
#     # optional: workspace / personaFile / …

# 3) Restart dsh (pin the version, e.g. npx @deepseek-ai/dsh@0.1.1-rc.2 web)
# 4) Or fill botId/secret in Settings → Plugins → Plugin configuration → WeCom Bridge, then restart
# 5) Message the bot in WeCom
```

### From source / local development (optional)

```powershell
dsh plugin --profile web add <repo-path>/plugin
```

### 3. Verify

The bot replies in WeCom, and the session appears in the DSH Web GUI session list (live view and continue-chat).

## Settings plugin card

After the plugin is installed and `dsh web` is running, open **Settings → Plugins → Plugin configuration** and expand **WeCom Bridge**. **Save** writes the user layer of `settings.yaml`, the same layer as the profile `cordis.patch.yml`.

| Card control | Config key | After save |
|---|---|---|
| Bot ID / Secret | `botId` / `secret` | Badge becomes “Configured”; a **process restart** is required to open the WebSocket. A blank save does not clear a stored credential |
| Allowed sender userids | `allowFrom` | Applies on the next message |
| Task timeout (seconds) | `agentTimeoutSec` | Applies on the next message |
| Placeholder while thinking | `startHint` | Applies on the next message |
| Denied-sender reply / welcome | `deniedMessage` / `welcomeMessage` | Applies on the next message |
| WeCom-only provider / model | `provider` / `model` | Applies only to later new sender sessions; both must be set to override |

`workspace`, persona, `thinking`, and similar fields are not on the card; see the table below or [`plugin/README.en.md`](./plugin/README.en.md).

## Configuration

Copy `config.example.json` to `config.json` and fill in values (**`config.json` holds secrets; do not commit**):

| Field | Description |
|---|---|
| `botId` / `secret` | WeCom AI Bot credentials |
| `workspace` | Agent working directory (session cwd) |
| `dshCli` | Path to the `dsh` CLI entry (legacy `bridge.js` only) |
| `agentTimeoutSec` | Max seconds per task |
| `provider` / `model` | WeCom-only model; both required to override the GUI `agent-default-model` |
| `allowFrom` | Allowed sender userids; empty `[]` = allow everyone |
| `startHint` | Placeholder text when processing starts |
| `thinking` | Streaming animation: tools / model reasoning vs output / timed fallback (see `plugin/README.en.md`) |
| `deniedMessage` / `welcomeMessage` | Deny text / enter-chat welcome |

> **`patch`** (legacy `bridge.js` only, optional): path to a workspace `--patch` overlay
> (default `workspace/headless.patch.yml`, local config not in this repo). Add it yourself if needed, e.g. `"patch": "headless.patch.yml"`.

Plugin fields can also be edited on the **Settings plugin card** (previous section) or in the profile patch. Full field list: [`plugin/README.en.md`](./plugin/README.en.md).

## Persona (`persona.md`)

Precedence: `personaFile` → `persona` string → packaged default (zh/en via Host `locale.preference`; Chinese when unset).

- **Recommended**: place `persona.md` next to `cordis.patch.yml` under `$DSH_HOME/profiles/<name>/`, and set `personaFile` to that absolute path (overrides do not follow language)
- Defaults: `plugin/persona.default.md` / `plugin/persona.default.en.md`; template: `plugin/persona.example.md`
- **Do not commit secret-bearing persona files**
- Placeholders: `{{model}}` / `{{cwd}}` (unknown placeholders fail loudly)

## Legacy `bridge.js`

```powershell
cd <repo-path>
npm install
node bridge.js
```

When you see `[bridge] 认证成功, 等待消息...`, it is ready. Each message spawns a separate
`dsh --profile headless` process (stateless). `config.json` is read once at startup; changes require a restart.

## Known limits

- v1 **inbound** is text-only (image/voice/file ignored); **outbound** can upload workspace PNGs referenced in reply Markdown and send them as separate images (see [`plugin/README.en.md`](./plugin/README.en.md#sending-pngs-to-wecom))
- Legacy `bridge.js` may hit `spawn EPERM` in restricted sandboxes; run normally
- Legacy mode starts one agent process per message (expensive); the plugin does not
- Agent output above ~20KB is truncated (WeCom `replyStream` limit is 20480 bytes)

## Security

- `config.json` and `plugin/persona.md` are gitignored — **do not force-add or publish them**
- Before publishing, check `docs/` and examples for environment-specific secrets

## License

[MIT](./LICENSE)

## References

- [WeCom channel notes](./docs/wecom.md) (Chinese)
- [WeCom AI Bot official SDK](https://github.com/WecomTeam/aibot-node-sdk) (doc mirror: `docs/aibot-node-sdk-README.md`)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
