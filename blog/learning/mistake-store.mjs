import { getStudyStorage } from './study-storage.mjs'
export const MISTAKES_KEY = 'zhixu-mistakes-v1'
export const MISTAKES_EVENT = 'zhixu:mistakes'
export const SUBJECTS = { 'zsb-math': '高数', 'zsb-english': '英语', 'zsb-politics': '政治', 'zsb-cs': '计算机' }
export const REVIEW_LABELS = { pending: '待订正', scheduled: '待复测', mastered: '已巩固' }
const DAY = 86400000
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const storageOf = storage => storage || getStudyStorage()
const number = value => Number.isFinite(value) && value >= 0 ? value : 0
const definition = q => Object.fromEntries(['schemaVersion', 'contentVersion', 'question', 'chapter', 'knowledgePoint', 'sourceMetadata', 'legacyQuestion', 'slug', 'lessonId', 'ref', 'kind', 'stem', 'stemHtml', 'options', 'answer', 'explanation', 'explanationHtml', 'doubt', 'source', 'sourceLabel', 'title', 'reading', 'legacyHtml', 'contextRequired', 'teaching', 'subjective'].filter(k => k in q).map(k => [k, q[k]]))

// Compatibility is limited to an identical registered definition. A genuine
// answer/content change still invalidates mastery as it did before.
export function equivalentPoliticsDefinition(old, q) {
  if (q.slug !== 'zsb-politics' || q.schemaVersion !== 1) return false
  let stem = old.question || old.stem || ''
  const original = q.legacyQuestion || q.question
  while (stem !== original && /^【[^】]*】/.test(stem)) stem = stem.replace(/^【[^】]*】/, '')
  const answers = value => [...new Set((Array.isArray(value) ? value.join('') : String(value || '')).replace(/[、，,\s]/g, '').split(''))].sort()
  const options = list => (list || []).map(o => [o.value || o.letter, o.text])
  return (stem === q.question || stem === original) && original === q.question
    && JSON.stringify(options(old.options)) === JSON.stringify(options(q.options))
    && JSON.stringify(answers(old.answer)) === JSON.stringify(answers(q.answer))
}

export function readMistakes(storage) {
  try {
    const data = JSON.parse(storageOf(storage).getItem(MISTAKES_KEY) || '{}')
    return data.version === 1 && object(data.entries) ? data.entries : {}
  } catch { return {} }
}
function write(entries, storage) {
  try {
    storageOf(storage).setItem(MISTAKES_KEY, JSON.stringify({ version: 1, entries }))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MISTAKES_EVENT))
      window.dispatchEvent(new CustomEvent('l1uj:study'))
    }
    return true
  } catch { return false }
}
export function canonicalLesson(id) { return /^\d+$/.test(String(id)) ? String(Number(id)) : String(id || '') }
export function mistakeId(q) {
  return q.slug === 'zsb-politics' ? `${q.slug}:bank:${q.ref}` : `${q.slug}:${canonicalLesson(q.lessonId)}:${q.ref}`
}
export function safeLessonPath(value, base = '/blog/') {
  if (typeof value !== 'string' || /[\\\u0000-\u001f]/.test(value)) return ''
  try {
    const url = new URL(value, 'https://study.invalid')
    return url.origin === 'https://study.invalid' && url.pathname.startsWith(`${base}lessons/`) ? url.pathname : ''
  } catch { return '' }
}
// Formatting enrichment must not reset existing mastery or an in-progress group.
export function questionSignature(q) { return JSON.stringify([q.stem, q.options?.map(({ value, text }) => ({ value, text })), q.answer]) }
export function isDue(entry, now = Date.now()) { return entry.status !== 'mastered' && number(entry.dueAt) <= now }
export function canGrade(q) {
  return q.kind !== 'recall' && !q.doubt && !q.contextRequired && Array.isArray(q.answer) && q.answer.length > 0
    && q.answer.every(a => q.options?.some(o => o.value === a))
}

