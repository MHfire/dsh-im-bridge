/** WeCom settings card: owned chrome, staged fields, save/discard. */

import type { ReactElement } from 'react'
import type { ImBridgeLocaleKey } from './locales.ts'
import type { WecomCardFace, WecomCardState } from './card-controller.ts'
import { PluginCard } from './PluginCard.tsx'
import { SecretField, ValueField } from './fields.tsx'
import css from './fields.module.css'

/** Props the slot renderer binds for this card. */
export interface WecomCardProps {
  /** Translate a dictionary key of the `im-bridge` namespace. */
  t: (key: ImBridgeLocaleKey) => string
  /** Card snapshot bound from inject.hooks.wecomCard. */
  useWecomCard: <S>(select: (state: WecomCardState) => S) => S
  /** Stage draft text for one field. */
  edit: WecomCardFace['edit']
  /** Stage a clear back to the composition layer. */
  resetField: WecomCardFace['resetField']
  /** Write every staged edit. */
  save: WecomCardFace['save']
  /** Drop every staged edit. */
  discard: WecomCardFace['discard']
  /** Download official wecomcli-* into the Host-resolved directory. */
  installSkills: WecomCardFace['installSkills']
}

/**
 * Render the WeCom settings card.
 * @param props - locale copy, snapshot hook, and form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function WecomCard(props: WecomCardProps): ReactElement | null {
  const { t } = props
  const state = props.useWecomCard(snapshot => snapshot)
  const disabled = !state.writable
  const field = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalidNumber'),
    disabled,
  }
  return (
    <PluginCard
      t={t}
      titleKey="title"
      descriptionKey="description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="im-bridge-botId"
        label={t('botId')}
        hint={t('secretHint')}
        disabled={disabled}
        text={state.botId.text}
        configured={state.botIdConfigured}
        stateLabel={state.botIdConfigured ? t('secretConfigured') : t('secretUnset')}
        onEdit={text => { props.edit('botId', text) }}
      />
      <SecretField
        id="im-bridge-secret"
        label={t('secret')}
        hint={t('secretHint')}
        disabled={disabled}
        text={state.secret.text}
        configured={state.secretConfigured}
        stateLabel={state.secretConfigured ? t('secretConfigured') : t('secretUnset')}
        onEdit={text => { props.edit('secret', text) }}
      />
      <SkillsInstall
        t={t}
        disabled={disabled}
        available={state.skillsInstallAvailable}
        status={state.skillsInstallStatus}
        dest={state.skillsDest}
        count={state.skillsCount}
        error={state.skillsError}
        onInstall={props.installSkills}
      />
      <ValueField
        id="im-bridge-allowFrom"
        label={t('allowFrom')}
        hint={t('allowFromHint')}
        {...field}
        {...state.allowFrom}
        onEdit={text => { props.edit('allowFrom', text) }}
        onReset={() => { props.resetField('allowFrom') }}
      />
      <ValueField
        id="im-bridge-agentTimeoutSec"
        label={t('agentTimeoutSec')}
        hint={t('agentTimeoutSecHint')}
        numeric
        {...field}
        {...state.agentTimeoutSec}
        onEdit={text => { props.edit('agentTimeoutSec', text) }}
        onReset={() => { props.resetField('agentTimeoutSec') }}
      />
      <ValueField
        id="im-bridge-startHint"
        label={t('startHint')}
        hint={t('startHintHint')}
        {...field}
        {...state.startHint}
        onEdit={text => { props.edit('startHint', text) }}
        onReset={() => { props.resetField('startHint') }}
      />
      <ValueField
        id="im-bridge-deniedMessage"
        label={t('deniedMessage')}
        hint={t('deniedMessageHint')}
        {...field}
        {...state.deniedMessage}
        onEdit={text => { props.edit('deniedMessage', text) }}
        onReset={() => { props.resetField('deniedMessage') }}
      />
      <ValueField
        id="im-bridge-welcomeMessage"
        label={t('welcomeMessage')}
        hint={t('welcomeMessageHint')}
        {...field}
        {...state.welcomeMessage}
        onEdit={text => { props.edit('welcomeMessage', text) }}
        onReset={() => { props.resetField('welcomeMessage') }}
      />
      <ValueField
        id="im-bridge-provider"
        label={t('provider')}
        hint={t('providerHint')}
        {...field}
        {...state.provider}
        onEdit={text => { props.edit('provider', text) }}
        onReset={() => { props.resetField('provider') }}
      />
      <ValueField
        id="im-bridge-model"
        label={t('model')}
        hint={t('modelHint')}
        {...field}
        {...state.model}
        onEdit={text => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
    </PluginCard>
  )
}

function skillsStatusText(
  t: (key: ImBridgeLocaleKey) => string,
  status: WecomCardState['skillsInstallStatus'],
  dest: string,
  count: number,
  error: string,
  available: boolean,
): string {
  if (!available) return t('skillsUnavailable')
  if (status === 'ok') {
    return t('skillsInstalled').replace('{count}', String(count)).replace('{dest}', dest)
  }
  if (status === 'error') {
    return error === '' ? t('skillsFailed') : `${t('skillsFailed')} ${error}`
  }
  return t('skillsHint')
}

/**
 * Host-side install of official wecomcli-* (browser never chooses the path).
 * @param props - copy, status, and the install action.
 * @returns the labelled control.
 */
function SkillsInstall(props: {
  t: (key: ImBridgeLocaleKey) => string
  disabled: boolean
  available: boolean
  status: WecomCardState['skillsInstallStatus']
  dest: string
  count: number
  error: string
  onInstall: () => void
}): ReactElement {
  const installing = props.status === 'installing'
  const status = skillsStatusText(
    props.t,
    props.status,
    props.dest,
    props.count,
    props.error,
    props.available,
  )
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{props.t('skillsTitle')}</span>
      </div>
      <button
        type="button"
        className={css.install}
        disabled={props.disabled || !props.available || installing}
        onClick={props.onInstall}
      >
        {props.t(installing ? 'skillsInstalling' : 'skillsInstall')}
      </button>
      <p className={props.status === 'error' || !props.available ? css.invalid : css.hint}>
        {status}
      </p>
    </div>
  )
}
