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
  single: '企微·私聊',
  group: '企微·群',
} as const

/** Leading `企微·` / previously used `企业微信·` channel labels. */
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

/** One leading `@nickname` and its separator; JS `\s` covers WeCom's U+00A0 and U+2005. */
const LEADING_MENTION = /^@[^\s@]+(?:\s+|$)/u

/**
 * Drop the `@bot` mentions WeCom prepends to a group message, so the model
 * input and the generated title both start at the actual request. Mentions
 * later in the text stay; a message that is nothing but mentions is returned
 * unchanged rather than emptied.
 * @param text - trimmed inbound message text.
 */
export function stripBotMention(text: string): string {
  let rest = text
  for (let match = LEADING_MENTION.exec(rest); match !== null; match = LEADING_MENTION.exec(rest)) {
    rest = rest.slice(match[0].length)
  }
  const stripped = rest.trim()
  return stripped === '' ? text : stripped
}

/** Previously pinned `企微·私聊/群 <id>` titles from the id-based rename. */
export function isLegacyPinnedWecomTitle(title: string): boolean {
  return /^(?:企微·(?:私聊|群))\s+[A-Za-z0-9][A-Za-z0-9_-]*$/.test(title.trim())
}

function singleRef(sender: string): WecomSessionRef {
  return {
    key: `single:${sender}`,
    kind: 'single',
    sender,
  }
}

/**
 * Stable DSH session id for one epoch of a WeCom window (survives process
 * restart). Epoch 1 carries no suffix, so ids minted before archiving support
 * keep resolving to the same session.
 * @param key - {@link WecomSessionRef.key}.
 * @param epoch - 1-based session generation for this window.
 */
export function wecomSessionId(key: string, epoch = 1): string {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return epoch <= 1 ? `wecom-${hex}` : `wecom-${hex}-${epoch}`
}

/** Session a WeCom window binds to, and how {@link planWecomBind} reaches it. */
export interface WecomBindPlan {
  /** DSH session id from {@link wecomSessionId}. */
  readonly sessionId: string
  /** Adopt a live Agent, resume a persisted session, or create a new one. */
  readonly bind: 'adopt' | 'resume' | 'create'
  /** Which epoch {@link WecomBindPlan.sessionId} belongs to. */
  readonly epoch: number
}

/** What the Host currently knows about candidate session ids. */
export interface WecomBindState {
  /** Whether the Agent registry holds a live Agent for this id. */
  live: (sessionId: string) => boolean
  /** Session ids present in session persistence. */
  stored: ReadonlySet<string>
  /** Session ids in the workspace registry's archive set. */
  archived: ReadonlySet<string>
}

/**
 * Bind a WeCom window to its first non-archived epoch. Archiving a session in
 * the GUI hides it everywhere with no way back, so its epoch is skipped and
 * the window continues in the next one; the chosen id adopts a live Agent,
 * resumes a persisted session, or starts a new one.
 * @param key - {@link WecomSessionRef.key}.
 * @param state - live / persisted / archived knowledge per candidate id.
 */
export function planWecomBind(key: string, state: WecomBindState): WecomBindPlan {
  // An archived id is necessarily a known session, so the archive set bounds
  // how many epochs can be skipped.
  const limit = state.archived.size + 1
  for (let epoch = 1; epoch <= limit; epoch += 1) {
    const sessionId = wecomSessionId(key, epoch)
    if (state.archived.has(sessionId)) continue
    if (state.live(sessionId)) return { sessionId, bind: 'adopt', epoch }
    if (state.stored.has(sessionId)) return { sessionId, bind: 'resume', epoch }
    return { sessionId, bind: 'create', epoch }
  }
  throw new Error(`im-bridge: no free session epoch for ${key} within ${String(limit)} candidates`)
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
