/**
 * dsh-im-bridge — WeCom AI bot ⇄ DSH Agent host plugin.
 *
 * Function-plugin shape (`name` / `inject` / `Config` / `apply`, no default
 * export). Messages create in-process Agents so per-chat-window sessions stay on
 * the same Loader tree as the Web GUI. Settings register through
 * `installSettingsSection`; live fields read `source()`, credentials still
 * require a process restart to open the WebSocket.
 */

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
  collectReplyPngs,
  resolveChatId,
  sendCollectedPngs,
} from './reply-images.ts'
import {
  isLegacyPinnedWecomTitle,
  planWecomBind,
  resolveWecomSession,
  stripBotMention,
  wecomDisplayTitle,
  WecomSessionReject,
  type WecomSessionRef,
} from './session-key.ts'
import {
  ALLOW_FROM_REQUIRED_MESSAGE,
  IM_BRIDGE_RPC_CHANNEL,
  INSTALL_SKILLS_ENDPOINT,
  SKILLS_RPC_UNAVAILABLE_MESSAGE,
  WECOM_CLI_NO_OFFICE_PROMPT,
  WECOM_CLI_PROMPT,
  WECOM_CLI_TOOL_NAME,
  WORKSPACE_WECOMCLI_LEAK_MESSAGE,
  authInitHint,
  countWecomcliSkills,
  countWorkspaceWecomcliLeaks,
  ensureConfigDir,
  ensureOnPath,
  installOfficialWecomSkills,
  loadWecomSkills,
  probeAuth,
  registerWecomCliTool,
  registerWecomOfficeSkills,
  resolveConfigDir,
  resolveSkillsDir,
  resolveWecomBin,
  senderHasOfficeAccess,
  shouldEnableWecomCli,
  shouldInjectWecomOfficeSkills,
  skillsInstallHint,
  trySeedAuth,
  type InstallWecomSkillsResult,
  type WecomSkill,
} from './wecom-cli.ts'
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

const WecomCliSchema = z.object({
  enabled: z.boolean().default(false),
  skillsDir: z.string().default(''),
  configDir: z.string().default(''),
  allowFrom: z.array(String).default([]),
})

/** Optional wecom-cli office skills (mail, calendar, docs, …). */
export interface WecomCliConfig {
  /** Explicit opt-in; off by default because it shares the authorized identity. */
  enabled: boolean
  /** Skills root; empty = `$DSH_HOME/wecom-cli-skills`. */
  skillsDir: string
  /** Credential directory; empty = `<workspace>/.dsh/wecom-cli`. */
  configDir: string
  /** Office-command userid list; empty skips PATH / auth. Independent of chat `allowFrom`. */
  allowFrom: string[]
}

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
  wecomCli: WecomCliConfig
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
  wecomCli: WecomCliSchema.default({ enabled: false, skillsDir: '', configDir: '', allowFrom: [] }),
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
  ctx: Context
  session: {
    seq: number
    events: readonly LoggedEvent[]
    header?: { cwd?: string; agentPreset?: string }
  }
}

interface ChatState {
  agent?: LiveAgent
  sessionId?: string
  kind?: 'single' | 'group'
  /** True when the current inbound sender is on `wecomCli.allowFrom`. */
  office: boolean
  /** Prompt sections already registered on this Agent. */
  wecomPromptInstalled: boolean
  /** wecomcli-* already registered on this Agent. */
  officeSkillsRegistered: boolean
  /** The gated `wecom_cli` tool already registered on this Agent. */
  officeToolRegistered: boolean
  queue: Promise<unknown>
  lastActivity: string
  activityClearAt: number
  lastToolByCallId: Map<string, string>
  modelStreamPhase: 'idle' | 'reasoning' | 'outputting'
  streamStatusTick: number
}

/** Placeholder Map value so later messages on the same key share one queue. */
function emptyChatState(): ChatState {
  return {
    office: false,
    wecomPromptInstalled: false,
    officeSkillsRegistered: false,
    officeToolRegistered: false,
    queue: Promise.resolve(),
    lastActivity: '',
    activityClearAt: 0,
    lastToolByCallId: new Map(),
    modelStreamPhase: 'idle',
    streamStatusTick: 0,
  }
}

