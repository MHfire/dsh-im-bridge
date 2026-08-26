[中文](./README.md) | English

# @mhfire/dsh-im-bridge

WeCom AI Bot ⇄ DeepSeek Harness Agent bridge — a **DSH plugin**.

Creates Agents **in-process** inside a dsh profile (no child-process spawn): one durable DSH session **per WeCom chat window** (1:1 = that user; everyone in the same group shares one session — a person’s DM and group chats stay separate), sessions registered with the Web GUI (live view and continue-chat), plus a Settings → Plugins card (`botId` / `secret`, allow-list, timeouts, copy, and model overrides, written to `settings.yaml`).

The Host half registers the `im-bridge` namespace through `installSettingsSection`. The browser half contributes a card into `settings.plugin.item` under `key: im-bridge`. The card can set `botId` / `secret` on the same user layer as the profile patch. Live fields such as `startHint` apply on the next message; changing credentials still requires a process restart to open the WebSocket.

## Session granularity

One DSH session maps to one WeCom chat window, not “every window of the same userid”:

- **1:1**: `single:<userid>` — one Agent for that user
- **Group**: `group:<chatid>` — all members share one Agent and one serial queue (two people speaking at once still cannot concurrent-`followup`)
- `allowFrom` filters **who may chat** by sender userid; empty = enqueue everyone. Office commands use `wecomCli.allowFrom` separately
- Leading `@nickname` mentions are stripped on arrival, so both the model input and the title read `测试一下` instead of `@MediaAgent 测试一下`. Mentions later in the text stay, and a message that is nothing but mentions goes to the model unchanged
- Process restart continues the same durable session via a stable `wecom-` + short hash of the key: adopt a live Agent if the process already has one (for example the browser already opened that row), `resume` from persistence otherwise, and `create` only when neither exists. Resume cwd / preset follow the archive, not the current config; a cwd mismatch logs a warning and is not rewritten.
- The GUI title is `企微·私聊` / `企微·群` plus the first user prompt (the same automatic title as other sessions), not a userid / chatid; two windows of the same kind with similar first lines stay two sidebar rows
- Archiving a WeCom session in the GUI ends that context: the next message silently starts a new session at `wecom-<hash>-2` (`-3` after another archive), with no extra WeCom notice. DSH has no unarchive API, so the archived session is merely no longer written to — it neither becomes visible again nor is deleted
- Every window still shares the same `workspace` (files / rag). That is environment isolation, separate from chat-context windows

## Compatible DeepSeek Harness versions

DeepSeek Harness is still a developer preview and makes **no semver compatibility promise** to out-of-tree plugins. Package 0.4.0 is aligned to published tags by the APIs it actually calls:

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
# dsh plugin --profile web add @mhfire/dsh-im-bridge@0.4.0
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
| WeCom-only provider / model | `provider` / `model` | Applies only to **later new** WeCom-window sessions; both must be set to override, otherwise the GUI default model is used |

`workspace`, `agentPreset`, `persona` / `personaFile`, `thinking`, `maxReplyBytes`, `reasoningEffort`, and `wecomCli` are not on the card; set them in the profile patch or the table below. This release does not hot-reconnect credentials; changing `wecomCli` also requires a process restart.

## Configuration

The bundle `cordis.patch.yml` supplies defaults for every field except `botId` / `secret`. Full field list:

| Field | Description |
|---|---|
| `botId` / `secret` | WeCom AI Bot credentials (`role('secret')`, redacted in UI); when empty, WeCom side is skipped and the host keeps running |
| `workspace` | Agent working directory (session cwd) |
| `allowFrom` | Chat allow-list; empty = everyone may ask. Does not gate wecom-cli |
| `agentTimeoutSec` | Max seconds per task; also drives progress / ETA |
| `startHint` | Placeholder text when processing starts |
| `agentPreset` | Agent preset to mount (default `standard`) |
| `provider` / `model` | WeCom-only model; **both must be non-empty** to override, otherwise follow the GUI `agent-default-model`. Filling only one warns and falls back. Editable in Settings; applies to later new WeCom-window sessions only |
| `reasoningEffort` | Optional effort when the WeCom override is in effect; ignored otherwise |
| `persona` / `personaFile` | Bot persona; precedence: `personaFile` → `persona` → packaged default (zh/en via Host `locale.preference`); overrides do not follow language; do not commit secrets |
| `maxReplyBytes` | Reply size cap in bytes (default 20000) |
| `deniedMessage` | Reply when the sender is not on `allowFrom` (editable in Settings) |
| `welcomeMessage` | Welcome text on `enter_chat` (editable in Settings) |
| `wecomCli` | Optional WeCom office skills (off by default). See the next section |
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

## WeCom office skills (wecom-cli)

