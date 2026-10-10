import { getStudyStorage } from './study-storage.mjs'
/* 教学流运行时：温故知新、知识点 1/3/7 复测、小节续学。
   数据：localStorage l1uj-knowledge-v1（知识点三盒）与 l1uj-sections-v1:<slug>:<lessonId>（小节完成）。
   课页注入的 #teaching-data / #teaching-bank 提供 sections、题目补充与知识点定义；
   本模块只调度与呈现，题目判分仍由各课 quiz 运行时负责（经 study:attempt 上报）。 */
import { readMistakes, mistakeId } from './mistake-store.mjs'
import { mountGuidedSection } from './guided-section.mjs'

const DAY = 86400000
export const KNOWLEDGE_KEY = 'l1uj-knowledge-v1'
export const SECTIONS_PREFIX = 'l1uj-sections-v1:'
export const KNOWLEDGE_INTERVALS = [1, 3, 7]
export const WARMUP_LIMIT = 3

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const storageOf = storage => storage || getStudyStorage()

/* ---------------- 知识点三盒（1/3/7 天，对齐政治闪卡语义） ---------------- */

export function readKnowledge(storage) {
  try {
    const data = JSON.parse(storageOf(storage).getItem(KNOWLEDGE_KEY) || '{}')
    return data.version === 1 && object(data.points)
      ? { points: data.points, sources: object(data.sources) ? data.sources : {} }
      : { points: {}, sources: {} }
  } catch { return { points: {}, sources: {} } }
}

export function writeKnowledge(state, storage) {
  try {
    storageOf(storage).setItem(KNOWLEDGE_KEY, JSON.stringify({ version: 1, points: state.points || {}, sources: state.sources || {} }))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('l1uj:study'))
    return true
  } catch { return false }
}

export function isDuePoint(point, now = Date.now()) {
  return !!point && point.learnedAt != null && Number(point.dueAt) <= now
}

export function dueKnowledge(storage, now = Date.now()) {
  const state = readKnowledge(storage)
  return Object.entries(state.points)
    .filter(([, point]) => isDuePoint(point, now))
    .map(([id, point]) => ({ id, ...point, source: state.sources[id] || null }))
    .sort((a, b) => a.dueAt - b.dueAt)
}

/* 作答结果驱动晋级：独立答对且到期 → box+1（上限 3）并重排；答错 → 回 1 盒明天再来；
   看答案只记 viewed 不晋级；未到期答对不动排期，只留痕迹。skip 只给已学点补一条历史。
   历史按最近 50 条封顶，避免长期积累把存储和备份撑大。 */
export const HISTORY_LIMIT = 50

function nextPoint(old, result, now) {
  const history = [...(old?.history || []), { at: now, result }].slice(-HISTORY_LIMIT)
  if (!old) return result === 'skip' ? null : { box: 1, dueAt: now + DAY, learnedAt: now, lastResult: result, history }
  if (result === 'skip') return { ...old, history }
  if (result === 'wrong') return { ...old, box: 1, dueAt: now + DAY, lastResult: 'wrong', history }
  if (result === 'correct') {
    if (!isDuePoint(old, now)) return { ...old, lastResult: 'correct', history }
    const box = Math.min(KNOWLEDGE_INTERVALS.length, Math.max(1, old.box) + 1)
    return { ...old, box, dueAt: now + KNOWLEDGE_INTERVALS[box - 1] * DAY, lastResult: 'correct', history }
  }
  return { ...old, lastResult: 'viewed', history }
}

/* source 可以是固定对象，也可以是 (kpId) => 记录的函数（题号 + 知识点名按点各记一份），
   今日任务据此把到期知识点链接回对应课的互动页。 */
export function recordKnowledge(ids, { result, now = Date.now(), source } = {}, storage) {
  if (!['correct', 'wrong', 'viewed', 'skip'].includes(result)) return false
  const state = readKnowledge(storage)
  const sourceOf = typeof source === 'function' ? source : () => source
  let changed = false
  for (const id of ids || []) {
    if (!id) continue
    const next = nextPoint(state.points[id], result, now)
    if (!next) continue
    state.points[id] = next
    const origin = sourceOf(id)
    if (origin) state.sources = { ...state.sources, [id]: origin }
    changed = true
  }
  return changed ? writeKnowledge(state, storage) : true
}

