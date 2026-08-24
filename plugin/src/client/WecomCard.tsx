/** WeCom settings card: own chrome, staged fields, save/discard. */

import { useState, type CSSProperties, type ReactElement } from 'react'
import type { ImBridgeLocaleKey } from './locales.ts'
import type { WecomCardFace, WecomCardState } from './card-controller.ts'
import type { CardFieldState } from './card-form.ts'

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
}

const cardStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '12px 14px',
  border: '1px solid var(--dsw-border, #d0d0d0)',
  borderRadius: 8,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

const nameStyle: CSSProperties = { fontSize: 14, fontWeight: 600 }
const descStyle: CSSProperties = { fontSize: 12, color: 'var(--dsw-muted, #888)', marginTop: 2 }
const bodyStyle: CSSProperties = { display: 'grid', gap: 10, marginTop: 12 }
const fieldStyle: CSSProperties = { display: 'grid', gap: 2, fontSize: 13 }
const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: 13 }
const footerStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }
const hintStyle: CSSProperties = { fontSize: 12, color: 'var(--dsw-muted, #888)' }

interface FieldRowProps {
  id: string
  label: string
  hint: string
  numeric?: boolean
  disabled: boolean
  field: CardFieldState
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}

function FieldRow(props: FieldRowProps): ReactElement {
  return (
    <label htmlFor={props.id} style={fieldStyle}>
      <span>
        {props.label}
        {props.field.overridden
          ? (
            <>
              {' '}
              <span style={hintStyle}>{props.overriddenLabel}</span>
              {' '}
              <button type="button" disabled={props.disabled} onClick={props.onReset}>
                {props.resetLabel}
              </button>
            </>
          )
          : null}
      </span>
      <input
        id={props.id}
        type={props.numeric === true ? 'number' : 'text'}
        value={props.field.text}
        disabled={props.disabled}
        aria-invalid={props.field.invalid || undefined}
        style={inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <span style={{ ...hintStyle, color: props.field.invalid ? '#c00' : hintStyle.color }}>
        {props.field.invalid ? props.invalidLabel : props.hint}
      </span>
    </label>
  )
}

/**
 * Render the WeCom settings card.
 * @param props - locale copy, snapshot hook, and form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function WecomCard(props: WecomCardProps): ReactElement | null {
  const { t } = props
  const state = props.useWecomCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li style={cardStyle}>
      <button
        type="button"
        style={headerStyle}
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        <span>
          <span style={nameStyle}>{t('title')}</span>
          <div style={descStyle}>{t('description')}</div>
        </span>
        {state.dirty ? <span style={hintStyle}>{t('unsaved')}</span> : null}
      </button>
      {open
        ? (
          <div style={bodyStyle}>
            {!state.writable ? <p style={hintStyle} role="status">{t('readOnly')}</p> : null}
            <FieldRow
              id="im-bridge-allowFrom"
              label={t('allowFrom')}
              hint={t('allowFromHint')}
              disabled={disabled}
              field={state.allowFrom}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('allowFrom', text) }}
              onReset={() => { props.resetField('allowFrom') }}
            />
            <FieldRow
              id="im-bridge-agentTimeoutSec"
              label={t('agentTimeoutSec')}
              hint={t('agentTimeoutSecHint')}
              numeric
              disabled={disabled}
              field={state.agentTimeoutSec}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('agentTimeoutSec', text) }}
              onReset={() => { props.resetField('agentTimeoutSec') }}
            />
            <FieldRow
              id="im-bridge-startHint"
              label={t('startHint')}
              hint={t('startHintHint')}
              disabled={disabled}
              field={state.startHint}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('startHint', text) }}
              onReset={() => { props.resetField('startHint') }}
            />
            <FieldRow
              id="im-bridge-deniedMessage"
              label={t('deniedMessage')}
              hint={t('deniedMessageHint')}
              disabled={disabled}
              field={state.deniedMessage}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('deniedMessage', text) }}
              onReset={() => { props.resetField('deniedMessage') }}
            />
            <FieldRow
              id="im-bridge-welcomeMessage"
              label={t('welcomeMessage')}
              hint={t('welcomeMessageHint')}
              disabled={disabled}
              field={state.welcomeMessage}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('welcomeMessage', text) }}
              onReset={() => { props.resetField('welcomeMessage') }}
            />
            <FieldRow
              id="im-bridge-provider"
              label={t('provider')}
              hint={t('providerHint')}
              disabled={disabled}
              field={state.provider}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('provider', text) }}
              onReset={() => { props.resetField('provider') }}
            />
            <FieldRow
              id="im-bridge-model"
              label={t('model')}
              hint={t('modelHint')}
              disabled={disabled}
              field={state.model}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              onEdit={text => { props.edit('model', text) }}
              onReset={() => { props.resetField('model') }}
            />
            <div style={footerStyle}>
              {state.failed ? <span role="status" style={{ color: '#c00', fontSize: 12 }}>{t('saveFailed')}</span> : null}
              <button type="button" disabled={!state.dirty || state.saving} onClick={props.discard}>
                {t('discard')}
              </button>
              <button type="button" disabled={blocked} onClick={props.save}>
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
