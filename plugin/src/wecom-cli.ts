/**
 * Locate the bundled wecom-cli binary, keep it on PATH, probe auth, and load
 * official wecomcli-* SKILL.md files from a managed directory.
 */

import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  chmodSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'

const execFileAsync = promisify(execFile)

/** Kebab-case skill names accepted by DSH (`wecomcli-shared`). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Workspace-relative DSH native skills directory (`.dsh/skills`). Used only to detect leftover wecomcli-*. */
export const DEFAULT_WORKSPACE_SKILLS_DIR = join('.dsh', 'skills')

/** Workspace-relative Cursor/agents skills directory (`.agents/skills`). Used only to detect leftover wecomcli-*. */
export const DEFAULT_WORKSPACE_AGENTS_SKILLS_DIR = join('.agents', 'skills')

/** Managed wecomcli-* root under `$DSH_HOME` (not `$DSH_HOME/skills`, which skill-filesystem still scans). */
export const DEFAULT_MANAGED_SKILLS_DIR = 'wecom-cli-skills'

/** Workspace-relative wecom-cli credential directory (writable under sandbox). */
export const DEFAULT_WORKSPACE_CONFIG_DIR = join('.dsh', 'wecom-cli')

/** Official CLI env that overrides `~/.config/wecom`. */
export const WECOM_CLI_CONFIG_DIR_ENV = 'WECOM_CLI_CONFIG_DIR'

/** Directory that holds PATH shims when wecom-cli is not already installed. */
export const SHIM_DIR_NAME = 'wecom-cli-bin'

/** Timeout for `wecom-cli auth show --status`. */
export const AUTH_PROBE_TIMEOUT_MS = 10_000

/** Timeout for `wecom-cli auth init --manual` (CLI contacts WeCom). */
export const AUTH_INIT_TIMEOUT_MS = 30_000

/** Host fallback when stdin seeding of `--manual` does not authorize. */
export const AUTH_INIT_HINT = 'npx --yes @wecom/cli auth init --manual'

/**
 * Logged / returned when `--manual` exits non-zero. Must never include botId or secret.
 */
export const AUTH_INIT_FAILED_MESSAGE =
  `wecom-cli auth init --manual 未能完成。请在 host 上执行 ${AUTH_INIT_HINT}（输入同一套密钥，不要全局安装）。`

/** Logged when wecomCli is on but wecomCli.allowFrom is empty. */
export const ALLOW_FROM_REQUIRED_MESSAGE =
  'wecomCli 已开启但 wecomCli.allowFrom 为空；已跳过 wecom-cli 的 PATH 与授权检查。聊天仍由根级 allowFrom 控制（空 = 所有人）。请把办公 userid 配进 wecomCli.allowFrom。工作区 .dsh/skills 或 .agents/skills 里残留的 wecomcli-* 仍会被该 cwd 下所有 Agent 发现。'

/** Logged when the Agent context has no skills.register. */
export const SKILLS_SERVICE_MISSING_MESSAGE =
  '当前 Agent 没有 skills 服务，无法注册 wecomcli-*。'

/** Logged when workspace scan roots still contain wecomcli-*. */
export const WORKSPACE_WECOMCLI_LEAK_MESSAGE =
  '工作区 .dsh/skills 或 .agents/skills 仍有 wecomcli-*，同 cwd 的 GUI/群聊仍会发现。请挪到 $DSH_HOME/wecom-cli-skills 后删除工作区副本。'

/** Official GitHub zip of wecom-cli (skills live under `skills/wecomcli-*`). */
export const WECOM_CLI_SKILLS_ARCHIVE_URL =
  'https://github.com/WeComTeam/wecom-cli/archive/refs/heads/main.zip'

/** Connection channel for the Settings install button. */
export const IM_BRIDGE_RPC_CHANNEL = '/im-bridge'

/** Unary endpoint that downloads and extracts official wecomcli-* skills. */
export const INSTALL_SKILLS_ENDPOINT = 'wecomcli.installSkills'

