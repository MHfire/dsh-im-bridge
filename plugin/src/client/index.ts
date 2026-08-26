/**
 * Browser half: Settings card keyed by the `im-bridge` namespace.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: ctx.settingsScope.describe and the keyed slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { WecomCard } from './WecomCard.tsx'
import { WecomCardController, type SkillsInstallRpc } from './card-controller.ts'
import { en, zh } from './locales.ts'

/** Settings namespace shared with the Host half. */
const NS = 'im-bridge'

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register locale copy and the Plugins-tab card.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as { rpc?: SkillsInstallRpc } | undefined
  const card = new WecomCardController(
    ctx.settingsScope.bind({ namespace: NS }),
    ctx.settingsScope.describe(),
    connection?.rpc,
  )

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'im-bridge: locale dicts')

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => card.inject(),
  }, WecomCard))
}