/** Duck-typed Connection RPC result (no apiproxy import). */
type SkillsRpcResult =
  | { ok: true; value: InstallWecomSkillsResult }
  | { ok: false; error: { code: 'internal' | 'cancelled'; message: string; details: Record<string, never> } }

/** Optional Host Connection used by the Settings install button. */
interface HostConnectionRpc {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<SkillsRpcResult>,
    options: { authority: 'loopback' },
  ): () => Promise<void>
}

interface DefaultModel {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

interface AgentRegistry {
  get(id: ReturnType<typeof SessionId>): LiveAgent | undefined
  create(options: {
    sessionId: ReturnType<typeof SessionId>
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: { provider: string; model: string }
    setup?: (agentCtx: Context) => void | Promise<void>
  }): Promise<{ agent: LiveAgent }>
  resume(options: {
    resumeSessionId: ReturnType<typeof SessionId>
    agentOptions?: { provider: string; model: string }
    setup?: (agentCtx: Context) => void | Promise<void>
  }): Promise<{ agent: LiveAgent }>
}

interface SessionPersistenceHeader {
  id: string
  cwd?: string
  agentPreset?: string
}

interface SessionPersistence {
  list(): Promise<SessionPersistenceHeader[]>
}

interface WorkspaceRegistry {
  readonly archivedSessionIds: readonly string[]
}

interface SessionStore {
  flush(session: LiveAgent['session']): Promise<void>
}

interface SessionTitleSnapshot {
  title: string
  source: { kind: string }
}

interface SessionTitleService {
  get(session: LiveAgent['session']): SessionTitleSnapshot | undefined
  refresh(session: LiveAgent['session']): Promise<unknown>
}

interface TitledSession {
  id: string
  events: readonly LoggedEvent[]
  append(type: 'session/title', data: {
    title: string
    messageSeqs: number[]
    source: unknown
  }): void
}

interface SessionTitleEventData {
  title?: string
  messageSeqs?: number[]
  source?: { kind?: string }
}

interface AgentPresets {
  resolve(id: string): Promise<{ id: string }>
  mount(agentCtx: Context, id: string): Promise<unknown>
}

interface SystemPromptService {
  section(entry: { name: string; order: number; text: () => string }): unknown
}

/** Caller-bound prompt registry on an Agent context (not a raw `get()` result). */
interface PromptHost {
  get(name: string): unknown
  systemPrompt?: SystemPromptService
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
    chatid?: string
    chattype?: string | number
  }
}

