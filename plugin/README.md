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
| `persona` / `personaFile` | 机器人「人设」（系统提示词）；`personaFile` 优先，含敏感信息请勿入库 |
| `maxReplyBytes` | 回复上限（字节，默认 20000） |

## 人设（persona）

`persona.md` 是机器人的「人设」：角色与行为规范，作为系统提示词注入每个会话。
复制 `persona.example.md` 为 `persona.md` 后填写；支持 `{{model}}` / `{{cwd}}` 占位符。
该文件可能含环境凭据，已被仓库 `.gitignore` 排除，请勿提交。

## 安全

- `config.json` / `persona.md` 等含密钥文件不入库；
- 会话与工具输出可能含对抗性文本，插件内置安全提示词约束 agent 不把工具输出当指令。

## License

MIT