/* ---------------- 小节完成进度 ---------------- */

export function sectionsKey(slug, lessonId) { return `${SECTIONS_PREFIX}${slug}:${lessonId}` }

export function readSections(slug, lessonId, storage) {
  try {
    const data = JSON.parse(storageOf(storage).getItem(sectionsKey(slug, lessonId)) || '{}')
    return object(data) ? data : {}
  } catch { return {} }
}

export function markSectionDone(slug, lessonId, sectionId, now = Date.now(), storage) {
  const done = readSections(slug, lessonId, storage)
  if (done[sectionId]?.done) return true
  try {
    storageOf(storage).setItem(sectionsKey(slug, lessonId), JSON.stringify({ ...done, [sectionId]: { done: true, at: now } }))
    return true
  } catch { return false }
}

/* 第一个未完成小节的下标；全部完成返回 -1，没有记录返回 0。 */
export function nextSectionIndex(sections, done) {
  for (let i = 0; i < sections.length; i++) if (!done[sections[i].id]?.done) return i
  return sections.length ? -1 : 0
}

/* ---------------- 温故知新选题 ---------------- */

/* questions: [{id, ref, lessonId, knowledgePoints:[]}]；points/mistakes 为对应存储的条目映射。
   优先级：(1) 本节前置/知识点中已学点的已学题 (2) 到期薄弱点（点到期或错题 pending）(3) 更早已学内容。
   同一层里本课题目排在后面（本课稍后还会练，先温故更早的内容）；跨层按题目 id 去重。 */
export function pickWarmup({ sections = [], questions = [], points = {}, mistakes = {}, currentLesson = '', limit = WARMUP_LIMIT, now = Date.now() } = {}) {
  const learned = new Set(Object.entries(points).filter(([, p]) => p && p.learnedAt != null).map(([id]) => id))
  const pending = new Set(Object.entries(mistakes).filter(([, e]) => e && e.status === 'pending').map(([id]) => id))
  if (!learned.size && !Object.keys(mistakes).length) return { mode: 'empty', questions: [] }
  const sectionKps = []
  for (const section of sections) {
    for (const kp of [...(section.prereqs || []), ...(section.knowledgePoints || [])]) {
      if (!sectionKps.includes(kp)) sectionKps.push(kp)
    }
  }
  const due = new Set(Object.entries(points).filter(([, p]) => isDuePoint(p, now)).map(([id]) => id))
  const tiers = [
    q => q.knowledgePoints.some(kp => learned.has(kp) && sectionKps.includes(kp)),
    q => q.knowledgePoints.some(kp => due.has(kp)) || pending.has(q.id),
    q => q.knowledgePoints.some(kp => learned.has(kp)),
  ]
  const seen = new Set()
  const picked = []
  for (const match of tiers) {
    const pool = questions.filter(q => !seen.has(q.id) && match(q))
    pool.sort((a, b) => Number(String(a.lessonId) === String(currentLesson)) - Number(String(b.lessonId) === String(currentLesson)))
    for (const q of pool) {
      if (picked.length >= limit) break
      seen.add(q.id)
      picked.push(q)
    }
    if (picked.length >= limit) break
  }
  // 有学习记录但本节没有相关题目（如跨科目首学）：走引导分支，不说"0 道旧题"。
  if (!picked.length) return { mode: 'empty', questions: [], priorRecords: learned.size > 0 || Object.keys(mistakes).length > 0 }
  return { mode: 'questions', questions: picked, partial: picked.length < limit }
}

