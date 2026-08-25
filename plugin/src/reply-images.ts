/**
 * Collect workspace PNG paths from assistant Markdown and send them as
 * WeCom image messages after the text stream finishes.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

/** WeCom image-type upload cap (bytes before encoding). */
export const MAX_PNG_BYTES = 10 * 1024 * 1024
/** WeCom mixed-image list cap; also keeps send-rate headroom after stream ticks. */
export const MAX_PNG_COUNT = 10
/** PNG signature (first 8 bytes). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One local PNG ready to upload. */
export interface CollectedPng {
  /** Realpath inside the workspace. */
  absPath: string
  /** Basename passed to `uploadMedia` (`*.png`). */
  filename: string
  /** File bytes. */
  buffer: Buffer
}

/** Result of scanning a reply for sendable PNGs. */
export interface CollectPngResult {
  /** Deduped PNGs in first-seen order, capped at {@link MAX_PNG_COUNT}. */
  images: CollectedPng[]
  /** Human-readable skip reasons (path + why). */
  skipped: string[]
}

/** Optional caps for tests; production uses the WeCom defaults. */
export interface CollectPngOptions {
  /** Override {@link MAX_PNG_BYTES}. */
  maxBytes?: number
  /** Override {@link MAX_PNG_COUNT}. */
  maxCount?: number
}

/** WeCom client methods used after `sendFinal`. */
export interface MediaSender {
  uploadMedia(
    fileBuffer: Buffer,
    options: { type: string; filename: string },
  ): Promise<{ media_id?: string; mediaId?: string }>
  sendMediaMessage(chatid: string, mediaType: string, mediaId: string): Promise<unknown>
}

/** `![alt](url)` or `[text](url)`, capturing the destination. */
const MARKDOWN_LINK = /!?\[(?:[^\]]*?)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

/**
 * Pull destination URLs from Markdown images and links, in order.
 * @param text - assistant reply body.
 * @returns raw destinations (angle brackets already stripped).
 */
export function extractMarkdownUrls(text: string): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const raw = match[1]
    if (raw === undefined) continue
    const dest = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
    if (dest !== '') urls.push(dest)
  }
  return urls
}

/**
 * Chat id for `sendMediaMessage`: group `chatid`, otherwise the sender userid.
 * @param frame - inbound WeCom frame.
 * @param sender - userid used for 1:1 chats.
 */
export function resolveChatId(
  frame: { body?: { chatid?: string; chattype?: string | number } },
  sender: string,
): string {
  const chattype = frame.body?.chattype
  const chatid = frame.body?.chatid
  const grouped = chattype === 'group' || chattype === 2 || chattype === '2'
  if (grouped && chatid) return chatid
  const single = chattype === 'single' || chattype === 1 || chattype === '1'
  if (!single && chatid) return chatid
  return sender
}

function stripQueryHash(url: string): string {
  const noHash = url.split('#')[0] ?? url
  return noHash.split('?')[0] ?? noHash
}

function isRemote(url: string): boolean {
  return /^(?:https?:|data:|mailto:|file:)/i.test(url)
}

function isPngPath(url: string): boolean {
  return /\.png$/i.test(url)
}

function containedIn(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return false
  if (isAbsolute(rel)) return false
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  return true
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * Resolve Markdown destinations to workspace PNG files.
 * @param text - untruncated assistant reply.
 * @param workspace - Agent cwd / plugin `workspace`.
 * @param options - optional size/count caps.
 */
export function collectReplyPngs(
  text: string,
  workspace: string,
  options?: CollectPngOptions,
): CollectPngResult {
  const maxBytes = options?.maxBytes ?? MAX_PNG_BYTES
  const maxCount = options?.maxCount ?? MAX_PNG_COUNT
  const images: CollectedPng[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  const root = tryRealpath(workspace)
  if (root === undefined) {
    skipped.push(`工作区不可读: ${workspace}`)
    return { images, skipped }
  }

  for (const raw of extractMarkdownUrls(text)) {
    const url = stripQueryHash(raw.trim())
    if (url === '' || isRemote(url)) continue
    if (!isPngPath(url)) continue
    if (images.length >= maxCount) {
      skipped.push(`超过 ${maxCount} 张上限，忽略后续图片`)
      break
    }
    const abs = resolve(root, url)
    const real = tryRealpath(abs)
    if (real === undefined) {
      skipped.push(`文件不存在: ${url}`)
      continue
    }
    if (!containedIn(root, real)) {
      skipped.push(`越出工作区: ${url}`)
      continue
    }
    if (seen.has(real)) continue
    let size: number
    try {
      size = statSync(real).size
    } catch {
      skipped.push(`无法读取: ${url}`)
      continue
    }
    if (size > maxBytes) {
      skipped.push(`超过 ${maxBytes} 字节: ${url}`)
      continue
    }
    let buffer: Buffer
    try {
      buffer = readFileSync(real)
    } catch {
      skipped.push(`无法读取: ${url}`)
      continue
    }
    if (buffer.subarray(0, PNG_MAGIC.length).compare(PNG_MAGIC) !== 0) {
      skipped.push(`不是 PNG: ${url}`)
      continue
    }
    seen.add(real)
    images.push({ absPath: real, filename: basename(real), buffer })
  }
  return { images, skipped }
}

function mediaIdOf(result: { media_id?: string; mediaId?: string }): string | undefined {
  const id = result.media_id ?? result.mediaId
  return id !== undefined && id !== '' ? id : undefined
}

/**
 * Upload each PNG then push it as a WeCom image message.
 * Failures are logged and do not abort the remaining files.
 * @param ws - WeCom client.
 * @param chatid - 1:1 userid or group chatid.
 * @param images - files from {@link collectReplyPngs}.
 * @returns counts of sent vs failed filenames.
 */
export async function sendCollectedPngs(
  ws: MediaSender,
  chatid: string,
  images: CollectedPng[],
): Promise<{ sent: number; failed: string[] }> {
  const failed: string[] = []
  let sent = 0
  for (const image of images) {
    try {
      const uploaded = await ws.uploadMedia(image.buffer, {
        type: 'image',
        filename: image.filename,
      })
      const mediaId = mediaIdOf(uploaded)
      if (mediaId === undefined) {
        failed.push(image.filename)
        console.error(`[im-bridge] 上传成功但无 media_id: ${image.filename}`)
        continue
      }
      await ws.sendMediaMessage(chatid, 'image', mediaId)
      sent++
      console.log(`[im-bridge] 已发送图片 ${image.filename} (${image.buffer.length}B)`)
    } catch (error) {
      failed.push(image.filename)
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[im-bridge] 发送图片失败 ${image.filename}: ${message}`)
    }
  }
  return { sent, failed }
}
