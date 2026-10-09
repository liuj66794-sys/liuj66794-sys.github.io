import { recordKey } from './record-codec.mjs'

export function createSyncEngine({ storage, transport, notify = () => {}, now = Date.now }) {
  let running, controller, epoch = 0, retryAt = 0, failures = 0
  const status = () => { const data = storage.snapshot(); return { pending: data.pending.length, conflicts: Object.keys(data.conflicts).length, retryAt,lastSyncedAt:Number(data.lastSyncedAt)||0 } }
  async function flush({ force = false } = {}) {
    if (running) return running
    if (storage.writable === false) return { ...status(), error: storage.writeBlockedReason }
    if (!force && now() < retryAt) return status()
    const owner = storage.owner, generation = epoch
    controller = new AbortController()
    const current = () => storage.owner === owner && generation === epoch && !controller.signal.aborted
    running = (async () => {
      try {
        // Push first: a lost acknowledgement must retry its receipt before a pull
        // mistakes the already-committed revision for an independent remote edit.
        for (const original of storage.snapshot().pending) {
          const item = storage.snapshot().pending.find(p=>p.request_id===original.request_id)
          if (!item) continue
          const id = recordKey(item.bucket, item.record_id)
          if (storage.snapshot().conflicts[id] || item.dependsOn) continue
          const response = await transport.push(item, controller.signal)
          if (!current()) return
          storage.update(data => {
            if (response.status === 'conflict') { data.conflicts[id] = response.record; return }
            data.revisions[id] = response.record.revision
            data.pending = data.pending.filter(p => p.request_id !== item.request_id)
            for (const p of data.pending) if (p.dependsOn === item.request_id) { delete p.dependsOn; p.base_revision = response.record.revision }
          })
        }
        const remote = await transport.pull(storage.snapshot().cursor, controller.signal)
        if (!current()) return
        storage.update(data => {
          for (const record of remote) {
            const id = recordKey(record.bucket, record.record_id)
            if (data.pending.some(p => recordKey(p.bucket, p.record_id) === id)) {
              if ((data.revisions[id] ?? 0) < record.revision) data.conflicts[id] = record
            } else storage.applyRemote(record, data)
            data.cursor = Math.max(data.cursor, Number(record.change_seq) || 0)
          }
          data.lastSyncedAt=now()
        },{remote:true})
        failures = 0; retryAt = 0; notify(status()); return status()
      } catch (error) {
        if (current()) { retryAt = now() + Math.min(60000, 1000 * 2 ** failures++); notify({ error: '网络或服务不可用，记录已留在当前账号，稍后重试', ...status() }) }
        throw error
      } finally { running = null }
    })()
    return running
  }
  function stop() { epoch++; controller?.abort() }
  function resolve(id, choice) {
    if (!['local', 'remote'].includes(choice)) throw new Error('必须明确选择本机或云端')
    const data = storage.snapshot(), record = data.conflicts[id]
    if (!record) return
    const local = data.pending.filter(p => recordKey(p.bucket, p.record_id) === id).at(-1)
    storage.update(next => {
      next.pending = next.pending.filter(p => recordKey(p.bucket, p.record_id) !== id)
      storage.applyRemote(record, next)
      delete next.conflicts[id]
      if (choice === 'local' && local) {
        const item = { ...local, request_id: crypto.randomUUID(), base_revision: record.revision }
        delete item.dependsOn
        next.pending.push(item)
        storage.applyRemote({ ...item, revision: record.revision }, next)
      }
    },{remote:true})
  }
  return { flush, stop, resolve, status }
}
