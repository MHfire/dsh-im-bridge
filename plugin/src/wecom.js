/**
 * wecom.js — 企业微信交互封装: 流式动画(v3) + 最终简报 + 发送助手。
 * 逻辑移植自旧版 im-bridge/bridge.js, 改为纯 ESM 供插件使用。
 */
import AiBot from '@wecom/aibot-node-sdk'

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
 * 流式动画 v3(办公助手人设): 阶段化人格台词 + 旋转表情 + 进度条 + 已用时/剩余估算 + 长任务彩蛋。
 * 每 1.5s 更新一次同一条流式消息(共用 streamId), 直到 agent 完成。返回停止函数。
 * @param {() => string} [activity] - 可选: 返回当前真实活动描述(如 "📋 正在执行 <操作>"), 覆盖阶段台词。
 */
export function startThinking(ws, frame, streamId, startedAt, timeoutSec, activity) {
  const PHASES = [
    [0, '🤔 正在理解你的需求…'],
    [8, '📋 正在整理任务清单'],
    [25, '🔍 正在查找相关资料'],
    [55, '✍️ 正在处理文档/数据'],
    [120, '🧠 正在思考最佳方案…'],
    [240, '⏳ 任务较繁琐，请稍候…'],
    [420, '☕ 快好了，正在收尾…'],
  ]
  const SPIN = ['🧠', '💭', '✨', '🔎', '⚡']
  const EGGS = [
    '📎 顺手把要点整理好了，稍后一起给你',
    '📶 网络有点忙，让它慢慢跑',
    '🎯 结果快出来了，坚持一下',
    '🗂️ 资料较多，正在汇总中',
    '🌙 别盯着了，完成会自动通知你',
  ]
  const total = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 600
  let i = 0
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000)
    const live = activity ? activity() : ''
    let stage = PHASES[0][1]
    if (!live) for (const [t, s] of PHASES) if (secs >= t) stage = s
    const pct = Math.min(Math.floor((secs / total) * 100), 99)
    const filled = '█'.repeat(Math.floor(pct / 10))
    const bar = secs < 3 ? '' : `\n${filled}${'░'.repeat(10 - filled.length)} ${String(pct).padStart(2)}%`
    const remain = Math.max(total - secs, 0)
    const remainTxt = secs < 3 ? '' : ` · 预计还剩 ${Math.floor(remain / 60)}分${remain % 60}秒`
    const egg = secs >= 240 ? `\n${EGGS[Math.floor(secs / 60) % EGGS.length]}` : ''
    const emoji = SPIN[i % SPIN.length]
    i++
    const status = live || stage
    ws.replyStream(frame, streamId, `${emoji} ${status}   ⏱ ${secs} 秒${remainTxt}${bar}${egg}`, false).catch(() => {})
  }, 1500)
  return () => clearInterval(timer)
}

/** 最终回复: 原流失败(如 WeCom 10 分钟过期)时用新流重试一次 */
export async function sendFinal(ws, frame, streamId, content) {
  try {
    await ws.replyStream(frame, streamId, content, true)
  } catch (e) {
    console.error(`[im-bridge] 原流最终回复失败(${e.message}), 尝试新流...`)
    await ws.replyStream(frame, AiBot.generateReqId('stream'), content, true)
  }
}
