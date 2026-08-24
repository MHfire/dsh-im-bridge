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

  /** @param scope - bound settings scope for the `im-bridge` namespace. */
  constructor(scope: SettingsScope<WecomCardSettings>) {
    this.form = new CardForm(scope, [
      csvField('allowFrom'),
      numberField('agentTimeoutSec'),
      textField('startHint'),
      textField('deniedMessage'),
      textField('welcomeMessage'),
      textField('provider'),
      textField('model'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WecomCardState {
    return {
      ...this.form.shell(),
      allowFrom: this.form.field('allowFrom'),
      agentTimeoutSec: this.form.field('agentTimeoutSec'),
      startHint: this.form.field('startHint'),
      deniedMessage: this.form.field('deniedMessage'),
      welcomeMessage: this.form.field('welcomeMessage'),
      provider: this.form.field('provider'),
      model: this.form.field('model'),
    }
  }

  /** Face the slot registration injects. */
  inject(): WecomCardFace {
    return { hooks: { wecomCard: this.store }, ...this.form.actions() }
  }
}
