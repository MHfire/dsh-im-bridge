[中文](./README.md) | English

# @mhfire/dsh-im-bridge

WeCom AI Bot ⇄ DeepSeek Harness Agent bridge — a **DSH plugin**.

Creates Agents **in-process** inside a dsh profile (no child-process spawn): per-sender durable sessions (the same WeCom user reuses one session with memory), sessions registered with the Web GUI (live view and continue-chat), plus a Settings → Plugins card (`allowFrom` / `agentTimeoutSec` / `startHint`, written to `settings.yaml` with hot reload).

## Install

### Recommended: npm package

```powershell
dsh plugin --profile web add @mhfire/dsh-im-bridge
# Or pin a version:
# dsh plugin --profile web add @mhfire/dsh-im-bridge@0.1.2
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

If `botId` / `secret` are missing, the plugin still loads (does not block `dsh web`); logs warn that WeCom connect is skipped. You can fill credentials in Settings → Plugins; **restart** is required to connect (this release does not hot-start the WebSocket).

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
| `persona` / `personaFile` | Bot persona; precedence: `personaFile` → `persona` → packaged default (zh/en via Host `locale.preference`); overrides do not follow language; do not commit secrets |
| `maxReplyBytes` | Reply size cap in bytes (default 20000) |
| `deniedMessage` | Reply when the sender is not on `allowFrom` (editable in Settings) |
| `welcomeMessage` | Welcome text on `enter_chat` (editable in Settings) |
| `thinking` | Streaming “thinking” animation: `phases` / `spin` / `eggs` / `eggAfterSec` / `intervalMs` / `activityPrefix`; override via profile patch (not the simple Settings card) |

Example `thinking.phases` override:

```yaml
thinking:
  intervalMs: 1500
  phases:
    - atSec: 0
      text: '🤔 Understanding your request…'
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
