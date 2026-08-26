/** Dictionary keys owned by the im-bridge settings card. */
export type ImBridgeLocaleKey =
  | 'title'
  | 'description'
  | 'unsaved'
  | 'readOnly'
  | 'saveFailed'
  | 'save'
  | 'saving'
  | 'discard'
  | 'expand'
  | 'collapse'
  | 'overridden'
  | 'reset'
  | 'invalidNumber'
  | 'botId'
  | 'secret'
  | 'secretHint'
  | 'secretConfigured'
  | 'secretUnset'
  | 'allowFrom'
  | 'allowFromHint'
  | 'agentTimeoutSec'
  | 'agentTimeoutSecHint'
  | 'startHint'
  | 'startHintHint'
  | 'deniedMessage'
  | 'deniedMessageHint'
  | 'welcomeMessage'
  | 'welcomeMessageHint'
  | 'provider'
  | 'providerHint'
  | 'model'
  | 'modelHint'
  | 'skillsTitle'
  | 'skillsHint'
  | 'skillsInstall'
  | 'skillsInstalling'
  | 'skillsInstalled'
  | 'skillsFailed'
  | 'skillsUnavailable'

/** English copy for the im-bridge card. */
export const en: Record<ImBridgeLocaleKey, string> = {
  title: 'WeCom Bridge',
  description: 'Credentials, allow-list, timeouts, and WeCom-only model overrides.',
  unsaved: 'Unsaved',
  readOnly: 'This document is read-only.',
  saveFailed: 'Save did not land. Correct the fields and try again.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  expand: 'Show settings',
  collapse: 'Hide settings',
  overridden: 'Overridden',
  reset: 'Reset',
  invalidNumber: 'Enter a finite number.',
  botId: 'Bot ID',
  secret: 'Secret',
  secretHint: 'The box stays empty on purpose (the stored value never rides the wire). A Configured badge means it is saved; type a new value to replace it. Save, then restart the process to open the WebSocket.',
  secretConfigured: 'Configured',
  secretUnset: 'Not configured',
  allowFrom: 'Allowed sender userids',
  allowFromHint: 'Comma-separated. Empty allows everyone.',
  agentTimeoutSec: 'Task timeout (seconds)',
  agentTimeoutSecHint: 'Progress bar and remaining-time estimate.',
  startHint: 'Placeholder while thinking',
  startHintHint: 'First stream line after a message arrives.',
  deniedMessage: 'Denied-sender reply',
  deniedMessageHint: 'Sent when the userid is outside the allow-list.',
  welcomeMessage: 'Welcome message',
  welcomeMessageHint: 'Sent when a user opens the WeCom chat.',
  provider: 'WeCom-only provider',
  providerHint: 'Empty follows the GUI default model. Both provider and model must be set to override.',
  model: 'WeCom-only model',
  modelHint: 'Takes effect only together with provider.',
  skillsTitle: 'WeCom office skills',
  skillsHint: 'Installs wecomcli-* into the plugin directory ($DSH_HOME/wecom-cli-skills). Do not use npx skills add -g; that CLI has no --dir. An empty Bot ID / Secret box is normal.',
  skillsInstall: 'Install official skills',
  skillsInstalling: 'Installing…',
  skillsInstalled: 'Installed {count} skills into {dest}',
  skillsFailed: 'Install failed.',
  skillsUnavailable: 'Install needs the Web host Connection.',
}

/** Chinese copy for the im-bridge card. */
export const zh: Record<ImBridgeLocaleKey, string> = {
  title: '企业微信桥接',
  description: '凭证、白名单、超时和企微专用模型覆盖。',
  unsaved: '未保存',
  readOnly: '当前文档不可写。',
  saveFailed: '保存未生效，请修正后重试。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  expand: '展开设置',
  collapse: '收起设置',
  overridden: '已覆盖',
  reset: '重置',
  invalidNumber: '请输入有效数字。',
  botId: 'Bot ID',
  secret: 'Secret',
  secretHint: '框空是正常的（已存值不会传到浏览器）。徽章「已配置」即已保存；重新输入可覆盖。保存后需重启进程才会连 WebSocket。',
  secretConfigured: '已配置',
  secretUnset: '未配置',
  allowFrom: '允许的发送者 userid',
  allowFromHint: '逗号分隔；空 = 允许所有人。',
  agentTimeoutSec: '单任务超时（秒）',
  agentTimeoutSecHint: '动画进度条和剩余估算的基准。',
  startHint: '开始处理时的占位提示',
  startHintHint: '收到消息后推送的第一条流式文案。',
  deniedMessage: '非白名单拒绝文案',
  deniedMessageHint: '发送者不在白名单时回复。',
  welcomeMessage: '进入会话欢迎语',
  welcomeMessageHint: '用户打开企微会话时发送。',
  provider: '企微专用 provider',
  providerHint: '空 = 跟随 GUI 默认模型。须与 model 同时填写才覆盖。',
  model: '企微专用 model',
  modelHint: '仅在同时填写 provider 时生效。',
  skillsTitle: '企微办公 skills',
  skillsHint: '装到程序目录 $DSH_HOME/wecom-cli-skills。不要用 npx skills add -g；CLI 没有 --dir。Bot ID / Secret 框空是正常的。',
  skillsInstall: '安装官方 skills',
  skillsInstalling: '正在安装…',
  skillsInstalled: '已装 {count} 个到 {dest}',
  skillsFailed: '安装失败。',
  skillsUnavailable: '安装需要 Web Host 的 Connection。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'im-bridge': ImBridgeLocaleKey
  }
}
