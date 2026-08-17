/**
 * wecom.js — 企业微信交互封装: 流式动画(v3) + 最终简报 + 发送助手。
 * 逻辑移植自旧版 im-bridge/bridge.js, 改为纯 ESM 供插件使用。
 */
import { generateReqId } from '@wecom/aibot-node-sdk'

/** 流式思考动画的默认素材(可被 Config.thinking / cordis patch 覆盖) */
export const DEFAULT_THINKING = {
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
 */
export function startThinking(ws, frame, streamId, startedAt, timeoutSec, activity, thinking) {
  const t = { ...DEFAULT_THINKING, ...(thinking || {}) }
  const phases = Array.isArray(t.phases) && t.phases.length > 0 ? t.phases : DEFAULT_THINKING.phases
  const spin = Array.isArray(t.spin) && t.spin.length > 0 ? t.spin : DEFAULT_THINKING.spin
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
    const emoji = spin[i % spin.length]
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