/** Logged when the Host has no Connection (no Settings install button). */
export const SKILLS_RPC_UNAVAILABLE_MESSAGE =
  '当前 Host 没有 Connection，Settings 安装按钮不可用。'

/** Zip entry under the GitHub archive: `wecom-cli-<ref>/skills/wecomcli-<name>/...`. */
const ARCHIVE_SKILL_FILE =
  /^wecom-cli-[^/]+\/skills\/(wecomcli-[a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/

/**
 * GitHub zips list directories as empty entries. Writing those as files makes
 * a later mkdir of the same path fail with EEXIST.
 * @param name - zip path with `/` separators.
 * @param data - entry bytes.
 * @returns true when this entry must not be written as a file.
 */
function isZipDirectoryEntry(name: string, data: Uint8Array): boolean {
  if (name.endsWith('/')) return true
  if (data.byteLength > 0) return false
  const last = name.split('/').filter(Boolean).at(-1) ?? ''
  return !last.includes('.')
}

/** Extra system-prompt rules for the WeCom channel (no GUI confirm dialog). */
export const WECOM_CLI_PROMPT = [
  '本通道是企业微信，没有 GUI 确认框。不要调用 ask_user_question，它会一直等到任务超时。',
  '发信、取消会议、删除待办、覆盖文档等不可逆操作：先用 --dry-run 自检，在回复里说明将要做什么，等用户下一条消息确认后再执行。',
  '本机 wecom-cli 由 im-bridge 插件提供。禁止执行 npm install -g @wecom/cli 或 npm i -g @wecom/cli。',
  '若 wecom-cli 不在 PATH 上，不要自行安装，告诉用户开启 wecomCli.enabled、配好 wecomCli.allowFrom 并重启 dsh。',
  '禁止执行 wecom-cli auth init --noninteractive，禁止扫码授权。扫码会新建智能机器人；凭证由插件用已有 botId/secret 维护。',
  '若业务命令报 853004（cli token expired），直接重试该业务命令，不要 auth init。token 刷新写入工作区 .dsh/wecom-cli。',
  '若刷新仍失败，告诉用户重启 dsh，或在 host 上执行 npx --yes @wecom/cli auth init --manual（同一套密钥，不要全局安装）。',
].join('\n')

/** Prompt when the sender is not on `wecomCli.allowFrom`. */
export const WECOM_CLI_NO_OFFICE_PROMPT = [
  '本通道你没有企微办公权限。禁止调用 wecom-cli，禁止使用 wecomcli-* 技能。',
  '只回答诊断与当前工作区任务。不要发信、改日程、动微盘或通讯录。',
].join('\n')

/** One parsed official wecom-cli skill. */
export interface WecomSkill {
  /** Frontmatter `name` (kebab-case). */
  name: string
  /** Frontmatter `description`. */
  description: string
  /** Markdown body after the frontmatter. */
  content: string
  /** Skill directory; used as DSH `resourceBase.path`. */
  directory: string
}

/** Duck-typed payload for `ctx.skills.register()` (no `@deepseek-ai/dsh-skill` import). */
export interface RuntimeSkillRegistration {
  /** Kebab-case skill name. */
  name: string
  /** Catalog description. */
  description: string
  /** Runtime provider bucket; must not land in skill-filesystem roots. */
  source: 'runtime'
  /** Instruction body. */
  content: string
  /** Directory that holds SKILL.md and relative resources. */
  resourceBase: { kind: 'directory'; path: string }
}

/** Minimal Cordis face used to look up `skills`. */
export interface SkillRegisterHost {
  /** Service lookup; missing `skills` is a no-op with a warning. */
  get(name: string): unknown
}

/** Result of putting wecom-cli on PATH. */
export interface EnsureOnPathResult {
  /** True when a wecom-cli executable was already on PATH. */
  alreadyOnPath: boolean
  /** Shim directory when this process wrote one. */
  shimDir?: string
}

/** `wecom-cli auth show --status` outcome. */
export type AuthStatus = 'authorized' | 'unauthorized' | 'error'

/** Result of writing official wecomcli-* into the managed skills directory. */
export interface InstallWecomSkillsResult {
  /** Absolute destination directory. */
  dest: string
  /** How many wecomcli-* SKILL.md trees loaded after extract. */
  count: number
}

/** Failed download or extract; message is safe to show in Settings. */
export class WecomSkillsInstallError extends Error {
  /**
   * @param message - short reason with no secrets.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WecomSkillsInstallError'
  }
}

/**
 * DSH home: `$DSH_HOME`, else `~/.dsh`.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the absolute home directory.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/**
 * Skills directory: configured path, else `$DSH_HOME/wecom-cli-skills`.
 * Relative `configured` values resolve against `workspace`.
 * @param configured - `wecomCli.skillsDir`; empty means the managed home default.
 * @param workspace - Agent cwd / plugin `workspace`.
 * @param env - environment for `$DSH_HOME`; defaults to `process.env`.
 * @returns an absolute directory path.
 */
export function resolveSkillsDir(
  configured: string,
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = configured.trim()
  if (trimmed === '') return join(resolveDshHome(env), DEFAULT_MANAGED_SKILLS_DIR)
  return isAbsolute(trimmed) ? trimmed : resolve(workspace, trimmed)
}

/**
 * wecom-cli credential directory: configured path, else `<workspace>/.dsh/wecom-cli`.
 * Relative `configured` values resolve against `workspace`.
 * @param configured - `wecomCli.configDir`; empty means the workspace default.
 * @param workspace - Agent cwd / plugin `workspace`.
 * @returns an absolute directory path.
 */
export function resolveConfigDir(configured: string, workspace: string): string {
  const trimmed = configured.trim()
  if (trimmed === '') return join(workspace, DEFAULT_WORKSPACE_CONFIG_DIR)
  return isAbsolute(trimmed) ? trimmed : resolve(workspace, trimmed)
}

/**
 * Create `dir` and set `WECOM_CLI_CONFIG_DIR` so the CLI does not use `~/.config/wecom`.
 * @param dir - absolute credential directory.
 * @param env - environment object to mutate; defaults to `process.env`.
 * @returns `dir`.
 */
export function ensureConfigDir(dir: string, env: NodeJS.ProcessEnv = process.env): string {
  mkdirSync(dir, { recursive: true })
  env[WECOM_CLI_CONFIG_DIR_ENV] = dir
  return dir
}

/**
 * How to land official skills in `dir`. The skills CLI has no `--dir` and `-g`
 * leaks into `~/.agents/skills`.
 * @param dir - destination skills directory.
 * @returns a one-line install hint.
 */
export function skillsInstallHint(dir: string): string {
  return `在 Settings → 插件配置 → 企业微信桥接 点「安装官方 skills」，或把官方仓库 skills/wecomcli-* 拷到 "${dir}"（不要 npx skills add -g；CLI 没有 --dir）`
}

/**
 * Download the official wecom-cli GitHub zip.
 * @param fetchImpl - HTTP client; defaults to global `fetch`.
 * @param signal - optional cancellation.
 * @returns zip bytes.
 */
export async function fetchWecomSkillsZip(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetchImpl(WECOM_CLI_SKILLS_ARCHIVE_URL, { signal, redirect: 'follow' })
  } catch {
    throw new WecomSkillsInstallError('下载官方 skills 失败（网络）')
  }
  if (!response.ok) {
    throw new WecomSkillsInstallError(`下载官方 skills 失败（HTTP ${String(response.status)}）`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Extract `skills/wecomcli-*` from a GitHub archive zip into `dest`.
 * Rejects entries whose path contains `..`. Overwrites matching skill folders
 * and leaves other children of `dest` in place.
 * @param zipBytes - GitHub `archive/refs/heads/main.zip` body.
 * @param dest - managed skills root (`resolveSkillsDir`).
 * @returns destination and loaded wecomcli-* count.
 */
export function extractWecomSkillsFromZip(zipBytes: Uint8Array, dest: string): InstallWecomSkillsResult {
  if (zipBytes.byteLength === 0) {
    throw new WecomSkillsInstallError('下载的 zip 为空')
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipBytes)
  } catch {
    throw new WecomSkillsInstallError('无法解压官方 skills zip')
  }
  const writes: Array<{ skill: string; rel: string; data: Uint8Array }> = []
  for (const [rawName, data] of Object.entries(files)) {
    const name = rawName.replaceAll('\\', '/')
    if (name.split('/').includes('..')) {
      throw new WecomSkillsInstallError('zip 含非法路径')
    }
    if (isZipDirectoryEntry(name, data)) continue
    const match = ARCHIVE_SKILL_FILE.exec(name)
    if (match === null || match[1] === undefined || match[2] === undefined) continue
    writes.push({ skill: match[1], rel: match[2], data })
  }
  if (writes.length === 0) {
    throw new WecomSkillsInstallError('zip 中没有 wecomcli-* skills')
  }
  writes.sort((left, right) => left.rel.split('/').length - right.rel.split('/').length)
  mkdirSync(dest, { recursive: true })
  const destRoot = resolve(dest)
  for (const skill of new Set(writes.map(entry => entry.skill))) {
    const skillDir = join(destRoot, skill)
    if (existsSync(skillDir)) rmSync(skillDir, { recursive: true, force: true })
  }
  for (const entry of writes) {
    const target = resolve(destRoot, entry.skill, entry.rel)
    const relToDest = relative(destRoot, target)
    if (relToDest.startsWith('..') || isAbsolute(relToDest)) {
      throw new WecomSkillsInstallError('zip 含非法路径')
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.data)
  }
  const count = countWecomcliSkills(loadWecomSkills(destRoot))
  if (count === 0) {
    throw new WecomSkillsInstallError('解压后未读到 wecomcli-* SKILL.md')
  }
  return { dest: destRoot, count }
}

/**
 * Install official wecomcli-* into `dest`. Tests pass `zip`; production fetches.
 * @param dest - managed skills root.
 * @param options - fixture zip, fetch override, or cancellation.
 * @returns destination and loaded count.
 */
export async function installOfficialWecomSkills(
  dest: string,
  options?: {
    zip?: Uint8Array
    fetch?: typeof fetch
    signal?: AbortSignal
  },
): Promise<InstallWecomSkillsResult> {
  const zip = options?.zip ?? await fetchWecomSkillsZip(options?.fetch, options?.signal)
  return extractWecomSkillsFromZip(zip, dest)
}

/**
 * Whether wecomCli may set up PATH, auth, and office prompts.
 * Uses `wecomCli.allowFrom`, not the chat `allowFrom`.
 * Workspace wecomcli-* leftovers are still discovered by skill-filesystem.
 * @param enabled - `wecomCli.enabled`.
 * @param officeFrom - office-sender userid list.
 * @returns true only when both conditions hold.
 */
export function shouldEnableWecomCli(enabled: boolean, officeFrom: readonly string[]): boolean {
  return enabled && officeFrom.some(id => id.trim() !== '')
}

/**
 * Whether this chat may receive runtime wecomcli-* registration.
 * Groups never inject; 1:1 injects only for an office sender.
 * @param kind - WeCom window kind; undefined is treated as no inject.
 * @param office - whether the current sender is on `wecomCli.allowFrom`.
 * @returns true only for office 1:1 chats.
 */
export function shouldInjectWecomOfficeSkills(
  kind: 'single' | 'group' | undefined,
  office: boolean,
): boolean {
  return kind === 'single' && office
}

/**
 * Whether `sender` is on the office list (trimmed exact match).
 * @param officeFrom - `wecomCli.allowFrom`.
 * @param sender - inbound userid.
 * @returns true when the sender may receive the office prompt.
 */
export function senderHasOfficeAccess(officeFrom: readonly string[], sender: string): boolean {
  const id = sender.trim()
  if (id === '') return false
  return officeFrom.some(entry => entry.trim() === id)
}

/**
 * Workspace skill-filesystem roots that would leak wecomcli-* to every cwd Agent.
 * @param workspace - Agent cwd / plugin `workspace`.
 * @returns `.dsh/skills` then `.agents/skills` under `workspace`.
 */
export function workspaceWecomcliLeakRoots(workspace: string): readonly string[] {
  return [
    join(workspace, DEFAULT_WORKSPACE_SKILLS_DIR),
    join(workspace, DEFAULT_WORKSPACE_AGENTS_SKILLS_DIR),
  ]
}

/**
 * Count `wecomcli-*` still sitting in workspace scan roots.
 * @param workspace - Agent cwd / plugin `workspace`.
 * @returns total parsed wecomcli-* across leak roots.
 */
export function countWorkspaceWecomcliLeaks(workspace: string): number {
  let total = 0
  for (const root of workspaceWecomcliLeakRoots(workspace)) {
    total += countWecomcliSkills(loadWecomSkills(root))
  }
  return total
}

/**
 * Count official wecom-cli skills (`wecomcli-*`) in a loaded list.
 * @param skills - parsed skills from a directory scan.
 * @returns how many names start with `wecomcli-`.
 */
export function countWecomcliSkills(skills: readonly WecomSkill[]): number {
  return skills.filter(skill => skill.name.startsWith('wecomcli-')).length
}

/**
 * Map a parsed wecomcli-* skill to a runtime registration. Other names are ignored.
 * @param skill - parsed SKILL.md.
 * @returns the registration, or undefined when the name is not `wecomcli-*`.
 */
export function toRuntimeSkillRegistration(skill: WecomSkill): RuntimeSkillRegistration | undefined {
  if (!skill.name.startsWith('wecomcli-')) return undefined
  return {
    name: skill.name,
    description: skill.description,
    source: 'runtime',
    content: skill.content,
    resourceBase: { kind: 'directory', path: skill.directory },
  }
}

/**
 * Register wecomcli-* on this Agent's skills layer. Must be called on `agentCtx`, not the host.
 * @param agentCtx - the Agent-scoped Cordis context.
 * @param skills - parsed skills; non-wecomcli names are skipped.
 * @returns how many skills were registered.
 */
export function registerWecomOfficeSkills(
  agentCtx: SkillRegisterHost,
  skills: readonly WecomSkill[],
): number {
  const registry = skillsRegisterOf(agentCtx)
  if (registry === undefined) {
    console.warn(`[im-bridge] ${SKILLS_SERVICE_MISSING_MESSAGE}`)
    return 0
  }
  let count = 0
  for (const skill of skills) {
    const registration = toRuntimeSkillRegistration(skill)
    if (registration === undefined) continue
    registry.register(registration)
    count += 1
  }
  return count
}

function skillsRegisterOf(agentCtx: SkillRegisterHost): { register(skill: RuntimeSkillRegistration): () => void } | undefined {
  const skills = agentCtx.get('skills')
  if (skills === undefined || skills === null || typeof skills !== 'object') return undefined
  const register = (skills as { register?: unknown }).register
  if (typeof register !== 'function') return undefined
  return skills as { register(skill: RuntimeSkillRegistration): () => void }
}

/**
 * Resolve `@wecom/cli`'s `bin/wecom.js` from this package's node_modules.
 * @returns the absolute launcher path, or undefined when the package is missing.
 */
export function resolveWecomBin(): string | undefined {
  try {
    const pkgJsonPath = createRequire(import.meta.url).resolve('@wecom/cli/package.json')
    return resolveWecomBinFromPackage(pkgJsonPath)
  } catch {
    return undefined
  }
}

/**
 * Read a `@wecom/cli` package.json and return its wecom-cli bin path.
 * @param pkgJsonPath - absolute path to that package.json.
 * @returns the absolute launcher path, or undefined when `bin` is missing.
 */
export function resolveWecomBinFromPackage(pkgJsonPath: string): string | undefined {
  const raw = readFileSync(pkgJsonPath, 'utf8')
  const pkg = JSON.parse(raw) as { bin?: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['wecom-cli']
  if (rel === undefined || rel === '') return undefined
  const binJs = join(dirname(pkgJsonPath), rel)
  return existsSync(binJs) ? binJs : undefined
}

/**
 * True when PATH already contains a wecom-cli executable.
 * @param env - environment whose PATH to scan.
 * @param platform - target platform name matching Node's `process.platform`.
 * @returns true if an executable is found.
 */
export function wecomCliOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathValue = env.PATH ?? env.Path ?? ''
  const names = platform === 'win32'
    ? ['wecom-cli.exe', 'wecom-cli.cmd', 'wecom-cli.bat', 'wecom-cli']
    : ['wecom-cli']
  for (const dir of pathValue.split(delimiterFor(platform))) {
    if (dir === '') continue
    for (const name of names) {
      if (existsSync(join(dir, name))) return true
    }
  }
  return false
}

/**
 * Write a PATH shim that runs `binJs` via this Node, and prepend the shim dir.
 * Skips writing when wecom-cli is already on PATH.
 * @param binJs - absolute path to `@wecom/cli`'s `bin/wecom.js`.
 * @param options - home, env, and platform overrides for tests.
 * @returns whether a pre-existing binary was reused, and the shim dir if written.
 */
export function ensureOnPath(binJs: string, options?: {
  dshHome?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  execPath?: string
}): EnsureOnPathResult {
  const env = options?.env ?? process.env
  const platform = options?.platform ?? process.platform
  if (wecomCliOnPath(env, platform)) return { alreadyOnPath: true }
  const dshHome = options?.dshHome ?? resolveDshHome(env)
  const shimDir = join(dshHome, SHIM_DIR_NAME)
  const execPath = options?.execPath ?? process.execPath
  writeWecomShim(shimDir, binJs, platform, execPath)
  prependPath(shimDir, env, platform)
  return { alreadyOnPath: false, shimDir }
}

/**
 * Write `wecom-cli` / `wecom-cli.cmd` that execs `binJs`.
 * @param shimDir - directory to create.
 * @param binJs - absolute launcher path.
 * @param platform - target platform.
 * @param execPath - Node executable to put in the shim.
 * @returns `shimDir`.
 */
export function writeWecomShim(
  shimDir: string,
  binJs: string,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): string {
  mkdirSync(shimDir, { recursive: true })
  if (platform === 'win32') {
    writeFileSync(join(shimDir, 'wecom-cli.cmd'), `@echo off\r\n"${execPath}" "${binJs}" %*\r\n`, 'utf8')
    return shimDir
  }
  const posix = join(shimDir, 'wecom-cli')
  writeFileSync(posix, `#!/bin/sh\nexec "${execPath}" "${binJs}" "$@"\n`, { encoding: 'utf8', mode: 0o755 })
  chmodSync(posix, 0o755)
  return shimDir
}

/**
 * Prepend `dir` to PATH on `env`.
 * @param dir - directory to put first.
 * @param env - environment object to mutate.
 * @param platform - target platform (selects the PATH delimiter).
 */
export function prependPath(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  const sep = delimiterFor(platform)
  const current = env.PATH ?? env.Path ?? ''
  env.PATH = current === '' ? dir : `${dir}${sep}${current}`
}

/**
 * Map `auth show --status` stdout to a status tag.
 * @param stdout - captured standard output.
 * @returns `authorized` / `unauthorized` / `error`.
 */
export function parseAuthStatus(stdout: string): AuthStatus {
  const line = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? ''
  if (line === 'authorized' || line === 'unauthorized') return line
  return 'error'
}

/**
 * Run `wecom-cli auth show --status` against `binJs`.
 * @param binJs - absolute launcher path.
 * @returns the parsed status; spawn failures become `error`.
 */
export async function probeAuth(binJs: string): Promise<AuthStatus> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binJs, 'auth', 'show', '--status'], {
      timeout: AUTH_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return parseAuthStatus(String(stdout))
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'stdout' in error) {
      const stdout = (error as { stdout: unknown }).stdout
      const parsed = parseAuthStatus(String(stdout ?? ''))
      if (parsed !== 'error') return parsed
    }
    return 'error'
  }
}

/**
 * Stdin for `wecom-cli auth init --manual`: Bot ID, then Secret, each on its own line.
 * @param botId - plugin `botId`.
 * @param secret - plugin `secret`.
 * @returns the bytes to write to stdin.
 */
export function manualAuthStdin(botId: string, secret: string): string {
  return `${botId.trim()}\n${secret.trim()}\n`
}

/**
 * Seed wecom-cli credentials from the plugin Bot ID / Secret via `--manual` stdin.
 * Does not log the secret. A CLI that requires a real TTY may still fail.
 * @param binJs - absolute launcher path.
 * @param botId - plugin `botId`.
 * @param secret - plugin `secret`.
 * @returns `undefined` when the process exits 0; otherwise an error string with no secret.
 */
export async function tryManualAuth(binJs: string, botId: string, secret: string): Promise<string | undefined> {
  const id = botId.trim()
  const sec = secret.trim()
  if (id === '' || sec === '') {
    return '缺少 botId 或 secret，无法执行 wecom-cli auth init --manual。'
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [binJs, 'auth', 'init', '--manual'],
        { timeout: AUTH_INIT_TIMEOUT_MS, windowsHide: true },
        (error) => {
          if (error !== null) reject(error)
          else resolve()
        },
      )
      child.stdin?.on('error', () => {
        // CLI closed stdin (needs TTY, or already exited); wait for the process result.
      })
      child.stdin?.end(manualAuthStdin(id, sec), 'utf8')
    })
    return undefined
  } catch {
    // Credential check failed, timeout, or CLI refused piped stdin; callers log AUTH_INIT_HINT.
    return AUTH_INIT_FAILED_MESSAGE
  }
}

