/**
 * Browser half: Settings card for the `im-bridge` namespace.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: ctx.slots, ctx.locale, ctx.configForms, and the Plugins page slot.
// Behavior crosses packages through services and slots only.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { WecomCard } from './WecomCard.tsx'
import { WecomCardController, type SkillsInstallRpc } from './card-controller.ts'
import { en, zh } from './locales.ts'

/** Settings namespace shared with the Host half. */
const NS = 'im-bridge'

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

/**
 * Register locale copy and the Plugins page card while the Host serves this namespace.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as { rpc?: SkillsInstallRpc } | undefined
  const card = new WecomCardController(
    ctx.configForms.get(NS),
    ctx.configForms.describe(),
    connection?.rpc,
  )
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'im-bridge: locale dicts')

  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: NS,
    order: 50,
    label: () => t('title'),
    locale: NS,
    inject: () => card.inject(),
  }, WecomCard))), 'im-bridge: settings card')
}