interface WecomClient {
  replyStream(frame: unknown, streamId: string, content: string, finish: boolean): Promise<unknown>
  replyWelcome(frame: unknown, payload: { msgtype: string; text: { content: string } }): Promise<unknown>
  uploadMedia(
    fileBuffer: Buffer,
    options: { type: string; filename: string },
  ): Promise<{ media_id?: string; mediaId?: string }>
  sendMediaMessage(chatid: string, mediaType: string, mediaId: string): Promise<unknown>
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

/**
 * Payload of the log's last `session/title` event — the title in force now.
 * @param session - live session whose log to fold.
 * @returns the payload, or undefined when the session has no title event.
 */
function latestTitleData(session: TitledSession): SessionTitleEventData | undefined {
  const events = session.events
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type === 'session/title') return event.data as SessionTitleEventData
  }
  return undefined
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
 * Resolve the model for a new WeCom chat session. Both provider and model must be
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

  const chats = new Map<string, ChatState>()
  let wecomCliReady = false
  let officeSkills: WecomSkill[] = []
  /** Launcher and credential directory the gated tool spawns with; set once wecom-cli is usable. */
  let officeCli: { binJs: string; configDir: string } | undefined

  /**
   * Install the office layer on one Agent: wecomcli-* skills and the gated
   * `wecom_cli` tool. Both register through the Agent's own context, so a group
   * chat or the GUI never sees them. Idempotent per Agent, and retried on each
   * inbound message because skills can arrive from the Settings button later.
   */
  function installOfficeLayer(agentCtx: Context, st: ChatState): void {
    if (!wecomCliReady) return
    if (!shouldInjectWecomOfficeSkills(st.kind, st.office)) return
    if (!st.officeSkillsRegistered) {
      const count = registerWecomOfficeSkills(agentCtx, officeSkills)
      if (count > 0) {
        st.officeSkillsRegistered = true
        console.log(`[im-bridge] 已在该 Agent 注册 ${String(count)} 个 wecomcli-*`)
      }
    }
    if (st.officeToolRegistered || officeCli === undefined) return
    try {
      st.officeToolRegistered = registerWecomCliTool(agentCtx, officeCli.binJs, officeCli.configDir)
      if (st.officeToolRegistered) {
        console.log(`[im-bridge] 已在该 Agent 注册 ${WECOM_CLI_TOOL_NAME} 工具`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[im-bridge] 注册 ${WECOM_CLI_TOOL_NAME} 失败: ${message}`)
    }
  }

  ctx.inject(['connection'], (bound) => {
    const rpc = (bound.get('connection') as { rpc?: HostConnectionRpc } | undefined)?.rpc
    if (rpc === undefined) {
      console.warn(`[im-bridge] ${SKILLS_RPC_UNAVAILABLE_MESSAGE}`)
      return
    }
    bound.effect(
      () => rpc.handle(IM_BRIDGE_RPC_CHANNEL, async (endpoint, _payload, signal) => {
        if (endpoint !== INSTALL_SKILLS_ENDPOINT) {
          return {
            ok: false,
            error: { code: 'internal', message: `unknown endpoint ${endpoint}`, details: {} },
          }
        }
        if (signal.aborted) {
          return {
            ok: false,
            error: { code: 'cancelled', message: '安装已取消', details: {} },
          }
        }
        try {
          const dest = resolveSkillsDir(cfg().wecomCli.skillsDir, cfg().workspace)
          const result = await installOfficialWecomSkills(dest, { signal })
          officeSkills = loadWecomSkills(result.dest).filter(skill => skill.name.startsWith('wecomcli-'))
          for (const st of chats.values()) {
            if (st.agent === undefined) continue
            installOfficeLayer(st.agent.ctx, st)
          }
          console.log(`[im-bridge] 已安装 ${String(result.count)} 个 wecomcli-* 到 ${result.dest}`)
          return { ok: true, value: result }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, error: { code: 'internal', message, details: {} } }
        }
      }, { authority: 'loopback' }),
      'im-bridge: wecomcli.installSkills',
    )
  })

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

    const wecomCli = cfg().wecomCli
    if (wecomCli.enabled) {
      const skillsDir = resolveSkillsDir(wecomCli.skillsDir, cfg().workspace)
      officeSkills = loadWecomSkills(skillsDir).filter(skill => skill.name.startsWith('wecomcli-'))
      const wecomcliCount = countWecomcliSkills(officeSkills)
      if (wecomcliCount === 0) {
        console.warn(
          `[im-bridge] 未找到 wecomcli-* skills（${skillsDir}）。${skillsInstallHint(skillsDir)}`,
        )
      } else {
        console.log(
          `[im-bridge] 已从 ${skillsDir} 加载 ${String(wecomcliCount)} 个 wecomcli-*，将在办公单聊 Agent 上注册`,
        )
      }
      const leakCount = countWorkspaceWecomcliLeaks(cfg().workspace)
      if (leakCount > 0) {
        console.warn(`[im-bridge] ${WORKSPACE_WECOMCLI_LEAK_MESSAGE}（${String(leakCount)}）`)
      }
      if (!shouldEnableWecomCli(true, wecomCli.allowFrom)) {
        console.warn(`[im-bridge] ${ALLOW_FROM_REQUIRED_MESSAGE}`)
      } else {
        wecomCliReady = true
        const binJs = resolveWecomBin()
        if (binJs === undefined) {
          console.warn('[im-bridge] 未找到 @wecom/cli 二进制，办公命令不可用。请确认插件依赖已安装。')
        } else {
          const configDir = ensureConfigDir(resolveConfigDir(wecomCli.configDir, cfg().workspace))
          officeCli = { binJs, configDir }
          console.log(`[im-bridge] wecom-cli 凭证目录: ${configDir}`)
          const pathResult = ensureOnPath()
          console.log(
            `[im-bridge] PATH 上的 wecom-cli 已改为拒绝执行: ${pathResult.shimDir}${pathResult.shadowed ? '（已遮蔽另一个 wecom-cli）' : ''}`,
          )
          let status = await probeAuth(binJs, configDir)
          if (status === 'unauthorized') {
            if ((await trySeedAuth(binJs, cfg().botId, cfg().secret, configDir)) === undefined) {
              status = await probeAuth(binJs, configDir)
            }
          }
          if (status === 'authorized') {
            console.log('[im-bridge] wecom-cli 已授权')
          } else if (status === 'unauthorized') {
            console.warn(
              `[im-bridge] wecom-cli 未能用 botId/secret 完成授权。请在 host 上执行 ${authInitHint(configDir)}（输入同一套密钥，不要全局安装）。`,
            )
          } else {
            console.warn('[im-bridge] wecom-cli auth show 失败。')
          }
        }
      }
    }

    /**
     * Add the channel prefix to a title the Host generated. `session/event`
     * runs inside the append publication window, which refuses a reentrant
     * append, so the prefixed title goes out in a microtask and re-reads the
     * log first: an already prefixed tail (including the one this appends)
     * stops the chain.
     */
    function prefixWecomTitle(session: TitledSession, st: ChatState): void {
      const kind = st.kind
      if (kind === undefined) return
      queueMicrotask(() => {
        const data = latestTitleData(session)
        if (data === undefined) return
        // An explicit GUI rename is pinned on purpose; only automatic titles get labelled.
        if (data.source?.kind === 'user') return
        const raw = typeof data.title === 'string' ? data.title : ''
        const next = wecomDisplayTitle(kind, raw)
        if (next === raw) return
        const messageSeqs = Array.isArray(data.messageSeqs)
          ? data.messageSeqs.filter((seq) => typeof seq === 'number')
          : []
        // A non-user title must cite at least one user/message seq, or the
        // session-title invariant rejects the append.
        if (messageSeqs.length === 0) return
        try {
          session.append('session/title', {
            title: next,
            messageSeqs,
            source: data.source ?? { kind: 'fallback' },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[im-bridge] 加标题前缀失败: ${message}`)
        }
      })
    }

    /**
     * Sessions the GUI archived. Archiving is the workspace registry's global
     * set, not session state, and it has no inverse: an archived session is
     * invisible in every list, so this plugin must stop writing to it.
     */
    function archivedSessions(): ReadonlySet<string> {
      const registry = ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
      if (registry === undefined) return new Set()
      try {
        return new Set(registry.archivedSessionIds)
      } catch (error) {
        // The getter throws until the registry finishes its own startup.
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[im-bridge] 读归档会话失败: ${message}`)
        return new Set()
      }
    }

    async function unpinLegacyWecomTitle(agent: LiveAgent): Promise<void> {
      const titles = ctx.get('sessionTitle') as SessionTitleService | undefined
      if (titles === undefined) return
      try {
        const snapshot = titles.get(agent.session)
        if (snapshot?.source?.kind !== 'user') return
        if (!isLegacyPinnedWecomTitle(snapshot.title)) return
        await titles.refresh(agent.session)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[im-bridge] 解开旧标题失败: ${message}`)
      }
    }

    /**
     * Register persona + wecom prompt on this Agent's layer, synchronously.
     * Must use `agentCtx.systemPrompt` (caller-bound). `inject()` without await
     * yields a microtask and can publish the Agent before the section exists;
     * `adopt` never re-runs setup.
     */
    function installWecomChannel(agentCtx: Context, st: ChatState): void {
      if (st.wecomPromptInstalled) return
      const host = agentCtx as Context & PromptHost
      if (host.get('systemPrompt') === undefined || host.systemPrompt === undefined) {
        console.warn('[im-bridge] 当前 Agent 没有 systemPrompt，企微提示词未注入')
        return
      }
      const prompt = host.systemPrompt
      try {
        prompt.section({
          name: 'deployment:persona',
          order: 0,
          text: () => resolvePersona(cfg(), settings),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[im-bridge] 人设段未覆盖（可能已由 preset 注册）: ${message}`)
      }
      try {
        prompt.section({
          name: 'channel:wecom-cli',
          order: 1,
          // Re-read per request: a group Agent is shared, and its sender —
          // hence `st.office` — changes message to message. Only an office
          // 1:1 gets the tool, so only it may get the office prompt.
          // Always inject: WeCom has no GUI even when wecomCli is off.
          text: () => wecomCliReady && shouldInjectWecomOfficeSkills(st.kind, st.office)
            ? WECOM_CLI_PROMPT
            : WECOM_CLI_NO_OFFICE_PROMPT,
        })
        console.log(
          `[im-bridge] 已注入企微提示词 office=${String(st.office)} kind=${st.kind ?? '?'}`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[im-bridge] 注入企微提示词失败: ${message}`)
      }
      st.wecomPromptInstalled = true
    }

    async function ensureAgent(ref: WecomSessionRef): Promise<ChatState> {
      let st = chats.get(ref.key)
      if (st === undefined) {
        st = emptyChatState()
        chats.set(ref.key, st)
      }
      st.kind = ref.kind
      if (st.agent !== undefined) {
        if (st.sessionId === undefined || !archivedSessions().has(st.sessionId)) {
          // Office access is decided per inbound sender, and skills can arrive
          // from the Settings button after this Agent was created.
          installOfficeLayer(st.agent.ctx, st)
          return st
        }
        console.log(`[im-bridge] 会话 ${st.sessionId} 已归档，改开新会话`)
        st.agent = undefined
        st.sessionId = undefined
        st.wecomPromptInstalled = false
        st.officeSkillsRegistered = false
        st.officeToolRegistered = false
      }

      const persistence = ctx.get('sessionPersistence') as SessionPersistence | undefined
      const headers = persistence === undefined ? [] : await persistence.list()
      const plan = planWecomBind(ref.key, {
        live: (id) => agents.get(SessionId(id)) !== undefined,
        stored: new Set(headers.map((header) => header.id)),
        archived: archivedSessions(),
      })
      const sessionId = SessionId(plan.sessionId)
      const stored = headers.find((header) => header.id === sessionId)

      const attach = (agent: LiveAgent, how: 'adopt' | 'resume' | 'create'): void => {
        st.agent = agent
        st.sessionId = sessionId
        st.kind = ref.kind
        if (agent.ctx === undefined) {
          console.warn('[im-bridge] Agent 没有 ctx，无法注入企微提示词')
        } else {
          installWecomChannel(agent.ctx, st)
          installOfficeLayer(agent.ctx, st)
        }
        void unpinLegacyWecomTitle(agent)
        const cwd = agent.session.header?.cwd ?? stored?.cwd
        if (cwd !== undefined && cwd !== cfg().workspace) {
          console.warn(
            `[im-bridge] 会话 ${sessionId} 仍使用存档目录 ${cwd}，当前 workspace=${cfg().workspace}`,
          )
        }
        const epoch = plan.epoch > 1 ? ` 第${String(plan.epoch)}段` : ''
        console.log(
          `[im-bridge] 为 ${ref.key} ${how}会话 ${sessionId}${epoch} userid=${ref.sender} chattype=${ref.kind} chatid=${ref.chatid ?? ''}`,
        )
      }

      const live = agents.get(sessionId)
      if (plan.bind === 'adopt' && live !== undefined) {
        attach(live, 'adopt')
        return st
      }

      const selection = resolveSelection(cfg(), defaultModel)
      const presets = ctx.get('agentPresets') as AgentPresets | undefined
      const presetId = (plan.bind === 'resume' && stored?.agentPreset) ? stored.agentPreset : cfg().agentPreset
      let resolvedId = presetId
      if (presets !== undefined) {
        resolvedId = (await presets.resolve(presetId)).id
      }
      const setup = async (agentCtx: Context): Promise<void> => {
        const selected = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
        if (presets !== undefined) await presets.mount(agentCtx, resolvedId)
        installWecomChannel(agentCtx, st)
      }
      const agentOptions = { provider: selection.provider, model: selection.model }

      try {
        if (plan.bind === 'resume') {
          const { agent } = await agents.resume({
            resumeSessionId: sessionId,
            agentOptions,
            setup,
          })
          attach(agent, 'resume')
          return st
        }
        const { agent } = await agents.create({
          sessionId,
          meta: { cwd: cfg().workspace, agentPreset: resolvedId },
          agentOptions,
          setup,
        })
        attach(agent, 'create')
        return st
      } catch (error) {
        const raced = agents.get(sessionId)
        if (raced !== undefined) {
          attach(raced, 'adopt')
          return st
        }
        throw error
      }
    }

    ctx.on('session/event', (session: TitledSession, event: LoggedEvent) => {
      const thinking = cfg().thinking
      const prefix = thinking?.activityPrefix ?? DEFAULT_THINKING.activityPrefix
      const flashMs = Number.isFinite(thinking?.intervalMs) && thinking.intervalMs > 0
        ? thinking.intervalMs
        : DEFAULT_THINKING.intervalMs
      for (const st of chats.values()) {
        if (st.sessionId !== session.id) continue
        if (event.type === 'session/title') {
          prefixWecomTitle(session, st)
          continue
        }
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

    async function handle(frame: WecomFrame, ref: WecomSessionRef, content: string): Promise<void> {
      let st = chats.get(ref.key)
      if (st === undefined) {
        st = emptyChatState()
        chats.set(ref.key, st)
      }
      st.office = senderHasOfficeAccess(cfg().wecomCli.allowFrom, ref.sender)
      st = await ensureAgent(ref)
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
        if (st.agent === undefined) throw new Error('im-bridge: chat agent missing')
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
        const body = outcome.text || '(agent 无输出)'
        const collected = collectReplyPngs(body, cfg().workspace)
        for (const reason of collected.skipped) {
          console.warn(`[im-bridge] 跳过图片: ${reason}`)
        }
        let reply = truncate(body, (cfg().maxReplyBytes || 20000) - 200) + footerOf(ms)
        if (collected.skipped.length > 0) {
          reply = truncate(
            `${reply}\n⚠️ ${collected.skipped.length} 张图片未发送（过大、越权或不存在）`,
            cfg().maxReplyBytes || 20000,
          )
        }
        console.log(`[im-bridge] ${ref.key} 完成 (${Buffer.byteLength(reply, 'utf8')}B, ${fmtDuration(ms)})`)
        await sendFinal(ws, frame, streamId, reply)
        if (collected.images.length > 0) {
          await sendCollectedPngs(ws, resolveChatId(frame, ref.sender), collected.images)
        }
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
      const inbound = (frame.body?.text?.content || '').trim()
      if (!inbound) return
      const content = stripBotMention(inbound)
      let ref: WecomSessionRef
      try {
        ref = resolveWecomSession(frame)
      } catch (error) {
        if (error instanceof WecomSessionReject) {
          console.error(`[im-bridge] ${error.reply}`)
          void ws.replyStream(frame, generateReqId('stream'), error.reply, true).catch(() => {})
          return
        }
        throw error
      }
      if (cfg().allowFrom.length > 0 && !cfg().allowFrom.includes(ref.sender)) {
        void ws.replyStream(frame, generateReqId('stream'), cfg().deniedMessage, true).catch(() => {})
        return
      }
      console.log(
        `[im-bridge] 收到 key=${ref.key} userid=${ref.sender} chattype=${String(frame.body?.chattype ?? '')} chatid=${ref.chatid ?? ''}: ${content.slice(0, 100)}`,
      )
      const st = chats.get(ref.key) ?? emptyChatState()
      st.kind = ref.kind
      chats.set(ref.key, st)
      st.queue = st.queue
        .then(() => handle(frame, ref, content))
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
