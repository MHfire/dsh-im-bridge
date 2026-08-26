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

/** Directory that holds the PATH deny shim. */
export const SHIM_DIR_NAME = 'wecom-cli-bin'

/** Model-facing name of the gated office tool. */
export const WECOM_CLI_TOOL_NAME = 'wecom_cli'

/** Wall-clock limit for one gated office command. */
export const WECOM_CLI_TOOL_TIMEOUT_MS = 120_000

/** Byte ceiling applied to each of stdout and stderr before the model sees them. */
export const WECOM_CLI_TOOL_MAX_OUTPUT_BYTES = 60_000

/**
 * What the PATH shim prints before exiting 1. ASCII only: a `.cmd` echoes the
 * file's bytes, and a console under a non-UTF-8 code page would garble Chinese.
 */
export const WECOM_CLI_SHIM_DENY_MESSAGE =
  'wecom-cli is disabled in this window. Office 1:1 agents must call the wecom_cli tool with an argv array; group chats have no office access.'

/** Timeout for `wecom-cli auth show --status`. */
export const AUTH_PROBE_TIMEOUT_MS = 10_000

/** Timeout for `wecom-cli auth init --bot-id/--secret` (CLI contacts WeCom). */
export const AUTH_INIT_TIMEOUT_MS = 30_000

/** Host TTY fallback command; the credential directory is deployment-specific, so use {@link authInitHint}. */
export const AUTH_INIT_COMMAND = 'npx --yes @wecom/cli auth init --manual'

/**
 * Host-terminal fallback that writes into the credential directory this plugin reads.
 * The plugin injects `WECOM_CLI_CONFIG_DIR` per spawn, so a bare terminal would
 * otherwise authorize `~/.config/wecom`, which nothing here reads.
 * @param configDir - absolute credential directory.
 * @param platform - target platform; selects pwsh or POSIX env syntax.
 * @returns a one-line command to run on the host.
 */
export function authInitHint(
  configDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? `$env:${WECOM_CLI_CONFIG_DIR_ENV}='${configDir}'; ${AUTH_INIT_COMMAND}`
    : `${WECOM_CLI_CONFIG_DIR_ENV}='${configDir}' ${AUTH_INIT_COMMAND}`
}

/** Logged when plugin config has no Bot ID or Secret. Must never include the secret value. */
export const AUTH_INIT_MISSING_MESSAGE = '缺少 botId 或密钥，无法写入 wecom-cli 凭据。'

/**
 * Logged when automatic seeding exits non-zero. Must never include botId or the secret value.
 * @param configDir - absolute credential directory, for the manual fallback.
 * @returns the operator-facing failure line.
 */
export function authInitFailedMessage(configDir: string): string {
  return `wecom-cli 未能用已有 Bot ID 完成授权。请重启 dsh，或在 host 终端执行 ${authInitHint(configDir)}（输入同一套密钥，不要全局安装）。`
}

/** Logged when wecomCli is on but wecomCli.allowFrom is empty. */
export const ALLOW_FROM_REQUIRED_MESSAGE =
  'wecomCli 已开启但 wecomCli.allowFrom 为空；已跳过 wecom-cli 的 PATH 与授权检查。聊天仍由根级 allowFrom 控制（空 = 所有人）。请把办公 userid 配进 wecomCli.allowFrom。工作区 .dsh/skills 或 .agents/skills 里残留的 wecomcli-* 仍会被该 cwd 下所有 Agent 发现。'

/** Logged when the Agent context has no skills.register. */
export const SKILLS_SERVICE_MISSING_MESSAGE =
  '当前 Agent 没有 skills 服务，无法注册 wecomcli-*。'

/** Logged when the Agent context has no tools.register. */
export const TOOLS_SERVICE_MISSING_MESSAGE =
  `当前 Agent 没有 tools 服务，无法注册 ${WECOM_CLI_TOOL_NAME}，办公命令不可用。`

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

/** Channel rules for every WeCom Agent: no GUI confirm, so `ask_user_question` hangs. */
export const WECOM_CHANNEL_PROMPT =
  '本通道是企业微信，没有确认框。禁止调用 ask_user_question，它会挂到任务超时；有问题写在回复里问。'

