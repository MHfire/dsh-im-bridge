[中文](./README.md) | English

# @mhfire/dsh-im-bridge

WeCom AI Bot ⇄ DeepSeek Harness Agent bridge — a **DSH plugin**.

Creates Agents **in-process** inside a dsh profile (no child-process spawn): per-sender durable sessions (the same WeCom user reuses one session with memory), sessions registered with the Web GUI (live view and continue-chat), plus a Settings → Plugins card (`botId` / `secret`, allow-list, timeouts, copy, and model overrides, written to `settings.yaml`).

The Host half registers the `im-bridge` namespace through `installSettingsSection`. The browser half contributes a card into `settings.plugin.item` under `key: im-bridge`. The card can set `botId` / `secret` on the same user layer as the profile patch. Live fields such as `startHint` apply on the next message; changing credentials still requires a process restart to open the WebSocket.

## Compatible DeepSeek Harness versions

DeepSeek Harness is still a developer preview and makes **no semver compatibility promise** to out-of-tree plugins. Package 0.2.0 is aligned to published tags by the APIs it actually calls:

| DSH | This package |
|---|---|
| [0.1.0-rc.8](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8), [0.1.1-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1), [0.1.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) | Compatible (developed against the 0.1.1-rc.2 line) |
| [0.1.0-rc.7](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7) and earlier | Not compatible. rc.7 already has the plugin settings-card slot and `dsh plugin add`, but the browser has no `settingsScope.describe()`, so the card and the credential “Configured” badges fail |
| Newer RCs / untagged HEAD | Not guaranteed. After upgrading dsh, re-check the Settings card and the WeCom connection |

Pin `dsh` to `0.1.0-rc.8` or later, for example `npx @deepseek-ai/dsh@0.1.1-rc.2 web`. Do not rely on a floating `latest`.

## Install

### Recommended: npm package

```powershell
dsh plugin --profile web add @mhfire/dsh-im-bridge
# Or pin a version:
# dsh plugin --profile web add @mhfire/dsh-im-bridge@0.2.0
```

In `$DSH_HOME/profiles/web/cordis.patch.yml` (or your profile), supply credentials only (other fields ship as bundle defaults and can be overridden):

```yaml
- id: im-bridge
  config:
    botId: "<your BotID>"
    secret: "<your Secret>"
    # optional: workspace / personaFile / … — see Configuration below
```

Restart dsh to apply (e.g. `dsh web` / `pnpm dsh web`).

### Optional: local development

Install from this repo’s `plugin/` directory or a `file:` path:

```powershell
dsh plugin --profile web add <package-path>
```

If `botId` / `secret` are missing, the plugin still loads (does not block `dsh web`); logs warn that WeCom connect is skipped. You can also fill them on the Settings plugin card (see the next section).

## Settings plugin card

After the plugin is installed and `dsh web` is running, open **Settings → Plugins → Plugin configuration** and expand **WeCom Bridge** (same card chrome as Shell / Agent loop / Web search). **Save** writes the user layer of `settings.yaml`, the same layer as the profile `cordis.patch.yml`. **Discard** drops unsaved drafts. Fields marked **Overridden** can be **Reset** to the bundle default.

Fields, top to bottom:

| Card control | Config key | After save |
|---|---|---|
| Bot ID / Secret | `botId` / `secret` | Badge becomes “Configured”; a **process restart** is required to open the WebSocket. Inputs are password fields; stored literals never ride the wire. A **blank save does not clear** a stored credential |
| Allowed sender userids | `allowFrom` | Applies on the next message; comma-separated, empty = allow everyone |
| Task timeout (seconds) | `agentTimeoutSec` | Applies on the next message |
| Placeholder while thinking | `startHint` | Applies on the next message |
| Denied-sender reply | `deniedMessage` | Applies on the next message |
| Welcome message | `welcomeMessage` | Applies on the next message |
| WeCom-only provider / model | `provider` / `model` | Applies only to **later new** sender sessions; both must be set to override, otherwise the GUI default model is used |