The plugin depends on the official [`@wecom/cli`](https://www.npmjs.com/package/@wecom/cli) binary. Install `wecomcli-*` under **`$DSH_HOME/wecom-cli-skills`** (not workspace `.dsh/skills` / `.agents/skills`, and not `$DSH_HOME/skills`). The plugin `skills.register()`s that catalog only on the **office userid’s 1:1** agent; group chats that share an agent do not get it in this build. Other workspace skills stay on `skill-filesystem`. The model runs `wecom-cli` through the preset’s existing `pwsh` / `bash` tool; this plugin does not register a separate tool.

`wecomCli.enabled` is off by default. Turning PATH on requires a non-empty **`wecomCli.allowFrom`** (office userids). Root `allowFrom` only gates who may chat; empty means everyone may ask. An empty office list logs a warning and skips PATH / auth.

One-time setup:

1. Leave root `allowFrom` empty (everyone may ask) and put **office** userids in `wecomCli.allowFrom` (do not leave that empty)
2. In **Settings → Plugins → WeCom Bridge**, click **Install official skills** (the Host downloads the official repo zip into `$DSH_HOME/wecom-cli-skills`). **Do not** use `npx skills add -g` (it leaks into the GUI). The skills CLI has **no `--dir`**, so that flag does not write into the plugin directory. If `wecomcli-*` folders already sit in the workspace, move them here and delete the workspace copies. You can also copy official `skills/wecomcli-*` into `$DSH_HOME/wecom-cli-skills` by hand.

3. Enable it in the profile `cordis.patch.yml` (the plugin then writes wecom-cli credentials from the existing `botId` / `secret` via hidden `auth init --bot-id/--secret`; no QR scan and no `npm install -g @wecom/cli`):

```yaml
- id: im-bridge
  config:
    allowFrom: []
    wecomCli:
      enabled: true
      allowFrom: ["<office userid>"]
      # skillsDir: ''   # empty = $DSH_HOME/wecom-cli-skills
      # configDir: ''   # empty = <workspace>/.dsh/wecom-cli; gitignore this directory
```

| Field | Description |
|---|---|
| `wecomCli.enabled` | Wire PATH / auth / prompt for WeCom agents; default `false` |
| `wecomCli.allowFrom` | Userids allowed to run wecom-cli; empty skips PATH / auth. Independent of the chat list |
| `wecomCli.skillsDir` | Override skills root; empty = `$DSH_HOME/wecom-cli-skills` |
| `wecomCli.configDir` | Override the credential directory (`WECOM_CLI_CONFIG_DIR`); empty = `<workspace>/.dsh/wecom-cli`. Gitignore that directory. Once enabled, `~/.config/wecom` is unused. |

Changing `wecomCli` requires a process restart. Messages still arrive when unauthorized; at boot the plugin seeds credentials with hidden `--bot-id/--secret` (stderr is not a TTY). If automatic seeding fails, the log tells you to run `npx --yes @wecom/cli auth init --manual` on a host terminal (the same Bot ID / Secret; do not install globally). Credentials live in workspace `.dsh/wecom-cli/` (gitignore it), not `~/.config/wecom`. Do not run `auth init --noninteractive` from the agent (that creates a new bot).

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

## Sending PNGs to WeCom

If the agent’s final reply contains Markdown pointing at a **workspace** PNG, the bridge uploads it after the text stream finishes and sends it as a **separate image message** (`uploadMedia`, then `sendMediaMessage` with `media_id`).

Trigger (paths relative to `workspace`):

```markdown
![screenshot](main_screen.png)
[screenshot](out/frame.png)
```

- Only `.png`; `http(s):` / `data:` are ignored; the file must stay inside `workspace`
- Must be a real PNG (signature), at most **10MB** each, at most **10** images (first-seen order, deduped)
- Writing a PNG without that Markdown does **not** send it
- Images follow the text bubble; they are not inlined into the stream
- Inbound image / voice / file messages are still ignored

## Security

- Do not commit secret-bearing files such as `config.json` / `persona.md` / `.dsh/wecom-cli/`
- Session and tool output may contain adversarial text; the plugin’s safety prompt tells the agent not to treat tool output as instructions

## Known Limitations and Deferred Work

- wecom-cli credentials live in the workspace `<workspace>/.dsh/wecom-cli` (`WECOM_CLI_CONFIG_DIR`; gitignore it). Once enabled, `~/.config/wecom` is unused. People on `wecomCli.allowFrom` borrow that identity’s office permissions; the chat list (root `allowFrom`) does not grant office access. PATH stays process-wide and does not stop `pwsh wecom-cli`. The office catalog is registered only on the office 1:1 agent; group chats do not get it. This is not a sandbox.
- The WeCom channel has no GUI confirmation dialog. Irreversible actions (send mail, cancel a meeting, delete a todo, overwrite a document) are constrained only by the prompt (run `--dry-run` first, wait for the next user message). `ask_user_question` hangs until the task times out on this channel.
- Leftover `wecomcli-*` folders in workspace `.dsh/skills` / `.agents/skills` remain visible to every agent with that cwd, including GUI. Other skills are unchanged. `enabled: false` only turns off WeCom-side PATH / auth / prompt / registration.

## License

MIT
