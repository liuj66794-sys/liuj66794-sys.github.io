import { migrateLegacy, recordAttempt, registerQuestion } from './mistake-store.mjs'
import { escapeMarkup, serializeQuestionMarkup } from './question-markup.mjs'

function readableNode(value) {
  let copy
  if (typeof value === 'string') {
    const template = document.createElement('template')
    template.innerHTML = value
    copy = template.content
  } else copy = value?.cloneNode?.(true)
  if (!copy) return null
  copy.querySelectorAll('.katex').forEach(math => {
    const tex = math.querySelector('annotation')
    if (tex) math.replaceWith(document.createTextNode(`$${tex.textContent}$`))
  })
  copy.querySelectorAll('.quiz-flag,.qno,.mtag,script,style,template,iframe,object').forEach(node => node.remove())
  copy.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')))
  return copy
}
export function readableText(value, html = false) {
  if (typeof value === 'string' && !html) return value
  return readableNode(value)?.textContent.trim() || ''
}
const domReader = {
  text: node => node.nodeType === 3 ? node.textContent : null,
  tag: node => node.tagName?.toLowerCase() || '',
  attr: (node, key) => node.getAttribute?.(key) || '',
  children: node => [...node.childNodes],
}
export function readableMarkup(value, html = false, stripOptionLabel = false) {
  if (typeof value === 'string' && !html) return escapeMarkup(stripOptionLabel ? value.replace(/^[A-Z][.、．]\s+/i, '') : value)
  const copy = readableNode(value)
  if (!copy) return ''
  if (stripOptionLabel) {
    let remaining = copy.textContent.match(/^\s*[A-Z][.、．]\s+/i)?.[0].length || 0
    const walker = document.createTreeWalker(copy, 4)
    while (remaining) {
      const node = walker.nextNode()
      if (!node) break
      const count = Math.min(remaining, node.textContent.length)
      node.textContent = node.textContent.slice(count); remaining -= count
    }
  }
  return serializeQuestionMarkup(copy, domReader).trim()
}
function snapshot(node, base) {
  const meta = node.studyQuestion
  if (!meta) return null
  const recall = meta.kind === 'recall'
  const stem = meta.stem ?? node.querySelector(recall ? '.recall-q' : '.quiz-q,.qtext,.stem')
  const options = meta.options || [...node.querySelectorAll('.quiz-opts button,.quiz-opts li')].map(option => ({
    value: option.dataset.k || option.dataset.opt, text: readableText(option),
  }))
  const explanation = meta.explanation ?? node.querySelector(recall ? '.recall-a' : '.quiz-exp,.quiz-expl,.quiz-explanation')
  const formatted = meta.slug === 'zsb-english'
  return { slug: meta.slug, lessonId: meta.lessonId, ref: meta.ref, kind: recall ? 'recall' : 'choice',
    ...(meta.slug === 'zsb-politics' ? { schemaVersion: meta.schemaVersion, contentVersion: meta.contentVersion,
      question: meta.question, chapter: meta.chapter, legacyQuestion: meta.legacyQuestion, sourceMetadata: meta.sourceMetadata } : {}),
    stem: readableText(stem, meta.html), legacyHtml: false,
    ...(formatted ? { stemHtml: readableMarkup(stem, meta.html), explanationHtml: readableMarkup(explanation, meta.html) } : {}),
    options: options.map(o => ({ value: String(o.value), text: readableText(o.text, meta.html), ...(formatted ? { html: readableMarkup(o.text, meta.html) } : {}) })),
    answer: meta.answer || [], doubt: !!meta.doubt,
    sourceLabel: meta.sourceLabel || '',
    ...(meta.teaching ? { teaching: meta.teaching } : {}),
    ...(meta.subjective ? { subjective: meta.subjective } : {}),
    contextRequired: (meta.slug === 'zsb-english' && Number(meta.lessonId) >= 18 && Number(meta.lessonId) <= 23) || !!node.querySelector('img,svg,canvas'),
    explanation: readableText(explanation, meta.html),
    source: meta.source || location.pathname, title: meta.title || document.querySelector('h1')?.textContent.trim() || document.title,
    reading: `${base}courses/${meta.slug}/l/${/^\d+$/.test(meta.lessonId) ? Number(meta.lessonId) : meta.lessonId}/` }
}

export function attachMistakeTracking(base = '/blog/') {
  const slug = location.pathname.match(/\/lessons\/(zsb-(?:math|english|politics|cs))\//)?.[1]
  if (!slug) return () => {}
  if ((slug === 'zsb-politics' && /\/wrong\.html$/.test(location.pathname)) || (slug === 'zsb-cs' && /\/mistakes\.html$/.test(location.pathname))) {
    location.replace(`${base}review/?subject=${slug}`)
    return () => {}
  }
  migrateLegacy()
  const known = new WeakSet()
  const query = new URLSearchParams(location.search)
  let retry = query.get('reviewQuestion')
  function check() {
    for (const node of document.querySelectorAll('.quiz[data-answer],.qcard,.q-item,.recall')) {
      if (!node.studyQuestion || known.has(node)) continue
      known.add(node)
      const q = snapshot(node, base)
      registerQuestion(q)
      if (retry === q.ref) {
        retry = null
        const url = new URL(location.href); url.searchParams.delete('reviewQuestion')
        history.replaceState(history.state, '', url.pathname + url.search + url.hash)
        node.dispatchEvent(new Event('study-retry'))
        requestAnimationFrame(() => {
          const target = [...document.querySelectorAll('.quiz[data-answer],.qcard,.q-item,.recall')].find(el => el.studyQuestion?.ref === q.ref) || node
          target.scrollIntoView({ block: 'center' }); target.tabIndex = -1; target.focus({ preventScroll: true })
        })
      }
    }
  }
  function attempt(event) {
    const q = snapshot(event.detail.node, base)
    if (!q) return
    const saved = recordAttempt(q, { correct: event.detail.correct, independent: event.detail.independent,
      attemptId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` })
    let notice = document.querySelector('.study-storage-notice')
    if (!saved && !notice) {
      notice = document.createElement('p'); notice.className = 'study-storage-notice'; notice.setAttribute('role', 'alert')
      notice.textContent = '本次错题未能保存。请检查浏览器存储权限，并保留已有备份。'
      event.detail.node.append(notice)
    }
  }
  document.addEventListener('study:attempt', attempt)
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true })
  check()
  return () => { observer.disconnect(); document.removeEventListener('study:attempt', attempt) }
}
