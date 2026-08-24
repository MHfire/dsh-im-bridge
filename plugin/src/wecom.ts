/**
 * WeCom stream helpers: thinking animation, final brief, and send retries.
 * The WeCom SDK is imported only on the final-send retry path so plugin load
 * does not pull it in before Loader settle.
 */

/** One timed fallback line while no model chunk has arrived. */
export interface ThinkingPhase {
  /** Elapsed seconds at which this line becomes current. */
  atSec: number
  /** Status text shown in the stream. */
  text: string
}

/** Stream-animation copy and timing. */
export interface ThinkingConfig {
  /** Timed fallback lines while no `assistant/chunk` has arrived. */
  phases: ThinkingPhase[]
  /** Idle-phase spinner glyphs. */
  spin: string[]
  /** Extra lines after {@link ThinkingConfig.eggAfterSec}. */
  eggs: string[]
  /** Seconds after which eggs start rotating. */
  eggAfterSec: number
  /** Stream refresh interval. */
  intervalMs: number
  /** Prefix before a friendly tool name. */
  activityPrefix: string
  /** Lines rotated during `reasoning-delta`. */
  reasoningStatus: string[]
  /** Lines rotated during `text-delta`. */
  outputStatus: string[]
  /** Spinner glyphs during reasoning. */
  reasoningSpin: string[]
  /** Spinner glyphs during output. */
  outputSpin: string[]
  /** Tool registration name → WeCom-visible label. */
  toolLabels: Record<string, string>
}

/** Default stream-animation copy; Config / cordis patch may override. */
export const DEFAULT_THINKING: ThinkingConfig = {
  phases: [
    { atSec: 0, text: '🤔 正在理解你的需求…' },
    { atSec: 8, text: '📋 正在整理任务清单' },
    { atSec: 25, text: '🔍 正在查找相关资料' },
    { atSec: 55, text: '✍️ 正在处理文档/数据' },
    { atSec: 120, text: '🧠 正在思考最佳方案…' },
    { atSec: 240, text: '⏳ 任务较繁琐，请稍候…' },
    { atSec: 420, text: '☕ 快好了，正在收尾…' },
  ],
  spin: ['🧠', '💭', '✨', '🔎', '⚡'],
  eggs: [
    '📎 顺手把要点整理好了，稍后一起给你',
    '📶 网络有点忙，让它慢慢跑',
    '🎯 结果快出来了，坚持一下',
    '🗂️ 资料较多，正在汇总中',
    '🌙 别盯着了，完成会自动通知你',
  ],
  eggAfterSec: 240,
  intervalMs: 1500,
  activityPrefix: '🛠️ 正在执行 ',
  reasoningStatus: ['💭 模型思考中…', '🧠 深入分析中…', '✨ 梳理思路中…'],
  outputStatus: ['✍️ 正在输出回复…', '📝 组织文字中…', '💬 生成回答中…'],
  reasoningSpin: ['💭', '🧠', '🌀', '✨'],
  outputSpin: ['✍️', '📝', '💬', '⚡'],
  toolLabels: {
    pwsh: 'PowerShell',
    bash: 'Shell',
    read_file: '读文件',
    read: '读文件',
    write_file: '写文件',
    write: '写文件',
    edit_file: '编辑文件',
    str_replace: '编辑文件',
    glob: '查找文件',
    grep: '搜索内容',
    web_search: '网页搜索',
    web_fetch: '抓取网页',
    todo_write: '更新待办',
  },
}

/** WeCom client methods used by the animation and final send. */
export interface WecomStreamClient {
  replyStream(frame: unknown, streamId: string, content: string, finish: boolean): Promise<unknown>
}

/** Map a tool registration name to the WeCom-visible label. */
export function labelTool(name: string, thinking?: Partial<ThinkingConfig>): string {
  const labels = {
    ...DEFAULT_THINKING.toolLabels,
    ...(thinking?.toolLabels && typeof thinking.toolLabels === 'object' ? thinking.toolLabels : {}),
  }
  return labels[name] || name
}

/** Pick one status line from a configured list, rotating by tick. */
export function pickStatusLine(
  value: string | string[] | undefined,
  fallback: string[],
  tick: number,
): string {
  const list = Array.isArray(value) && value.length > 0
    ? value
    : (typeof value === 'string' && value !== '' ? [value] : fallback)
  return list[Math.abs(tick) % list.length] ?? fallback[0] ?? ''
}

/** Infer the model stream phase from one `assistant/chunk` payload. */
export function streamPhaseFromChunk(
  chunk: { type?: string; blockType?: string } | undefined,
): 'reasoning' | 'outputting' | null {
  if (!chunk || typeof chunk !== 'object') return null
  if (chunk.type === 'reasoning-delta') return 'reasoning'
  if (chunk.type === 'text-delta') return 'outputting'
  if (chunk.type === 'block-start') {
    if (chunk.blockType === 'reasoning') return 'reasoning'
    if (chunk.blockType === 'text') return 'outputting'
  }
  return null
}

