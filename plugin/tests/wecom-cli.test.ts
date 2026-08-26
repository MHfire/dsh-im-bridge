import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  ALLOW_FROM_REQUIRED_MESSAGE,
  AUTH_INIT_FAILED_MESSAGE,
  AUTH_INIT_HINT,
  AUTH_INIT_MISSING_MESSAGE,
  SKILLS_SERVICE_MISSING_MESSAGE,
  WECOM_CLI_NO_OFFICE_PROMPT,
  WECOM_CLI_PROMPT,
  WORKSPACE_WECOMCLI_LEAK_MESSAGE,
  countWecomcliSkills,
  countWorkspaceWecomcliLeaks,
  DEFAULT_MANAGED_SKILLS_DIR,
  DEFAULT_WORKSPACE_AGENTS_SKILLS_DIR,
  DEFAULT_WORKSPACE_CONFIG_DIR,
  DEFAULT_WORKSPACE_SKILLS_DIR,
  ensureConfigDir,
  ensureOnPath,
  extractWecomSkillsFromZip,
  installOfficialWecomSkills,
  loadWecomSkills,
  authInitArgv,
  parseAuthStatus,
  parseSkillMarkdown,
  probeAuth,
  registerWecomOfficeSkills,
  resolveConfigDir,
  resolveDshHome,
  resolveSkillsDir,
  resolveWecomBinFromPackage,
  senderHasOfficeAccess,
  shouldEnableWecomCli,
  shouldInjectWecomOfficeSkills,
  skillsInstallHint,
  toRuntimeSkillRegistration,
  trySeedAuth,
  WECOM_CLI_CONFIG_DIR_ENV,
  WecomSkillsInstallError,
  workspaceWecomcliLeakRoots,
  writeWecomShim,
} from '../src/wecom-cli.ts'

function scratch(label: string): string {
  return join(tmpdir(), `im-bridge-${label}-${process.pid}-${Date.now()}`)
}

function skillMarkdown(name: string): string {
  return ['---', `name: ${name}`, 'description: x', '---', 'body'].join('\n')
}

function zipFromText(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(files)) {
    entries[path] = strToU8(text)
  }
  return zipSync(entries)
}

test('parseSkillMarkdown accepts kebab-case name and description', () => {
  const skill = parseSkillMarkdown(
    [
      '---',
      'name: wecomcli-shared',
      'description: 公共前置检查',
      '---',
      '',
      '# body',
      '',
      'do the check',
    ].join('\n'),
    '/skills/wecomcli-shared',
  )
  assert.deepEqual(skill, {
    name: 'wecomcli-shared',
    description: '公共前置检查',
    content: '# body\n\ndo the check',
    directory: '/skills/wecomcli-shared',
  })
})

test('parseSkillMarkdown rejects missing fields and non-kebab names', () => {
  assert.equal(
    parseSkillMarkdown('---\ndescription: x\n---\nbody\n', '/s'),
    undefined,
  )
  assert.equal(
    parseSkillMarkdown('---\nname: wecomcli-shared\n---\nbody\n', '/s'),
    undefined,
  )
  assert.equal(
    parseSkillMarkdown('---\nname: WecomShared\ndescription: x\n---\nbody\n', '/s'),
    undefined,
  )
  assert.equal(
    parseSkillMarkdown('# no frontmatter\n', '/s'),
    undefined,
  )
  assert.equal(
    parseSkillMarkdown('---\nname: wecomcli-shared\ndescription: ""\n---\nbody\n', '/s'),
    undefined,
  )
})

test('loadWecomSkills returns [] for a missing directory', () => {
  assert.deepEqual(loadWecomSkills(join(tmpdir(), 'im-bridge-no-such-skills-dir')), [])
})

