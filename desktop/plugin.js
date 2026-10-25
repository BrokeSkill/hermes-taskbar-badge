import { Button, Codicon, Input, ListRow, STATUSBAR_AREAS, atom, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const BRIDGE_PORT = 8766
const STATE_LABELS = { 1: 'completed', 2: 'needs input', 3: 'failed' }

const DONE = 1
const NEEDS_INPUT = 2
const FAILED = 3

const SETTINGS_KEY = 'settings'
const HEX = /^#[0-9a-f]{6}$/i

const DEFAULTS = {
  done: '#3fb950',
  input: '#d29922',
  error: '#e0534a',
  greyOnly: false,
  events: {}
}

const INPUT_EVENTS = new Set([
  'approval.request',
  'clarify.request',
  'connection.request',
  'secret.request',
  'sudo.request',
  'vault.code.request',
  'vault.save_login.request',
  'vault.unlock.request'
])

const SETTLED_EVENTS = new Set([
  'approval.settled',
  'clarify.settled',
  'request.cancel',
  'secret.expire',
  'sudo.expire',
  'vault.code.expire',
  'vault.save_login.expire',
  'vault.unlock.expire'
])

const $settings = atom(DEFAULTS)
const $pending = atom({ count: 0, state: 0, color: '' })

let storage = null
let $test = null
let $refresh = null

const normalize = raw => {
  const events = {}
  const mappings = raw?.events && typeof raw.events === 'object' ? raw.events : {}
  for (const [type, color] of Object.entries(mappings)) {
    if (typeof color === 'string' && HEX.test(color)) {
      events[type] = color
    }
  }
  return {
    done: HEX.test(raw?.done) ? raw.done : DEFAULTS.done,
    input: HEX.test(raw?.input) ? raw.input : DEFAULTS.input,
    error: HEX.test(raw?.error) ? raw.error : DEFAULTS.error,
    greyOnly: raw?.greyOnly === true,
    events
  }
}

const save = next => {
  const clean = normalize(next)
  $settings.set(clean)
  storage?.set?.(SETTINGS_KEY, clean)
}

const colorFor = (type, state) => {
  const current = $settings.get()
  if (current.events[type]) {
    return current.events[type]
  }
  return state === FAILED ? current.error : state === NEEDS_INPUT ? current.input : current.done
}

function ColorRow({ description, label, onChange, value }) {
  return jsx(ListRow, {
    title: label,
    description,
    action: jsx('input', {
      'aria-label': `${label} colour`,
      className: 'h-8 w-12 cursor-pointer rounded border border-(--ui-stroke-secondary) bg-transparent p-0.5',
      type: 'color',
      value,
      onChange: event => onChange(event.target.value)
    })
  })
}

function TestRow() {
  return jsx(ListRow, {
    title: 'Try it',
    description: 'Raises one state through the same path a real event takes.',
    action: jsxs('div', {
      className: 'flex flex-wrap gap-2',
      children: [
        jsx(Button, { key: 'done', size: 'sm', onClick: () => $test?.(DONE), children: 'Finished' }),
        jsx(Button, { key: 'input', size: 'sm', onClick: () => $test?.(NEEDS_INPUT), children: 'Needs input' }),
        jsx(Button, { key: 'error', size: 'sm', onClick: () => $test?.(FAILED), children: 'Failed' }),
        jsx(Button, { key: 'clear', size: 'sm', onClick: () => $test?.(0), children: 'Clear' })
      ]
    })
  })
}

function LegacyRow() {
  const settings = useValue($settings)
  return jsx(ListRow, {
    title: 'Grey icon only',
    description: 'Legacy: the neutral count Chromium draws, with no coloured overlay. Any colour already on the button is cleared.',
    action: jsx('input', {
      'aria-label': 'Grey icon only',
      className: 'h-4 w-4 cursor-pointer',
      type: 'checkbox',
      checked: settings.greyOnly,
      onChange: event => {
        save({ ...settings, greyOnly: event.target.checked })
        $refresh?.()
      }
    })
  })
}

function ColorsPage() {
  const settings = useValue($settings)
  return jsxs('div', {
    className: 'space-y-1',
    children: [
      jsx(ColorRow, {
        key: 'done',
        label: 'Completed',
        description: 'A turn finished in a session you have not opened yet.',
        value: settings.done,
        onChange: color => save({ ...settings, done: color })
      }),
      jsx(ColorRow, {
        key: 'input',
        label: 'Needs input',
        description: 'A session is blocked on an approval, a clarify, or a credential card.',
        value: settings.input,
        onChange: color => save({ ...settings, input: color })
      }),
      jsx(ColorRow, {
        key: 'error',
        label: 'Failed',
        description: 'A turn ended with an error.',
        value: settings.error,
        onChange: color => save({ ...settings, error: color })
      }),
      jsx(TestRow, { key: 'test' }),
      jsx(LegacyRow, { key: 'legacy' }),
      jsx(AdvancedSection, { key: 'advanced' })
    ]
  })
}

function AdvancedSection() {
  const settings = useValue($settings)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('')
  const [color, setColor] = useState('#58a6ff')
  const add = () => {
    const name = type.trim()
    if (!name) {
      return
    }
    save({ ...settings, events: { ...settings.events, [name]: color } })
    setType('')
  }
  const rows = Object.keys(settings.events).sort().map(name =>
    jsx(ListRow, {
      key: name,
      title: jsx('code', { className: 'font-mono text-xs', children: name }),
      description: 'Uses this colour instead of the state colour.',
      action: jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('input', {
            'aria-label': `${name} colour`,
            className: 'h-8 w-12 cursor-pointer rounded border border-(--ui-stroke-secondary) bg-transparent p-0.5',
            type: 'color',
            value: settings.events[name],
            onChange: event => save({ ...settings, events: { ...settings.events, [name]: event.target.value } })
          }),
          jsx(Button, {
            variant: 'ghost',
            size: 'sm',
            onClick: () => {
              const events = { ...settings.events }
              delete events[name]
              save({ ...settings, events })
            },
            children: 'Remove'
          })
        ]
      })
    })
  )
  return jsxs('div', {
    className: 'space-y-1',
    children: [
      jsx('button', {
        key: 'toggle',
        type: 'button',
        'aria-expanded': open,
        className: 'flex w-full cursor-pointer items-center gap-1 pt-6 pb-1 text-left',
        onClick: () => setOpen(!open),
        children: [
          jsx(Codicon, { name: open ? 'chevron-down' : 'chevron-right' }),
          jsx('span', { className: 'text-sm font-medium', children: 'Advanced' })
        ]
      }),
      ...(open
        ? [
            jsx(ListRow, {
              key: 'add',
              title: 'Event colour',
              description: 'Exact gateway event type, for example sudo.request or vault.unlock.request. Priority still follows the state the event maps to.',
              action: jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Input, {
                    className: 'w-52 font-mono text-xs',
                    placeholder: 'event.type',
                    value: type,
                    onChange: event => setType(event.target.value)
                  }),
                  jsx('input', {
                    'aria-label': 'New event colour',
                    className: 'h-8 w-12 cursor-pointer rounded border border-(--ui-stroke-secondary) bg-transparent p-0.5',
                    type: 'color',
                    value: color,
                    onChange: event => setColor(event.target.value)
                  }),
                  jsx(Button, { size: 'sm', onClick: add, children: 'Add' })
                ]
              })
            }),
            ...rows
          ]
        : [])
    ]
  })
}

