import { guideKey, readGuideState, saveGuideState, freshGuideState, answerGuide, guideResults, validateGuide } from './guided-state.mjs'

const node = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const button = (text, action, cls = '') => {
  const b = node('button', cls, text)
  b.type = 'button'
  b.addEventListener('click', action)
  return b
}
const details = (title, lines) => {
  const d = node('details', 'gs-details')
  d.append(node('summary', '', title))
  for (const line of lines) d.append(node('p', '', line))
  return d
}

export function mountGuidedSection({ section, heading, slug, lessonId, base, storage }) {
  const guide = section.guide
  if (!guide || validateGuide(guide).length || !heading) return () => {}
  const key = guideKey(slug, lessonId, section.id)
  const subject = { 'zsb-english': '英语', 'zsb-politics': '政治', 'zsb-math': '高数', 'zsb-cs': '计算机' }[slug] || '课程'
  const label = guide.shortTitle || section.title.replace(/^(?:第[一二三四五六七八九十]+部分\s*[·：]|[一二三四五六七八九十]+、)\s*/, '')
  let state = readGuideState(guide, key, storage)
  const panel = node('section', 'guided-section')
  panel.id = `guided-${section.id}`
  panel.setAttribute('aria-label', guide.title)
  const status = node('p', 'gs-save')
  status.setAttribute('role', 'status')
  const retry = button('重试保存', () => persist())
  retry.hidden = true
  const frame = node('div', 'gs-frame')
  const headingId = `${panel.id}-title`
  const header = node('header', 'gs-header')
  header.append(node('p', 'gs-eyebrow', `${subject} · 第 ${lessonId} 课 / 基础小步学`), node('h3', '', guide.title), node('p', 'gs-intro', guide.intro))
  const reading = node('a', 'gs-reading', '查阅完整讲义 ↗')
  reading.href = `${base}courses/${slug}/l/${lessonId}/`
  const jump = node('a', 'gs-reading', '查看本节完整内容 ↓')
  jump.href = `#${heading.id || section.id}`
  header.append(reading, jump)
  panel.append(header, frame, status, retry)
  heading.before(panel)
  let entries = document.querySelector('.gs-course-entries')
  if (!entries) {
    entries = node('nav', 'gs-course-entries')
    entries.setAttribute('aria-label', '小步学习入口')
    document.querySelector('h1')?.after(entries)
  }
  const entry = node('a', 'gs-entry', `${state.updatedAt ? '继续学习' : '小步学'}：${label} →`)
  entry.href = `#${panel.id}`
  entries.append(entry)

  function resumeEntry() {
    if (!state.updatedAt || state.updatedAt < Number(entries.dataset.latest || 0)) return
    entries.dataset.latest = String(state.updatedAt)
    let latest = entries.querySelector('.gs-latest')
    if (!latest) {
      latest = node('a', 'gs-entry gs-latest')
      entries.prepend(latest)
    }
    latest.href = `#${panel.id}`
    latest.textContent = `接着上次的小步学：${label} · ${state.step === guide.steps.length ? '学习小结' : `第 ${state.step + 1} 步`} →`
  }
  resumeEntry()

  function persist() {
    const ok = saveGuideState(key, state, storage)
    resumeEntry()
    entry.textContent = `${state.step === guide.steps.length ? '学习小结' : '继续学习'}：${label} →`
    status.textContent = ok ? '学习位置、作答与笔记已保存在此设备。换设备时可使用学习备份。' : '暂时无法保存；本页可以继续学习，关闭前请复制笔记或重试保存。'
    retry.hidden = ok
    return ok
  }
  function go(index) {
    state.step = index
    persist()
    render(true)
  }
  function render(focus = false) {
    frame.replaceChildren()
    const nav = node('nav', 'gs-steps')
    nav.setAttribute('aria-label', `${label}学习步骤`)
    guide.steps.forEach((step, i) => {
      const b = button(`${i + 1}. ${step.short}`, () => go(i))
      if (state.step === i) b.setAttribute('aria-current', 'step')
      nav.append(b)
    })
    const summaryButton = button('学习小结', () => go(guide.steps.length))
    if (state.step === guide.steps.length) summaryButton.setAttribute('aria-current', 'step')
    nav.append(summaryButton)
    if (guide.steps.length > 8) {
      const outline = node('details', 'gs-details gs-outline')
      outline.append(node('summary', '', `跳转步骤（共 ${guide.steps.length} 步）`), nav)
      frame.append(outline)
    } else frame.append(nav)
    if (state.step === guide.steps.length) renderSummary()
    else renderStep(guide.steps[state.step])
    if (focus) {
      const title = frame.querySelector(`#${headingId}`)
      title?.focus({ preventScroll: true })
      title?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }
  function title(text) {
    const h = node('h4', 'gs-title', text)
    h.id = headingId
    h.tabIndex = -1
    return h
  }
  function renderStep(step) {
    const article = node('div', 'gs-content')
    article.append(node('p', 'gs-meta', `${step.transfer ? '独立应用' : '理解与随堂练习'} · 第 ${state.step + 1} / ${guide.steps.length} 步 · ${step.minutes} 分钟`), title(step.title))
    for (const p of step.body) article.append(node('p', 'gs-body', p))
    if (step.examples?.length) {
      const examples = node('div', 'gs-examples')
      for (const example of step.examples) {
        const pair = node('div', 'gs-example')
        const english = node('p', 'gs-english', example.en)
        english.lang = 'en'
        pair.append(english, node('p', 'gs-translation', example.zh))
        if (example.note) pair.append(node('p', 'gs-example-note', example.note))
        examples.append(pair)
      }
      article.append(examples)
    }
    if (step.extra) article.append(details(step.extra.title, step.extra.lines))
    if (step.terms?.length) article.append(details('这些术语是什么意思？', step.terms))
    if (step.context?.length) {
      const source = details('作答所需原文（可滚动阅读）', step.context)
      source.classList.add('gs-context')
      source.open = true
      article.append(source)
    }
    if (step.reflection) {
      const label = node('label', 'gs-note-label', step.reflection)
      const input = node('textarea', '')
      input.id = `${panel.id}-draft-${step.id}`
      label.htmlFor = input.id
      input.rows = step.writing ? 7 : 2
      input.maxLength = 6000
      input.placeholder = step.writing ? '先独立写，再展开参考答案逐项核对。' : '用自己的话写一句，或先在心里回答。'
      input.value = state.drafts?.[step.id] || ''
      input.addEventListener('input', () => {
        state.drafts = { ...state.drafts, [step.id]: input.value }
        persist()
      })
      article.append(label, input)
      if (step.reference?.length) article.append(details('写完后核对参考要点（不自动判分）', step.reference))
    }
    const q = step.question
    const a = state.answers[step.id]
    const checked = !q || a?.picked != null || a?.revealed
    if (q) {
    const quiz = node('fieldset', 'gs-quiz')
    quiz.append(node('legend', '', q.stem))
    if (q.translation) quiz.append(node('p', 'gs-translation', q.translation))
    if (q.sourceLabel) quiz.append(node('p', 'gs-meta', q.sourceLabel))
    q.options.forEach((opt, i) => {
      const b = button(`${String.fromCharCode(65 + i)}. ${opt.text}`, () => {
        state = answerGuide(state, step, i)
        persist()
        render()
        frame.querySelector('.gs-feedback')?.focus({ preventScroll: true })
      }, 'gs-option')
      if (checked) {
        b.disabled = true
        if (i === q.answer) { b.classList.add('is-correct'); b.append(document.createTextNode(' · 正确答案')) }
        if (i === a.picked) { b.classList.add('is-picked'); b.append(document.createTextNode(' · 你的选择')) }
      }
      quiz.append(b)
    })
    if (!checked) {
      quiz.append(button(a?.hinted ? '提示已展开' : '给我一点提示', () => {
        state.answers[step.id] = { picked: null, hinted: true, revealed: false }
        persist(); render()
      }, 'gs-text-button'))
      if (a?.hinted) quiz.append(node('p', 'gs-hint', q.hint))
      quiz.append(button('暂时不会，看看讲解', () => {
        state.answers[step.id] = { picked: null, hinted: a?.hinted || false, revealed: true }
        persist(); render()
        frame.querySelector('.gs-feedback')?.focus({ preventScroll: true })
      }, 'gs-text-button'))
    }
    article.append(quiz)
    if (checked) {
      const correct = a.picked === q.answer
      const feedback = node('div', 'gs-feedback')
      feedback.tabIndex = -1
      feedback.setAttribute('role', 'status')
      feedback.append(node('strong', '', a.revealed ? '先看懂，再换一道试试' : correct ? (a.hinted ? '借助提示答对了' : '答对了，看看你的理由是否一致') : '先找到卡住的那一步'))
      if (a.picked != null) feedback.append(node('p', '', `你的选择：${q.options[a.picked].text}。${q.options[a.picked].why}`))
      const reasoning = node('ol', '')
      for (const line of q.steps) reasoning.append(node('li', '', line))
      feedback.append(reasoning, details('逐项看看为什么', q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}：${o.why}`)))
      article.append(feedback)
    }
    }
    const actions = node('div', 'gs-actions')
    const prev = button('上一步', () => go(state.step - 1))
    prev.disabled = state.step === 0
    actions.append(prev, button(checked ? (state.step === guide.steps.length - 1 ? '看看学习小结 →' : '继续下一步 →') : '先跳过这道，继续 →', () => go(state.step + 1), 'gs-primary'))
    article.append(actions)
    frame.append(article)
  }
  function renderSummary() {
    const result = guideResults(guide, state)
    const content = node('div', 'gs-content')
    content.append(title('合上讲解，试着自己说一遍'), node('p', 'gs-body', guide.recall))
    const metrics = node('p', 'gs-result', `第 ${state.round} 轮：已答 ${result.answered}/${result.total} · 答对 ${result.correct} · 无提示答对 ${result.independent} · 看过答案 ${result.revealed} · 未答 ${result.total - result.answered - result.revealed}`)
    if (result.total) content.append(metrics)
    const openTasks = guide.steps.filter(s => s.reflection)
    if (openTasks.length) content.append(node('p', 'gs-result', `已保存 ${openTasks.filter(s => state.drafts?.[s.id]?.trim()).length}/${openTasks.length} 份随手记录或作答草稿（不代表答对）。`))
    content.append(node('p', 'gs-body', `${result.transferTotal ? `变式应用：${result.transferCorrect}/${result.transferTotal} 道无提示答对。` : ''}一次学习还需要隔天检验；明天回来，用下方「再练一轮」复习。开放题与写作保留草稿，按参考要点自查，不自动判分。`))
    const addTextarea = (name, labelText, placeholder) => {
      const label = node('label', 'gs-note-label', labelText)
      const input = node('textarea', '')
      input.id = `${panel.id}-${name}`
      label.htmlFor = input.id
      input.maxLength = 2000
      input.rows = 3
      input.placeholder = placeholder
      input.value = state[name]
      input.addEventListener('input', () => { state[name] = input.value; persist() })
      content.append(label, input)
    }
    addTextarea('recall', '用自己的话解释', guide.recallHint || '先不看讲解，写下你的判断方法，并举一个例子。')
    content.append(details('写完后对照参考要点', guide.checklist))
    addTextarea('note', '还有哪里没懂？', '记下一句话、一个词或一道题，回来时接着解决。')
    const unfinished = guide.steps.filter(s => s.question && state.answers[s.id]?.picked == null && !state.answers[s.id]?.revealed)
    const weak = guide.steps.filter(s => { const a = state.answers[s.id]; return s.question && a && (a.revealed || a.hinted || (a.picked != null && a.picked !== s.question.answer)) })
    if (unfinished.length || weak.length) {
      content.append(node('p', 'gs-body', '接下来可以先处理：'))
      const links = node('div', 'gs-weak')
      for (const s of [...new Set([...unfinished, ...weak])]) links.append(button(s.title, () => go(guide.steps.indexOf(s))))
      content.append(links)
    }
    const actions = node('div', 'gs-actions')
    actions.append(button('再练一轮（保留笔记）', () => {
      state = { ...freshGuideState(guide), note: state.note, recall: state.recall, ...(state.drafts ? { drafts: state.drafts } : {}), round: state.round + 1 }
      persist(); render(true)
    }))
    const originalId = section.practiceRefs?.map(ref => ref.split(':')[0]).find(id => document.getElementById(id))
    const original = node('a', 'gs-primary', originalId ? '回到原课练习 →' : '回到本节讲义 →')
    original.href = `#${originalId || heading.id || section.id}`
    actions.append(original)
    content.append(actions)
    const backup = node('a', 'gs-reading', '学习备份与换设备 →')
    backup.href = `${base}prep/#study-backup-title`
    content.append(backup)
    frame.append(content)
  }
  status.textContent = state.updatedAt ? '已恢复上次学习位置与作答。记录保存在此设备。' : '每一步都可以返回或跳过，作答后会自动保存。'
  render()
  return () => { panel.remove(); entry.remove(); if (!entries.querySelector('.gs-entry:not(.gs-latest)')) entries.remove() }
}
