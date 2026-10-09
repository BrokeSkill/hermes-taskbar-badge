import { host } from '@hermes/plugin-sdk'

export default {
  id: 'taskbar-badge',
  name: 'Taskbar Badge',
  description: 'Windows taskbar badge on the Hermes window when a turn finishes.',
  register(ctx) {
    const set = () => { try { navigator.setAppBadge(1).catch(() => {}) } catch (e) {} }
    const clear = () => { try { navigator.clearAppBadge().catch(() => {}) } catch (e) {} }

    ctx.onEvent('message.complete', set)

    const focused = host.state.focusedStoredSessionId
    let last = focused.get()
    if (typeof focused.listen === 'function') {
      const unbind = focused.listen(next => {
        if (next !== last) {
          last = next
          clear()
        }
      })
      ctx.onDispose(unbind)
    }

    ctx.addEventListener(window, 'focus', clear)
    console.error('[taskbar-badge] register ok (pure JS setAppBadge)')
  }
}
