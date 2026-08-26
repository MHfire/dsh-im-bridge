中文 | [English](./README.en.md)

# @mhfire/dsh-im-bridge

企业微信智能机器人 ⇄ DeepSeek Harness Agent 桥接 **DSH 插件**。

在 dsh profile 内**进程内**创建 Agent（不再 spawn 子进程）：按**企微窗口**拆分持久会话（单聊 = 该用户一条；同一群里所有人共用一条；同一个人的私聊和群聊互不串上下文），会话与 Web GUI 同进程注册（实时可见、可续聊），并在 Settings → 插件配置页提供配置卡片（`botId` / `secret`、白名单、超时、提示语、模型覆盖，写入 `settings.yaml`）。

Host 通过 `installSettingsSection` 注册 `im-bridge` 命名空间；浏览器半包以 `key: im-bridge` 挂进 `settings.plugin.item`。卡片可填 `botId` / `secret`，与 profile patch 写入同一用户层；改 `startHint` 等热字段后下一轮消息即生效，改凭证仍需重启进程才会连 WebSocket。

## 会话粒度

一条 DSH 会话对应一个企微聊天窗口，而不是「同一个 userid 的所有窗口」：

- **单聊**：`single:<userid>`，该用户一条 Agent
- **群聊**：`group:<chatid>`，群内所有人共用一条 Agent 和同一条串行队列（两人同时发也不会并发 `followup`）
- `allowFrom` 按**发送者** userid 拦截谁能聊天；空 = 所有人可进队。办公命令另用 `wecomCli.allowFrom`
- 群里 @机器人 的消息，开头的 `@昵称` 在入站就去掉：模型看到的和标题用的都是「测试一下」而不是「@MediaAgent 测试一下」；正文中间的 @某人 保留，整条只有 @ 时按原文交给模型
- 进程重启后用稳定 id `wecom-` + key 的短 hash 续上同一条会话：进程里已有活 Agent 就直接采用（例如浏览器已打开该行），存档里有就 `resume`，都没有才 `create`。resume 的 cwd / preset 跟存档，不跟当前配置；cwd 不一致时打警告，不改写。
- GUI 标题为「企微·私聊/群」+ 第一句用户话（与其它会话一样由 DSH 生成），不再露出 userid / chatid；同类型窗口若第一句话相近，侧栏仍是两行
- 在 GUI 里归档某条企微会话 = 结束那段上下文：下一条消息用 `wecom-<hash>-2`（再归档就 `-3`）静默开一条新会话，企微侧不额外提示。DSH 没有取消归档的接口，所以旧会话只是不再被本插件写入，既不会恢复可见也不会被删除
- 所有窗口仍共用同一个 `workspace`（文件 / rag 环境），与聊天上下文分窗是两件事

## 兼容的 DeepSeek Harness 版本

DeepSeek Harness 仍是 developer preview，对外置插件**没有 semver 兼容承诺**。本包 0.4.2 按实际调用的 API 对齐已发布 tag：

| DSH | 本包 |
|---|---|
| [0.1.0-rc.8](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8)、[0.1.1-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1)、[0.1.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) | 可适配（对照开发的是 0.1.1-rc.2 一线） |
| [0.1.0-rc.7](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7) 及更早 | 不可适配。rc.7 已有插件配置卡槽位和 `dsh plugin add`，但浏览器没有 `settingsScope.describe()`，配置卡加载和凭证「已配置」徽章会失败 |
| 更新的 RC / 未打 tag 的 HEAD | 未保证。升级 dsh 后请再验 Settings 卡和企微连线 |

建议把 `dsh` 钉在 `0.1.0-rc.8` 及以上，例如 `npx @deepseek-ai/dsh@0.1.1-rc.2 web`，不要只跑浮动的 `latest`。

## 安装

### 推荐：从 npm 安装

```powershell
dsh plugin --profile web add @mhfire/dsh-im-bridge
# 或钉版本：
# dsh plugin --profile web add @mhfire/dsh-im-bridge@0.4.2
```

在 `$DSH_HOME/profiles/web/cordis.patch.yml`（或对应 profile）中补密钥即可（其余项已有 bundle 默认，可按需覆盖）：

```yaml
- id: im-bridge
  config:
    botId: "<你的 BotID>"
    secret: "<你的 Secret>"
    # 可选：workspace / personaFile 等，见下方配置项
```

