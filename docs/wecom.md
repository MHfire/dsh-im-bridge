# 企业微信渠道接入说明（dsh-im-bridge）

> 本文档说明 `dsh-im-bridge` 的**企业微信（WeChat Work / 企微）渠道**如何工作与接入。
> 项目定位为多渠道 IM 桥接：当前实现企业微信，未来可扩展飞书等渠道（各渠道独立文件，如 `wecom.js`、未来的 `feishu.js`）。

## 渠道概览

```
企业微信用户
   │  WebSocket 长连接 (wss://openws.work.weixin.qq.com)
   ▼
dsh-im-bridge 插件 (挂进 dsh profile)
   │  进程内 agents.create() → DSH Agent（按企微窗口拆分会话）
   ▼
replyStream 流式回复（阶段动画 + 进度条 + 最终简报）
```

- 采用企业微信「**智能机器人**」的 **WebSocket 长连接**模式：无需公网 URL、无需消息加解密、无需 IP 白名单，内网机器可直连；
- SDK 自动完成认证（botId + secret）、心跳保活、断线指数退避重连；
- 插件在 dsh 进程内创建 Agent，会话与 Web GUI 同进程注册 → 企微对话在 GUI 实时可见、可续聊。侧栏标题带「企微·私聊/群」渠道前缀；在 GUI 归档该会话后，同一窗口的下一条消息会开一条新会话。开启 `wecomCli.enabled` 且配置了非空 `wecomCli.allowFrom` 后，企微 Agent 可调用官方 wecom-cli 办公命令；`wecomcli-*` 装在 `$DSH_HOME/wecom-cli-skills`，只注入办公单聊 Agent。不要用 `npx skills add -g`；skills CLI 没有 `--dir`。

## 一、创建智能机器人（一次性）

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. **应用管理 → 智能机器人 → 创建智能机器人**，填写名称/头像
3. 记录凭证（**Secret 只显示一次，立即保存**）：`BotID` 与 `Secret`

## 二、接入插件

在 dsh profile（如 web）中配置（示例见根 README「快速开始」）：

```yaml
- id: im-bridge
  config:
    botId: "<你的 BotID>"
    secret: "<你的 Secret>"
    workspace: "<Agent 工作目录>"
    personaFile: "<绝对路径>/persona.md"
    allowFrom: []              # 可选：发送者白名单
    agentTimeoutSec: 1800      # 可选：单任务超时（秒）
    startHint: "🧠 已收到，正在处理..."
```

重启 dsh 进程后，企业微信给机器人发消息即可使用。

## 三、消息流转与回复

1. **收到文本消息** → 同一发送者复用同一会话（有上下文记忆），消息串行处理；
2. **进程内执行** → 通过 `agents.create()` 创建 Agent，工具链与 GUI 一致（沙箱/审批/技能）；
3. **流式回复** → `replyStream` 推送：
   - 阶段动画（按用时切换：理解需求 → 整理任务 → 查找资料 → 处理 → 思考方案 → 收尾）+ 旋转表情；
   - 进度条 + 百分比 + 剩余时间估算（基于 `agentTimeoutSec`）；
   - 长任务彩蛋文案（办公助手人设）；
4. **最终简报** → 完成时附耗时与速度评价（⚡ 神速 / 🚀 正常 / 🐢 较长），失败附错误信息；若回复含工作区 PNG 的 Markdown，随后再发独立图片消息。

## 四、人设（persona）

`persona.md` 即机器人「人设」（系统提示词），决定回答身份与规则；模板见 `plugin/persona.example.md`。
支持 `{{model}}` / `{{cwd}}` 占位符。含敏感信息，勿入库。

## 五、已知限制

- v1 仅处理**入站文本**（图片/语音/文件会忽略）；出站可将回复 Markdown 中的工作区 PNG 上传后作为独立图片发出
- 回复上限约 **20KB**（企微 `replyStream` 上限 20480 字节），超出截断；
- 旧版 `bridge.js`（每条消息 spawn 独立 `dsh --profile headless` 进程）保留作回退，`config.json` 启动时读取一次。
- 可选 wecom-cli 办公能力须显式开启且 `wecomCli.allowFrom` 非空；`wecomcli-*` 装在 `$DSH_HOME/wecom-cli-skills`（Settings 卡片一键安装），工作区残留仍会泄漏给 GUI；凭证每机一份，企微通道没有 GUI 审批框。

## 六、后续渠道规划

- 项目为渠道无关命名（`dsh-im-bridge`），企业微信为第一渠道；
- 新渠道（如飞书）在 `plugin/src/` 新增对应渠道文件（如 `feishu.js`），复用同一 Agent/人设/流式框架。

## 参考

- 企业微信智能机器人官方 SDK 文档：`docs/aibot-node-sdk-README.md`
- 官方 SDK 仓库：<https://github.com/WecomTeam/aibot-node-sdk>
