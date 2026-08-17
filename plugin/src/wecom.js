/**
 * wecom.js — 企业微信交互封装: 流式动画(v3) + 最终简报 + 发送助手。
 * 逻辑移植自旧版 im-bridge/bridge.js, 改为纯 ESM 供插件使用。
 */
import { generateReqId } from '@wecom/aibot-node-sdk'

/** 流式思考动画的默认素材(可被 Config.thinking / cordis patch 覆盖) */
export const DEFAULT_THINKING = {
  /** 尚无 assistant/chunk 时的时间轴兜底文案(与模型是否在推理无关) */
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
  /** 收到 reasoning-delta 时的状态行文案(按刷新轮换) */
  reasoningStatus: ['💭 模型思考中…', '🧠 深入分析中…', '✨ 梳理思路中…'],
  /** 收到 text-delta 时的状态行文案(按刷新轮换) */
  outputStatus: ['✍️ 正在输出回复…', '📝 组织文字中…', '💬 生成回答中…'],
  /** 思考阶段专用旋转表情 */
  reasoningSpin: ['💭', '🧠', '🌀', '✨'],
  /** 输出阶段专用旋转表情 */
  outputSpin: ['✍️', '📝', '💬', '⚡'],
  /** 工具名 → 企微活动文案友好名(可被 thinking.toolLabels 覆盖) */
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

/**
 * 将工具注册名映射为企微可见友好名。
 * @param {string} name - 工具名(如 pwsh)
 * @param {typeof DEFAULT_THINKING | undefined} thinking - 含可选 toolLabels 覆盖
 * @returns {string}
 */
export function labelTool(name, thinking) {
  const labels = {
    ...DEFAULT_THINKING.toolLabels,
    ...(thinking?.toolLabels && typeof thinking.toolLabels === 'object' ? thinking.toolLabels : {}),
  }
  return labels[name] || name
}

/**
 * 从 string | string[] 配置中按 tick 取一条状态文案。
 * @param {string | string[] | undefined} value
 * @param {string[]} fallback
 * @param {number} tick
 */
export function pickStatusLine(value, fallback, tick) {
  const list = Array.isArray(value) && value.length > 0
    ? value
    : (typeof value === 'string' && value !== '' ? [value] : fallback)
  return list[Math.abs(tick) % list.length]
}

/**
 * 根据 assistant/chunk 判别模型流式阶段。
 * @param {{ type?: string, blockType?: string } | undefined} chunk
 * @returns {'reasoning' | 'outputting' | null}
 */
export function streamPhaseFromChunk(chunk) {
  if (!chunk || typeof chunk !== 'object') return null
  if (chunk.type === 'reasoning-delta') return 'reasoning'
  if (chunk.type === 'text-delta') return 'outputting'
  if (chunk.type === 'block-start') {
    if (chunk.blockType === 'reasoning') return 'reasoning'
    if (chunk.blockType === 'text') return 'outputting'
  }
  return null
}

/** 毫秒 → 人类可读时长(如 "9 分 47 秒") */
export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`
}

/** 按耗时给个速度评价 */
export function speedOf(ms) {
  if (ms < 60000) return '⚡ 神速'
  if (ms < 180000) return '🚀 正常速度'
  return '🐢 耗时较长'
}

/** 执行完成的尾部简报 */
export function footerOf(ms) {
  if (ms >= 180000) {
    return `\n\n---\n✅ 执行完成 · 🐢 耗时较长（${fmtDuration(ms)}）\n💡 如需提速，可让我把诊断步骤合并成更少的 SSH 批次`
  }
  return `\n\n---\n✅ 执行完成 · ${speedOf(ms)}（${fmtDuration(ms)}）`
}

/** 截断(按字节) */
export function truncate(text, max) {
  if (Buffer.byteLength(text, 'utf8') <= max) return text
  let t = text
  while (Buffer.byteLength(t, 'utf8') > max) t = t.slice(0, -100)
  return t + '\n\n...(内容过长已截断)'
}

/**
 * 流式动画 v3: 阶段化台词 + 旋转表情 + 进度条 + 已用时/剩余估算 + 长任务彩蛋。
 * 每 intervalMs 更新一次同一条流式消息(共用 streamId), 直到 agent 完成。返回停止函数。
 * @param {() => string} [activity] - 可选: 返回当前真实活动描述, 覆盖阶段台词。
 * @param {typeof DEFAULT_THINKING} [thinking] - 动画素材; 缺省用 {@link DEFAULT_THINKING}。
 * @param {() => 'idle' | 'reasoning' | 'outputting' | string} [getStreamPhase] - 模型流式阶段, 影响旋转表情池。
 */
export function startThinking(ws, frame, streamId, startedAt, timeoutSec, activity, thinking, getStreamPhase) {
  const t = { ...DEFAULT_THINKING, ...(thinking || {}) }
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
    let stage = phases[0].text
    if (!live) {
      for (const p of phases) {
        if (secs >= p.atSec) stage = p.text
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
    ws.replyStream(frame, streamId, `${emoji} ${status}   ⏱ ${secs} 秒${remainTxt}${bar}${egg}`, false).catch(() => {})
  }, intervalMs)
  return () => clearInterval(timer)
}

/** 最终回复: 原流失败(如 WeCom 10 分钟过期)时用新流重试一次 */
export async function sendFinal(ws, frame, streamId, content) {
  try {
    await ws.replyStream(frame, streamId, content, true)
  } catch (e) {
    console.error(`[im-bridge] 原流最终回复失败(${e.message}), 尝试新流...`)
    await ws.replyStream(frame, generateReqId('stream'), content, true)
  }
}