重启 dsh 进程即可使用（例如 `dsh web` / `pnpm dsh web`）。

### 备选：本地开发

从本仓库 `plugin/` 目录或 `file:` 路径安装：

```powershell
dsh plugin --profile web add <本包路径>
```

未配置 `botId` / `secret` 时插件仍会加载（不阻塞 `dsh web`），日志会提示跳过企微连线；也可在 Settings 插件配置卡填写（见下节）。

## Settings 插件配置卡

安装插件并启动 `dsh web` 后，打开 **设置 → 插件 → 插件配置**，展开 **企业微信桥接**（与「终端 / Agent 循环 / 网页搜索」同一组卡片）。改完点右下角 **保存** 写入 `settings.yaml` 用户层，与 profile `cordis.patch.yml` 同一层；**放弃** 丢掉未保存草稿。带「已覆盖」的字段可 **重置** 回 bundle 默认。

卡片字段自上而下：

| 卡片项 | 对应配置 | 保存后 |
|---|---|---|
| Bot ID / Secret | `botId` / `secret` | 徽章变为「已配置」；**须重启进程** 才会连 WebSocket。输入框为密码框，线上看不到已存字面值；**留空再保存不会清空**已存凭证 |
| 允许的发送者 userid | `allowFrom` | 下一轮消息生效；逗号分隔，空 = 允许所有人 |
| 单任务超时（秒） | `agentTimeoutSec` | 下一轮消息生效 |
| 开始处理时的占位提示 | `startHint` | 下一轮消息生效 |
| 非白名单拒绝文案 | `deniedMessage` | 下一轮消息生效 |
| 进入会话欢迎语 | `welcomeMessage` | 下一轮消息生效 |
| 企微专用 provider / model | `provider` / `model` | 只影响之后**新建**的企微窗口会话；须两项都填才覆盖，否则跟随 GUI 默认模型 |

`workspace`、`agentPreset`、`persona` / `personaFile`、`thinking`、`maxReplyBytes`、`reasoningEffort`、`wecomCli` 不在卡片上，仍在 profile patch 或下表中配置。本版本不做凭证热重连；改 `wecomCli` 也须重启进程。

## 配置项

bundle 的 `cordis.patch.yml` 已为除 `botId` / `secret` 外的字段提供默认值；下表为完整说明。

| 字段 | 说明 |
|---|---|
| `botId` / `secret` | 企业微信智能机器人凭证（`role('secret')`，UI 自动脱敏）；缺省时跳过企微侧，不阻塞主进程 |
| `workspace` | Agent 工作目录（会话 cwd） |
| `allowFrom` | 聊天白名单；空 = 允许所有人问诊断。不控制 wecom-cli |
| `agentTimeoutSec` | 单任务最长执行时间（秒），动画进度条/剩余估算的基准 |
| `startHint` | 开始处理时的占位提示语 |
| `agentPreset` | Agent 加入的 preset（默认 `standard`） |
| `provider` / `model` | 企微专用模型；**两者都非空**才覆盖，否则跟随 GUI 的 `agent-default-model`；只填一项会告警并回退。Settings 可编，只影响之后新建的企微窗口会话 |
| `reasoningEffort` | 覆盖生效时可选的推理强度；未覆盖模型时忽略 |
| `persona` / `personaFile` | 机器人「人设」；优先级：`personaFile` → `persona` → 包内默认（按 Host `locale.preference` 选中/英）；覆盖不跟语言切换；含敏感信息请勿入库 |
| `maxReplyBytes` | 回复上限（字节，默认 20000） |
| `deniedMessage` | 非白名单用户的拒绝文案（Settings 可编） |
| `welcomeMessage` | 进入会话欢迎语（Settings 可编） |
| `wecomCli` | 可选的企业微信办公能力（默认关闭）。见下一节 |
| `thinking` | 流式动画。优先级：工具活动（`toolLabels`）> 模型流式阶段（`reasoningStatus` / `outputStatus`，来自 `assistant/chunk`）> 时间轴 `phases` 兜底；另有 `spin` / `reasoningSpin` / `outputSpin` / `eggs` 等 |

企微与 GUI 使用不同模型时，在 profile `cordis.patch.yml` 同时填写：

```yaml
- id: im-bridge
  config:
    provider: deepseek-official
    model: deepseek-reasoner
```

`thinking` 行为：

