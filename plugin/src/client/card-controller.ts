/** Staged form over the `im-bridge` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm,
  csvField,
  numberField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'

/** One redacted secret slot from `settings.describe`. */
interface SecretSlotView {
  path: readonly string[]
  set: boolean
}

/**
 * Cross-namespace describe face. Typed locally so this out-of-tree package
 * does not value- or type-import `@deepseek-ai/dsh-client-ui-settings`.
 */
interface SettingsDescribeFace {
  getSnapshot(): {
    view?: {
      namespaces: ReadonlyArray<{
        ns: string
        secrets: readonly SecretSlotView[]
      }>
    }
  }
}

/** Settings namespace paired with this card. */
const NS = 'im-bridge'

/** User-editable slice of the im-bridge settings namespace. */
export interface WecomCardSettings {
  allowFrom?: string[]
  agentTimeoutSec?: number
  startHint?: string
  deniedMessage?: string
  welcomeMessage?: string
  provider?: string
  model?: string
}

/** Snapshot the WeCom card renders. */
export interface WecomCardState extends CardShell {
  botId: CardFieldState
  secret: CardFieldState
  botIdConfigured: boolean
  secretConfigured: boolean
  allowFrom: CardFieldState
  agentTimeoutSec: CardFieldState
  startHint: CardFieldState
  deniedMessage: CardFieldState
  welcomeMessage: CardFieldState
  provider: CardFieldState
  model: CardFieldState
}

/** Face the card's slot registration injects. */
export interface WecomCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWecomCard. */
    wecomCard: SnapshotStore<WecomCardState>
  }
}

/** Bridges the `im-bridge` scope onto the staged card form. */
export class WecomCardController {
  private readonly form: CardForm<WecomCardSettings>
  private readonly store: SnapshotStore<WecomCardState>

  /**
   * @param scope - bound settings scope for the `im-bridge` namespace.
   * @param describe - Host describe face; secret literals never ride it.
   */
  constructor(
    private readonly scope: SettingsScope<WecomCardSettings>,
    private readonly describe: SettingsDescribeFace,
  ) {
    this.form = new CardForm(
      scope,
      [
        csvField('allowFrom'),
        numberField('agentTimeoutSec'),
        textField('startHint'),
        textField('deniedMessage'),
        textField('welcomeMessage'),
        textField('provider'),
        textField('model'),
      ],
      [
        { field: 'botId', write: text => this.writeSecret('botId', text) },
        { field: 'secret', write: text => this.writeSecret('secret', text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WecomCardState {
    return {
      ...this.form.shell(),
      botId: this.form.field('botId'),
      secret: this.form.field('secret'),
      botIdConfigured: this.secretConfigured('botId'),
      secretConfigured: this.secretConfigured('secret'),
      allowFrom: this.form.field('allowFrom'),
      agentTimeoutSec: this.form.field('agentTimeoutSec'),
      startHint: this.form.field('startHint'),
      deniedMessage: this.form.field('deniedMessage'),
      welcomeMessage: this.form.field('welcomeMessage'),
      provider: this.form.field('provider'),
      model: this.form.field('model'),
    }
  }

  /**
   * Whether the Host reports a configured value for one secret slot.
   * @param field - `botId` or `secret`.
   * @returns true when describe lists that slot as set.
   */
  private secretConfigured(field: string): boolean {
    const row = this.describe.getSnapshot().view?.namespaces.find(candidate => candidate.ns === NS)
    return row?.secrets.some(slot => slot.path[0] === field && slot.set) === true
  }

  /**
   * Write one credential into the user layer, then read configured state back.
   * @param field - `botId` or `secret`.
   * @param text - the staged literal.
   * @returns whether describe reports the slot set afterwards.
   */
  private async writeSecret(field: string, text: string): Promise<boolean> {
    await this.scope.set(field, text)
    return this.secretConfigured(field)
  }

  /** Face the slot registration injects. */
  inject(): WecomCardFace {
    return { hooks: { wecomCard: this.store }, ...this.form.actions() }
  }
}