/**
 * Parse one SKILL.md body. Missing/invalid frontmatter returns undefined.
 * @param text - file contents.
 * @param directory - skill directory (resource base).
 * @returns the skill, or undefined when name/description are unusable.
 */
export function parseSkillMarkdown(text: string, directory: string): WecomSkill | undefined {
  const split = splitFrontmatter(text)
  if (split === undefined) return undefined
  let data: unknown
  try {
    data = parseYaml(split.yaml)
  } catch {
    return undefined
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  if (name === '' || description === '' || !SKILL_NAME.test(name)) return undefined
  return { name, description, content: split.body.trim(), directory }
}

/**
 * Load SKILL.md from one-level subdirectories of `dir`.
 * Missing or empty directories return []. Empty `allow` keeps every valid skill.
 * @param dir - managed skills root.
 * @param allow - optional name allow-list.
 * @returns parsed skills in directory order.
 */
export function loadWecomSkills(dir: string, allow: readonly string[] = []): WecomSkill[] {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
  const allowSet = new Set(allow.map(name => name.trim()).filter(Boolean))
  const skills: WecomSkill[] = []
  for (const name of entries) {
    const directory = join(dir, name)
    const file = join(directory, 'SKILL.md')
    if (!existsSync(file)) continue
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const skill = parseSkillMarkdown(text, directory)
    if (skill === undefined) continue
    if (allowSet.size > 0 && !allowSet.has(skill.name)) continue
    skills.push(skill)
  }
  return skills
}

function delimiterFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

function splitFrontmatter(text: string): { yaml: string; body: string } | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (match === null || match[1] === undefined) return undefined
  return { yaml: match[1], body: text.slice(match[0].length) }
}