1. 收到 `reasoning-delta` → 「模型思考中」类文案轮换 + `reasoningSpin`
2. 收到 `text-delta` → 「正在输出回复」类文案轮换 + `outputSpin`
3. `tool/call` → `activityPrefix` + 友好名；`tool/result` 短暂完成/失败后清空
4. 尚无 chunk 时 → 按秒数走 `phases`（与模型是否在推理无关）

```yaml
thinking:
  intervalMs: 1500
  reasoningStatus:
    - '💭 模型思考中…'
  outputStatus:
    - '✍️ 正在输出回复…'
  toolLabels:
    pwsh: PowerShell
```

## 企业微信办公能力（wecom-cli）

插件依赖官方 [`@wecom/cli`](https://www.npmjs.com/package/@wecom/cli) 二进制。`wecomcli-*` 装在 **`$DSH_HOME/wecom-cli-skills`**（不要装进工作区 `.dsh/skills` / `.agents/skills`，也不要装进 `$DSH_HOME/skills`）。插件只在**办公 userid 的单聊** Agent 上注入：`skills.register()` 装 catalog，`tools.register()` 装门控工具 `wecom_cli`。两者都走该 Agent 自己的 ctx，群聊与 GUI 看不到。工作区里其它 skill 仍由 `skill-filesystem` 发现，不受影响。

办公命令**只经 `wecom_cli` 工具执行**：模型传 `argv`（`wecom-cli` 之后的参数数组），插件直接 spawn 官方二进制，并拒绝任何 `auth init`。PATH 上的 `wecom-cli` 是一个只打印拒绝信息并 `exit 1` 的 shim，所以群聊、GUI 以及任何 `pwsh wecom-cli` 都跑不通；shim 的文案会指回 `wecom_cli`。凭证目录不进程级导出，只在插件自己 spawn 时注入。

`wecomCli.enabled` 默认关闭。开启须同时配置非空 **`wecomCli.allowFrom`**（办公 userid）；根级 `allowFrom` 只管谁能聊天，空名单表示所有人可问诊断。办公名单为空时插件会告警并跳过 shim / 授权 / `wecom_cli`。

一次性准备：

1. 根级 `allowFrom` 留空（所有人可问诊断），把 **办公** userid 写进 `wecomCli.allowFrom`（不要留空）
2. 在 **Settings → 插件配置 → 企业微信桥接** 点「安装官方 skills」（Host 下载官方仓库 zip，解到 `$DSH_HOME/wecom-cli-skills`）。**不要用** `npx skills add -g`（会泄漏给 GUI）；skills CLI **没有 `--dir`**，加了也不会写到程序目录。若工作区里已有 `wecomcli-*`，先挪到该目录再删工作区副本。也可手动把官方仓库 `skills/wecomcli-*` 拷进 `$DSH_HOME/wecom-cli-skills`。

3. 在 profile `cordis.patch.yml` 打开（启用后插件会用已有 `botId` / `secret` 走 `auth init --bot-id/--secret` 写入 wecom-cli 凭据，不必扫码、不必 `npm install -g @wecom/cli`）：

```yaml
- id: im-bridge
  config:
    allowFrom: []
    wecomCli:
      enabled: true
      allowFrom: ["<办公 userid>"]
      # skillsDir: ''   # 空 = $DSH_HOME/wecom-cli-skills
      # configDir: ''   # 空 = <workspace>/.dsh/wecom-cli；请 gitignore
```

| 字段 | 说明 |
|---|---|
| `wecomCli.enabled` | 装 PATH 拒绝 shim、跑授权检查、给企微 Agent 接上 prompt 与 `wecom_cli` 工具；默认 `false` |
| `wecomCli.allowFrom` | 能拿到 `wecom_cli` 工具的 userid；空则跳过 shim / 授权。与根级聊天名单独立 |
| `wecomCli.skillsDir` | 覆盖 skills 根目录；空 = `$DSH_HOME/wecom-cli-skills` |
| `wecomCli.configDir` | 覆盖凭证目录；空 = `<workspace>/.dsh/wecom-cli`。请把该目录加入 gitignore。`WECOM_CLI_CONFIG_DIR` 只在插件 spawn CLI 时注入，不写进程环境，因此不会使用 `~/.config/wecom`。 |

改 `wecomCli` 后须重启进程。未授权时插件仍收消息；启动时用隐藏的 `--bot-id/--secret`（stderr 非 TTY）写入凭据。若自动写入失败，日志会打印一条带 `WECOM_CLI_CONFIG_DIR` 的手动命令——必须带上它，否则 `npx --yes @wecom/cli auth init --manual` 会把凭证写到 `~/.config/wecom`，插件读不到。禁止在 Agent 里扫码 `auth init`（会新建机器人）。

## 人设（persona）

优先级：`personaFile` → `persona` 字符串 → 包内默认人设。

- **包内默认**：[`persona.default.md`](./persona.default.md)（中文）/ [`persona.default.en.md`](./persona.default.en.md)（英文）。按 Host settings `locale.preference`（`zh`|`en`）选择；**未显式选择时回退中文**（Host 看不到仅浏览器决定的语言）。每次 assemble 重新读取，Settings 改语言后下一轮请求生效。
- **覆盖不跟语言切换**：配置了 `personaFile` / 非空 `persona` 时始终用该内容。

**推荐覆盖方式**：在 `$DSH_HOME/profiles/<name>/` 与 `cordis.patch.yml` 同目录放置 `persona.md`，并在 profile patch 里用绝对路径指向它（相对路径相对进程 cwd，不宜依赖）：

```yaml
- id: im-bridge
  config:
    personaFile: 'C:\\Users\\you\\.dsh\\profiles\\web\\persona.md'
```

也可复制 [`persona.example.md`](./persona.example.md) 为模板后按环境填写。支持 `{{model}}` / `{{cwd}}` 占位符。含环境凭据的人设文件请勿提交。欢迎语 / 拒绝文案 / 思考动画文案目前仍为中文配置项，不随语言切换。

## 把 PNG 发到企业微信

Agent 的最终回复若包含指向**工作区内** PNG 的 Markdown，桥会在文字流结束之后，把图作为**独立图片消息**发出（先 `uploadMedia`，再用 `media_id` 调用 `sendMediaMessage`）。

触发写法（相对 `workspace`）：

```markdown
![屏幕截图](main_screen.png)
[屏幕截图](out/frame.png)
```

- 只认 `.png`；跳过 `http(s):` / `data:`；路径必须落在 `workspace` 内
- 文件须为真实 PNG（文件头），单张不超过 **10MB**，最多 **10** 张（按出现顺序去重）
- 只把 PNG 写到磁盘、回复里没有上述 Markdown，**不会**发图
- 图在文字气泡之后另发，不会嵌进同一条流式消息
- 入站图片/语音/文件消息仍忽略

## 安全

- `config.json` / `persona.md` / `.dsh/wecom-cli/` 等含密钥文件不入库；
- 会话与工具输出可能含对抗性文本，插件内置安全提示词约束 agent 不把工具输出当指令。

## Known Limitations and Deferred Work

- wecom-cli 凭证在工作区 `<workspace>/.dsh/wecom-cli`（请 gitignore）。`wecomCli.allowFrom` 里的人借用这份凭据的办公权限；聊天名单（根级 `allowFrom`）不授予办公。办公单聊仍可向任意 `--chat-id` 发信，插件不锁定收件人。
- 门控不是沙箱。`wecom_cli` 工具与 `wecomcli-*` 只注册到办公单聊 Agent，PATH 上的 `wecom-cli` 一律拒绝，凭证目录也只在插件自己 spawn 时注入；但同进程的 shell 仍可绕过：直接 `node <@wecom/cli 的 wecom.js 绝对路径>`，或 `npx --yes @wecom/cli` 并自行设置 `WECOM_CLI_CONFIG_DIR`。不设该变量时这类旁路会落到未授权的 `~/.config/wecom`。真正的隔离需要进程级沙箱。
- 企微通道没有 GUI 审批框：发信、取消会议、删待办、覆盖文档等不可逆操作只靠 prompt 约束（先 `--dry-run`，等用户下一条确认）。所有企微会话都禁止 `ask_user_question`（会挂到超时）。
- 工作区 `.dsh/skills` / `.agents/skills` 里残留的 `wecomcli-*` 仍会被同 cwd 的 GUI 和群聊发现。其它 skill 不受影响。`enabled: false` 只关拒绝 shim、授权检查、`wecom_cli` 与 wecomcli-* 注册；通道上的 `ask_user_question` 禁令仍会注入。

## License

MIT
