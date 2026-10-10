import { getStudyStorage } from './study-storage.mjs'
import { readEntries, resumeUrl } from './reading-state.mjs'
import { readMistakes, isDue } from './mistake-store.mjs'

export const STUDY_KEY = 'l1uj-study-progress-v1'
export const TASKS_KEY = 'l1uj-study-tasks-v1'
export const STUDY_EVENT = 'l1uj:study'
export const STUDY_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'learning', label: '学习中' },
  { value: 'review', label: '待巩固' },
  { value: 'new', label: '未开始' },
  { value: 'complete', label: '已完成练习' },
]
export function matchesStudyFilter(status, filter = 'all') {
  if (filter === 'review') return status?.reviewNeeded > 0
  if (['new', 'learning', 'complete'].includes(filter)) return (status?.state || 'new') === filter
  return true
}
export function storageObject(key, storage) {
  try { const value = JSON.parse((storage || getStudyStorage()).getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
export function studyIdentity(pathname, base = '/blog/') {
  let decoded
  try { decoded = decodeURI(pathname) } catch { return null }
  if (!decoded.startsWith(base)) return null
  const relative = decoded.slice(base.length)
  const reading = relative.match(/^courses\/(zsb-(?:math|english|politics|cs))\/l\/(\d+|(?:xg|mzt|sz)\d+)\/$/)
  const practice = relative.match(/^lessons\/(zsb-(?:math|english|politics|cs))\/lessons\/(\d{4}|(?:xg|mzt|sz)\d+)(?:[-_][^/]+)?\.html$/)
  const match = reading || practice
  if (!match) return null
  const id = /^\d+$/.test(match[2]) ? String(Number(match[2])) : match[2]
  return { slug: match[1], id, key: `${match[1]}:${id}` }
}
export function safeReturnTo(value, base = '/blog/') {
  if (typeof value !== 'string' || /[\\\u0000-\u001f]/.test(value) || value.length > 1800) return null
  try {
    const url = new URL(value, 'https://study.invalid')
    if (url.origin !== 'https://study.invalid' || !url.pathname.startsWith(base)) return null
    if (url.pathname === base) return url.pathname + url.search + url.hash
    if (!/^(?:courses|prep|knowledge|review)(?:\/|$)/.test(url.pathname.slice(base.length))) return null
    return url.pathname + url.search + url.hash
  } catch { return null }
}
export function withStudyContext(href, returnTo, base = '/blog/', extra = {}) {
  const path = href.startsWith(base) ? href : base + href.replace(/^\//, '')
  const url = new URL(path, 'https://study.invalid')
  const back = safeReturnTo(returnTo, base)
  if (back) url.searchParams.set('returnTo', back)
  for (const [key, value] of Object.entries(extra)) if (value != null) url.searchParams.set(key, String(value))
  return url.pathname + url.search + url.hash
}
export function lessonStatus(slug, lesson, base = '/blog/', storage) {
  const key = `${slug}:${lesson.id}`
  const saved = storageObject(STUDY_KEY, storage).entries?.[key]
  if (saved && Number.isFinite(saved.total) && Number.isFinite(saved.answered) && saved.total >= 0) {
    const total = Math.max(0, saved.total), answered = Math.min(total, Math.max(0, saved.answered))
    return { ...saved, total, answered, state: total > 0 && answered === total ? 'complete' : 'learning', label: total > 0 && answered === total ? '已完成练习' : '学习中' }
  }
  const visited = readEntries(base, storage).some(entry => studyIdentity(entry.path, base)?.key === key)
  // Legacy manual flags do not tell us which exercises were done or whether they were correct.
  const math = slug === 'zsb-math' && storageObject('zc-progress-v1', storage)[String(lesson.id).padStart(4, '0')]
  const political = slug === 'zsb-politics' && storageObject(`zzkk:v2:lesson:${lesson.id}`, storage)
  let english = false
  try { english = slug === 'zsb-english' && (storage || getStudyStorage()).getItem('zsb-course-done-' + String(lesson.id).padStart(4, '0')) === '1' } catch {}
  const legacy = Boolean(math?.visits || political?.at || english)
  return { total: 0, answered: 0, correct: 0, reviewNeeded: 0, state: visited || legacy ? 'learning' : 'new', label: visited || legacy ? '学习中' : '未开始', legacy }
}
export function subjectProgress(slug, lessons, base = '/blog/', storage) {
  const statuses = Object.fromEntries(lessons.map(lesson => [lesson.id, lessonStatus(slug, lesson, base, storage)]))
  const values = Object.values(statuses)
  const complete = values.filter(status => status.state === 'complete').length
  const learning = values.filter(status => status.state === 'learning').length
  const recentById = new Map()
  for (const entry of readEntries(base, storage)) {
    const identity = studyIdentity(entry.path, base)
    if (identity?.slug === slug && !recentById.has(identity.id)) recentById.set(identity.id, entry)
  }
  const lastActivity = lesson => Math.max(recentById.get(lesson.id)?.updatedAt || 0, statuses[lesson.id].updatedAt || 0)
  const continueLesson = lessons.filter(lesson => statuses[lesson.id].state === 'learning')
    .sort((a, b) => lastActivity(b) - lastActivity(a))[0]
    || lessons.find(lesson => statuses[lesson.id].state === 'new') || null
  const entry = continueLesson && recentById.get(continueLesson.id)
  // Only restore a current catalog URL; old renamed paths must not create broken resume links.
  const canonicalPaths = continueLesson ? [continueLesson.href, continueLesson.interactive].filter(Boolean).map(href => {
    const pathname = href.startsWith(base) ? href : base + href.replace(/^\//, '')
    try { return decodeURI(pathname) } catch { return pathname }
  }) : []
  const continueEntry = entry && canonicalPaths.includes(entry.path) ? entry : null
  return {
    complete, learning, fresh: values.filter(status => status.state === 'new').length,
    review: values.filter(status => status.reviewNeeded > 0).length,
    total: lessons.length, started: complete + learning > 0, statuses, continueLesson, continueEntry,
    continueHref: continueEntry ? resumeUrl(continueEntry, base) : continueLesson ? withStudyContext(continueLesson.interactive, null, base) : null,
  }
}
export function saveStudyProgress(entry, storage) {
  const store = storageObject(STUDY_KEY, storage)
  const entries = store.version === 1 && store.entries && typeof store.entries === 'object' ? store.entries : {}
  const key = `${entry.slug}:${entry.id}`
  const old = entries[key]
  const fields = ['slug','id','title','path','total','answered','correct','reviewNeeded']
  if (old && fields.every(field => old[field] === entry[field])) return false
  try {
    ;(storage || getStudyStorage()).setItem(STUDY_KEY, JSON.stringify({version:1,entries:{...entries,[key]:{...entry,updatedAt:Date.now()}}}))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STUDY_EVENT))
    return true
  } catch { return false }
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function reviewCounts(storage, date = new Date()) {
  const result = { due: 0, politicalWrong: 0, csWrong: 0, mathWrong: 0, englishWrong: 0 }
  const unified = readMistakes(storage)
  try {
    const source = storage || getStudyStorage()
    const day = Date.parse(localDay(date) + 'T00:00:00Z')
    for (let i=0;i<source.length;i++) {
      const key = source.key(i)
      if (key?.startsWith('zzkk:v2:card:')) {
        const card = storageObject(key, source)
        if ([1,2,3].includes(card.box) && (!card.at || (Number.isFinite(Date.parse(card.at)) && day - Date.parse(card.at) >= [1,3,7][card.box-1]*86400000))) result.due++
      }
      if (key?.startsWith('zzkk:v2:wrong:') && !unified[`zsb-politics:bank:${key.slice('zzkk:v2:wrong:'.length)}`]) result.politicalWrong++
    }
    for (const [lid, lesson] of Object.entries(storageObject('zsb-mistakes-v1', source))) if (lesson && typeof lesson === 'object') {
      result.csWrong += Object.entries(lesson).filter(([qn, item]) => item && item.wrongs > 0 && !item.fixed && !unified[`zsb-cs:${Number(lid)}:q:${qn}`]).length
    }
    for (const entry of Object.values(unified)) if (isDue(entry, date.getTime())) {
      const field = { 'zsb-math': 'mathWrong', 'zsb-english': 'englishWrong', 'zsb-cs': 'csWrong', 'zsb-politics': 'politicalWrong' }[entry.slug]
      if (field) result[field]++
    }
  } catch {}
  return result
}
export function taskPreferences(storage) { return storageObject(TASKS_KEY, storage).entries || {} }
export function changeTask(id, patch, storage) {
  try {
    const entries = taskPreferences(storage)
    const next = {...entries[id],...patch,updatedAt:Date.now()}
    if (!next.deferUntil) delete next.deferUntil
    ;(storage || getStudyStorage()).setItem(TASKS_KEY, JSON.stringify({version:1,entries:{...entries,[id]:next}}))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STUDY_EVENT))
    return true
  } catch { return false }
}
