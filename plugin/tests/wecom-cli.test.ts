import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  ALLOW_FROM_REQUIRED_MESSAGE,
  AUTH_INIT_COMMAND,
  AUTH_INIT_MISSING_MESSAGE,
  SKILLS_SERVICE_MISSING_MESSAGE,
  TOOLS_SERVICE_MISSING_MESSAGE,
  WECOM_CHANNEL_PROMPT,
  WECOM_CLI_NO_OFFICE_PROMPT,
  WECOM_CLI_PROMPT,
  WECOM_CLI_SHIM_DENY_MESSAGE,
  WECOM_CLI_SKILL_PREFIX,
  WECOM_CLI_TOOL_NAME,
  WORKSPACE_WECOMCLI_LEAK_MESSAGE,
  argvForbiddenAuth,
  authInitFailedMessage,
  authInitHint,
  clipOutput,
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
  parseWecomCliArgs,
  probeAuth,
  registerWecomCliTool,
  registerWecomOfficeSkills,
  renderWecomCliRun,
  resolveConfigDir,
  resolveDshHome,
  resolveSkillsDir,
  resolveWecomBinFromPackage,
  runWecomCli,
  senderHasOfficeAccess,
  shouldEnableWecomCli,
  shouldInjectWecomOfficeSkills,
  skillsInstallHint,
  toRuntimeSkillRegistration,
  trySeedAuth,
  wecomCliEnv,
  wecomCliToolDefinition,
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
    content: `${WECOM_CLI_SKILL_PREFIX}\n\nbody`,
    resourceBase: { kind: 'directory', path: '/skills/wecomcli-shared' },
  })
  assert.match(WECOM_CLI_SKILL_PREFIX, new RegExp(WECOM_CLI_TOOL_NAME))
  assert.match(WECOM_CLI_SKILL_PREFIX, /禁止用 pwsh\/bash\/npx/)
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