test('loadWecomSkills reads one-level SKILL.md and filters by allow-list', () => {
  const root = scratch('skills')
  mkdirSync(join(root, 'wecomcli-shared'), { recursive: true })
  mkdirSync(join(root, 'wecomcli-contact'), { recursive: true })
  mkdirSync(join(root, 'wecomcli-bad'), { recursive: true })
  writeFileSync(join(root, 'wecomcli-shared', 'SKILL.md'), [
    '---',
    'name: wecomcli-shared',
    'description: shared',
    '---',
    'shared body',
  ].join('\n'))
  writeFileSync(join(root, 'wecomcli-contact', 'SKILL.md'), [
    '---',
    'name: wecomcli-contact',
    'description: contact',
    '---',
    'contact body',
  ].join('\n'))
  writeFileSync(join(root, 'wecomcli-bad', 'SKILL.md'), '---\nname: NotKebab\ndescription: x\n---\n')
  writeFileSync(join(root, 'orphan.md'), '---\nname: wecomcli-orphan\ndescription: x\n---\n')
  try {
    const all = loadWecomSkills(root)
    assert.equal(all.length, 2)
    assert.deepEqual(all.map(skill => skill.name).sort(), ['wecomcli-contact', 'wecomcli-shared'])
    const filtered = loadWecomSkills(root, ['wecomcli-contact'])
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0]?.name, 'wecomcli-contact')
    assert.equal(filtered[0]?.directory, join(root, 'wecomcli-contact'))
    assert.equal(countWecomcliSkills(all), 2)
    assert.equal(countWecomcliSkills([{ name: 'other-skill', description: 'x', content: '', directory: root }]), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('shouldEnableWecomCli uses the office list, independent of chat allowFrom', () => {
  assert.equal(shouldEnableWecomCli(false, ['userA']), false)
  assert.equal(shouldEnableWecomCli(true, []), false)
  assert.equal(shouldEnableWecomCli(true, ['', '  ']), false)
  assert.equal(shouldEnableWecomCli(true, ['userA']), true)
  assert.match(ALLOW_FROM_REQUIRED_MESSAGE, /wecomCli\.allowFrom/)
  assert.equal(senderHasOfficeAccess(['userA'], 'userA'), true)
  assert.equal(senderHasOfficeAccess(['  userA  '], 'userA'), true)
  assert.equal(senderHasOfficeAccess(['userA'], 'userB'), false)
  assert.equal(senderHasOfficeAccess([], 'userA'), false)
})

test('shouldInjectWecomOfficeSkills is only office 1:1', () => {
  assert.equal(shouldInjectWecomOfficeSkills('single', true), true)
  assert.equal(shouldInjectWecomOfficeSkills('single', false), false)
  assert.equal(shouldInjectWecomOfficeSkills('group', true), false)
  assert.equal(shouldInjectWecomOfficeSkills('group', false), false)
  assert.equal(shouldInjectWecomOfficeSkills(undefined, true), false)
})

test('resolveSkillsDir defaults to $DSH_HOME/wecom-cli-skills and resolves relative paths', () => {
  const workspace = join(tmpdir(), 'ws-skills-test')
  const home = join(tmpdir(), 'dsh-home-skills-test')
  const env: NodeJS.ProcessEnv = { DSH_HOME: home }
  assert.equal(resolveSkillsDir('', workspace, env), join(home, DEFAULT_MANAGED_SKILLS_DIR))
  assert.equal(resolveSkillsDir('', workspace, env), join(resolveDshHome(env), DEFAULT_MANAGED_SKILLS_DIR))
  const abs = join(workspace, 'custom', 'skills')
  assert.equal(resolveSkillsDir(abs, workspace, env), abs)
  assert.equal(resolveSkillsDir(join('.dsh', 'extra'), workspace, env), resolve(workspace, '.dsh', 'extra'))
})

test('workspaceWecomcliLeakRoots lists .dsh/skills and .agents/skills', () => {
  const workspace = join(tmpdir(), 'ws-leak-roots')
  assert.deepEqual(workspaceWecomcliLeakRoots(workspace), [
    join(workspace, DEFAULT_WORKSPACE_SKILLS_DIR),
    join(workspace, DEFAULT_WORKSPACE_AGENTS_SKILLS_DIR),
  ])
})

test('countWorkspaceWecomcliLeaks counts wecomcli-* in workspace scan roots', () => {
  const workspace = scratch('leak-ws')
  const agents = join(workspace, DEFAULT_WORKSPACE_AGENTS_SKILLS_DIR, 'wecomcli-email')
  mkdirSync(agents, { recursive: true })
  writeFileSync(join(agents, 'SKILL.md'), [
    '---',
    'name: wecomcli-email',
    'description: mail',
    '---',
    'body',
  ].join('\n'))
  const other = join(workspace, DEFAULT_WORKSPACE_SKILLS_DIR, 'v4l2-frame-capture')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'SKILL.md'), [
    '---',
    'name: v4l2-frame-capture',
    'description: cam',
    '---',
    'body',
  ].join('\n'))
  try {
    assert.equal(countWorkspaceWecomcliLeaks(workspace), 1)
    assert.match(WORKSPACE_WECOMCLI_LEAK_MESSAGE, /wecomcli-/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('toRuntimeSkillRegistration maps wecomcli-* and skips other names', () => {
  const office = {
    name: 'wecomcli-shared',
    description: 'shared',
    content: 'body',
    directory: '/skills/wecomcli-shared',
  }
  const mapped = toRuntimeSkillRegistration(office)
  assert.deepEqual(mapped, {
    name: 'wecomcli-shared',
    description: 'shared',
    source: 'runtime',
    content: 'body',
    resourceBase: { kind: 'directory', path: '/skills/wecomcli-shared' },
  })
  assert.equal(toRuntimeSkillRegistration({
    name: 'v4l2-frame-capture',
    description: 'cam',
    content: 'x',
    directory: '/skills/v4l2',
  }), undefined)
})

test('registerWecomOfficeSkills registers wecomcli-* on agentCtx.skills', () => {
  const captured: unknown[] = []
  const agentCtx = {
    get(name: string): unknown {
      if (name !== 'skills') return undefined
      return {
        register(skill: unknown): () => void {
          captured.push(skill)
          return () => {}
        },
      }
    },
  }
  const count = registerWecomOfficeSkills(agentCtx, [
    { name: 'wecomcli-email', description: 'mail', content: 'c', directory: '/s/wecomcli-email' },
    { name: 'other-skill', description: 'x', content: '', directory: '/s/other' },
  ])
  assert.equal(count, 1)
  assert.equal(captured.length, 1)
  assert.equal((captured[0] as { name: string }).name, 'wecomcli-email')
  assert.equal((captured[0] as { resourceBase: { kind: string } }).resourceBase.kind, 'directory')
})

test('registerWecomOfficeSkills warns when skills.register is missing', () => {
  const count = registerWecomOfficeSkills({ get: () => undefined }, [
    { name: 'wecomcli-email', description: 'mail', content: 'c', directory: '/s/wecomcli-email' },
  ])
  assert.equal(count, 0)
  assert.match(SKILLS_SERVICE_MISSING_MESSAGE, /skills/)
})

test('resolveConfigDir defaults to workspace .dsh/wecom-cli and resolves relative paths', () => {
  const workspace = join(tmpdir(), 'ws-config-test')
  assert.equal(resolveConfigDir('', workspace), join(workspace, DEFAULT_WORKSPACE_CONFIG_DIR))
  const abs = join(workspace, 'custom', 'wecom-cli')
  assert.equal(resolveConfigDir(abs, workspace), abs)
  assert.equal(resolveConfigDir(join('.dsh', 'extra-cli'), workspace), resolve(workspace, '.dsh', 'extra-cli'))
})

test('ensureConfigDir creates the directory and sets WECOM_CLI_CONFIG_DIR', () => {
  const root = scratch('config-dir')
  const dir = join(root, '.dsh', 'wecom-cli')
  const env: NodeJS.ProcessEnv = {}
  try {
    assert.equal(ensureConfigDir(dir, env), dir)
    assert.equal(existsSync(dir), true)
    assert.equal(env[WECOM_CLI_CONFIG_DIR_ENV], dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('skillsInstallHint names the managed skills directory and not --dir', () => {
  const dir = join('C:\\Users\\me\\.dsh', 'wecom-cli-skills')
  const hint = skillsInstallHint(dir)
  assert.match(hint, /Settings/)
  assert.match(hint, /wecom-cli-skills/)
  assert.match(hint, /npx skills add -g/)
  assert.match(hint, /没有 --dir/)
})

test('extractWecomSkillsFromZip writes wecomcli-* SKILL.md and leaves other folders', () => {
  const dest = scratch('zip-ok')
  mkdirSync(join(dest, 'keep-me'), { recursive: true })
  writeFileSync(join(dest, 'keep-me', 'note.txt'), 'stay')
  mkdirSync(join(dest, 'wecomcli-shared'), { recursive: true })
  writeFileSync(join(dest, 'wecomcli-shared', 'SKILL.md'), 'old')
  const zip = zipFromText({
    'wecom-cli-main/README.md': 'ignore',
    'wecom-cli-main/skills/wecomcli-shared/SKILL.md': skillMarkdown('wecomcli-shared'),
    'wecom-cli-main/skills/wecomcli-email/SKILL.md': skillMarkdown('wecomcli-email'),
  })
  try {
    const result = extractWecomSkillsFromZip(zip, dest)
    assert.equal(result.dest, dest)
    assert.equal(result.count, 2)
    assert.equal(existsSync(join(dest, 'wecomcli-shared', 'SKILL.md')), true)
    assert.match(readFileSync(join(dest, 'wecomcli-shared', 'SKILL.md'), 'utf8'), /wecomcli-shared/)
    assert.equal(readFileSync(join(dest, 'keep-me', 'note.txt'), 'utf8'), 'stay')
    assert.deepEqual(
      loadWecomSkills(dest).map(skill => skill.name).sort(),
      ['wecomcli-email', 'wecomcli-shared'],
    )
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})

test('extractWecomSkillsFromZip skips zip directory entries under a skill', () => {
  const dest = scratch('zip-refs')
  mkdirSync(dest, { recursive: true })
  const zip = zipFromText({
    'wecom-cli-main/skills/wecomcli-calendar/SKILL.md': skillMarkdown('wecomcli-calendar'),
    'wecom-cli-main/skills/wecomcli-calendar/references': '',
    'wecom-cli-main/skills/wecomcli-calendar/references/': '',
    'wecom-cli-main/skills/wecomcli-calendar/references/api.md': '# api',
  })
  try {
    const result = extractWecomSkillsFromZip(zip, dest)
    assert.equal(result.count, 1)
    const refs = join(dest, 'wecomcli-calendar', 'references')
    assert.equal(lstatSync(refs).isDirectory(), true)
    assert.equal(readFileSync(join(refs, 'api.md'), 'utf8'), '# api')
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})

test('extractWecomSkillsFromZip rejects zip-slip paths and does not write outside dest', () => {
  const dest = scratch('zip-slip')
  mkdirSync(dest, { recursive: true })
  const zip = zipFromText({
    'wecom-cli-main/skills/wecomcli-shared/../../outside.txt': 'pwn',
  })
  try {
    assert.throws(
      () => extractWecomSkillsFromZip(zip, dest),
      (error: unknown) => error instanceof WecomSkillsInstallError && /非法路径/.test(error.message),
    )
    assert.equal(existsSync(join(dest, '..', 'outside.txt')), false)
    assert.equal(existsSync(join(dest, 'outside.txt')), false)
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})

test('extractWecomSkillsFromZip fails when the zip has no wecomcli-* skills', () => {
  const dest = scratch('zip-empty')
  mkdirSync(dest, { recursive: true })
  const zip = zipFromText({
    'wecom-cli-main/README.md': 'no skills',
  })
  try {
    assert.throws(
      () => extractWecomSkillsFromZip(zip, dest),
      (error: unknown) => error instanceof WecomSkillsInstallError && /没有 wecomcli/.test(error.message),
    )
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})

test('installOfficialWecomSkills uses a fixture zip without fetching', async () => {
  const dest = scratch('zip-install')
  const zip = zipFromText({
    'wecom-cli-main/skills/wecomcli-shared/SKILL.md': skillMarkdown('wecomcli-shared'),
  })
  try {
    const result = await installOfficialWecomSkills(dest, { zip })
    assert.equal(result.count, 1)
    assert.equal(existsSync(join(dest, 'wecomcli-shared', 'SKILL.md')), true)
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})

test('resolveWecomBinFromPackage reads the bin field', () => {
  const root = scratch('pkg')
  mkdirSync(join(root, 'bin'), { recursive: true })
  const binJs = join(root, 'bin', 'wecom.js')
  writeFileSync(binJs, 'console.log("ok")')
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@wecom/cli',
    bin: { 'wecom-cli': './bin/wecom.js' },
  }))
  try {
    assert.equal(resolveWecomBinFromPackage(join(root, 'package.json')), binJs)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeWecomShim writes a Windows cmd that points at binJs', () => {
  const root = scratch('shim-win')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, 'ok', 'utf8')
  const shimDir = join(root, 'bin')
  try {
    writeWecomShim(shimDir, binJs, 'win32', 'C:\\nodejs\\node.exe')
    const cmd = readFileSync(join(shimDir, 'wecom-cli.cmd'), 'utf8')
    assert.match(cmd, /C:\\nodejs\\node\.exe/)
    assert.match(cmd, /wecom\.js/)
    assert.match(cmd, /%/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureOnPath prepends a shim when wecom-cli is missing', () => {
  const root = scratch('path')
  mkdirSync(root, { recursive: true })
  const dshHome = join(root, 'dsh')
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, 'ok', 'utf8')
  const env: NodeJS.ProcessEnv = { PATH: join(root, 'nowhere') }
  try {
    const result = ensureOnPath(binJs, { dshHome, env, platform: 'win32', execPath: 'C:\\nodejs\\node.exe' })
    assert.equal(result.alreadyOnPath, false)
    assert.equal(result.shimDir, join(dshHome, 'wecom-cli-bin'))
    assert.equal(existsSync(join(dshHome, 'wecom-cli-bin', 'wecom-cli.cmd')), true)
    assert.ok(env.PATH?.startsWith(join(dshHome, 'wecom-cli-bin')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureOnPath reuses an existing wecom-cli on PATH', () => {
  const root = scratch('existing')
  mkdirSync(root, { recursive: true })
  const existing = join(root, 'wecom-cli.cmd')
  writeFileSync(existing, '@echo off\r\n', 'utf8')
  const env: NodeJS.ProcessEnv = { PATH: root }
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, 'ok', 'utf8')
  try {
    const result = ensureOnPath(binJs, {
      dshHome: join(root, 'dsh'),
      env,
      platform: 'win32',
      execPath: 'C:\\nodejs\\node.exe',
    })
    assert.equal(result.alreadyOnPath, true)
    assert.equal(result.shimDir, undefined)
    assert.equal(existsSync(join(root, 'dsh', 'wecom-cli-bin')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseAuthStatus reads the last non-empty line', () => {
  assert.equal(parseAuthStatus('authorized\n'), 'authorized')
  assert.equal(parseAuthStatus('unauthorized'), 'unauthorized')
  assert.equal(parseAuthStatus('Status: ok\n'), 'error')
  assert.equal(parseAuthStatus(''), 'error')
})

test('probeAuth runs a fake launcher and parses --status', async () => {
  const root = scratch('probe')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, 'if (process.argv.includes("--status")) console.log("authorized")\n')
  try {
    assert.equal(await probeAuth(binJs), 'authorized')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('WECOM_CLI_PROMPT forbids npm install -g, self-install, and QR auth init', () => {
  assert.match(WECOM_CLI_PROMPT, /npm install -g @wecom\/cli/)
  assert.match(WECOM_CLI_PROMPT, /npm i -g @wecom\/cli/)
  assert.match(WECOM_CLI_PROMPT, /不要自行安装/)
  assert.match(WECOM_CLI_PROMPT, /wecomCli\.enabled/)
  assert.match(WECOM_CLI_PROMPT, /wecomCli\.allowFrom/)
  assert.match(WECOM_CLI_PROMPT, /auth init --noninteractive/)
  assert.match(WECOM_CLI_PROMPT, /--bot-id/)
  assert.match(WECOM_CLI_PROMPT, /禁止扫码/)
  assert.match(WECOM_CLI_PROMPT, /853004/)
  assert.match(WECOM_CLI_PROMPT, /auth init --manual/)
})

test('WECOM_CLI_NO_OFFICE_PROMPT forbids wecom-cli', () => {
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /wecom-cli/)
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /wecomcli-/)
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /没有企微办公权限/)
})

test('authInitArgv uses hidden --bot-id/--secret and never --manual', () => {
  assert.deepEqual(authInitArgv('  bot-id  ', '  secret-value  '), [
    'auth', 'init', '--bot-id', 'bot-id', '--secret', 'secret-value',
  ])
  assert.ok(!authInitArgv('bot-id', 'secret-value').includes('--manual'))
  assert.ok(!authInitArgv('bot-id', 'secret-value').includes('--noninteractive'))
})

test('AUTH_INIT_HINT is npx --manual and never names a secret', () => {
  assert.equal(AUTH_INIT_HINT, 'npx --yes @wecom/cli auth init --manual')
  assert.doesNotMatch(AUTH_INIT_HINT, /secret/i)
  assert.doesNotMatch(AUTH_INIT_FAILED_MESSAGE, /secret/i)
  assert.doesNotMatch(AUTH_INIT_MISSING_MESSAGE, /secret/i)
  assert.match(AUTH_INIT_FAILED_MESSAGE, /npx --yes @wecom\/cli auth init --manual/)
  assert.doesNotMatch(AUTH_INIT_FAILED_MESSAGE, /npm install -g/)
})

test('trySeedAuth passes hidden flags to a fake launcher', async () => {
  const root = scratch('seed-ok')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, [
    'const argv = process.argv',
    'const bot = argv.indexOf("--bot-id")',
    'const sec = argv.indexOf("--secret")',
    'const ok = bot >= 0 && sec >= 0',
    '  && argv[bot + 1] === "bot-id"',
    '  && argv[sec + 1] === "secret-value"',
    '  && argv.includes("auth") && argv.includes("init")',
    '  && !argv.includes("--manual") && !argv.includes("--noninteractive")',
    'process.exit(ok ? 0 : 1)',
    '',
  ].join('\n'))
  try {
    assert.equal(await trySeedAuth(binJs, 'bot-id', 'secret-value'), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('trySeedAuth returns a secret-free error when the launcher fails', async () => {
  const root = scratch('seed-fail')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  writeFileSync(binJs, 'process.exit(1)\n')
  const secret = 'super-secret-xyz'
  try {
    const message = await trySeedAuth(binJs, 'bot-id', secret)
    assert.equal(message, AUTH_INIT_FAILED_MESSAGE)
    assert.doesNotMatch(message ?? '', new RegExp(secret))
    assert.equal(await trySeedAuth(binJs, '', secret), AUTH_INIT_MISSING_MESSAGE)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
