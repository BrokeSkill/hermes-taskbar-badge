import { host } from '@hermes/plugin-sdk'

export default {
  id: 'taskbar-badge',
  name: 'Taskbar Badge',
  description: 'Windows taskbar badge on the Hermes window when a turn finishes.',
  register(ctx) {
    const setBadge = navigator.setAppBadge?.bind(navigator)
    const clearBadge = navigator.clearAppBadge?.bind(navigator)
    if (!setBadge) return

    const set = () => {
      if (document.hasFocus()) return
      Promise.resolve(setBadge(1)).catch(() => {})
    }
    const clear = () => { Promise.resolve(clearBadge?.()).catch(() => {}) }

    ctx.onEvent('message.complete', set)

    const focused = host.state.focusedStoredSessionId
    let last = focused.get()
    if (typeof focused.listen === 'function') {
      ctx.onDispose(focused.listen(next => {
        if (next !== last) { last = next; clear() }
      }))
    }

    ctx.addEventListener(window, 'focus', clear)
  }
}