// Called only for actual user actions; painting a saved answer never creates an attempt.
export function recordAttempt(question, { correct, independent = true, attemptId, now = Date.now() }, storage) {
  if (!SUBJECTS[question.slug] || !question.ref || !attemptId || typeof correct !== 'boolean' || question.doubt) return false
  const entries = readMistakes(storage), id = mistakeId(question), old = entries[id]
  if (old?.recentAttempts?.includes(attemptId)) return true
  if (correct && !old) return true
  if (correct && old?.lastWrongAt && now - old.lastWrongAt < DAY) independent = false
  const entry = { ...old, ...definition(question), id, signature: questionSignature(question), firstAt: old?.firstAt || now,
    wrongs: number(old?.wrongs), successDays: number(old?.successDays), lastSuccessAt: number(old?.lastSuccessAt),
    recentAttempts: [...(old?.recentAttempts || []).slice(-29), attemptId], updatedAt: now }
  if (!correct) {
    entry.wrongs++; entry.status = 'pending'; entry.successDays = 0; entry.lastSuccessAt = 0; entry.lastWrongAt = now; entry.dueAt = now
  } else if (independent && (!entry.lastSuccessAt || now - entry.lastSuccessAt >= DAY)) {
    entry.successDays++; entry.lastSuccessAt = now
    entry.status = entry.successDays >= 2 ? 'mastered' : 'scheduled'
    entry.dueAt = now + (entry.successDays >= 2 ? 7 : 1) * DAY
  } else if (entry.status !== 'mastered') {
    entry.status = 'scheduled'
    // Repeated same-day clicking must not postpone the next review.
    entry.dueAt = old?.status === 'scheduled' ? old.dueAt : now + DAY
  }
  entries[id] = entry
  return write(entries, storage)
}
export function registerQuestion(q, storage) {
  const entries = readMistakes(storage), id = mistakeId(q), old = entries[id]
  if (!old) return true
  const signature = questionSignature(q)
  const changed = old.signature && old.signature !== signature && !equivalentPoliticsDefinition(old, q)
  const next = { ...old, ...definition(q), id, signature }
  if (changed) Object.assign(next, { status: 'pending', successDays: 0, lastSuccessAt: 0, dueAt: 0, revisionChanged: true })
  if (JSON.stringify(next) === JSON.stringify(old)) return true
  entries[id] = next
  return write(entries, storage)
}
export function refreshQuestionDefinitions(index, storage) {
  if (index?.version !== 1 || !object(index.entries)) return false
  const entries = readMistakes(storage)
  let changed = false
  for (const id of Object.keys(entries)) {
    const old = entries[id]
    if (!old) continue
    const target = index.aliases?.[id] || id, q = index.entries[target]
    if (!q) continue
    const current = entries[target], signature = questionSignature(q)
    const revised = (target !== id || (old.signature && old.signature !== signature)) && !equivalentPoliticsDefinition(old, q)
    const winner = !current || number(old.updatedAt) > number(current.updatedAt) ? old : current
    const history = target === id ? old : { ...old, ...current, ...winner,
      wrongs: number(old.wrongs) + number(current?.wrongs), lastWrongAt: Math.max(number(old.lastWrongAt), number(current?.lastWrongAt)),
      note: [...new Set([old.note, current?.note].filter(Boolean))].join('\n\n'),
      recentAttempts: [...new Set([...(old.recentAttempts || []), ...(current?.recentAttempts || [])])],
      migrationHistory: { ...(old.migrationHistory || {}), ...(current?.migrationHistory || {}), [id]: old, ...(current ? { [target]: current } : {}) },
      legacyIds: [...new Set([...(old.legacyIds || []), ...(current?.legacyIds || []), id])] }
    const next = { ...history, ...definition(q), id: target, signature }
    if (revised) Object.assign(next, { status: 'pending', successDays: 0, lastSuccessAt: 0, dueAt: 0, revisionChanged: true })
    if (JSON.stringify(old) !== JSON.stringify(next)) { entries[target] = next; changed = true }
    if (target !== id) delete entries[id]
  }
  return !changed || write(entries, storage)
}
export function setMistakeNote(id, note, storage) {
  const entries = readMistakes(storage)
  if (!entries[id]) return false
  entries[id] = { ...entries[id], note: String(note).slice(0, 2000), updatedAt: Date.now() }
  return write(entries, storage)
}
export function reopenMistake(id, storage) {
  const entries = readMistakes(storage)
  if (!entries[id]) return false
  entries[id] = { ...entries[id], status: 'pending', successDays: 0, lastSuccessAt: 0, dueAt: 0, updatedAt: Date.now() }
  return write(entries, storage)
}
export function exportMistakes(storage) { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: readMistakes(storage) }, null, 2) }
export function parseMistakeBackup(text, base = '/blog/') {
  if (typeof text !== 'string' || text.length > 8000000) throw new Error('备份文件过大，限制为 8 MB。')
  const data = JSON.parse(text)
  if (data.version !== 1 || !object(data.entries) || Object.keys(data.entries).length > 20000) throw new Error('这不是有效的知序错题备份。')
  const incoming = []
  const optionalMarkup = value => value === undefined || (typeof value === 'string' && value.length <= 60000)
  const optionalTeaching = value => value === undefined || (object(value) && JSON.stringify(value).length <= 20000)
  for (const [id, q] of Object.entries(data.entries)) {
    if (!object(q) || !SUBJECTS[q.slug] || typeof q.ref !== 'string' || id !== mistakeId(q)
      || typeof q.stem !== 'string' || q.stem.length > 30000 || !REVIEW_LABELS[q.status]
      || !optionalMarkup(q.stemHtml) || !optionalMarkup(q.explanationHtml)
      || !optionalTeaching(q.teaching) || !optionalTeaching(q.subjective)
      || !Array.isArray(q.options) || !q.options.every(o => object(o) && typeof o.value === 'string' && typeof o.text === 'string' && optionalMarkup(o.html))
      || !Array.isArray(q.answer) || !q.answer.every(a => typeof a === 'string')) throw new Error('备份中的题目格式无效，未导入任何记录。')
    incoming.push({ ...q, id, source: safeLessonPath(q.source, base), wrongs: number(q.wrongs),
      successDays: number(q.successDays), dueAt: number(q.dueAt), updatedAt: number(q.updatedAt),
      lastSuccessAt: number(q.lastSuccessAt), recentAttempts: Array.isArray(q.recentAttempts) ? q.recentAttempts.filter(x => typeof x === 'string').slice(-30) : [] })
  }
  return incoming
}
export function importMistakes(text, storage, base = '/blog/') {
  const incoming = parseMistakeBackup(text, base)
  const entries = readMistakes(storage)
  let added = 0
  for (const q of incoming) if (!entries[q.id] || number(entries[q.id].updatedAt) < q.updatedAt) { entries[q.id] = q; added++ }
  if (!write(entries, storage)) throw new Error('浏览器未能保存，请保留原备份文件。')
  return added
}

