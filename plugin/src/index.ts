/**
 * dsh-im-bridge — WeCom AI bot ⇄ DSH Agent host plugin.
 *
 * Function-plugin shape (`name` / `inject` / `Config` / `apply`, no default
 * export). Messages create in-process Agents so per-sender sessions stay on
 * the same Loader tree as the Web GUI. Settings register through
 * `installSettingsSection`; live fields read `source()`, credentials still
 * require a process restart to open the WebSocket.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_THINKING,
  footerOf,
  fmtDuration,
  labelTool,
  pickStatusLine,
  sendFinal,
  startThinking,
  streamPhaseFromChunk,
  truncate,
  type ThinkingConfig,
} from './wecom.ts'

/** Package root (persona files live beside package.json). */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Built-in Chinese persona. */
const DEFAULT_PERSONA_ZH = join(PACKAGE_ROOT, 'persona.default.md')
/** Built-in English persona. */
const DEFAULT_PERSONA_EN = join(PACKAGE_ROOT, 'persona.default.en.md')
/** Host locale settings namespace (`dsh-client-locale`). */
const LOCALE_SETTINGS_NS = settingsNamespace('locale')

/** Settings namespace paired with the browser card. */
export const IM_BRIDGE_NS = settingsNamespace('im-bridge')

/** Cordis diagnostic name. */
export const name = 'im-bridge'

/** Required host services. */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

const ThinkingPhase = z.object({
  atSec: z.number(),
  text: z.string(),
})

const ThinkingSchema = z.object({
  phases: z.array(ThinkingPhase).default(DEFAULT_THINKING.phases),
  spin: z.array(String).default(DEFAULT_THINKING.spin),
  eggs: z.array(String).default(DEFAULT_THINKING.eggs),
  eggAfterSec: z.number().default(DEFAULT_THINKING.eggAfterSec),
  intervalMs: z.number().default(DEFAULT_THINKING.intervalMs),
  activityPrefix: z.string().default(DEFAULT_THINKING.activityPrefix),
  toolLabels: z.dict(String).default(DEFAULT_THINKING.toolLabels),
  reasoningStatus: z.array(String).default(DEFAULT_THINKING.reasoningStatus),
  outputStatus: z.array(String).default(DEFAULT_THINKING.outputStatus),
  reasoningSpin: z.array(String).default(DEFAULT_THINKING.reasoningSpin),
  outputSpin: z.array(String).default(DEFAULT_THINKING.outputSpin),
})

/** Plugin config: secrets come from the profile patch or Settings. */
export interface Config {
  botId: string
  secret: string
  workspace: string
  allowFrom: string[]
  startHint: string
  agentTimeoutSec: number
  agentPreset: string
  provider: string
  model: string
  reasoningEffort: string
  persona: string
  personaFile: string
  maxReplyBytes: number
  thinking: ThinkingConfig
  deniedMessage: string
  welcomeMessage: string
}

/** Schemastery schema for the composition entry and settings namespace. */
export const Config: z<Config> = z.object({
  botId: z.string().default('').role('secret'),
  secret: z.string().default('').role('secret'),
  workspace: z.string().default(process.cwd()),
  allowFrom: z.array(String).default([]),
  startHint: z.string().default('🧠 正在思考...'),
  agentTimeoutSec: z.number().default(600),
  agentPreset: z.string().default('standard'),
  provider: z.string().default(''),
  model: z.string().default(''),
  reasoningEffort: z.string().default(''),
  persona: z.string().default(''),
  personaFile: z.string().default(''),
  maxReplyBytes: z.number().default(20000),
  thinking: ThinkingSchema.default(DEFAULT_THINKING),
  deniedMessage: z.string().default('无权访问本服务'),
  welcomeMessage: z.string().default('👋 办公助手已就绪。直接发消息即可，例如查文件、整理文档、查资料或处理日常事务。'),
})

interface LoggedEvent {
  seq: number
  type: string
  data: Record<string, unknown>
}

interface TextBlock {
  type: string
  text?: string
}

interface AssistantMessageData {
  message?: { content?: TextBlock[] }
}

interface ToolCallData {
  name?: string
  callId?: string
}

interface ToolResultData {
  error?: unknown
  message?: { source?: { callId?: string } }
}

interface ChunkData {
  chunk?: { type?: string; blockType?: string }
}

interface LiveAgent {
  whenIdle(): Promise<void>
  followup(message: unknown): void
  session: { seq: number; events: readonly LoggedEvent[] }
}

interface SenderState {
  agent?: LiveAgent
  sessionId?: string
  queue: Promise<unknown>
  lastActivity: string
  activityClearAt: number
  lastToolByCallId: Map<string, string>
  modelStreamPhase: 'idle' | 'reasoning' | 'outputting'
  streamStatusTick: number
}