/** Format milliseconds as a short Chinese duration. */
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`
}

/** Speed label from elapsed milliseconds. */
export function speedOf(ms: number): string {
  if (ms < 60000) return '⚡ 神速'
  if (ms < 180000) return '🚀 正常速度'
  return '🐢 耗时较长'
}

/** Footer appended to a completed WeCom reply. */
export function footerOf(ms: number): string {
  if (ms >= 180000) {
    return `\n\n---\n✅ 执行完成 · 🐢 耗时较长（${fmtDuration(ms)}）\n💡 如需提速，可让我把诊断步骤合并成更少的 SSH 批次`
  }
  return `\n\n---\n✅ 执行完成 · ${speedOf(ms)}（${fmtDuration(ms)}）`
}

/** Truncate a string to at most `max` UTF-8 bytes. */
export function truncate(text: string, max: number): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text
  let t = text
  while (Buffer.byteLength(t, 'utf8') > max) t = t.slice(0, -100)
  return `${t}\n\n...(内容过长已截断)`
}

/**
 * Refresh one stream message until the caller stops it.
 * @param activity - live tool/status text; empty falls back to timed phases.
 * @param thinking - animation copy; defaults to {@link DEFAULT_THINKING}.
 * @param getStreamPhase - model stream phase; selects the spinner pool.
 * @returns disposer that cancels the interval.
 */
export function startThinking(
  ws: WecomStreamClient,
  frame: unknown,
  streamId: string,
  startedAt: number,
  timeoutSec: number,
  activity?: () => string,
  thinking?: Partial<ThinkingConfig>,
  getStreamPhase?: () => 'idle' | 'reasoning' | 'outputting' | string,
): () => void {
  const t = { ...DEFAULT_THINKING, ...thinking }
  const phases = Array.isArray(t.phases) && t.phases.length > 0 ? t.phases : DEFAULT_THINKING.phases
  const spin = Array.isArray(t.spin) && t.spin.length > 0 ? t.spin : DEFAULT_THINKING.spin
  const reasoningSpin = Array.isArray(t.reasoningSpin) && t.reasoningSpin.length > 0
    ? t.reasoningSpin
    : DEFAULT_THINKING.reasoningSpin
  const outputSpin = Array.isArray(t.outputSpin) && t.outputSpin.length > 0
    ? t.outputSpin
    : DEFAULT_THINKING.outputSpin
  const eggs = Array.isArray(t.eggs) && t.eggs.length > 0 ? t.eggs : DEFAULT_THINKING.eggs
  const eggAfterSec = Number.isFinite(t.eggAfterSec) ? t.eggAfterSec : DEFAULT_THINKING.eggAfterSec
  const intervalMs = Number.isFinite(t.intervalMs) && t.intervalMs > 0 ? t.intervalMs : DEFAULT_THINKING.intervalMs
  const total = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 600
  let i = 0
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000)
    const live = activity ? activity() : ''
    let stage = phases[0]?.text ?? ''
    if (!live) {
      for (const phase of phases) {
        if (secs >= phase.atSec) stage = phase.text
      }
    }
    const pct = Math.min(Math.floor((secs / total) * 100), 99)
    const filled = '█'.repeat(Math.floor(pct / 10))
    const bar = secs < 3 ? '' : `\n${filled}${'░'.repeat(10 - filled.length)} ${String(pct).padStart(2)}%`
    const remain = Math.max(total - secs, 0)
    const remainTxt = secs < 3 ? '' : ` · 预计还剩 ${Math.floor(remain / 60)}分${remain % 60}秒`
    const egg = secs >= eggAfterSec && eggs.length > 0
      ? `\n${eggs[Math.floor(secs / 60) % eggs.length]}`
      : ''
    const phase = getStreamPhase ? getStreamPhase() : 'idle'
    const emojiPool = phase === 'reasoning'
      ? reasoningSpin
      : phase === 'outputting'
        ? outputSpin
        : spin
    const emoji = emojiPool[i % emojiPool.length]
    i++
    const status = live || stage
    void ws.replyStream(frame, streamId, `${emoji} ${status}   ⏱ ${secs} 秒${remainTxt}${bar}${egg}`, false)
      .catch(() => {})
  }, intervalMs)
  return () => clearInterval(timer)
}

/** Finish the current stream; open a new stream if WeCom expired the first. */
export async function sendFinal(
  ws: WecomStreamClient,
  frame: unknown,
  streamId: string,
  content: string,
): Promise<void> {
  try {
    await ws.replyStream(frame, streamId, content, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[im-bridge] 原流最终回复失败(${message}), 尝试新流...`)
    const { generateReqId } = await import('@wecom/aibot-node-sdk')
    await ws.replyStream(frame, generateReqId('stream'), content, true)
  }
}
