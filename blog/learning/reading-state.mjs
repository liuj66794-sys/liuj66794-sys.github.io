import { getStudyStorage } from './study-storage.mjs'
// Shared by VuePress and standalone lessons. This store never contains quiz scores.
export const READING_KEY = 'l1uj-reading-v1'
export const READING_EVENT = 'l1uj:reading'
const SUBJECTS = {
  'zsb-math': '高等数学', 'zsb-english': '公共英语', 'zsb-politics': '政治理论',
  'zsb-cs': '计算机基础', 'pi-agent': 'TypeScript Agent', 'engineering-skills': '工程技能',
  'a-shares': 'A 股入门', english: '英语教学', policy: '政策学习',
}

export function lessonIdentity(pathname, base = '/blog/') {
  let path
  try { path = decodeURI(pathname) } catch { return null }
  if (!path.startsWith(base) || /[?#\\]/.test(path)) return null
  const relative = path.slice(base.length)
  const reading = relative.match(/^courses\/([\w-]+)\/l\/([^/]+)\/$/)
  const interactive = relative.match(/^lessons\/([\w-]+)\/lessons\/((?:\d{4}[-_][^/]+|(?:mzt|xg|sz)\d+))\.html$/)
  const match = reading || interactive
  if (!match || !SUBJECTS[match[1]] || match[2] === 'NaN' || /(^|\/)\.{1,2}(\/|$)/.test(path)) return null
  return { path, slug: match[1], subject: SUBJECTS[match[1]], mode: reading ? 'reading' : 'interactive' }
}

function storageOrDefault(storage) { return storage || getStudyStorage() }

export function readEntries(base = '/blog/', storage) {
  try {
    const data = JSON.parse(storageOrDefault(storage).getItem(READING_KEY) || '{}')
    if (data.version !== 1 || !Array.isArray(data.entries)) return []
    return data.entries.filter(entry => entry && lessonIdentity(entry.path, base)
      && typeof entry.title === 'string' && Number.isFinite(entry.updatedAt)
      && Number.isFinite(entry.y) && entry.y >= 0)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40)
  } catch { return [] }
}

export function readRecent(base = '/blog/', storage) { return readEntries(base, storage)[0] || null }

export function saveReading(entry, base = '/blog/', storage) {
  const identity = lessonIdentity(entry.path, base)
  if (!identity || !entry.title) return false
  const value = {
    ...identity, title: String(entry.title).slice(0, 180), updatedAt: Date.now(),
    y: Math.max(0, Number(entry.y) || 0), offset: Math.max(-1000, Math.min(10000, Number(entry.offset) || 0)),
    anchor: String(entry.anchor || '').slice(0, 100), chapter: String(entry.chapter || '').slice(0, 100),
  }
  try {
    const entries = [value, ...readEntries(base, storage).filter(item => item.path !== value.path)].slice(0, 40)
    storageOrDefault(storage).setItem(READING_KEY, JSON.stringify({ version: 1, entries }))
    return true
  } catch { return false }
}

export function resumeUrl(entry, base = '/blog/') {
  return entry && lessonIdentity(entry.path, base) ? `${encodeURI(entry.path)}?resume=1` : null
}

// Returning via an ordinary link keeps normal navigation. Only the explicit resume action restores.
export function trackReading(base = '/blog/') {
  const identity = lessonIdentity(window.location.pathname, base)
  if (!identity) return () => {}
  const main = document.querySelector('main, .vp-doc, article, .wrap') || document.body
  const heading = main.querySelector('h1') || document.querySelector('h1')
  if (!heading) return () => {}
  const previous = readEntries(base).find(entry => entry.path === identity.path)
  const url = new URL(window.location.href)
  const shouldRestore = url.searchParams.get('resume') === '1' && !url.hash
  let disposed = false
  let active = false
  let timer
  const anchors = [...main.querySelectorAll('h1,h2,h3,.qcard,.q-item,.quiz[data-answer],.recall')]
    .filter(node => !node.closest('dialog,nav,footer'))
  anchors.forEach((node, index) => { node.dataset.readingAnchor = `section-${index}` })
  const title = heading.textContent.trim()
  function capture() {
    if (!active || disposed) return
    const top = document.querySelector('[data-blog-nav-bar]')?.getBoundingClientRect().height || 80
    let closest = anchors[0]
    for (const node of anchors) {
      if (!node.getClientRects().length) continue // Collapsed or inactive lesson sections are not the reading position.
      if (node.getBoundingClientRect().top <= top + 28) closest = node
    }
    const section = closest?.matches('h1,h2,h3') ? closest.textContent.trim() : ''
    saveReading({ ...identity, title, y: window.scrollY,
      anchor: closest?.dataset.readingAnchor,
      offset: closest ? -closest.getBoundingClientRect().top : window.scrollY,
      chapter: section,
    }, base)
  }
  function onScroll() { clearTimeout(timer); timer = setTimeout(capture, 300) }
  function onVisibility() { if (document.visibilityState === 'hidden') capture() }
  async function start() {
    // Math loads its renderer asynchronously; font readiness alone can resolve too early.
    if (window.ZC?.mathReady) await window.ZC.mathReady.catch(() => {})
    await (document.fonts?.ready || Promise.resolve())
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (disposed) return
    if (url.searchParams.has('resume')) {
      url.searchParams.delete('resume')
      history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    }
    if (shouldRestore && previous) {
      const anchor = anchors.find(node => node.dataset.readingAnchor === previous.anchor && node.getClientRects().length)
      const y = anchor ? window.scrollY + anchor.getBoundingClientRect().top + (previous.offset || 0) : previous.y
      window.scrollTo({ top: Math.max(0, y), behavior: 'instant' })
      // 焦点随阅读位置走：键盘与读屏用户落在恢复到的章节，而不是页首
      if (anchor) {
        anchor.setAttribute('tabindex', '-1')
        anchor.focus({ preventScroll: true })
      }
    }
    active = true
    capture()
    window.dispatchEvent(new CustomEvent(READING_EVENT))
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', capture)
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
  return () => {
    capture()
    disposed = true
    clearTimeout(timer)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('pagehide', capture)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
