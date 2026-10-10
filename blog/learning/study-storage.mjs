import { multiuserConfig } from './multiuser-config.mjs'
import { diffRecords, joinRecord, splitRecord, recordKey } from './record-codec.mjs'
import { createAccountWriter } from './account-writer.mjs'

export const OWNER_KEY = 'zhixu-active-owner-v1'
export const STORAGE_EVENT = 'zhixu:storage'
export const REMOTE_EVENT = 'zhixu:cloud-records'
const prefix = 'zhixu-account-v1:'
export function cachedOwner(session,{enabled=true,now=Date.now()}={}) {
  if(!enabled)return null
  try{
    const owner=session.getItem(OWNER_KEY),cached=JSON.parse(session.getItem('zhixu-auth-v1')||'null')
    if(owner&&cached?.user?.id===owner&&Number(cached.expires_at)*1000>now)return owner
    session.removeItem(OWNER_KEY)
  }catch{}
  return null
}
export function isStudyKey(key) {
  return /^(?:l1uj-(?:reading|study-progress|study-tasks|knowledge|guided|sections|learning-guide-note|study-backup-at|cs-answers|english-answers|politics-answers)|zhixu-(?:mistakes|review-session)|zhixu:cs-|zc-|zsb-(?:mistakes|prep-checks|quiz|course-done)|zzkk:)/.test(key)
}
const empty = () => ({ version: 1, values: {}, revisions: {}, pending: [], conflicts: {}, cursor: 0 })
export function createStudyStorage({ storage, sessionStorage, enabled = true, owner = null, uuid = () => crypto.randomUUID(), onChange = () => {}, writer } = {}) {
  let active = owner, locked = false, staged = null
  const assertWritable = () => { if (enabled && active && writer && !writer.writable) throw new Error(writer.reason) }
  writer?.setOwner(enabled ? active : null)
  const envelopeKey = () => prefix + encodeURIComponent(active)
  const load = () => {
    if (staged) return staged
    const raw = storage.getItem(envelopeKey())
    const data = raw ? JSON.parse(raw) : empty()
    if (data.version !== 1 || !data.values || !Array.isArray(data.pending)) throw new Error('账号缓存格式异常，请先导出恢复，不能覆盖')
    return data
  }
  const save = (data, detail) => { if(staged){staged=data;return} storage.setItem(envelopeKey(), JSON.stringify(data)); onChange(detail) }
  const needsNamespace = key => enabled && active && isStudyKey(key)
  const keys = () => {
    if (locked) return []
    const native = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k && !k.startsWith(prefix) && !(enabled && active && isStudyKey(k)))
    return [...new Set([...native, ...(enabled && active ? Object.keys(load().values) : [])])]
  }
  const api = {
    get owner() { return active },
    get writable() { return !locked && (!enabled || !active || !writer || writer.writable) },
    get writeBlockedReason() { return writer?.reason || '正在切换身份，暂不保存学习记录' },
    get length() { return keys().length },
    key(index) { return keys()[index] ?? null },
    getItem(key) { if (locked && isStudyKey(key)) return null; return needsNamespace(key) ? load().values[key] ?? null : storage.getItem(key) },
    setItem(key, value) { api.write(key, String(value)) },
    removeItem(key) { api.write(key, null) },
    write(key, value) {
      if (locked && isStudyKey(key)) throw new Error('正在切换身份，暂不保存学习记录')
      if (!needsNamespace(key)) { value == null ? storage.removeItem(key) : storage.setItem(key, value); return }
      assertWritable()
      const data = load(), before = data.values[key] ?? null
      if (before === value) return
      for (const change of diffRecords(key, before, value)) {
        const id = recordKey(key, change.record_id)
        const previous = data.pending.findLast(p => recordKey(p.bucket, p.record_id) === id)
        data.pending.push({ ...change, request_id: uuid(), base_revision: data.revisions[id] ?? 0, ...(previous ? { dependsOn: previous.request_id } : {}) })
      }
      if (value == null) delete data.values[key]; else data.values[key] = value
      save(data) // Cache and outbox are one durable write; quota failure changes neither.
    },
    setOwner(next) { active = next || null; locked = false; writer?.setOwner(enabled ? active : null); if (sessionStorage) next ? sessionStorage.setItem(OWNER_KEY, next) : sessionStorage.removeItem(OWNER_KEY); onChange() },
    lock() { locked = true },
    snapshot() { if (!active || locked) throw new Error('需要登录'); return structuredClone(load()) },
    update(mutator, detail) { if (!active || locked) throw new Error('需要登录'); assertWritable(); const data = load(); mutator(data); save(data,detail) },
    transaction(action) {
      if(!active || !enabled)return action()
      assertWritable()
      if(staged)throw new Error('不支持嵌套存储事务')
      staged=load()
      try { const result=action();const data=staged;staged=null;if(result?.applied!==false)save(data);return result }
      finally { staged=null }
    },
    applyRemote(record, data) {
      const id = recordKey(record.bucket, record.record_id)
      const parts = splitRecord(record.bucket, data.values[record.bucket])
      if (record.deleted_at || record.deleted) delete parts[record.record_id]; else parts[record.record_id] = record.payload
      const raw = joinRecord(record.bucket, parts)
      if (raw == null) delete data.values[record.bucket]; else data.values[record.bucket] = raw
      data.revisions[id] = record.revision
    },
    clearDeletedOwner(expectedOwner) {
      if (!expectedOwner || expectedOwner !== active) throw new Error('账号归属已变化，不能清理缓存')
      storage.setItem('zhixu-deleted-account-v1:' + encodeURIComponent(expectedOwner), '1')
      storage.removeItem(envelopeKey())
      if (sessionStorage) for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i)
        if (key?.startsWith('zhixu-session-v1:' + encodeURIComponent(expectedOwner) + ':')) sessionStorage.removeItem(key)
      }
      api.setOwner(null)
    },
  }
  return api
}
let singleton
const unavailableStorage = Object.freeze({ unavailable: true, owner: null, length: 0, key: () => null, getItem: () => null,
  setItem: () => { throw new Error('浏览器存储不可用，请复制保留当前作答') }, removeItem: () => { throw new Error('浏览器存储不可用') } })
