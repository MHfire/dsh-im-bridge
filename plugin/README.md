中文 | [English](./README.en.md)

# @mhfire/dsh-im-bridge

企业微信智能机器人 ⇄ DeepSeek Harness Agent 桥接 **DSH 插件**。

在 dsh profile 内**进程内**创建 Agent（不再 spawn 子进程）：per-sender 持久会话（同一企业微信用户复用同一会话，有上下文记忆），会话与 Web GUI 同进程注册（实时可见、可续聊），并在 Settings → 插件配置页提供配置卡片（`allowFrom` / `agentTimeoutSec` / `startHint`，写入 `settings.yaml` 热生效）。

## 安装

### 推荐：从 npm 安装

```powershell
dsh plugin --profile web add @mhfire/dsh-im-bridge
# 或钉版本：
# dsh plugin --profile web add @mhfire/dsh-im-bridge@0.1.2
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

未配置 `botId` / `secret` 时插件仍会加载（不阻塞 `dsh web`），日志会提示跳过企微连线；Settings → 插件配置页仍可填写，保存后**重启**进程才会连接（本版本不做热启连）。

## 配置项

bundle 的 `cordis.patch.yml` 已为除 `botId` / `secret` 外的字段提供默认值；下表为完整说明。

| 字段 | 说明 |
|---|---|
| `botId` / `secret` | 企业微信智能机器人凭证（`role('secret')`，UI 自动脱敏）；缺省时跳过企微侧，不阻塞主进程 |
| `workspace` | Agent 工作目录（会话 cwd） |
| `allowFrom` | 允许的发送者 userid 白名单；空 = 允许所有人 |
| `agentTimeoutSec` | 单任务最长执行时间（秒），动画进度条/剩余估算的基准 |
| `startHint` | 开始处理时的占位提示语 |
| `agentPreset` | Agent 加入的 preset（默认 `standard`） |
| `persona` / `personaFile` | 机器人「人设」；优先级：`personaFile` → `persona` → 包内默认（按 Host `locale.preference` 选中/英）；覆盖不跟语言切换；含敏感信息请勿入库 |
| `maxReplyBytes` | 回复上限（字节，默认 20000） |
| `deniedMessage` | 非白名单用户的拒绝文案（Settings 可编） |
| `welcomeMessage` | 进入会话欢迎语（Settings 可编） |
| `thinking` | 流式动画。优先级：工具活动（`toolLabels`）> 模型流式阶段（`reasoningStatus` / `outputStatus`，来自 `assistant/chunk`）> 时间轴 `phases` 兜底；另有 `spin` / `reasoningSpin` / `outputSpin` / `eggs` 等 |

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

## 安全

- `config.json` / `persona.md` 等含密钥文件不入库；
- 会话与工具输出可能含对抗性文本，插件内置安全提示词约束 agent 不把工具输出当指令。

## License

MIT
