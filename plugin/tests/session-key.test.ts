import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isLegacyPinnedWecomTitle,
  planWecomBind,
  resolveWecomSession,
  senderUserid,
  stripBotMention,
  wecomDisplayTitle,
  wecomSessionId,
  WecomSessionReject,
} from '../src/session-key.ts'

test('two 1:1 users get two keys', () => {
  const a = resolveWecomSession({
    body: { chattype: 'single', from: { userid: 'userA' } },
  })
  const b = resolveWecomSession({
    body: { chattype: 'single', from: { userid: 'userB' } },
  })
  assert.equal(a.key, 'single:userA')
  assert.equal(b.key, 'single:userB')
  assert.notEqual(a.key, b.key)
  assert.equal(a.kind, 'single')
  assert.equal(a.sender, 'userA')
})

test('same user DM and group are two keys', () => {
  const dm = resolveWecomSession({
    body: { chattype: 'single', from: { userid: 'userA' } },
  })
  const group = resolveWecomSession({
    body: { chattype: 'group', chatid: 'wrChat', from: { userid: 'userA' } },
  })
  assert.equal(dm.key, 'single:userA')
  assert.equal(group.key, 'group:wrChat')
  assert.notEqual(dm.key, group.key)
})

test('two senders in the same group share one key', () => {
  const a = resolveWecomSession({
    body: { chattype: 'group', chatid: 'wrChat', from: { userid: 'userA' } },
  })
  const b = resolveWecomSession({
    body: { chattype: '2', chatid: 'wrChat', from: { userid: 'userB' } },
  })
  assert.equal(a.key, 'group:wrChat')
  assert.equal(b.key, 'group:wrChat')
  assert.equal(a.sender, 'userA')
  assert.equal(b.sender, 'userB')
  assert.equal(wecomSessionId(a.key), wecomSessionId(b.key))
})

test('userid is from.userid then body.userid, never sender', () => {
  assert.equal(
    senderUserid({ body: { from: { userid: 'fromUser' }, userid: 'bodyUser' } }),
    'fromUser',
  )
  assert.equal(senderUserid({ body: { userid: 'bodyUser' } }), 'bodyUser')
  assert.equal(
    senderUserid({
      body: { sender: { userid: 'senderOnly' } } as { from?: { userid?: string }; userid?: string },
    }),
    '',
  )
  assert.throws(
    () => resolveWecomSession({
      body: {
        chattype: 'single',
        sender: { userid: 'senderOnly' },
      } as { chattype: string; from?: { userid?: string }; userid?: string },
    }),
    (error: unknown) => error instanceof WecomSessionReject,
  )
})

test('missing userid never falls into unknown', () => {
  assert.throws(
    () => resolveWecomSession({ body: { chattype: 'single' } }),
    (error: unknown) => {
      assert.ok(error instanceof WecomSessionReject)
      assert.equal(error.reply, '无法识别发送者，已忽略')
      assert.equal(error.message.includes('unknown'), false)
      return true
    },
  )
  assert.throws(
    () => resolveWecomSession({ body: { chattype: 'group' } }),
    (error: unknown) => {
      assert.ok(error instanceof WecomSessionReject)
      assert.equal(error.reply, '无法识别会话，已忽略')
      return true
    },
  )
})

test('group without chatid falls back to single userid', () => {
  const previous = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    const ref = resolveWecomSession({
      body: { chattype: 'group', from: { userid: 'userA' } },
    })
    assert.equal(ref.key, 'single:userA')
    assert.equal(ref.kind, 'single')
    assert.ok(lines.some((line) => line.includes('缺少 chatid') && line.includes('userA')))
    assert.equal(ref.key.includes('unknown'), false)
  } finally {
    console.error = previous
  }
})

test('wecomDisplayTitle uses channel plus prompt text', () => {
  assert.equal(wecomDisplayTitle('single', '帮我查一下文件'), '企微·私聊 帮我查一下文件')
  assert.equal(wecomDisplayTitle('group', '汇总本周进度'), '企微·群 汇总本周进度')
})

test('wecomDisplayTitle does not stack prefixes and retargets kind', () => {
  assert.equal(
    wecomDisplayTitle('single', '企微·私聊 帮我查一下文件'),
    '企微·私聊 帮我查一下文件',
  )
  assert.equal(
    wecomDisplayTitle('group', '企业微信·私聊 帮我查一下文件'),
    '企微·群 帮我查一下文件',
  )
  assert.equal(wecomDisplayTitle('single', '企微·群 wrChat'), '企微·私聊 wrChat')
})

