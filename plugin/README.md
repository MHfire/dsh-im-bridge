# @mhfire/dsh-im-bridge

企业微信智能机器人 ⇄ DeepSeek Harness Agent 桥接 **DSH 插件**。

在 dsh profile 内**进程内**创建 Agent（不再 spawn 子进程）：per-sender 持久会话（同一企业微信用户复用同一会话，有上下文记忆），会话与 Web GUI 同进程注册（实时可见、可续聊），并在 Settings → 插件配置页提供配置卡片（`allowFrom` / `agentTimeoutSec` / `startHint`，写入 `settings.yaml` 热生效）。

## 安装

```powershell
dsh plugin --profile web add <本包路径>
```

在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: im-bridge
  config:
    botId: "<你的 BotID>"
    secret: "<你的 Secret>"
    workspace: "<Agent 工作目录>"
    personaFile: "<绝对路径>/persona.md"
```

重启 dsh 进程即可使用。

## 配置项

| 字段 | 说明 |
|---|---|
| `botId` / `secret` | 企业微信智能机器人凭证（`role('secret')`，UI 自动脱敏） |
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
