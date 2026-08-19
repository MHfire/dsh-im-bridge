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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { startThinking, sendFinal, truncate, footerOf, fmtDuration, DEFAULT_THINKING, labelTool, pickStatusLine, streamPhaseFromChunk } from './wecom.js'

/** 包根目录(与 persona.default*.md 同级) */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 包内中文默认人设 */
const DEFAULT_PERSONA_ZH = join(PACKAGE_ROOT, 'persona.default.md')
/** 包内英文默认人设 */
const DEFAULT_PERSONA_EN = join(PACKAGE_ROOT, 'persona.default.en.md')
/** Host settings 中与 dsh-client-locale 一致的语言命名空间 */
const LOCALE_SETTINGS_NS = 'locale'

/** 稳定插件名 */
export const name = 'im-bridge'

/** 依赖的核心服务 */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

const ThinkingPhase = z.object({
  atSec: z.number(),
  text: z.string(),
})

const ThinkingConfig = z.object({
  phases: z.array(ThinkingPhase).default(DEFAULT_THINKING.phases),
  spin: z.array(String).default(DEFAULT_THINKING.spin),
  eggs: z.array(String).default(DEFAULT_THINKING.eggs),
  eggAfterSec: z.number().default(DEFAULT_THINKING.eggAfterSec),
  intervalMs: z.number().default(DEFAULT_THINKING.intervalMs),
  activityPrefix: z.string().default(DEFAULT_THINKING.activityPrefix),
  /** 工具名 → 友好显示名; 与内置表合并, 同名覆盖 */
  toolLabels: z.dict(String).default(DEFAULT_THINKING.toolLabels),
  /** 模型推理阶段状态行(轮换) */
  reasoningStatus: z.array(String).default(DEFAULT_THINKING.reasoningStatus),
  /** 模型正文输出阶段状态行(轮换) */
  outputStatus: z.array(String).default(DEFAULT_THINKING.outputStatus),
  reasoningSpin: z.array(String).default(DEFAULT_THINKING.reasoningSpin),
  outputSpin: z.array(String).default(DEFAULT_THINKING.outputSpin),
})

