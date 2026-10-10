// A synchronous Storage interface cannot await a per-write Web Lock. Hold one
// exclusive lock for the account's entire page lifetime instead. No timeout,
// localStorage lease or "steal" can silently authorize a second writer.
export function createAccountWriter({ locks, changed = () => {} } = {}) {
  let owner = null, state = 'guest', generation = 0, release
  const update = next => { state = next; changed() }
  return {
    get writable() { return !owner || state === 'writer' },
    get state() { return state },
    get reason() { return state === 'unsupported' ? '浏览器不支持安全的多标签协调；账号学习记录只读，请使用支持 Web Locks 的 HTTPS 浏览器。' : '当前账号已由另一标签页保存，或正在获取写入权。本页只读：请关闭另一学习标签后重新加载，避免记录互相覆盖。' },
    setOwner(next) {
      if (next === owner) return
      const ticket = ++generation
      release?.(); release = undefined; owner = next
      if (!next) { update('guest'); return }
      if (!locks?.request) { update('unsupported'); return }
      update('acquiring')
      try {
        Promise.resolve(locks.request('zhixu-account-writer-v1:' + encodeURIComponent(next), { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (ticket !== generation) return
          if (!lock) { update('readonly'); return }
          const held = new Promise(resolve => { release = resolve })
          update('writer')
          await held
        })).catch(() => { if (ticket === generation) update('unsupported') })
      } catch { update('unsupported') }
    },
    stop() { ++generation; release?.(); release = undefined; update(owner ? 'readonly' : 'guest') },
  }
}
