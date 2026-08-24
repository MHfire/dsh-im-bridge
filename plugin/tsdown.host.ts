import type { UserConfig } from 'tsdown'

const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-settings',
  '@wecom/aibot-node-sdk',
]

const isExternal = (specifier: string): boolean =>
  HOST_EXTERNAL.some(name => specifier === name || specifier.startsWith(`${name}/`))

/** Host ESM library: Loader entry at lib/index.js. */
const config: UserConfig = {
  name: '@mhfire/dsh-im-bridge',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: {
    entryFileNames: 'index.js',
  },
  deps: {
    neverBundle: isExternal,
    alwaysBundle: specifier => !isExternal(specifier),
  },
}

export default config