interface DefaultModel {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

interface AgentRegistry {
  create(options: {
    sessionId: ReturnType<typeof SessionId>
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: { provider: string; model: string }
    setup?: (agentCtx: Context) => void | Promise<void>
  }): Promise<{ agent: LiveAgent }>
}

interface SessionStore {
  flush(session: LiveAgent['session']): Promise<void>
}

interface AgentPresets {
  resolve(id: string): Promise<{ id: string }>
  mount(agentCtx: Context, id: string): Promise<unknown>
}

interface SettingsReader {
  get(ns: ReturnType<typeof settingsNamespace>): unknown
}

interface LoaderTree {
  await(): Promise<void>
}

interface WecomFrame {
  body?: {
    text?: { content?: string }
    sender?: { userid?: string }
    from?: { userid?: string }
    userid?: string
  }
}

interface WecomClient {
  replyStream(frame: unknown, streamId: string, content: string, finish: boolean): Promise<unknown>
  replyWelcome(frame: unknown, payload: { msgtype: string; text: { content: string } }): Promise<unknown>
  connect(): void
  close?(): void
  on(event: string, handler: (...args: never[]) => void): void
}

/** Join assistant text from one turn starting at `firstSeq`. */
function summarize(events: readonly LoggedEvent[], firstSeq: number): { text: string; reason: unknown } {
  let started = false
  let text = ''
  let reason: unknown
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') { started = true; continue }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const message = (event.data as AssistantMessageData).message
      const joined = (message?.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Read Host `locale.preference`; missing or unknown falls back to `zh`. */
function readLocalePreference(settings: SettingsReader | undefined): 'zh' | 'en' {
  if (settings === undefined) return 'zh'
  try {
    const section = settings.get(LOCALE_SETTINGS_NS)
    const pref = section && typeof section === 'object' && 'preference' in section
      ? (section as { preference?: unknown }).preference
      : undefined
    return pref === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** Strip leading `#` comment lines from a built-in persona file. */
function stripLeadingHashComments(text: string): string {
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && /^\s*#/.test(lines[i] ?? '')) i++
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  return lines.slice(i).join('\n')
}

/** Resolve persona: personaFile → persona string → built-in locale file. */
function resolvePersona(config: Config, settings: SettingsReader | undefined): string {
  if (config.personaFile) {
    try {
      return readFileSync(config.personaFile, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[im-bridge] 读取 personaFile 失败: ${message}`)
    }
  }
  if (config.persona !== '') return config.persona
  const file = readLocalePreference(settings) === 'en' ? DEFAULT_PERSONA_EN : DEFAULT_PERSONA_ZH
  try {
    return stripLeadingHashComments(readFileSync(file, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[im-bridge] 读取默认人设失败: ${message}`)
    return ''
  }
}

/**
 * Resolve the model for a new sender session. Both provider and model must be
 * non-empty to override; otherwise fall back to agent-default-model.
 */
function resolveSelection(
  config: Config,
  defaultModel: DefaultModel,
): { provider: string; model: string; reasoningEffort?: string } {
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

/**
 * Mount the WeCom bridge: settings namespace, then a deferred WebSocket after Loader settle.
 * @param ctx - host plugin context.
 * @param config - composition entry used as the settings `base` layer.
 */
export function apply(ctx: Context, config: Config): void {
  const agents = ctx.get('agents') as AgentRegistry | undefined
  const sessions = ctx.get('sessions') as SessionStore | undefined
  const defaultModel = ctx.get('agentDefaultModel') as DefaultModel | undefined
  if (agents === undefined || sessions === undefined || defaultModel === undefined) {
    throw new Error('im-bridge: 需要 agents/sessions/agentDefaultModel 服务')
  }

  let source = (): Config => config
  let settings: SettingsReader | undefined
  installSettingsSection(ctx, IM_BRIDGE_NS, Config, config, {
    setSource: (current) => { source = current },
    onChange: () => {
      // Live fields are read through source() on the next handle/ensureAgent.
      // botId/secret still require a process restart to open the WebSocket.
    },
  })
  ctx.inject(['settings'], (settingsCtx) => {
    settings = settingsCtx.settings as SettingsReader
    settingsCtx.effect(() => () => { settings = undefined }, 'im-bridge: settings reader')
  })
  const cfg = (): Config => source()

  void (async () => {
    const loader = ctx.get('loader') as LoaderTree | undefined
    await loader?.await()
    const { botId, secret } = cfg()
    if (!botId || !secret) {
      console.warn(
        '[im-bridge] 跳过启动: 缺少 botId/secret。请在 profile cordis.patch.yml 或 Settings → 插件配置中填写后重启。',
      )
      return
    }

    const senders = new Map<string, SenderState>()

    async function ensureAgent(sender: string): Promise<SenderState> {
      let st = senders.get(sender)
      if (st !== undefined && st.agent !== undefined) return st
      const sessionId = SessionId(`session-${randomUUID()}`)
      const selection = resolveSelection(cfg(), defaultModel)
      const presets = ctx.get('agentPresets') as AgentPresets | undefined
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
          agentCtx.inject(['systemPrompt'], (promptCtx) => {
            promptCtx.systemPrompt.section({
              name: 'deployment:persona',
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

    ctx.on('session/event', (session: { id: string }, event: LoggedEvent) => {
      const thinking = cfg().thinking
      const prefix = thinking?.activityPrefix ?? DEFAULT_THINKING.activityPrefix
      const flashMs = Number.isFinite(thinking?.intervalMs) && thinking.intervalMs > 0
        ? thinking.intervalMs
        : DEFAULT_THINKING.intervalMs
      for (const st of senders.values()) {
        if (st.sessionId !== session.id) continue
        if (event.type === 'assistant/chunk') {
          const next = streamPhaseFromChunk((event.data as ChunkData).chunk)
          if (next !== null) st.modelStreamPhase = next
          continue
        }
        if (event.type === 'tool/call') {
          const toolName = (event.data as ToolCallData).name ?? ''
          const callId = (event.data as ToolCallData).callId
          if (callId !== undefined) st.lastToolByCallId.set(callId, toolName)
          st.activityClearAt = 0
          st.lastActivity = `${prefix}${labelTool(toolName, thinking)}`
          return
        }
        if (event.type === 'tool/result') {
          const data = event.data as ToolResultData
          const callId = data.message?.source?.callId
          const rawName = (callId !== undefined && st.lastToolByCallId.get(callId))
            || [...st.lastToolByCallId.values()].at(-1)
            || ''
          if (callId !== undefined) st.lastToolByCallId.delete(callId)
          const label = labelTool(rawName || '工具', thinking)
          const failed = data.error !== undefined
          st.lastActivity = failed ? `❌ ${label} 失败` : `✅ ${label} 完成`
          st.activityClearAt = Date.now() + flashMs
          st.modelStreamPhase = 'idle'
        }
      }
    })

    const { default: AiBot, generateReqId } = await import('@wecom/aibot-node-sdk') as {
      default: { WSClient: new (options: { botId: string; secret: string }) => WecomClient }
      generateReqId: (kind: string) => string
    }

    async function handle(frame: WecomFrame, sender: string, content: string): Promise<void> {
      const st = await ensureAgent(sender)
      const startedAt = Date.now()
      const streamId = generateReqId('stream')
      let stopThinking: (() => void) | null = null
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[im-bridge] 占位回复失败: ${message}`)
      }
      try {
        if (st.agent === undefined) throw new Error('im-bridge: sender agent missing')
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
      } catch (error) {
        if (stopThinking) stopThinking()
        const ms = Date.now() - startedAt
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[im-bridge] agent 失败: ${message}`)
        try {
          await sendFinal(ws, frame, streamId, `处理失败: ${truncate(message, 400)}\n\n---\n❌ 耗时 ${fmtDuration(ms)}`)
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
          console.error(`[im-bridge] 错误回复也失败: ${retryMessage}`)
        }
      }
    }

    const ws = new AiBot.WSClient({ botId, secret })

    ws.on('connected', (() => console.log('[im-bridge] WebSocket 已连接')) as (...args: never[]) => void)
    ws.on('authenticated', (() => console.log('[im-bridge] 认证成功, 等待消息...')) as (...args: never[]) => void)
    ws.on('disconnected', ((reason: string) => console.log(`[im-bridge] 断开: ${reason}`)) as (...args: never[]) => void)
    ws.on('reconnecting', ((n: number) => console.log(`[im-bridge] 第 ${n} 次重连...`)) as (...args: never[]) => void)
    ws.on('error', ((error: Error) => console.error(`[im-bridge] 错误: ${error.message}`)) as (...args: never[]) => void)

    ws.on('message.text', ((frame: WecomFrame) => {
      const content = (frame.body?.text?.content || '').trim()
      if (!content) return
      const sender = frame.body?.sender?.userid || frame.body?.from?.userid || frame.body?.userid || 'unknown'
      if (cfg().allowFrom.length > 0 && !cfg().allowFrom.includes(sender)) {
        void ws.replyStream(frame, generateReqId('stream'), cfg().deniedMessage, true).catch(() => {})
        return
      }
      console.log(`[im-bridge] 收到 from=${sender}: ${content.slice(0, 100)}`)
      const st = senders.get(sender) ?? {
        queue: Promise.resolve(),
        lastActivity: '',
        activityClearAt: 0,
        lastToolByCallId: new Map(),
        modelStreamPhase: 'idle' as const,
        streamStatusTick: 0,
      }
      senders.set(sender, st)
      st.queue = st.queue
        .then(() => handle(frame, sender, content))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[im-bridge] 任务异常: ${message}`)
        })
    }) as (...args: never[]) => void)

    ws.on('event.enter_chat', ((frame: WecomFrame) => {
      const sender = frame.body?.from?.userid || 'unknown'
      console.log(`[im-bridge] 用户 ${sender} 进入会话`)
      void ws.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: cfg().welcomeMessage },
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[im-bridge] 欢迎语失败: ${message}`)
      })
    }) as (...args: never[]) => void)

    ws.connect()

    ctx.on('dispose', () => {
      try { ws.close?.() } catch { /* already closed */ }
    })
  })()
}