/* 答完温故题后的一句衔接：旧知识点怎样托起本节目标。 */
export function warmupBridge(point, section) {
  const name = point?.name || '这个旧知识'
  const goal = section?.goal ? `「${section.goal}」` : '本节内容'
  const summary = point?.summary ? `${point.summary}` : '先把它回忆起来，再学新内容会更顺。'
  return `${name} 是本节 ${goal} 的台阶：${summary}`
}

/* ---------------- 页面挂载 ---------------- */

function readTeachingPayload() {
  try {
    if (typeof document.getElementById !== 'function') return null
    const lesson = document.getElementById('teaching-data')
    if (lesson) {
      const data = JSON.parse(lesson.textContent || '{}')
      if (object(data) && (object(data.questions) || Array.isArray(data.sections))) return data
    }
    const bank = document.getElementById('teaching-bank')
    if (!bank) return null
    const bankData = JSON.parse(bank.textContent || '{}')
    const questions = {}
    for (const paper of Object.values(object(bankData?.papers) ? bankData.papers : {})) {
      for (const [ref, q] of Object.entries(object(paper?.questions) ? paper.questions : {})) {
        if (!questions[ref]) questions[ref] = q
      }
    }
    return Object.keys(questions).length ? { version: 1, lessonId: '', sections: [], questions, knowledgePoints: [] } : null
  } catch { return null }
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** 小节锚点：优先 id，其次按标题文本匹配（政治课件 h2/h3 常无 id），最后按 h2 顺序兜底。 */
function sectionHeading(section, index) {
  if (section.id) {
    const node = document.getElementById(section.id)
    if (node && (node.tagName === 'H2' || node.tagName === 'H3')) return node
  }
  const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[0-9０-９]/g, '')
  const target = norm(section.title)
  if (target) {
    for (const tag of ['h2', 'h3']) {
      const headings = typeof document.querySelectorAll === 'function' ? document.querySelectorAll(tag) : []
      for (const h of headings) {
        const text = norm(h.textContent)
        if (text && (text.includes(target) || target.includes(text))) return h
      }
    }
  }
  const h2s = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('h2') : []
  return Number.isInteger(index) && h2s[index] ? h2s[index] : null
}

function mountSections(payload, slug, storage) {
  const resolved = []
  const usedHeadings = new Set()
  ;(payload.sections || []).forEach((section, index) => {
    const heading = sectionHeading(section, index)
    if (!heading || usedHeadings.has(heading)) return
    usedHeadings.add(heading)
    resolved.push({ section, heading })
  })
  if (!resolved.length) return () => {}
  const lessonId = String(payload.lessonId || '')
  const done = readSections(slug, lessonId, storage)
  const cleanups = []

  resolved.forEach(({ section, heading }, index) => {
    if (section.goal || section.minutes) {
      const bar = el('p', 'tf-goal')
      bar.append(el('span', 'tf-goal-label', '本节目标'))
      bar.append(document.createTextNode(` ${section.goal || '读完本节'}${section.minutes ? ` · 建议 ${section.minutes} 分钟` : ''}`))
      heading.after(bar)
      cleanups.push(() => bar.remove())
    }
    const next = resolved[index + 1]
    if (section.retell || next) {
      const tail = el('div', 'tf-retell')
      if (section.retell) tail.append(el('p', 'tf-retell-tip', `合上书复述：${section.retell}`))
      if (next) {
        const link = el('a', 'tf-retell-next', `继续下一节：${next.section.title || ''} →`)
        link.href = `#${encodeURIComponent(next.section.id)}`
        tail.append(link)
      }
      if (next) next.heading.before(tail)
      else heading.parentElement?.append(tail)
      cleanups.push(() => tail.remove())
    }
  })

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const item = resolved.find(x => x.heading === entry.target)
        if (item) markSectionDone(slug, lessonId, item.section.id, Date.now(), storage)
      }
    }, { rootMargin: '-60px 0px -40% 0px' })
    resolved.forEach(item => observer.observe(item.heading))
    cleanups.push(() => observer.disconnect())
  }

  const resumeIndex = nextSectionIndex(resolved.map(x => x.section), done)
  if (resumeIndex > 0) {
    const banner = el('p', 'tf-resume')
    const target = resolved[resumeIndex]
    const label = resolved.some(item => item.section.guide) ? '原讲义下一节' : '继续上次'
    const link = el('a', 'tf-resume-link', `${label}：第 ${resumeIndex + 1} 节 ${target.section.title || ''} →`)
    link.href = `#${encodeURIComponent(target.section.id)}`
    banner.append(link)
    const anchor = document.querySelector('h1') || resolved[0].heading
    anchor.after(banner)
    cleanups.push(() => banner.remove())
  }
  return () => cleanups.forEach(fn => fn())
}