function BadgeChip() {
  const view = useValue($pending)
  if (!view.count) {
    return null
  }
  const name = view.state === FAILED ? 'failed' : view.state === NEEDS_INPUT ? 'needs input' : 'finished'
  return jsxs('div', {
    className: 'flex items-center gap-1.5 px-1.5 text-[0.6875rem] text-(--ui-text-secondary)',
    title: `${view.count} ${name}`,
    children: [
      jsx('span', { className: 'size-2 shrink-0 rounded-full', style: { backgroundColor: view.color } }),
      jsx('span', { children: `${view.count} ${name}` })
    ]
  })
}

export default {
  id: 'taskbar-badge',
  name: 'Taskbar Badge',
  description: 'Taskbar badge for a finished turn (1), a wait for input (2) and a failure (3).',
  register(ctx) {
    const setBadge = navigator.setAppBadge?.bind(navigator) || null
    const clearBadge = navigator.clearAppBadge?.bind(navigator) || null

    let bridgeUp = true
    const bridge = (state, color, label) =>
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/state`, {
        method: 'POST',
        body: JSON.stringify({ state, color, label })
      }).then(response => {
        bridgeUp = response.ok
      }).catch(() => {
        bridgeUp = false
      })

    storage = ctx.storage || null
    $settings.set(normalize(ctx.storage?.get?.(SETTINGS_KEY)))
    bridge(0, '', '')

    const pending = new Map()
    const focused = () => host.state?.focusedSessionId?.get?.() || null

    const paint = () => {
      const legacy = $settings.get().greyOnly
      if (!pending.size) {
        $pending.set({ count: 0, state: 0, color: '' })
        if (clearBadge && (legacy || !bridgeUp)) {
          Promise.resolve(clearBadge()).catch(() => {})
        }
        if (!legacy || bridgeUp) {
          bridge(0, '', '')
        }
        return
      }
      let state = 0
      let type = ''
      let count = 0
      for (const entry of pending.values()) {
        if (entry.state > state) {
          state = entry.state
          type = entry.type
          count = 1
        } else if (entry.state === state) {
          count++
        }
      }
      const color = colorFor(type, state)
      $pending.set({ count, state, color })
      if (legacy) {
        if (setBadge) {
          Promise.resolve(setBadge(state)).catch(() => {})
        }
        if (bridgeUp) {
          bridge(0, '', '')
        }
        return
      }
      if (setBadge && !bridgeUp) {
        Promise.resolve(setBadge(state)).catch(() => {})
      }
      bridge(state, color, STATE_LABELS[state])
      return
    }

    $refresh = () => {
      if ($settings.get().greyOnly) {
        bridge(0, '', '')
      }
      paint()
    }

    const note = (sessionId, state, type, toolId) => {
      if (!sessionId) {
        return
      }
      if (state === DONE && sessionId === focused() && document.hasFocus()) {
        if (pending.delete(sessionId)) {
          paint()
        }
        return
      }
      if ((pending.get(sessionId)?.state || 0) >= state) {
        return
      }
      pending.set(sessionId, { state, type, toolId })
      paint()
    }

    $test = state => {
      pending.delete('__preview__')
      if (!state) {
        paint()
        return
      }
      note('__preview__', state, state === NEEDS_INPUT ? 'approval.request' : 'message.complete')
    }

    const ack = sessionId => {
      if (sessionId && pending.delete(sessionId)) {
        paint()
      }
    }

    const PROMPT_CARDS = '[data-approval-run],[data-clarify-choices],[data-clarify-batch],[data-clarify-select-mode],[data-theme-picker],[data-setup-beat]'
    const PROMPT_DIALOG = '[data-slot="dialog-content"]:has(input[type="password"],input[autocomplete="one-time-code"])'
    const promptShown = () => {
      if (document.querySelector(PROMPT_CARDS)) {
        return true
      }
      try {
        return Boolean(document.querySelector(PROMPT_DIALOG))
      } catch {
        return false
      }
    }
    if (typeof MutationObserver === 'function' && typeof document.querySelector === 'function') {
      let shown = false
      let queued = null
      const scan = () => {
        queued = null
        const present = promptShown()
        if (present === shown) {
          return
        }
        shown = present
        const sessionId = focused()
        if (present) {
          note(sessionId, NEEDS_INPUT, 'clarify.request')
        } else {
          ack(sessionId)
        }
      }
      const observer = new MutationObserver(() => {
        if (queued === null) {
          queued = setTimeout(scan, 150)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      ctx.onDispose?.(() => {
        observer.disconnect()
        clearTimeout(queued)
      })
      scan()
    }

    ctx.onEvent('*', event => {
      const eventType = event?.type
      const sessionId = event?.session_id
      if (!eventType) {
        return
      }
      if (eventType === 'message.complete' || eventType === 'error') {
        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
        const failed = eventType === 'error' || payload.status === 'error' || Boolean(payload.error)
        note(sessionId, failed ? FAILED : DONE, eventType)
        return
      }
      if (INPUT_EVENTS.has(eventType)) {
        note(sessionId, NEEDS_INPUT, eventType)
        return
      }
      if (eventType === 'tool.start' && event.payload?.name === 'clarify') {
        note(sessionId, NEEDS_INPUT, 'clarify.request', event.payload?.tool_id)
        return
      }
      if (eventType === 'tool.complete' && event.payload?.tool_id &&
          pending.get(sessionId)?.toolId === event.payload.tool_id) {
        ack(sessionId)
        return
      }
      if (SETTLED_EVENTS.has(eventType) || (eventType === 'connection.update' && event.payload?.settled)) {
        ack(sessionId)
      }
    })

    const focusedAtom = host.state?.focusedSessionId
    if (typeof focusedAtom?.listen === 'function') {
      let last = focusedAtom.get()
      ctx.onDispose(focusedAtom.listen(next => {
        if (next === last) {
          return
        }
        last = next
        ack(next)
      }))
    }

    ctx.addEventListener(window, 'focus', () => ack(focused()))

    ctx.onDispose($settings.listen(() => paint()))

    if (typeof ctx.register === 'function' && STATUSBAR_AREAS?.right) {
      ctx.register({ id: 'chip', area: STATUSBAR_AREAS.right, order: 140, render: () => jsx(BadgeChip, {}) })
    }

    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({
        id: 'badge',
        title: 'Taskbar Badge',
        icon: 'symbol-color',
        order: 40,
        render: () => jsx(ColorsPage, {})
      })
    }

    console.error('[taskbar-badge] register ok', { version: 19, settingsPage: typeof ctx.registerSettingsPage === 'function' })
  }
}
