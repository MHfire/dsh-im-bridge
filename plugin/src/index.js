/**
 * dsh-im-bridge — 企业微信智能机器人 ⇄ DSH Agent 桥接插件。
 *
 * 按 DeepSeek Harness 插件标准实现:
 *  - name / Config(zod) / apply(ctx, config) 标准形态, 通过 cordis.patch.yml 挂载;
 *  - 挂进 web profile: 消息在【进程内】通过 agents.create() 创建 Agent,
 *    per-sender 持久会话(同一企业微信用户复用同一会话, 有上下文记忆);
 *  - 会话与 GUI 同进程注册 → 在 Web GUI 中实时可见(顺带根治 repair 污染活日志问题);
 *  - 流式事件经 replyStream 推送动画/简报; 生命周期由 dsh 统一管理。
 *
 * 启动优化: @wecom/aibot-node-sdk(约 114ms 导入 + 建连初始化)延迟到 loader settle 之后
 * 动态加载, 避免拖慢主进程启动关键路径。
 *
 * 旧版 bridge.js(外部 spawn `dsh --profile headless`)保留在 im-bridge/ 根目录作回退。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { startThinking, sendFinal, truncate, footerOf, fmtDuration } from './wecom.js'

/** 稳定插件名 */
export const name = 'im-bridge'

/** 依赖的核心服务 */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

/** 插件配置(zod): 敏感项由 profile 层 patch 提供 */
export const Config = z.object({
  botId: z.string().required().role('secret'),
  secret: z.string().required().role('secret'),
  /** Agent 的工作目录(会话 cwd) */
  workspace: z.string().default(process.cwd()),
  /** 允许的发送者 userid 白名单; 空 = 允许所有人 */
  allowFrom: z.array(String).default([]),
  /** 占位提示语 */
  startHint: z.string().default('🧠 正在思考...'),
  /** 动画进度条/剩余估算的超时基准 */
  agentTimeoutSec: z.number().default(600),
  /** Agent 加入的 preset(web profile 下默认 standard) */
  agentPreset: z.string().default('standard'),
  /** 覆盖默认 persona 的文本(可选; 为空用 preset 自带) */
  persona: z.string().default(''),
  /** 从文件读取 persona(可选; 优先于 persona 字段, 便于维护长文本) */
  personaFile: z.string().default(''),
  /** 回复上限(字节) */
  maxReplyBytes: z.number().default(20000),
})