function bridgeFor(question, payload) {
  const kpId = (question.knowledgePoints || [])[0]
  const point = (payload.knowledgePoints || []).find(item => item.id === kpId)
  const section = (payload.sections || []).find(item => (item.knowledgePoints || []).includes(kpId)) || (payload.sections || [])[0]
  return warmupBridge(point, section)
}

function knowledgeName(payload, id) {
  return (payload.knowledgePoints || []).find(point => point.id === id)?.name || ''
}

function renderWarmupQuestion(panel, question, payload, slug, lessonId, storage, state) {
  const card = el('div', 'tf-warmup-q')
  card.append(el('p', 'tf-warmup-stem', question.stem || question.ref))
  const opts = el('div', 'tf-warmup-opts')
  const feedback = el('div', 'tf-warmup-feedback')
  let answered = false
  const source = id => ({ slug, lessonId, ref: question.ref, name: knowledgeName(payload, id) })
  const finish = (result, correct) => {
    if (answered) return
    answered = true
    state.answered.add(question.id)
    recordKnowledge(question.knowledgePoints, { result, source }, storage)
    opts.querySelectorAll('button').forEach(btn => { btn.disabled = true })
    feedback.append(el('p', correct === undefined ? 'tf-warmup-note' : correct ? 'tf-warmup-ok' : 'tf-warmup-no',
      correct === undefined ? `参考答案：${question.answerText}` : correct ? '✓ 答对了，旧知识还在。' : `✗ 正确答案：${question.answerText}`))
    feedback.append(el('p', 'tf-warmup-bridge', bridgeFor(question, payload)))
    if (question.explanation) feedback.append(el('p', 'tf-warmup-exp', question.explanation))
  }
  ;(question.options || []).forEach(option => {
    const btn = el('button', 'tf-warmup-opt', option.text)
    btn.type = 'button'
    btn.addEventListener('click', () => finish(question.answer.includes(option.value) ? 'correct' : 'wrong', question.answer.includes(option.value)))
    opts.append(btn)
  })
  const peek = el('button', 'tf-warmup-peek', '看答案')
  peek.type = 'button'
  peek.addEventListener('click', () => finish('viewed', undefined))
  opts.append(peek)
  card.append(opts, feedback)
  panel.append(card)
}

