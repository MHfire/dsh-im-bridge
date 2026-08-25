/**
 * Route WeCom inbound frames onto one DSH session per chat window:
 * 1:1 by userid, groups by chatid.
 */

import { createHash } from 'node:crypto'

/** Inbound fields used to pick a session (official `from` / `chattype` / `chatid`). */
export interface WecomSessionFrame {
  body?: {
    from?: { userid?: string }
    userid?: string
    chatid?: string
    chattype?: string | number
  }
}

/** One WeCom chat window mapped onto a DSH session. */
export interface WecomSessionRef {
  /** Map key: `single:<userid>` or `group:<chatid>`. */
  key: string
  /** Window kind. */
  kind: 'single' | 'group'
  /** Sender userid for allow-lists; empty when the group frame omitted `from`. */
  sender: string
  /** Group chatid when {@link WecomSessionRef.kind} is `group`. */
  chatid?: string
}

/** Single-chat frame with no userid — caller must refuse, not merge. */
export class WecomSessionReject extends Error {
  /** Short WeCom reply when the frame cannot be routed. */
  readonly reply: string

  /**
   * @param reply - text sent back on the inbound frame.
   */
  constructor(reply: string) {
    super(reply)
    this.name = 'WecomSessionReject'
    this.reply = reply
  }
}

/**
 * Sender userid from official `from.userid`, then `body.userid`.
 * Does not read `sender` (not on the SDK message type).
 */
export function senderUserid(frame: WecomSessionFrame): string {
  const from = frame.body?.from?.userid?.trim()
  if (from) return from
  const body = frame.body?.userid?.trim()
  if (body) return body
  return ''
}

function isGroupChat(chattype: string | number | undefined, chatid: string): boolean {
  if (chattype === 'group' || chattype === 2 || chattype === '2') return true
  if (chatid !== '' && chattype !== 'single' && chattype !== 1 && chattype !== '1') return true
  return false
}

/** GUI channel prefix by window kind (no userid / chatid). */
export const WECOM_TITLE_PREFIX = {
  single: '企业微信·私聊',
  group: '企业微信·群',
} as const

/** Leading `企业微信·` / legacy `企微·` channel labels. */
const CHANNEL_PREFIX = /^(?:企业微信|企微)·(?:私聊|群)\s*/u

/**
 * Sidebar title: channel kind plus first-prompt text, never an id.
 * @param kind - {@link WecomSessionRef.kind}.
 * @param raw - automatic or previously prefixed title.
 */
export function wecomDisplayTitle(kind: 'single' | 'group', raw: string): string {
  const prefix = WECOM_TITLE_PREFIX[kind]
  const stripped = raw.replace(CHANNEL_PREFIX, '').trim()
  return stripped === '' ? prefix : `${prefix} ${stripped}`
}

/** Previously pinned `企微·私聊/群 <id>` titles from the id-based rename. */
export function isLegacyPinnedWecomTitle(title: string): boolean {
  return /^(?:企微·(?:私聊|群))\s+\S/.test(title.trim())
}

function singleRef(sender: string): WecomSessionRef {
  return {
    key: `single:${sender}`,
    kind: 'single',
    sender,
  }
}

/**
 * Stable DSH session id for a WeCom window (survives process restart).
 * @param key - {@link WecomSessionRef.key}.
 */
export function wecomSessionId(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return `wecom-${hex}`
}

/** How {@link wecomAgentBind} attaches a WeCom window to a DSH Agent. */
export type WecomAgentBind = 'adopt' | 'resume' | 'create'

/**
 * Choose adopt / resume / create. Live Agent wins; a persisted header
 * without a live Agent resumes; otherwise create.
 * @param live - `agents.get(sessionId)` returned an Agent.
 * @param persisted - persistence `list()` included this session id.
 */
export function wecomAgentBind(live: boolean, persisted: boolean): WecomAgentBind {
  if (live) return 'adopt'
  if (persisted) return 'resume'
  return 'create'
}

/**
 * Map one inbound frame to a chat-window session.
 * Group without `chatid` falls back to 1:1 when userid is present.
 * 1:1 without userid throws {@link WecomSessionReject}.
 */
export function resolveWecomSession(frame: WecomSessionFrame): WecomSessionRef {
  const sender = senderUserid(frame)
  const chattype = frame.body?.chattype
  const chatid = frame.body?.chatid?.trim() ?? ''
  if (isGroupChat(chattype, chatid)) {
    if (chatid === '') {
      if (sender === '') {
        throw new WecomSessionReject('无法识别会话，已忽略')
      }
      console.error(`[im-bridge] 群消息缺少 chatid, 退回单聊 key from=${sender}`)
      return singleRef(sender)
    }
    return {
      key: `group:${chatid}`,
      kind: 'group',
      sender,
      chatid,
    }
  }
  if (sender === '') {
    throw new WecomSessionReject('无法识别发送者，已忽略')
  }
  return singleRef(sender)
}