/** 插件配置(zod): 敏感项由 profile 层 patch 或 Settings 提供；缺省时跳过企微连线，不阻塞主进程 */
export const Config = z.object({
  botId: z.string().default('').role('secret'),
  secret: z.string().default('').role('secret'),
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
  /** 企微专用 provider; 与 model 同时非空才覆盖 GUI 共享的 agent-default-model */
  provider: z.string().default(''),
  /** 企微专用 model; 与 provider 同时非空才生效 */
  model: z.string().default(''),
  /** 覆盖生效时可选的推理强度; provider/model 未覆盖时忽略 */
  reasoningEffort: z.string().default(''),
  /** 覆盖包内默认人设的文本(可选; 为空且无 personaFile 时按 locale 选默认文件) */
  persona: z.string().default(''),
  /** 从文件读取人设(可选; 优先于 persona; 不跟语言切换; 推荐与 profile 的 cordis.patch.yml 同目录) */
  personaFile: z.string().default(''),
  /** 回复上限(字节) */
  maxReplyBytes: z.number().default(20000),
  /** 流式思考动画素材(阶段/表情/彩蛋等); 可在 profile patch 覆盖 */
  thinking: ThinkingConfig.default(DEFAULT_THINKING),
  /** 非白名单用户的拒绝文案 */
  deniedMessage: z.string().default('无权访问本服务'),
  /** 用户进入会话时的欢迎语 */
  welcomeMessage: z.string().default('👋 办公助手已就绪。直接发消息即可，例如查文件、整理文档、查资料或处理日常事务。'),
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

/**
 * 读 Host `locale.preference`(`zh`|`en`); 缺失或未知时回退 `zh`
 * (与客户端 FALLBACK_LOCALE 一致; 未显式选择时 Host 不知浏览器实际语言)。
 * @param {{ get?: (ns: string) => unknown } | undefined} settings
 * @returns {'zh' | 'en'}
 */
function readLocalePreference(settings) {
  if (settings?.get === undefined) return 'zh'
  try {
    const section = settings.get(LOCALE_SETTINGS_NS)
    const pref = section && typeof section === 'object' && 'preference' in section
      ? section.preference
      : undefined
    return pref === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/**
 * 去掉文件开头连续的 `# …` 行与紧随空行(仅用于包内默认人设维护说明)。
 * 不对用户 personaFile 调用: 用户可能故意用 `#` 作标题。
 * @param {string} text
 * @returns {string}
 */
function stripLeadingHashComments(text) {
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && /^\s*#/.test(lines[i])) i++
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i).join('\n')
}

/**
 * 读取人设: personaFile → persona 字符串 → 包内默认(按 locale.preference 选 zh/en)
 * @param {z.infer<typeof Config>} config
 * @param {{ get?: (ns: string) => unknown } | undefined} settings
 */
function resolvePersona(config, settings) {
  if (config.personaFile) {
    try {
      return readFileSync(config.personaFile, 'utf8')
    } catch (e) {
      console.error(`[im-bridge] 读取 personaFile 失败: ${e.message}`)
    }
  }
  if (config.persona !== '') return config.persona
  const file = readLocalePreference(settings) === 'en' ? DEFAULT_PERSONA_EN : DEFAULT_PERSONA_ZH
  try {
    return stripLeadingHashComments(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`[im-bridge] 读取默认人设失败: ${e.message}`)
    return ''
  }
}

/**
 * 解析新会话的模型: provider 与 model 都非空时用企微自己的一对(可带 reasoningEffort),
 * 否则回退 GUI 共享的 agent-default-model。只填一项视为未覆盖并告警, 避免半残选择。
 * @param {z.infer<typeof Config>} config
 * @param {{ currentSelection: () => { provider: string, model: string, reasoningEffort?: string } }} defaultModel
 * @returns {{ provider: string, model: string, reasoningEffort?: string }}
 */
function resolveSelection(config, defaultModel) {
  const provider = config.provider.trim()
  const model = config.model.trim()
  if (provider !== '' && model !== '') {
    const effort = config.reasoningEffort.trim()
    return effort === '' ? { provider, model } : { provider, model, reasoningEffort: effort }
  }
  if (provider !== '' || model !== '') {
    console.warn('[im-bridge] provider/model 需同时填写才覆盖企微模型, 已回退 agent-default-model。')
  }
  return defaultModel.currentSelection()
}

export function apply(ctx, config) {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || sessions === undefined || defaultModel === undefined) {
    throw new Error('im-bridge: 需要 agents/sessions/agentDefaultModel 服务')
  }

  // ── 设置命名空间: 用户可在 GUI 插件配置页 / settings.yaml 覆盖字段(热生效) ──
  // 规范做法(与 @deepseek-ai/dsh-settings 的 installSettingsSection 一致):
  // 用 ctx.inject(['settings'], cb) 延迟到 settings 服务可用时再注册,
  // 避免 apply 时 settings 尚未挂载导致命名空间缺失(GUI 卡片显示"命名空间不可用")。
  // 缺凭证时仍注册, 便于在 Settings 补齐后再重启启用企微。
  let scope
  /** @type {{ get: (ns: string) => unknown } | undefined} */
  let settings
  ctx.inject(['settings'], (sctx) => {
    settings = sctx.settings
    scope = sctx.settings.register('im-bridge', Config, { base: { ...config } })
  })
  /** 有效配置: 默认值 → cordis patch(base) → 用户 settings.yaml, 热更新 */
  const cfg = () => scope?.value ?? config

  // ── 企微 WebSocket: 延迟到 loader settle 后启动, 不占启动关键路径 ──
  void (async () => {
    await ctx.get('loader')?.await()
    const { botId, secret } = cfg()
    if (!botId || !secret) {
      console.warn(
        '[im-bridge] 跳过启动: 缺少 botId/secret。请在 profile cordis.patch.yml 或 Settings → 插件配置中填写后重启。',
      )
      return
    }

    // per-sender 持久会话状态: sender -> { agent, sessionId, queue, lastActivity }
    const senders = new Map()

    /** 创建(或复用)某发送者的 Agent(会话/上下文持久于进程内) */
    async function ensureAgent(sender) {
      let st = senders.get(sender)
      if (st !== undefined && st.agent !== undefined) return st
      const sessionId = SessionId(`session-${randomUUID()}`)
      const selection = resolveSelection(cfg(), defaultModel)
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
          // 每次 assemble 再解析: 默认人设跟 Host locale.preference; 覆盖文件不跟切
          agentCtx.inject(['systemPrompt'], (promptCtx) => {
            promptCtx.systemPrompt.section({
              name: 'deployment:persona', // 同名 scoped section 覆盖部署 persona(仅本 agent)
              order: 0,
              text: () => resolvePersona(cfg(), settings),
            })
          })
        },
      })
      st = {
        agent,
        sessionId,
        queue: Promise.resolve(),
        lastActivity: '',
        activityClearAt: 0,
        lastToolByCallId: new Map(),
        modelStreamPhase: 'idle',
        streamStatusTick: 0,
      }
      senders.set(sender, st)
      console.log(`[im-bridge] 为 ${sender} 创建会话 ${sessionId}`)
      return st
    }

    // 优先级: 工具活动 > 模型流式阶段(reasoning/output) > 时间轴 phases
    ctx.on('session/event', (session, event) => {
      const thinking = cfg().thinking
      const prefix = thinking?.activityPrefix ?? DEFAULT_THINKING.activityPrefix
      const flashMs = Number.isFinite(thinking?.intervalMs) && thinking.intervalMs > 0
        ? thinking.intervalMs
        : DEFAULT_THINKING.intervalMs
      for (const st of senders.values()) {
        if (st.sessionId !== session.id) continue
        if (event.type === 'assistant/chunk') {
          const next = streamPhaseFromChunk(event.data.chunk)
          if (next !== null) st.modelStreamPhase = next
          continue
        }
        if (event.type === 'tool/call') {
          const name = event.data.name
          if (event.data.callId !== undefined) st.lastToolByCallId.set(event.data.callId, name)
          st.activityClearAt = 0
          st.lastActivity = `${prefix}${labelTool(name, thinking)}`
          return
        }
        if (event.type === 'tool/result') {
          const callId = event.data.message?.source?.callId
          const rawName = (callId !== undefined && st.lastToolByCallId.get(callId))
            || [...st.lastToolByCallId.values()].at(-1)
            || ''
          if (callId !== undefined) st.lastToolByCallId.delete(callId)
          const label = labelTool(rawName || '工具', thinking)
          const failed = event.data.error !== undefined
          st.lastActivity = failed ? `❌ ${label} 失败` : `✅ ${label} 完成`
          st.activityClearAt = Date.now() + flashMs
          st.modelStreamPhase = 'idle'
        }
      }
    })

    const { default: AiBot, generateReqId } = await import('@wecom/aibot-node-sdk')

    /** 处理一条消息: 动画 → followup → 汇总 → 简报 */
    async function handle(frame, sender, content) {
      const st = await ensureAgent(sender)
      const startedAt = Date.now()
      const streamId = generateReqId('stream')
      let stopThinking = null
      st.lastActivity = ''
      st.activityClearAt = 0
      st.lastToolByCallId.clear()
      st.modelStreamPhase = 'idle'
      st.streamStatusTick = 0
      try {
        await ws.replyStream(frame, streamId, cfg().startHint, false)
        stopThinking = startThinking(
          ws, frame, streamId, startedAt, cfg().agentTimeoutSec,
          () => {
            if (st.activityClearAt > 0 && Date.now() >= st.activityClearAt) {
              st.lastActivity = ''
              st.activityClearAt = 0
            }
            if (st.lastActivity) return st.lastActivity
            const thinking = cfg().thinking
            const tick = st.streamStatusTick++
            if (st.modelStreamPhase === 'reasoning') {
              return pickStatusLine(
                thinking?.reasoningStatus,
                DEFAULT_THINKING.reasoningStatus,
                tick,
              )
            }
            if (st.modelStreamPhase === 'outputting') {
              return pickStatusLine(
                thinking?.outputStatus,
                DEFAULT_THINKING.outputStatus,
                tick,
              )
            }
            return ''
          },
          cfg().thinking,
          () => (st.lastActivity ? 'idle' : st.modelStreamPhase),
        )
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

    const ws = new AiBot.WSClient({ botId, secret })

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
        ws.replyStream(frame, generateReqId('stream'), cfg().deniedMessage, true).catch(() => {})
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
        text: { content: cfg().welcomeMessage },
      }).catch((e) => console.error(`[im-bridge] 欢迎语失败: ${e.message}`))
    })

    ws.connect()

    // 生命周期: dsh 关闭时断开企微连接
    ctx.on('dispose', () => {
      try { ws.close?.() } catch { /* 已关闭 */ }
    })
  })()
}