// Additive migration: old stores remain intact. Existing unified entries always win.
// Old math/CS records sometimes have no full question; enrich them when the lesson is opened.
export function migrateLegacy(storage, catalog = {}, base = '/blog/') {
  const entries = readMistakes(storage)
  let added = 0
  const read = key => { try { return JSON.parse(storageOf(storage).getItem(key) || '{}') } catch { return {} } }
  const lesson = (slug, id) => catalog[slug]?.lessons?.find(l => canonicalLesson(l.id) === canonicalLesson(id))
  const source = (slug, id) => {
    const href = lesson(slug, id)?.interactive
    return href ? (href.startsWith(base) ? href : base.replace(/\/$/, '') + href) : ''
  }
  function add(q, history = {}) {
    const id = mistakeId(q)
    if (Object.values(entries).some(entry => entry.legacyIds?.includes(id))) return
    if (entries[id]) {
      if (!entries[id].source && q.source) { entries[id] = { ...entries[id], source: q.source, title: q.title }; added++ }
      return
    }
    entries[id] = { kind: 'choice', stem: '旧错题：回原课补全题目', options: [], answer: [], explanation: '', ...q, id,
      status: history.fixed ? 'scheduled' : 'pending', wrongs: Math.max(1, number(history.wrongs)),
      successDays: 0, lastSuccessAt: 0, dueAt: 0, updatedAt: 0, firstAt: 0, migrated: true, recentAttempts: [] }
    added++
  }
  try {
    const store = storageOf(storage), keys = Array.from({ length: store.length }, (_, i) => store.key(i))
    for (const key of keys) {
      if (!key) continue
      const raw = read(key)
      if (!object(raw)) continue
      if (key.startsWith('zzkk:v2:wrong:')) {
        const lid = raw.from?.match(/(?:mzt|xg|sz)\d+/)?.[0] || ''
        add({ slug: 'zsb-politics', lessonId: lid, ref: key.slice('zzkk:v2:wrong:'.length), stem: raw.stem || '政治旧错题',
          options: (raw.options || []).map(o => ({ value: String(o.letter), text: String(o.text) })), answer: raw.answer ? String(raw.answer).replace(/[、，,\s]+/g, '').split('') : [],
          explanation: raw.exp || '', source: source('zsb-politics', lid), title: lesson('zsb-politics', lid)?.title || raw.from || '政治练习' }, { wrongs: raw.count })
      } else if (key === 'zsb-mistakes-v1') {
        for (const [lid, records] of Object.entries(raw)) if (object(records)) for (const [qn, q] of Object.entries(records)) if (q?.wrongs > 0) {
          add({ slug: 'zsb-cs', lessonId: canonicalLesson(lid), ref: `q:${qn}`, stem: q.t || '计算机旧错题',
            source: source('zsb-cs', lid), title: lesson('zsb-cs', lid)?.title || `第 ${Number(lid)} 课` }, q)
        }
      } else if (key.startsWith('zc-progress-items-v1:')) {
        const lid = key.slice('zc-progress-items-v1:'.length)
        for (const [ref, q] of Object.entries(raw.quiz || {})) if (Array.isArray(q?.attempts) && q.attempts.length > (q.done ? 1 : 0)) {
          add({ slug: 'zsb-math', lessonId: canonicalLesson(lid), ref: `quiz:${ref}`,
            source: source('zsb-math', lid), title: lesson('zsb-math', lid)?.title || `第 ${Number(lid)} 课` }, { wrongs: q.attempts.length - (q.done ? 1 : 0), fixed: q.done })
        }
        for (const [ref, q] of Object.entries(raw.recall || {})) if (q?.vote === 'bad') {
          add({ slug: 'zsb-math', lessonId: canonicalLesson(lid), ref: `recall:${ref}`, kind: 'recall',
            source: source('zsb-math', lid), title: lesson('zsb-math', lid)?.title || `第 ${Number(lid)} 课` })
        }
      } else if (key.startsWith('l1uj-english-answers-v1:')) {
        const match = key.match(/^l1uj-english-answers-v1:(.+\.html):(.+)$/)
        const lid = match?.[1].match(/\/(\d{4})[^/]*\.html$/)?.[1]
        if (!lid) continue
        for (const [qn, q] of Object.entries(raw)) {
          try {
            const [stem, opts, answer] = JSON.parse(q.signature)
            if (!Array.isArray(opts) || !Number.isInteger(answer) || !Number.isInteger(q.picked) || q.picked === answer) continue
            add({ slug: 'zsb-english', lessonId: canonicalLesson(lid), ref: `${match[2]}:${qn}`, stem,
              options: opts.map((text, i) => ({ value: String(i), text })), answer: [String(answer)],
              source: safeLessonPath(match[1], base), title: lesson('zsb-english', lid)?.title || `第 ${Number(lid)} 课`, legacyHtml: true })
          } catch { /* Ignore an incomplete legacy answer, leaving the original record intact. */ }
        }
      }
    }
  } catch { return { added: 0, saved: false } }
  return { added, saved: !added || write(entries, storage) }
}
