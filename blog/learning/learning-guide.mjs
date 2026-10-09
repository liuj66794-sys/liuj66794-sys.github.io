import { getStudyStorage } from './study-storage.mjs'
/*
 * Shared course learning guide.
 *
 * The guide is deliberately content-led: it links to goals/headings that are
 * already on the page, then gives the learner one small repeatable loop:
 * read -> recall independently -> review mistakes. It does not create or
 * rewrite course facts and it keeps existing quiz runtimes in charge of state.
 */

const CONTROLLER_BY_HOST = new WeakMap()
const EXERCISE_SELECTOR = '.quiz[data-answer],.qcard,.q-item,.recall,.cards-shell'
const NOTE_PREFIX = 'l1uj-learning-guide-note-v1:'

function noop() {}

function normalizeBase(base) {
  const value = String(base == null ? '/blog/' : base).trim()
  if (!value) return '/'
  return value.endsWith('/') ? value : value + '/'
}

function compactText(value, limit = 160) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return text.slice(0, Math.max(1, limit - 1)).trimEnd() + '…'
}

function stableHash(value) {
  let hash = 5381
  const text = String(value == null ? '' : value)
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function isIgnored(node) {
  return Boolean(node.closest('.learning-guide,nav,footer,script,style'))
}

function uniqueNodes(nodes) {
  return [...new Set(nodes.filter(node => node && node.nodeType === 1))]
}

function contentRoot() {
  return document.querySelector('main,article,.wrap') || document.body
}

function extractGoalNodes(host) {
  const itemSelectors = [
    '.goal > ul > li',
    '.goal > ol > li',
    '.goal li',
    '[data-goal] li',
    '.lesson-goal li',
    '.objectives > li',
    '.objective',
  ]
  const items = uniqueNodes(itemSelectors.flatMap(selector => [...host.querySelectorAll(selector)]))
    .filter(node => !isIgnored(node) && compactText(node.textContent, 220))
  if (items.length) return items

  const containers = uniqueNodes([
    ...host.querySelectorAll('.goal,[data-goal],.lesson-goal,.objectives'),
  ]).filter(node => !isIgnored(node) && compactText(node.textContent, 220))
  return containers
}

function extractHeadings(host) {
  return [...host.querySelectorAll('h2,h3')]
    .filter(node => !isIgnored(node)
      && !node.closest('[data-study-session]')
      && compactText(node.textContent, 120))
}

function ensureAnchor(node, index, createdAnchors) {
  if (node.id) return node.id
  const slug = compactText(node.textContent, 48)
    .toLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stem = 'learning-guide-' + (slug || 'focus')
  let id = stem
  let suffix = 2
  while (document.getElementById(id)) {
    id = stem + '-' + suffix
    suffix += 1
  }
  node.id = id
  createdAnchors.push({ node, id })
  return id
}

function exercisesIn(host) {
  const candidates = [...host.querySelectorAll(EXERCISE_SELECTOR)]
  return uniqueNodes(candidates).filter(node => {
    // A future renderer may place a card inside a cards shell. The shell is
    // the useful focus target in that case; do not count its child twice.
    if (node.matches('.cards-shell')) return true
    return !node.closest('.cards-shell')
  })
}

function isAnswered(node) {
  if (node.matches('.cards-shell')) return false
  if (node.matches('.recall')) {
    return node.dataset.answered === '1'
      || node.classList.contains('voted-good')
      || node.classList.contains('voted-bad')
  }
  if (node.matches('.qcard')) {
    return Boolean(node.dataset.answered === '1'
      || node.querySelector('.qwhy,.quiz-feedback.ok,.quiz-feedback.bad'))
  }
  if (node.matches('.q-item')) {
    const judge = node.querySelector('.q-judge,.quiz-verdict,.quiz-feedback')
    return Boolean(judge && compactText(judge.textContent, 12))
  }
  return node.classList.contains('done')
    || Boolean(node.querySelector('.quiz-feedback.ok,.quiz-feedback.bad,.quiz-verdict.ok,.quiz-verdict.no'))
}

function linkFor(id) {
  const link = element('a', 'learning-guide-highlight')
  link.href = '#' + encodeURIComponent(id)
  return link
}

function stepNode(tag, kind, number, label, detail) {
  const node = element(tag, 'learning-guide-step learning-guide-step-' + kind)
  if (tag === 'button') node.type = 'button'
  const numberNode = element('span', 'learning-guide-step-number', number)
  const copy = element('span', 'learning-guide-step-copy')
  copy.append(element('strong', '', label), element('span', 'learning-guide-step-detail', detail))
  node.append(numberNode, copy)
  return node
}

function readTitle(host) {
  return compactText(host.querySelector('h1')?.textContent || document.title || '本课', 100)
}

function buildGuide(host, base, createdAnchors) {
  const guide = element('details', 'learning-guide')
  guide.dataset.learningGuide = 'true'
  guide.dataset.learningGuideOwned = 'true'
  guide.open = false

  const summary = element('summary', 'learning-guide-summary')
  summary.append(
    element('span', 'learning-guide-summary-title', '本课怎么学'),
    element('span', 'learning-guide-summary-trail', '读重点 → 独立作答 → 错题复习'),
  )
  guide.append(summary)

  const body = element('div', 'learning-guide-body')
  const intro = element(
    'p',
    'learning-guide-intro',
    '围绕「' + readTitle(host) + '」走一遍：先看已有重点，再合上内容作答，最后处理答错或没记住的项目。',
  )
  body.append(intro)

  const goals = extractGoalNodes(host)
  const headings = extractHeadings(host)
  const points = (goals.length ? goals : headings).slice(0, 4)
  const pointIds = points.map((node, index) => ensureAnchor(node, index, createdAnchors))
  if (points.length) {
    const highlights = element('section', 'learning-guide-highlights')
    highlights.setAttribute('aria-labelledby', 'learning-guide-highlights-title')
    const highlightsTitle = element('p', 'learning-guide-section-title', '本课重点导航')
    highlightsTitle.id = 'learning-guide-highlights-title'
    const list = element('ul', 'learning-guide-highlight-list')
    points.forEach((point, index) => {
      const item = element('li', 'learning-guide-highlight-item')
      const link = linkFor(pointIds[index])
      link.textContent = compactText(point.textContent, 128)
      item.append(link)
      list.append(item)
    })
    highlights.append(highlightsTitle, list)
    body.append(highlights)
  }

  const path = element('nav', 'learning-guide-path')
  path.setAttribute('aria-label', '本课学习路径')
  const readStep = points.length
    ? stepNode('a', 'read', '01', '读重点', compactText(points[0].textContent, 66))
    : stepNode('span', 'read', '01', '读重点', '沿正文标题阅读')
  if (points.length) readStep.href = '#' + encodeURIComponent(pointIds[0])

  const practiceStep = stepNode('button', 'practice', '02', '独立作答', '先自己想，再看解析')
  practiceStep.dataset.learningAction = 'practice'
  const reviewStep = stepNode('a', 'review', '03', '错题复习', '集中回看需要巩固的项目')
  reviewStep.href = normalizeBase(base) + 'review/'
  path.append(readStep, practiceStep, reviewStep)
  body.append(path)

  const actions = element('div', 'learning-guide-actions')
  const focusButton = element('button', 'learning-guide-focus', '进入练习聚焦')
  focusButton.type = 'button'
  focusButton.dataset.learningAction = 'focus'
  focusButton.setAttribute('aria-pressed', 'false')
  const reviewLink = element('a', 'learning-guide-review-link', '打开错题复习 →')
  reviewLink.href = normalizeBase(base) + 'review/'
  actions.append(focusButton, reviewLink)
  body.append(actions)

  const reflection = element('section', 'learning-guide-reflection')
  const noteId = 'learning-guide-note-' + stableHash(location.pathname)
  const noteLabel = element('label', 'learning-guide-note-label', '练后一句话回忆')
  noteLabel.htmlFor = noteId
  const noteHint = element(
    'span',
    'learning-guide-note-hint',
    '做完练习后，像讲给别人一样写下本课最关键的一句话。',
  )
  const note = element('textarea', 'learning-guide-note')
  note.id = noteId
  note.rows = 2
  note.maxLength = 240
  note.placeholder = '例如：我现在能用一句话解释……'
  note.setAttribute('aria-describedby', noteId + '-hint ' + noteId + '-status')
  noteHint.id = noteId + '-hint'
  const noteStatus = element('span', 'learning-guide-note-status')
  noteStatus.id = noteId + '-status'
  noteStatus.setAttribute('aria-live', 'polite')
  reflection.append(noteLabel, noteHint, note, noteStatus)
  body.append(reflection)

  guide.append(body)
  return { guide, practiceStep, focusButton, note, noteStatus }
}

function insertGuide(host, guide) {
  const sessionNav = host.querySelector('[data-study-session],.study-session-actions')
  if (sessionNav) {
    sessionNav.after(guide)
    return
  }
  const firstHeading = host.querySelector('h1')
  if (firstHeading) {
    firstHeading.before(guide)
  } else {
    host.prepend(guide)
  }
}

/**
 * Add the small, shared learning loop to the current course page.
 *
 * @param {string} base VuePress base path, usually "/blog/"
 * @returns {() => void} idempotent cleanup function for SPA navigation
 */
export function attachLearningGuide(base = '/blog/') {
  if (typeof document === 'undefined' || !document.body) return noop
  if (!/\/lessons\/zsb-(math|english|politics|cs)\/lessons\//.test(location.pathname)) return noop

  const host = contentRoot()
  if (!host) return noop
  const previous = CONTROLLER_BY_HOST.get(host)
  if (previous) previous.cleanup()

  const html = document.documentElement
  const previousGuideAttr = html.getAttribute('data-learning-guide')
  const previousFocusAttr = html.getAttribute('data-learning-focus')
  const previousHostAttr = host.getAttribute('data-learning-guide-host')
  html.dataset.learningGuide = 'true'
  host.dataset.learningGuideHost = 'true'

  const createdAnchors = []
  const view = buildGuide(host, base, createdAnchors)
  insertGuide(host, view.guide)

  let active = true
  let saveTimer = 0
  const noteKey = NOTE_PREFIX + location.pathname
  try { view.note.value = getStudyStorage().getItem(noteKey) || '' } catch {}

  const saveNote = () => {
    window.clearTimeout(saveTimer)
    saveTimer = 0
    if (!active) return
    try {
      getStudyStorage().setItem(noteKey, view.note.value)
      view.noteStatus.textContent = '已保存到此设备'
    } catch {
      view.noteStatus.textContent = '当前浏览器未允许本地保存'
    }
  }
  const queueSave = () => {
    view.noteStatus.textContent = '正在保存…'
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveNote, 180)
  }
  const flushOnHidden = () => {
    if (document.visibilityState === 'hidden') saveNote()
  }
  window.addEventListener('pagehide', saveNote)
  document.addEventListener('visibilitychange', flushOnHidden)
  view.note.addEventListener('input', queueSave)
  view.note.addEventListener('blur', saveNote)

  const setFocus = (enabled, moveToExercise = false) => {
    const list = exercisesIn(host)
    if (!enabled) html.removeAttribute('data-learning-focus')
    else if (!list.length) return
    else html.dataset.learningFocus = 'true'
    view.focusButton.textContent = enabled ? '退出练习聚焦' : '进入练习聚焦'
    view.focusButton.setAttribute('aria-pressed', String(enabled))
    if (!enabled || !moveToExercise) return

    const target = list.find(node => !isAnswered(node)) || list[0]
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    if (!target.hasAttribute('tabindex')) {
      target.dataset.learningGuideTemporaryTabindex = 'true'
      target.setAttribute('tabindex', '-1')
    }
    target.focus?.({ preventScroll: true })
  }

  const focusCurrentExercise = () => {
    const list = exercisesIn(host)
    if (!list.length) return
    setFocus(true, true)
  }
  const toggleFocus = () => {
    setFocus(html.dataset.learningFocus !== 'true', true)
  }
  view.practiceStep.addEventListener('click', focusCurrentExercise)
  view.focusButton.addEventListener('click', toggleFocus)

  const refresh = () => {
    if (!active) return
    const count = exercisesIn(host).length
    view.practiceStep.disabled = count === 0
    view.focusButton.disabled = count === 0
    view.practiceStep.setAttribute('aria-disabled', String(count === 0))
    const detail = view.practiceStep.querySelector('.learning-guide-step-detail')
    const nextDetail = count ? count + ' 项练习，先自己想' : '先打开题目，或按正文材料自测'
    if (detail && detail.textContent !== nextDetail) detail.textContent = nextDetail
  }
  refresh()

  const observer = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(refresh)
  observer?.observe(host, { childList: true, subtree: true })

  const cleanup = () => {
    if (!active) return
    window.clearTimeout(saveTimer)
    saveNote()
    window.removeEventListener('pagehide', saveNote)
    document.removeEventListener('visibilitychange', flushOnHidden)
    active = false
    observer?.disconnect()
    view.note.removeEventListener('input', queueSave)
    view.note.removeEventListener('blur', saveNote)
    view.practiceStep.removeEventListener('click', focusCurrentExercise)
    view.focusButton.removeEventListener('click', toggleFocus)
    host.querySelectorAll('[data-learning-guide-temporary-tabindex="true"]').forEach(node => {
      node.removeAttribute('tabindex')
      node.removeAttribute('data-learning-guide-temporary-tabindex')
    })
    view.guide.remove()
    for (const { node, id } of createdAnchors) {
      if (node.id === id) node.removeAttribute('id')
    }
    if (previousGuideAttr == null) html.removeAttribute('data-learning-guide')
    else html.setAttribute('data-learning-guide', previousGuideAttr)
    if (previousFocusAttr == null) html.removeAttribute('data-learning-focus')
    else html.setAttribute('data-learning-focus', previousFocusAttr)
    if (previousHostAttr == null) host.removeAttribute('data-learning-guide-host')
    else host.setAttribute('data-learning-guide-host', previousHostAttr)
    CONTROLLER_BY_HOST.delete(host)
  }

  const controller = { cleanup }
  CONTROLLER_BY_HOST.set(host, controller)
  return cleanup
}
