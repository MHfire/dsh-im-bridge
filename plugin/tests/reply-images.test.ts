import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  collectReplyPngs,
  extractMarkdownUrls,
  resolveChatId,
  sendCollectedPngs,
} from '../src/reply-images.ts'

/** 1×1 transparent PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('extractMarkdownUrls reads images and links', () => {
  const urls = extractMarkdownUrls(
    'see ![a](a.png) and [b](dir/b.png "title") and ![c](<c.png>) plus [site](https://x.example/z.png)',
  )
  assert.deepEqual(urls, ['a.png', 'dir/b.png', 'c.png', 'https://x.example/z.png'])
})

test('collectReplyPngs keeps workspace PNGs and skips the rest', () => {
  const parent = join(tmpdir(), `im-bridge-png-${process.pid}-${Date.now()}`)
  const root = join(parent, 'ws')
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'main_screen.png'), TINY_PNG)
  writeFileSync(join(root, 'out', 'frame.png'), TINY_PNG)
  writeFileSync(join(root, 'not-png.png'), 'not a png')
  writeFileSync(join(parent, 'secret.png'), TINY_PNG)
  try {
    const text = [
      '![屏幕](main_screen.png)',
      '[帧](out/frame.png)',
      '![dup](main_screen.png)',
      '![remote](https://example.com/x.png)',
      '![missing](nope.png)',
      '![bad](not-png.png)',
      '![escape](../secret.png)',
      '![jpg](photo.jpg)',
    ].join('\n')
    const result = collectReplyPngs(text, root)
    assert.equal(result.images.length, 2)
    assert.equal(result.images[0]?.filename, 'main_screen.png')
    assert.equal(result.images[1]?.filename, 'frame.png')
    assert.ok(result.skipped.some((line) => line.includes('文件不存在')))
    assert.ok(result.skipped.some((line) => line.includes('不是 PNG')))
    assert.ok(result.skipped.some((line) => line.includes('越出工作区')))
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('collectReplyPngs enforces size and count caps', () => {
  const root = join(tmpdir(), `im-bridge-png-cap-${process.pid}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'a.png'), TINY_PNG)
  writeFileSync(join(root, 'b.png'), TINY_PNG)
  writeFileSync(join(root, 'big.png'), Buffer.concat([TINY_PNG, Buffer.alloc(50)]))
  try {
    const capped = collectReplyPngs('![a](a.png) ![b](b.png)', root, { maxCount: 1 })
    assert.equal(capped.images.length, 1)
    assert.ok(capped.skipped.some((line) => line.includes('上限')))
    const oversized = collectReplyPngs('![big](big.png)', root, { maxBytes: TINY_PNG.length + 8 })
    assert.equal(oversized.images.length, 0)
    assert.ok(oversized.skipped.some((line) => line.includes('字节')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveChatId prefers group chatid', () => {
  assert.equal(resolveChatId({ body: { chattype: 'group', chatid: 'wrChat' } }, 'userA'), 'wrChat')
  assert.equal(resolveChatId({ body: { chattype: 'single' } }, 'userA'), 'userA')
  assert.equal(resolveChatId({}, 'userA'), 'userA')
})

test('sendCollectedPngs uploads then sends media_id in order', async () => {
  const calls: string[] = []
  const ws = {
    async uploadMedia(buffer: Buffer, options: { type: string; filename: string }) {
      calls.push(`upload:${options.type}:${options.filename}:${buffer.length}`)
      return { media_id: `mid-${options.filename}` }
    },
    async sendMediaMessage(chatid: string, mediaType: string, mediaId: string) {
      calls.push(`send:${chatid}:${mediaType}:${mediaId}`)
    },
  }
  const result = await sendCollectedPngs(ws, 'userA', [
    { absPath: '/ws/a.png', filename: 'a.png', buffer: TINY_PNG },
    { absPath: '/ws/b.png', filename: 'b.png', buffer: TINY_PNG },
  ])
  assert.equal(result.sent, 2)
  assert.deepEqual(result.failed, [])
  assert.deepEqual(calls, [
    `upload:image:a.png:${TINY_PNG.length}`,
    'send:userA:image:mid-a.png',
    `upload:image:b.png:${TINY_PNG.length}`,
    'send:userA:image:mid-b.png',
  ])
})

test('sendCollectedPngs continues after one failure', async () => {
  const ws = {
    async uploadMedia(_buffer: Buffer, options: { type: string; filename: string }) {
      if (options.filename === 'bad.png') throw new Error('upload failed')
      return { media_id: 'ok' }
    },
    async sendMediaMessage() {},
  }
  const result = await sendCollectedPngs(ws, 'userA', [
    { absPath: '/ws/bad.png', filename: 'bad.png', buffer: TINY_PNG },
    { absPath: '/ws/ok.png', filename: 'ok.png', buffer: TINY_PNG },
  ])
  assert.equal(result.sent, 1)
  assert.deepEqual(result.failed, ['bad.png'])
})