/** Extra system-prompt rules for office 1:1 (gated `wecom_cli` tool). */
export const WECOM_CLI_PROMPT = [
  WECOM_CHANNEL_PROMPT,
  `办公只用 ${WECOM_CLI_TOOL_NAME}：argv 为 wecom-cli 之后的参数，例如 ["message","aibot","sessions","list"]。禁止用 pwsh/bash/npx/npm 再跑 wecom-cli。`,
  '发信、取消会议、删待办、覆盖文档：先 --dry-run，回复里说明，等用户下一条确认再执行。',
  `禁止任何 auth init 与扫码（会新建机器人）。凭证由插件维护。报 853004 时用 ${WECOM_CLI_TOOL_NAME} 重试该命令；仍失败则让用户重启 dsh。`,
].join('\n')

/** Prompt for group chats, non-office 1:1, and WeCom agents with wecomCli off. */
export const WECOM_CLI_NO_OFFICE_PROMPT = [
  WECOM_CHANNEL_PROMPT,
  `本通道没有企微办公权限：没有 ${WECOM_CLI_TOOL_NAME}，禁止 wecom-cli / npx @wecom/cli / wecomcli-*。只回答诊断与当前工作区任务。`,
].join('\n')

/** Prepended to every official skill body: its `wecom-cli ...` lines are not runnable here. */
export const WECOM_CLI_SKILL_PREFIX = [
  `执行方式：本机没有可直接运行的 wecom-cli 命令。下文每条 \`wecom-cli ...\` 都改为调用 ${WECOM_CLI_TOOL_NAME} 工具，argv 传命令名之后的参数。`,
  `例如 \`wecom-cli message aibot send --chat-id X\` → ${WECOM_CLI_TOOL_NAME}({"argv":["message","aibot","send","--chat-id","X"]})。`,
  '禁止用 pwsh/bash/npx 运行 wecom-cli。',
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

/** Minimal Cordis face used to look up an optional Agent-scoped service. */
export interface AgentServiceHost {
  /** Service lookup; a missing service is a no-op with a warning. */
  get(name: string): unknown
}

/** One completed gated CLI run; matches the tool's `output.schema` exactly. */
export interface WecomCliRun {
  /** Captured standard output, clipped to {@link WECOM_CLI_TOOL_MAX_OUTPUT_BYTES}. */
  stdout: string
  /** Captured standard error, clipped the same way; also carries spawn failures. */
  stderr: string
  /** Process exit code; a spawn failure or timeout reports 1. */
  exitCode: number
}

/** The part of a DSH tool execution context this tool uses. */
export interface RuntimeToolExec {
  /** Caller-owned cancellation for this call. */
  signal: AbortSignal
}

/** Duck-typed `ctx.tools.register()` payload (no `@deepseek-ai/dsh-tools` import). */
export interface RuntimeToolRegistration {
  /** Model-visible tool name. */
  name: string
  /** Model-visible description. */
  description: string
  /** JSON Schema for the model's arguments. */
  parameters: Record<string, unknown>
  /** Mandatory canonical output declaration; the registry validates every returned value against `schema`. */
  output: {
    /** JSON Schema of the value `execute` returns. */
    schema: Record<string, unknown>
    /** Pure projection from the canonical value to model-facing content. */
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  /** Cooperative wall-clock budget enforced by the host's timeout policy. */
  timeoutMs?: number
  /** Run one accepted call. */
  execute(args: unknown, exec: RuntimeToolExec): Promise<WecomCliRun>
  /** Pure pending-state card, derived from `args` alone. */
  presentCall(args: unknown): { card: 'terminal'; title: string }
}

/** Result of installing the PATH deny shim. */
export interface EnsureOnPathResult {
  /** Directory prepended to PATH; holds the deny shim. */
  shimDir: string
  /** True when another wecom-cli executable was already on PATH and is now shadowed. */
  shadowed: boolean
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
 * Create the credential directory. Deliberately does not touch `process.env`:
 * an exported `WECOM_CLI_CONFIG_DIR` would hand the authorized identity to every
 * child process, including a group chat's shell reaching a CLI copy some other way.
 * @param dir - absolute credential directory.
 * @returns `dir`.
 */
export function ensureConfigDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Environment for one CLI spawn: `WECOM_CLI_CONFIG_DIR` reaches the CLI only here,
 * never `~/.config/wecom` and never the ambient process environment.
 * @param configDir - absolute credential directory.
 * @param base - environment to extend; defaults to `process.env`.
 * @returns a new environment object; `base` is not mutated.
 */
export function wecomCliEnv(
  configDir: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, [WECOM_CLI_CONFIG_DIR_ENV]: configDir }
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
 * The body keeps the official `wecom-cli ...` command lines, so
 * {@link WECOM_CLI_SKILL_PREFIX} leads and redirects them to the gated tool.
 * @param skill - parsed SKILL.md.
 * @returns the registration, or undefined when the name is not `wecomcli-*`.
 */
export function toRuntimeSkillRegistration(skill: WecomSkill): RuntimeSkillRegistration | undefined {
  if (!skill.name.startsWith('wecomcli-')) return undefined
  return {
    name: skill.name,
    description: skill.description,
    source: 'runtime',
    content: `${WECOM_CLI_SKILL_PREFIX}\n\n${skill.content}`,
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
  agentCtx: AgentServiceHost,
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

function skillsRegisterOf(agentCtx: AgentServiceHost): { register(skill: RuntimeSkillRegistration): () => void } | undefined {
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
 * Write the deny shim and put it first on PATH, shadowing any other wecom-cli.
 * Every child process of this host — group chats, the GUI, the user's own
 * terminal tools — resolves `wecom-cli` to a command that refuses; the plugin
 * itself never goes through PATH.
 * @param options - home, env, and platform overrides for tests.
 * @returns the shim directory and whether another wecom-cli was shadowed.
 */
export function ensureOnPath(options?: {
  dshHome?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): EnsureOnPathResult {
  const env = options?.env ?? process.env
  const platform = options?.platform ?? process.platform
  const shadowed = wecomCliOnPath(env, platform)
  const dshHome = options?.dshHome ?? resolveDshHome(env)
  const shimDir = join(dshHome, SHIM_DIR_NAME)
  writeWecomShim(shimDir, platform)
  prependPath(shimDir, env, platform)
  return { shimDir, shadowed }
}

/**
 * Write `wecom-cli` / `wecom-cli.cmd` that print {@link WECOM_CLI_SHIM_DENY_MESSAGE}
 * and exit 1. The message names the tool that does work, so a model following a
 * skill body's `wecom-cli ...` line learns the supported route from the failure.
 * @param shimDir - directory to create.
 * @param platform - target platform.
 * @returns `shimDir`.
 */
export function writeWecomShim(
  shimDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  mkdirSync(shimDir, { recursive: true })
  if (platform === 'win32') {
    writeFileSync(
      join(shimDir, 'wecom-cli.cmd'),
      `@echo off\r\necho ${WECOM_CLI_SHIM_DENY_MESSAGE}\r\nexit /b 1\r\n`,
      'utf8',
    )
    return shimDir
  }
  const posix = join(shimDir, 'wecom-cli')
  writeFileSync(
    posix,
    `#!/bin/sh\necho '${WECOM_CLI_SHIM_DENY_MESSAGE}'\nexit 1\n`,
    { encoding: 'utf8', mode: 0o755 },
  )
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
 * @param configDir - credential directory injected for this spawn.
 * @returns the parsed status; spawn failures become `error`.
 */
export async function probeAuth(binJs: string, configDir: string): Promise<AuthStatus> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binJs, 'auth', 'show', '--status'], {
      timeout: AUTH_PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: wecomCliEnv(configDir),
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
 * Hidden `@wecom/cli` argv: `auth init --bot-id/--secret`.
 * Official `--manual` needs a TTY; these flags skip prompts when stderr is not a terminal.
 * @param botId - plugin `botId`.
 * @param secret - plugin `secret`.
 * @returns argv after the launcher path. Do not log this array.
 */
export function authInitArgv(botId: string, secret: string): string[] {
  return ['auth', 'init', '--bot-id', botId.trim(), '--secret', secret.trim()]
}

/**
 * Seed wecom-cli credentials from the plugin Bot ID / Secret via hidden `--bot-id/--secret`.
 * Does not log the secret. Stdio stays piped so the CLI sees a non-TTY stderr.
 * @param binJs - absolute launcher path.
 * @param botId - plugin `botId`.
 * @param secret - plugin `secret`.
 * @param configDir - credential directory the seeded credentials are written to.
 * @returns `undefined` when the process exits 0; otherwise an error string with no secret value.
 */
export async function trySeedAuth(
  binJs: string,
  botId: string,
  secret: string,
  configDir: string,
): Promise<string | undefined> {
  const id = botId.trim()
  const sec = secret.trim()
  if (id === '' || sec === '') {
    return AUTH_INIT_MISSING_MESSAGE
  }
  try {
    await execFileAsync(process.execPath, [binJs, ...authInitArgv(id, sec)], {
      timeout: AUTH_INIT_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      env: wecomCliEnv(configDir),
    })
    return undefined
  } catch {
    // Credential check failed, timeout, or CLI rejected the hidden flags.
    return authInitFailedMessage(configDir)
  }
}

/**
 * Reject argv that would re-authorize the CLI. QR / `auth init` creates a NEW
 * bot; credentials are the plugin's job, and `--bot-id/--secret` never belong
 * in a model-supplied command.
 * @param argv - arguments after the `wecom-cli` name.
 * @returns a model-facing reason, or undefined when the command may run.
 */
export function argvForbiddenAuth(argv: readonly string[]): string | undefined {
  const tokens = new Set(argv.map(token => token.trim().toLowerCase()))
  if (tokens.has('auth') && tokens.has('init')) {
    return '禁止 auth init：重新授权会新建智能机器人。凭证由 im-bridge 用已有 botId/密钥维护；报 853004 时直接重试业务命令。'
  }
  if (tokens.has('--bot-id') || tokens.has('--secret')) {
    return '禁止在 argv 里传 --bot-id/--secret。'
  }
  return undefined
}

/**
 * Validate the model's tool arguments.
 * @param args - raw tool arguments.
 * @returns the argv array.
 * @throws when `argv` is missing, empty, or not all strings.
 */
export function parseWecomCliArgs(args: unknown): string[] {
  const argv = typeof args === 'object' && args !== null
    ? (args as { argv?: unknown }).argv
    : undefined
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(item => typeof item !== 'string')) {
    throw new Error(`${WECOM_CLI_TOOL_NAME} 需要 argv：非空字符串数组，例如 ["message","aibot","sessions","list"]`)
  }
  return argv as string[]
}

/**
 * Clip `text` to a byte ceiling; a split multibyte character becomes U+FFFD.
 * @param text - captured stream contents.
 * @param limit - byte ceiling.
 * @returns `text`, or a truncated copy that states the original byte length.
 */
export function clipOutput(text: string, limit: number = WECOM_CLI_TOOL_MAX_OUTPUT_BYTES): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= limit) return text
  const head = new TextDecoder().decode(bytes.subarray(0, limit))
  return `${head}\n…（输出已截断，原始 ${String(bytes.byteLength)} 字节）`
}

/**
 * Run one office command directly against `binJs`, bypassing PATH and the deny shim.
 * A non-zero exit is a domain result, not a throw; cancellation propagates.
 * @param binJs - absolute launcher path.
 * @param argv - arguments after the `wecom-cli` name.
 * @param configDir - credential directory injected for this spawn.
 * @param signal - caller cancellation from the tool execution.
 * @returns clipped stdout/stderr and the exit code.
 */
export async function runWecomCli(
  binJs: string,
  argv: readonly string[],
  configDir: string,
  signal?: AbortSignal,
): Promise<WecomCliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binJs, ...argv], {
      timeout: WECOM_CLI_TOOL_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: WECOM_CLI_TOOL_MAX_OUTPUT_BYTES * 4,
      env: wecomCliEnv(configDir),
      signal,
    })
    return { stdout: clipOutput(String(stdout)), stderr: clipOutput(String(stderr)), exitCode: 0 }
  } catch (error) {
    if (signal?.aborted === true) throw error
    const failure = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown }
    const stderr = String(failure.stderr ?? '') || String(failure.message ?? '')
    return {
      stdout: clipOutput(String(failure.stdout ?? '')),
      stderr: clipOutput(stderr),
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    }
  }
}

