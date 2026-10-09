const containers = new Set(['l1uj-study-progress-v1', 'l1uj-study-tasks-v1', 'zhixu-mistakes-v1'])
const maps = new Set(['zc-progress-v1', 'zsb-prep-checks', 'zsb-prep-checks-meta-v1', 'zsb-mistakes-v1'])
const unsafe = key => ['__proto__', 'constructor', 'prototype'].includes(key)
export const recordKey = (bucket, id) => JSON.stringify([bucket, id])
export function splitRecord(key, raw) {
  if (raw == null) return {}
  let data
  try { data = JSON.parse(raw) } catch { return { _: { raw } } }
  if (containers.has(key) && data?.version === 1 && data.entries && !Array.isArray(data.entries)) return { ...data.entries }
  if (key === 'l1uj-knowledge-v1' && data?.version === 1) return Object.fromEntries([
    ...Object.entries(data.points || {}).map(([id,value])=>['point:'+id,value]), ...Object.entries(data.sources || {}).map(([id,value])=>['source:'+id,value]),
  ])
  if (key === 'l1uj-reading-v1' && Array.isArray(data?.entries)) return Object.fromEntries(data.entries.map(entry => [entry.path, entry]))
  if ((maps.has(key) || key.startsWith('l1uj-sections-v1:')) && data && typeof data === 'object' && !Array.isArray(data)) return { ...data }
  return { _: { raw } }
}
export function joinRecord(key, records) {
  const safe = Object.fromEntries(Object.entries(records).filter(([id]) => !unsafe(id)))
  if (containers.has(key)) return JSON.stringify({ version: 1, entries: safe })
  if (key === 'l1uj-knowledge-v1') return JSON.stringify({ version:1,points:Object.fromEntries(Object.entries(safe).filter(([id])=>id.startsWith('point:')).map(([id,value])=>[id.slice(6),value])),sources:Object.fromEntries(Object.entries(safe).filter(([id])=>id.startsWith('source:')).map(([id,value])=>[id.slice(7),value])) })
  if (key === 'l1uj-reading-v1') return JSON.stringify({ version: 1, entries: Object.values(safe).sort((a, b) => b.updatedAt - a.updatedAt) })
  if (maps.has(key) || key.startsWith('l1uj-sections-v1:')) return JSON.stringify(safe)
  return safe._?.raw ?? null
}
export function diffRecords(bucket, before, after) {
  const a = splitRecord(bucket, before), b = splitRecord(bucket, after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => !unsafe(id) && JSON.stringify(a[id]) !== JSON.stringify(b[id]))
    .map(record_id => ({ bucket, record_id, payload: b[record_id] ?? null, deleted: !(record_id in b) }))
}