test('wecomDisplayTitle empty body keeps the channel label', () => {
  assert.equal(wecomDisplayTitle('single', ''), '企微·私聊')
  assert.equal(wecomDisplayTitle('group', '   '), '企微·群')
  assert.equal(wecomDisplayTitle('single', '企微·私聊'), '企微·私聊')
})

test('stripBotMention drops leading mentions with WeCom separators', () => {
  assert.equal(stripBotMention('@MediaAgent 测试一下'), '测试一下')
  assert.equal(stripBotMention('@MediaAgent\u2005测试一下'), '测试一下')
  assert.equal(stripBotMention('@MediaAgent\u00a0测试一下'), '测试一下')
  assert.equal(stripBotMention('@MediaAgent @张三 测试一下'), '测试一下')
})

test('stripBotMention keeps plain text, inner mentions, and mention-only messages', () => {
  assert.equal(stripBotMention('测试一下'), '测试一下')
  assert.equal(stripBotMention('帮我问 @张三 进度'), '帮我问 @张三 进度')
  assert.equal(stripBotMention('@MediaAgent'), '@MediaAgent')
  assert.equal(stripBotMention('@MediaAgent @张三'), '@MediaAgent @张三')
})

test('isLegacyPinnedWecomTitle matches old id pins only', () => {
  assert.equal(isLegacyPinnedWecomTitle('企微·私聊 userA'), true)
  assert.equal(isLegacyPinnedWecomTitle('企微·群 wrChat'), true)
  assert.equal(isLegacyPinnedWecomTitle('企微·私聊 帮我查一下文件'), false)
  assert.equal(isLegacyPinnedWecomTitle('企业微信·私聊 帮我查一下文件'), false)
  assert.equal(isLegacyPinnedWecomTitle('企微·私聊'), false)
})

test('wecomSessionId is stable, prefixed, and distinct per key', () => {
  const a = wecomSessionId('single:userA')
  const b = wecomSessionId('single:userB')
  const group = wecomSessionId('group:wrChat')
  assert.match(a, /^wecom-[0-9a-f]{16}$/)
  assert.equal(a, wecomSessionId('single:userA'))
  assert.notEqual(a, b)
  assert.notEqual(a, group)
})

test('wecomSessionId suffixes later epochs and keeps the first id bare', () => {
  const base = wecomSessionId('single:userA')
  assert.equal(wecomSessionId('single:userA', 1), base)
  assert.equal(wecomSessionId('single:userA', 2), `${base}-2`)
  assert.equal(wecomSessionId('single:userA', 3), `${base}-3`)
  assert.equal(wecomSessionId('single:userA', 2), wecomSessionId('single:userA', 2))
})

/** Build the {@link planWecomBind} state from plain id lists. */
function bindState(live: string[], stored: string[], archived: string[]): {
  live: (id: string) => boolean
  stored: ReadonlySet<string>
  archived: ReadonlySet<string>
} {
  return {
    live: (id) => live.includes(id),
    stored: new Set(stored),
    archived: new Set(archived),
  }
}

test('planWecomBind prefers live, then persisted, then create', () => {
  const key = 'single:userA'
  const base = wecomSessionId(key)
  assert.deepEqual(
    planWecomBind(key, bindState([base], [base], [])),
    { sessionId: base, bind: 'adopt', epoch: 1 },
  )
  assert.deepEqual(
    planWecomBind(key, bindState([], [base], [])),
    { sessionId: base, bind: 'resume', epoch: 1 },
  )
  assert.deepEqual(
    planWecomBind(key, bindState([], [], [])),
    { sessionId: base, bind: 'create', epoch: 1 },
  )
})

test('planWecomBind skips archived epochs', () => {
  const key = 'group:wrChat'
  const base = wecomSessionId(key)
  const second = wecomSessionId(key, 2)
  const third = wecomSessionId(key, 3)
  assert.deepEqual(
    planWecomBind(key, bindState([], [base], [base])),
    { sessionId: second, bind: 'create', epoch: 2 },
  )
  assert.deepEqual(
    planWecomBind(key, bindState([], [base, second], [base])),
    { sessionId: second, bind: 'resume', epoch: 2 },
  )
  assert.deepEqual(
    planWecomBind(key, bindState([], [base, second], [base, second])),
    { sessionId: third, bind: 'create', epoch: 3 },
  )
})

test('planWecomBind never adopts an archived live Agent', () => {
  const key = 'single:userA'
  const base = wecomSessionId(key)
  assert.deepEqual(
    planWecomBind(key, bindState([base], [base], [base])),
    { sessionId: wecomSessionId(key, 2), bind: 'create', epoch: 2 },
  )
})