export function getStudyStorage() {
  if (typeof window !== 'undefined' && window.ZhixuStudyStorage) return window.ZhixuStudyStorage
  if (singleton) return singleton
  if (typeof window === 'undefined') { if (globalThis.localStorage) return globalThis.localStorage; throw new Error('学习存储仅在浏览器初始化') }
  let owner = null
  try { owner = cachedOwner(window.sessionStorage,{enabled:multiuserConfig.auth}) } catch {}
  let native, session
  try { native = window.localStorage; session = window.sessionStorage } catch { return unavailableStorage }
  // Remote UI refresh is separate from local writes: refreshing classic quizzes
  // during their own save would re-enter rendering halfway through an attempt.
  const changed = detail => {
    for (const name of [STORAGE_EVENT, 'l1uj:study', 'l1uj:reading', 'zhixu:mistakes']) window.dispatchEvent(new CustomEvent(name))
    if(detail?.remote)window.dispatchEvent(new CustomEvent(REMOTE_EVENT))
  }
  const writer = createAccountWriter({ locks: window.navigator?.locks, changed })
  singleton = createStudyStorage({ storage: native, sessionStorage: session, enabled: multiuserConfig.auth, owner, writer, onChange: changed })
  window.ZhixuStudyStorage = singleton
  window.addEventListener('storage', event => {
    if (event.storageArea !== native || !singleton.owner) return
    if (event.key === 'zhixu-deleted-account-v1:' + encodeURIComponent(singleton.owner)) {
      singleton.lock(); writer.stop()
      for (let i = session.length - 1; i >= 0; i--) {
        const key = session.key(i)
        if (key?.startsWith('zhixu-auth-v1') || key?.startsWith('zhixu-session-v1:' + encodeURIComponent(singleton.owner) + ':') || key === OWNER_KEY) session.removeItem(key)
      }
      window.location.reload(); return
    }
    if (event.key === prefix + encodeURIComponent(singleton.owner)) changed({remote:true})
  })
  window.addEventListener('pagehide', () => writer.stop())
  // A BFCache-restored page may contain stale answers and has lost its lock.
  window.addEventListener('pageshow', event => { if (event.persisted && singleton.owner) window.location.reload() })
  return singleton
}
export function getStudySessionStorage() {
  const storage = window.sessionStorage, owner = getStudyStorage().owner
  const key = name => owner ? `zhixu-session-v1:${encodeURIComponent(owner)}:${name}` : name
  return { getItem: name => storage.getItem(key(name)), setItem: (name, value) => storage.setItem(key(name), value), removeItem: name => storage.removeItem(key(name)) }
}