/**
 * Model-facing text for one run: stdout, then stderr, then the exit code.
 * @param value - completed run.
 * @returns the rendered block.
 */
export function renderWecomCliRun(value: WecomCliRun): string {
  const parts: string[] = []
  if (value.stdout.trim() !== '') parts.push(value.stdout.trimEnd())
  if (value.stderr.trim() !== '') parts.push(`[stderr]\n${value.stderr.trimEnd()}`)
  parts.push(`[exit code: ${String(value.exitCode)}]`)
  return parts.join('\n')
}

/**
 * Build the gated office tool. Registering it on an Agent context is the only
 * way a model reaches wecom-cli; PATH resolves to the deny shim everywhere.
 * @param binJs - absolute launcher path.
 * @param configDir - credential directory injected into every run.
 * @returns the duck-typed `ctx.tools.register()` payload.
 */
export function wecomCliToolDefinition(binJs: string, configDir: string): RuntimeToolRegistration {
  return {
    name: WECOM_CLI_TOOL_NAME,
    description: '执行企业微信办公命令（wecom-cli）。argv 是 wecom-cli 之后的参数，例如 ["message","aibot","sessions","list"]。禁止 auth init 与扫码授权；不要用 pwsh/bash/npx 运行 wecom-cli。',
    parameters: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'wecom-cli 之后的参数，逐个元素，不要拼成一整条命令行。',
        },
      },
      required: ['argv'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
        },
        required: ['stdout', 'stderr', 'exitCode'],
      },
      render: (_args, value) => [{ type: 'text', text: renderWecomCliRun(value as WecomCliRun) }],
    },
    timeoutMs: WECOM_CLI_TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const argv = parseWecomCliArgs(args)
      const forbidden = argvForbiddenAuth(argv)
      if (forbidden !== undefined) throw new Error(forbidden)
      exec.signal.throwIfAborted()
      return runWecomCli(binJs, argv, configDir, exec.signal)
    },
    presentCall: (args) => {
      const argv = typeof args === 'object' && args !== null ? (args as { argv?: unknown }).argv : undefined
      const shown = Array.isArray(argv) ? argv.filter(item => typeof item === 'string').join(' ') : ''
      return { card: 'terminal', title: `wecom-cli ${shown}`.trimEnd() }
    },
  }
}

/**
 * Register the gated office tool on this Agent's tools layer. Must be called on
 * `agentCtx`: a host context would register it globally, exposing it to the GUI
 * and to group chats.
 * @param agentCtx - the Agent-scoped Cordis context.
 * @param binJs - absolute launcher path.
 * @param configDir - credential directory injected into every run.
 * @returns true when the tool was registered.
 */
export function registerWecomCliTool(
  agentCtx: AgentServiceHost,
  binJs: string,
  configDir: string,
): boolean {
  const registry = toolsRegisterOf(agentCtx)
  if (registry === undefined) {
    console.warn(`[im-bridge] ${TOOLS_SERVICE_MISSING_MESSAGE}`)
    return false
  }
  registry.register(wecomCliToolDefinition(binJs, configDir))
  return true
}

function toolsRegisterOf(agentCtx: AgentServiceHost): { register(tool: RuntimeToolRegistration): () => void } | undefined {
  const tools = agentCtx.get('tools')
  if (tools === undefined || tools === null || typeof tools !== 'object') return undefined
  const register = (tools as { register?: unknown }).register
  if (typeof register !== 'function') return undefined
  return tools as { register(tool: RuntimeToolRegistration): () => void }
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