`workspace`, `agentPreset`, `persona` / `personaFile`, `thinking`, `maxReplyBytes`, and `reasoningEffort` are not on the card; set them in the profile patch or the table below. This release does not hot-reconnect credentials.

## Configuration

The bundle `cordis.patch.yml` supplies defaults for every field except `botId` / `secret`. Full field list:

| Field | Description |
|---|---|
| `botId` / `secret` | WeCom AI Bot credentials (`role('secret')`, redacted in UI); when empty, WeCom side is skipped and the host keeps running |
| `workspace` | Agent working directory (session cwd) |
| `allowFrom` | Allowed sender userids; empty = allow everyone |
| `agentTimeoutSec` | Max seconds per task; also drives progress / ETA |
| `startHint` | Placeholder text when processing starts |
| `agentPreset` | Agent preset to mount (default `standard`) |
| `provider` / `model` | WeCom-only model; **both must be non-empty** to override, otherwise follow the GUI `agent-default-model`. Filling only one warns and falls back. Editable in Settings; applies to later new sender sessions only |
| `reasoningEffort` | Optional effort when the WeCom override is in effect; ignored otherwise |
| `persona` / `personaFile` | Bot persona; precedence: `personaFile` → `persona` → packaged default (zh/en via Host `locale.preference`); overrides do not follow language; do not commit secrets |
| `maxReplyBytes` | Reply size cap in bytes (default 20000) |
| `deniedMessage` | Reply when the sender is not on `allowFrom` (editable in Settings) |
| `welcomeMessage` | Welcome text on `enter_chat` (editable in Settings) |
| `thinking` | Streaming animation. Precedence: tool activity (`toolLabels`) > model stream phase (`reasoningStatus` / `outputStatus` from `assistant/chunk`) > timed `phases` fallback; also `spin` / `reasoningSpin` / `outputSpin` / `eggs` |

To give WeCom a different model from the GUI, set both in the profile `cordis.patch.yml`:

```yaml
- id: im-bridge
  config:
    provider: deepseek-official
    model: deepseek-reasoner
```

Behavior:

1. `reasoning-delta` → rotating “model thinking” copy + `reasoningSpin`
2. `text-delta` → rotating “writing reply” copy + `outputSpin`
3. `tool/call` → `activityPrefix` + friendly label; brief done/fail after `tool/result`
4. No chunks yet → timed `phases` (unrelated to whether the model is reasoning)

```yaml
thinking:
  intervalMs: 1500
  reasoningStatus:
    - '💭 Model thinking…'
  outputStatus:
    - '✍️ Writing reply…'
  toolLabels:
    pwsh: PowerShell
```

## Persona

Precedence: `personaFile` → `persona` string → packaged default persona.

- **Packaged defaults**: [`persona.default.md`](./persona.default.md) (Chinese) / [`persona.default.en.md`](./persona.default.en.md) (English). Chosen from Host settings `locale.preference` (`zh`|`en`); **falls back to Chinese when unset** (the Host cannot see a browser-only provisional locale). Re-read on each assemble so a Settings language change applies on the next request.
- **Overrides do not follow language**: a set `personaFile` / non-empty `persona` always wins.

**Recommended override**: place `persona.md` next to `cordis.patch.yml` under `$DSH_HOME/profiles/<name>/`, and point `personaFile` at it with an absolute path (relative paths resolve against process cwd):

```yaml
- id: im-bridge
  config:
    personaFile: 'C:\\Users\\you\\.dsh\\profiles\\web\\persona.md'
```

Or copy [`persona.example.md`](./persona.example.md) as a fill-in template. Supports `{{model}}` / `{{cwd}}`. Do not commit secret-bearing persona files. Welcome / deny / thinking copy remain Chinese config strings and do not follow locale yet.

## Security

- Do not commit secret-bearing files such as `config.json` / `persona.md`
- Session and tool output may contain adversarial text; the plugin’s safety prompt tells the agent not to treat tool output as instructions

## License

MIT