test('ensureConfigDir creates the directory and exports nothing', () => {
  const root = scratch('config-dir')
  const dir = join(root, '.dsh', 'wecom-cli')
  const before = process.env[WECOM_CLI_CONFIG_DIR_ENV]
  try {
    assert.equal(ensureConfigDir(dir), dir)
    assert.equal(existsSync(dir), true)
    assert.equal(process.env[WECOM_CLI_CONFIG_DIR_ENV], before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('wecomCliEnv injects the credential directory without mutating the base', () => {
  const base: NodeJS.ProcessEnv = { PATH: '/bin' }
  const env = wecomCliEnv('/creds', base)
  assert.equal(env[WECOM_CLI_CONFIG_DIR_ENV], '/creds')
  assert.equal(env.PATH, '/bin')
  assert.equal(base[WECOM_CLI_CONFIG_DIR_ENV], undefined)
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

test('writeWecomShim denies instead of forwarding to the launcher', () => {
  const root = scratch('shim')
  mkdirSync(root, { recursive: true })
  const shimDir = join(root, 'bin')
  try {
    writeWecomShim(shimDir, 'win32')
    const cmd = readFileSync(join(shimDir, 'wecom-cli.cmd'), 'utf8')
    assert.match(cmd, new RegExp(WECOM_CLI_SHIM_DENY_MESSAGE.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(cmd, /exit \/b 1/)
    assert.doesNotMatch(cmd, /wecom\.js/)

    writeWecomShim(shimDir, 'linux')
    const posix = readFileSync(join(shimDir, 'wecom-cli'), 'utf8')
    assert.match(posix, /exit 1/)
    assert.doesNotMatch(posix, /wecom\.js/)
    // A .cmd echoes its own bytes; non-ASCII would garble under a legacy code page.
    assert.doesNotMatch(WECOM_CLI_SHIM_DENY_MESSAGE, /[^\x20-\x7e]/)
    assert.match(WECOM_CLI_SHIM_DENY_MESSAGE, new RegExp(WECOM_CLI_TOOL_NAME))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureOnPath prepends the deny shim', () => {
  const root = scratch('path')
  mkdirSync(root, { recursive: true })
  const dshHome = join(root, 'dsh')
  const env: NodeJS.ProcessEnv = { PATH: join(root, 'nowhere') }
  try {
    const result = ensureOnPath({ dshHome, env, platform: 'win32' })
    assert.equal(result.shadowed, false)
    assert.equal(result.shimDir, join(dshHome, 'wecom-cli-bin'))
    assert.equal(existsSync(join(dshHome, 'wecom-cli-bin', 'wecom-cli.cmd')), true)
    assert.ok(env.PATH?.startsWith(join(dshHome, 'wecom-cli-bin')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureOnPath shadows an existing wecom-cli on PATH', () => {
  const root = scratch('existing')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'wecom-cli.cmd'), '@echo off\r\n', 'utf8')
  const dshHome = join(root, 'dsh')
  const env: NodeJS.ProcessEnv = { PATH: root }
  try {
    const result = ensureOnPath({ dshHome, env, platform: 'win32' })
    assert.equal(result.shadowed, true)
    assert.equal(result.shimDir, join(dshHome, 'wecom-cli-bin'))
    assert.ok(env.PATH?.startsWith(join(dshHome, 'wecom-cli-bin')))
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

test('probeAuth runs a fake launcher with the credential directory injected', async () => {
  const root = scratch('probe')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  const configDir = join(root, 'creds')
  writeFileSync(binJs, [
    'const dir = process.env.WECOM_CLI_CONFIG_DIR',
    'if (process.argv.includes("--status") && dir === process.argv[3]) console.log("authorized")',
    '',
  ].join('\n'))
  try {
    // argv[3] is the first launcher argument, so the fake CLI compares the
    // injected env with the directory the caller intended.
    assert.equal(await probeAuth(binJs, configDir), 'error')
    writeFileSync(binJs, [
      'const dir = process.env.WECOM_CLI_CONFIG_DIR',
      `if (process.argv.includes("--status") && dir === ${JSON.stringify(configDir)}) console.log("authorized")`,
      '',
    ].join('\n'))
    assert.equal(await probeAuth(binJs, configDir), 'authorized')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('WECOM_CHANNEL_PROMPT forbids ask_user_question', () => {
  assert.match(WECOM_CHANNEL_PROMPT, /ask_user_question/)
  assert.match(WECOM_CHANNEL_PROMPT, /企业微信/)
})

test('WECOM_CLI_PROMPT routes office commands through the gated tool', () => {
  assert.match(WECOM_CLI_PROMPT, /ask_user_question/)
  assert.match(WECOM_CLI_PROMPT, new RegExp(WECOM_CLI_TOOL_NAME))
  assert.match(WECOM_CLI_PROMPT, /pwsh\/bash\/npx\/npm/)
  assert.match(WECOM_CLI_PROMPT, /auth init/)
  assert.match(WECOM_CLI_PROMPT, /扫码/)
  assert.match(WECOM_CLI_PROMPT, /853004/)
})

test('WECOM_CLI_NO_OFFICE_PROMPT forbids wecom-cli, the tool, and npx', () => {
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /ask_user_question/)
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /wecom-cli/)
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, new RegExp(WECOM_CLI_TOOL_NAME))
  assert.match(WECOM_CLI_NO_OFFICE_PROMPT, /npx @wecom\/cli/)
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

test('authInitHint sets the credential directory the plugin actually reads', () => {
  const dir = 'C:\\ws\\.dsh\\wecom-cli'
  const windows = authInitHint(dir, 'win32')
  assert.match(windows, /^\$env:WECOM_CLI_CONFIG_DIR='C:\\ws\\\.dsh\\wecom-cli'; /)
  assert.ok(windows.endsWith(AUTH_INIT_COMMAND))
  const posix = authInitHint('/ws/.dsh/wecom-cli', 'linux')
  assert.equal(posix, `WECOM_CLI_CONFIG_DIR='/ws/.dsh/wecom-cli' ${AUTH_INIT_COMMAND}`)
  const failed = authInitFailedMessage(dir)
  assert.match(failed, /WECOM_CLI_CONFIG_DIR/)
  assert.match(failed, /npx --yes @wecom\/cli auth init --manual/)
  assert.doesNotMatch(failed, /npm install -g/)
  assert.doesNotMatch(failed, /secret/i)
  assert.doesNotMatch(AUTH_INIT_MISSING_MESSAGE, /secret/i)
})

test('trySeedAuth passes hidden flags to a fake launcher', async () => {
  const root = scratch('seed-ok')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  const configDir = join(root, 'creds')
  writeFileSync(binJs, [
    'const argv = process.argv',
    'const bot = argv.indexOf("--bot-id")',
    'const sec = argv.indexOf("--secret")',
    'const ok = bot >= 0 && sec >= 0',
    '  && argv[bot + 1] === "bot-id"',
    '  && argv[sec + 1] === "secret-value"',
    '  && argv.includes("auth") && argv.includes("init")',
    '  && !argv.includes("--manual") && !argv.includes("--noninteractive")',
    `  && process.env.WECOM_CLI_CONFIG_DIR === ${JSON.stringify(configDir)}`,
    'process.exit(ok ? 0 : 1)',
    '',
  ].join('\n'))
  try {
    assert.equal(await trySeedAuth(binJs, 'bot-id', 'secret-value', configDir), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('trySeedAuth returns a secret-free error when the launcher fails', async () => {
  const root = scratch('seed-fail')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  const configDir = join(root, 'creds')
  writeFileSync(binJs, 'process.exit(1)\n')
  const secret = 'super-secret-xyz'
  try {
    const message = await trySeedAuth(binJs, 'bot-id', secret, configDir)
    assert.equal(message, authInitFailedMessage(configDir))
    assert.doesNotMatch(message ?? '', new RegExp(secret))
    assert.equal(await trySeedAuth(binJs, '', secret, configDir), AUTH_INIT_MISSING_MESSAGE)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('argvForbiddenAuth rejects re-authorization and passes business commands', () => {
  assert.equal(argvForbiddenAuth(['message', 'aibot', 'sessions', 'list']), undefined)
  assert.equal(argvForbiddenAuth(['auth', 'show', '--status']), undefined)
  assert.match(argvForbiddenAuth(['auth', 'init']) ?? '', /auth init/)
  assert.match(argvForbiddenAuth(['auth', 'init', '--manual']) ?? '', /auth init/)
  assert.match(argvForbiddenAuth(['AUTH', 'INIT', '--noninteractive']) ?? '', /auth init/)
  assert.match(argvForbiddenAuth(['message', 'send', '--bot-id', 'x']) ?? '', /--bot-id/)
})

test('parseWecomCliArgs demands a non-empty string array', () => {
  assert.deepEqual(parseWecomCliArgs({ argv: ['auth', 'show'] }), ['auth', 'show'])
  assert.throws(() => parseWecomCliArgs({}), /argv/)
  assert.throws(() => parseWecomCliArgs({ argv: [] }), /argv/)
  assert.throws(() => parseWecomCliArgs({ argv: 'auth show' }), /argv/)
  assert.throws(() => parseWecomCliArgs({ argv: ['auth', 3] }), /argv/)
  assert.throws(() => parseWecomCliArgs(undefined), /argv/)
})

test('clipOutput keeps short text and states the original byte length', () => {
  assert.equal(clipOutput('hello', 10), 'hello')
  const clipped = clipOutput('阿'.repeat(100), 12)
  assert.match(clipped, /输出已截断，原始 300 字节/)
  assert.ok(Buffer.from(clipped.split('\n')[0] ?? '', 'utf8').byteLength <= 12)
})

test('runWecomCli returns a non-zero exit as a value and injects the credential directory', async () => {
  const root = scratch('run-cli')
  mkdirSync(root, { recursive: true })
  const binJs = join(root, 'wecom.js')
  const configDir = join(root, 'creds')
  writeFileSync(binJs, [
    'console.log("argv:" + process.argv.slice(2).join(","))',
    'console.log("dir:" + process.env.WECOM_CLI_CONFIG_DIR)',
    'console.error("warned")',
    'process.exit(3)',
    '',
  ].join('\n'))
  try {
    const run = await runWecomCli(binJs, ['message', 'aibot', 'sessions', 'list'], configDir)
    assert.equal(run.exitCode, 3)
    assert.match(run.stdout, /argv:message,aibot,sessions,list/)
    assert.match(run.stdout, new RegExp(`dir:${configDir.replaceAll('\\', '\\\\')}`))
    assert.match(run.stderr, /warned/)
    assert.match(renderWecomCliRun(run), /\[exit code: 3\]/)
    assert.match(renderWecomCliRun(run), /\[stderr\]/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runWecomCli reports a missing launcher as exit 1 instead of throwing', async () => {
  const run = await runWecomCli(join(scratch('missing'), 'wecom.js'), ['auth', 'show'], '/creds')
  assert.equal(run.exitCode, 1)
  assert.notEqual(run.stderr, '')
})

test('wecomCliToolDefinition declares argv, an object output schema, and a terminal card', () => {
  const definition = wecomCliToolDefinition('/bin/wecom.js', '/creds')
  assert.equal(definition.name, WECOM_CLI_TOOL_NAME)
  assert.deepEqual(definition.parameters.required, ['argv'])
  assert.deepEqual(definition.output.schema.required, ['stdout', 'stderr', 'exitCode'])
  assert.equal((definition.output.schema as { type: string }).type, 'object')
  assert.deepEqual(
    definition.presentCall({ argv: ['message', 'aibot', 'sessions', 'list'] }),
    { card: 'terminal', title: 'wecom-cli message aibot sessions list' },
  )
  assert.deepEqual(definition.output.render({}, { stdout: 'out', stderr: '', exitCode: 0 }), [
    { type: 'text', text: 'out\n[exit code: 0]' },
  ])
})

test('the gated tool refuses auth init before spawning anything', async () => {
  const definition = wecomCliToolDefinition(join(scratch('never'), 'wecom.js'), '/creds')
  await assert.rejects(
    definition.execute({ argv: ['auth', 'init', '--manual'] }, { signal: new AbortController().signal }),
    /auth init/,
  )
})

test('registerWecomCliTool registers on agentCtx.tools and warns without the service', () => {
  const captured: unknown[] = []
  const agentCtx = {
    get(name: string): unknown {
      if (name !== 'tools') return undefined
      return {
        register(tool: unknown): () => void {
          captured.push(tool)
          return () => {}
        },
      }
    },
  }
  assert.equal(registerWecomCliTool(agentCtx, '/bin/wecom.js', '/creds'), true)
  assert.equal(captured.length, 1)
  assert.equal((captured[0] as { name: string }).name, WECOM_CLI_TOOL_NAME)
  assert.equal(registerWecomCliTool({ get: () => undefined }, '/bin/wecom.js', '/creds'), false)
  assert.match(TOOLS_SERVICE_MISSING_MESSAGE, new RegExp(WECOM_CLI_TOOL_NAME))
})