/** 收集一次 turn 内最后一条 assistant 文本与结束原因 */
function summarize(events, firstSeq) {
  let started = false
  let text = ''
  let reason
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') { started = true; continue }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** 读取 persona: personaFile 优先, 其次 persona 字段 */
function resolvePersona(config) {
  if (config.personaFile) {
    try {
      return readFileSync(config.personaFile, 'utf8')
    } catch (e) {
      console.error(`[im-bridge] 读取 personaFile 失败: ${e.message}`)
    }
  }
  return config.persona
}

export function apply(ctx, config) {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || sessions === undefined || defaultModel === undefined) {
    throw new Error('im-bridge: 需要 agents/sessions/agentDefaultModel 服务')
  }

  // per-sender 持久会话状态: sender -> { agent, sessionId, queue, lastActivity }
  const senders = new Map()
  const persona = resolvePersona(config)

  // ── 设置命名空间: 用户可在 GUI 插件配置页 / settings.yaml 覆盖字段(热生效) ──
  const settings = ctx.get('settings')
  let scope
  if (settings !== undefined) {
    scope = settings.register('im-bridge', Config, { base: { ...config } })
  }
  /** 有效配置: 默认值 → cordis patch(base) → 用户 settings.yaml, 热更新 */
  const cfg = () => scope?.value ?? config

  /** 创建(或复用)某发送者的 Agent(会话/上下文持久于进程内) */
  async function ensureAgent(sender) {
    let st = senders.get(sender)
    if (st !== undefined && st.agent !== undefined) return st
    const sessionId = SessionId(`session-${randomUUID()}`)
    const selection = defaultModel.currentSelection()
    // 有 preset roster 的部署(如 web profile)必须在 setup 里 mount,
    // 否则 agent 看不到任何工具(模型只能编造工具调用)。
    const presets = ctx.get('agentPresets')
    let resolvedId = cfg().agentPreset
    if (presets !== undefined) {
      resolvedId = (await presets.resolve(cfg().agentPreset)).id
    }
    const { agent } = await agents.create({
      sessionId,
      meta: { cwd: cfg().workspace, agentPreset: resolvedId },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        const selected = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
        if (presets !== undefined) await presets.mount(agentCtx, resolvedId)
        if (persona !== '') {
          agentCtx.inject(['systemPrompt'], (promptCtx) => {
            promptCtx.systemPrompt.section({
              name: 'deployment:persona', // 同名 scoped section 覆盖部署 persona(仅本 agent)
              order: 0,
              text: persona,
            })
          })
        }
      },
    })
    st = { agent, sessionId, queue: Promise.resolve(), lastActivity: '' }
    senders.set(sender, st)
    console.log(`[im-bridge] 为 ${sender} 创建会话 ${sessionId}`)
    return st
  }

  // 会话事件 → 真实活动状态(工具调用名), 让动画显示"正在做什么"
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tool/call') return
    for (const st of senders.values()) {
      if (st.sessionId === session.id) st.lastActivity = `🛠️ 正在执行 ${event.data.name}`
    }
  })

  // ── 企微 WebSocket: 延迟到 loader settle 后启动, 不占启动关键路径 ──
  void (async () => {
    await ctx.get('loader')?.await()
    const { default: AiBot } = await import('@wecom/aibot-node-sdk')

    /** 处理一条消息: 动画 → followup → 汇总 → 简报 */
    async function handle(frame, sender, content) {
      const st = await ensureAgent(sender)
      const startedAt = Date.now()
      const streamId = AiBot.generateReqId('stream')
      let stopThinking = null
      try {
        await ws.replyStream(frame, streamId, cfg().startHint, false)
        stopThinking = startThinking(ws, frame, streamId, startedAt, cfg().agentTimeoutSec, () => st.lastActivity || '')
      } catch (e) {
        console.error(`[im-bridge] 占位回复失败: ${e.message}`)
      }
      try {
        await st.agent.whenIdle()
        const firstSeq = st.agent.session.seq
        st.agent.followup(createUserMessage({
          content: [{ type: 'text', text: content }],
          source: { kind: 'user' },
        }))
        await st.agent.whenIdle()
        await sessions.flush(st.agent.session)
        const outcome = summarize(st.agent.session.events, firstSeq)
        if (stopThinking) stopThinking()
        const ms = Date.now() - startedAt
        const reply = truncate(outcome.text || '(agent 无输出)', (cfg().maxReplyBytes || 20000) - 200) + footerOf(ms)
        console.log(`[im-bridge] ${sender} 完成 (${Buffer.byteLength(reply, 'utf8')}B, ${fmtDuration(ms)})`)
        await sendFinal(ws, frame, streamId, reply)
      } catch (e) {
        if (stopThinking) stopThinking()
        const ms = Date.now() - startedAt
        console.error(`[im-bridge] agent 失败: ${e.message}`)
        try {
          await sendFinal(ws, frame, streamId, `处理失败: ${truncate(e.message, 400)}\n\n---\n❌ 耗时 ${fmtDuration(ms)}`)
        } catch (e2) {
          console.error(`[im-bridge] 错误回复也失败: ${e2.message}`)
        }
      }
    }

    const ws = new AiBot.WSClient({ botId: cfg().botId, secret: cfg().secret })

    ws.on('connected', () => console.log('[im-bridge] WebSocket 已连接'))
    ws.on('authenticated', () => console.log('[im-bridge] 认证成功, 等待消息...'))
    ws.on('disconnected', (r) => console.log(`[im-bridge] 断开: ${r}`))
    ws.on('reconnecting', (n) => console.log(`[im-bridge] 第 ${n} 次重连...`))
    ws.on('error', (e) => console.error(`[im-bridge] 错误: ${e.message}`))

    ws.on('message.text', (frame) => {
      const content = (frame.body?.text?.content || '').trim()
      if (!content) return
      const sender = frame.body?.sender?.userid || frame.body?.from?.userid || frame.body?.userid || 'unknown'
      if (cfg().allowFrom.length > 0 && !cfg().allowFrom.includes(sender)) {
        ws.replyStream(frame, AiBot.generateReqId('stream'), '无权访问本服务', true).catch(() => {})
        return
      }
      console.log(`[im-bridge] 收到 from=${sender}: ${content.slice(0, 100)}`)
      const st = senders.get(sender) ?? { queue: Promise.resolve() }
      senders.set(sender, st)
      st.queue = st.queue
        .then(() => handle(frame, sender, content))
        .catch((e) => console.error(`[im-bridge] 任务异常: ${e.message}`))
    })

    ws.on('event.enter_chat', (frame) => {
      const sender = frame.body?.from?.userid || 'unknown'
      console.log(`[im-bridge] 用户 ${sender} 进入会话`)
      ws.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: '👋 云PC 诊断助手已就绪。直接发消息即可让我诊断设备/服务状态。' },
      }).catch((e) => console.error(`[im-bridge] 欢迎语失败: ${e.message}`))
    })

    ws.connect()

    // 生命周期: dsh 关闭时断开企微连接
    ctx.on('dispose', () => {
      try { ws.close?.() } catch { /* 已关闭 */ }
    })
  })()
}