async function mountWarmup(payload, slug, base, storage) {
  const sections = payload.sections || []
  if (!sections.some(section => (section.prereqs || []).length || (section.knowledgePoints || []).length)) return () => {}
  const lessonId = String(payload.lessonId || '')
  let questions = []
  try {
    const response = await fetch(`${base}learning/questions-${slug}.json`)
    if (!response.ok) throw new Error('question index unavailable')
    const index = await response.json()
    if (index?.version === 1 && object(index.entries)) {
      questions = Object.values(index.entries)
        .map(q => ({ ...q, id: q.id || mistakeId(q), knowledgePoints: q.teaching?.knowledgePoints || [],
          answerText: (q.options || []).filter(o => (q.answer || []).includes(o.value)).map(o => o.text).join('；') }))
        .filter(q => q.knowledgePoints.length && Array.isArray(q.options) && q.options.length && Array.isArray(q.answer) && q.answer.length)
    }
  } catch { return () => {} }

  const { points } = readKnowledge(storage)
  const plan = pickWarmup({ sections, questions, points, mistakes: readMistakes(storage), currentLesson: lessonId })
  const panel = el('section', 'tf-warmup')
  panel.setAttribute('aria-label', '温故知新')
  const head = el('div', 'tf-warmup-head')
  head.append(el('strong', 'tf-warmup-title', '温故知新'))
  panel.append(head)
  const state = { answered: new Set(), closed: false }

  if (plan.mode === 'empty') {
    if (plan.priorRecords) {
      head.append(el('span', 'tf-warmup-sub', '本节暂时没有需要温故的内容'))
      panel.append(el('p', 'tf-warmup-empty', `已学内容里还没有与本节点相关的题目，直接从「${sections[0]?.title || '开头'}」开始即可；学过相关内容后，这里会先出温故题。`))
    } else {
      head.append(el('span', 'tf-warmup-sub', '这是这段内容的第一步'))
      panel.append(el('p', 'tf-warmup-empty', `还没有已学记录。本节从「${sections[0]?.title || '开头'}」开始，边读边练即可；学过的内容会在之后的课里先来温故。`))
    }
  } else {
    head.append(el('span', 'tf-warmup-sub', `先回忆 ${plan.questions.length} 道旧题，再学本节新内容`))
    if (plan.partial) panel.append(el('p', 'tf-warmup-note', '暂无更多已学内容，先复习这几道。'))
    for (const question of plan.questions) renderWarmupQuestion(panel, question, payload, slug, lessonId, storage, state)
  }

  const skip = el('button', 'tf-warmup-skip', plan.mode === 'empty' ? '知道了，开始本节' : '跳过，直接学本节')
  skip.type = 'button'
  skip.addEventListener('click', () => {
    if (state.closed) return
    state.closed = true
    if (plan.mode === 'questions') {
      for (const question of plan.questions) {
        if (!state.answered.has(question.id)) recordKnowledge(question.knowledgePoints, { result: 'skip' }, storage)
      }
    }
    panel.remove()
  })
  head.append(skip)

  const anchor = sectionHeading(sections[0]) || document.querySelector('h1')
  if (!anchor) return () => {}
  anchor.before(panel)
  return () => panel.remove()
}

/* 样式表与模块同目录发布。挂载时按需注入一次，旧镜像页面不必改构建管道。 */
function ensureStylesheet(base) {
  const href = `${base}learning/teaching-flow.css`
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.append(link)
}

/* lesson-shell 在每课调用：挂载温故面板、小节进度条与知识点晋级监听。 */
export function mountTeachingFlow(base = '/blog/', storage) {
  if (typeof document === 'undefined' || !document.body) return () => {}
  ensureStylesheet(base)
  window.TF = {
    dueKnowledge: now => dueKnowledge(storage, now),
    readKnowledge: () => readKnowledge(storage),
    recordKnowledge: (ids, opts) => recordKnowledge(ids, opts, storage),
  }
  const payload = readTeachingPayload()
  if (!payload) return () => {}
  const slug = location.pathname.match(/\/lessons\/(zsb-(?:english|politics))\//)?.[1]
  if (!slug) return () => {}
  const lessonId = String(payload.lessonId || '')

  const onAttempt = event => {
    const meta = event.detail?.node?.studyQuestion
    const ids = meta?.knowledgePoints
    if (!Array.isArray(ids) || !ids.length) return
    const result = event.detail.correct ? (event.detail.independent === false ? 'viewed' : 'correct') : 'wrong'
    recordKnowledge(ids, { result, source: id => ({ slug, lessonId, ref: meta.ref, name: knowledgeName(payload, id) }) }, storage)
  }
  document.addEventListener('study:attempt', onAttempt)

  const cleanups = [() => document.removeEventListener('study:attempt', onAttempt), mountSections(payload, slug, storage)]
  ;(payload.sections || []).forEach((section, index) => {
    if (section.guide) cleanups.push(mountGuidedSection({ section, heading: sectionHeading(section, index), slug, lessonId, base, storage }))
  })
  mountWarmup(payload, slug, base, storage).then(cleanup => cleanups.push(cleanup))
  return () => cleanups.forEach(fn => fn())
}
