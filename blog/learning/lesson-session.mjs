import { studyIdentity, safeReturnTo, saveStudyProgress } from './study-state.mjs'

export function attachLessonSession(base = '/blog/', {interactive = false} = {}) {
  const identity = studyIdentity(location.pathname, base)
  const hasMistakes = identity && ['zsb-math', 'zsb-english', 'zsb-politics', 'zsb-cs'].includes(identity.slug)
  const params = new URLSearchParams(location.search)
  const back = safeReturnTo(params.get('returnTo'), base)
  const main = document.querySelector('.vp-doc, main, article, .wrap') || document.body
  if (main.querySelector('[data-study-session]')) return () => {}
  const top = document.createElement('nav')
  top.className = 'study-session-actions'
  top.setAttribute('aria-label','学习任务导航')
  top.dataset.studySession = 'true'
  const addLink = (label, href, parent = top) => {
    const link = document.createElement('a'); link.textContent = label; link.href = href; parent.append(link); return link
  }
  if (back) addLink(new URL(back, location.origin).pathname === base ? (back.endsWith('#today-tasks') ? '返回今日任务' : '返回学习工作台') : back.includes('/review/') ? '返回错题复习' : back.includes('/prep/') ? '返回原学习任务' : '返回搜索与筛选', back)
  addLink('今日任务', `${base}prep/#today-tasks`)
  if (identity) addLink('课程与学习状态', `${base}courses/${identity.slug}/`)
  if (hasMistakes) addLink('错题复习', `${base}review/?subject=${identity.slug}`)
  if (!identity && !back) return () => {}
  main.prepend(top)
  if (!interactive || !identity) return () => top.remove()
  const title = main.querySelector('h1')?.textContent.trim() || document.title
  const footer = document.createElement('section')
  footer.className = 'study-session-result'; footer.dataset.studySession = 'true'
  footer.setAttribute('aria-label','本课练习结果')
  const heading = document.createElement('h2'); heading.textContent = '这一课，学到哪里了？'
  const progress = document.createElement('p'); progress.setAttribute('role','status')
  const review = document.createElement('p')
  const actions = document.createElement('div'); actions.className = 'study-session-actions'
  footer.append(heading,progress,review,actions)
  addLink('回到今日任务', `${base}prep/#today-tasks`, actions)
  if (hasMistakes) addLink('查看本学科错题', `${base}review/?subject=${identity.slug}`, actions)
  if (back) addLink('返回原来的位置',back,actions)
  const next = [...main.querySelectorAll('a')].find(link => /下一课/.test(link.textContent) && !link.closest('[data-study-session]'))
  if (next) {
    const nextUrl = new URL(next.href,location.href)
    if (back) nextUrl.searchParams.set('returnTo',back)
    addLink('继续下一课 →', nextUrl.pathname+nextUrl.search+nextUrl.hash,actions)
  }
  main.append(footer)
  let timer, active = true
  const questions = () => [...main.querySelectorAll('.quiz[data-answer],.qcard,.q-item' + (identity.slug === 'zsb-math' ? ',.recall' : ''))].filter(node => !node.closest('[data-study-session]'))
  const practice = document.createElement('a'); practice.textContent = '到当前练习'; practice.href = '#study-current-question'
  practice.addEventListener('click',event => {
    const list=questions(), target=list.find(node => !isAnswered(node)) || list[0]
    if (target) { event.preventDefault(); target.scrollIntoView({block:'center',behavior:'smooth'}); target.setAttribute('tabindex','-1'); target.focus({preventScroll:true}) }
  })
  top.prepend(practice)
  function isAnswered(node) {
    if (node.matches('.recall')) return node.dataset.answered === '1'
    return node.matches('.quiz') ? node.classList.contains('done') : node.matches('.qcard') ? Boolean(node.querySelector('.qwhy')) : Boolean(node.querySelector('.q-judge')?.textContent.trim())
  }
  function update() {
    if (!active) return
    const list = questions()
    const answered = list.filter(isAnswered).length
    const correct = list.filter(node => node.matches('.voted-good') || node.querySelector('.quiz-verdict.ok,.quiz-feedback.ok,.q-judge.ok,.opt.is-ok[aria-pressed="true"]')).length
    const reviewNeeded = list.filter(node => node.matches('.voted-bad') || node.querySelector('.wrong,.is-no,.q-judge.no,.q-judge.warn')).length
    practice.hidden = list.length === 0
    const message = list.length ? `${answered === list.length ? '已完成练习' : '学习中'} · 本轮 ${answered}/${list.length} 项练习已完成 · ${correct} 项答对或自评记住${identity.slug === 'zsb-math' ? '（含回忆卡自评）' : ''}` : '学习中 · 本课没有可自动统计的选择题，请结合课内回忆卡或动手任务检查理解。'
    if (progress.textContent !== message) progress.textContent = message
    const advice = reviewNeeded ? `仍有 ${reviewNeeded} 题答错过或需要核对，建议查看解析后重新练习。完成练习不代表已经掌握。` : answered > 0 ? '记录反映本轮作答。建议隔天再测一次，检查能否独立回忆。' : '先完成一道练习，再回到这里查看结果。'
    if (review.textContent !== advice) review.textContent = advice
    saveStudyProgress({slug:identity.slug,id:identity.id,title,path:decodeURI(location.pathname),total:list.length,answered,correct,reviewNeeded})
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 30) }
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('[data-study-session]'))) schedule()
  })
  observer.observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled','aria-pressed']})
  main.addEventListener('click',schedule)
  update()
  if (params.get('practice') === '1') requestAnimationFrame(() => practice.click())
  return () => {active=false;clearTimeout(timer);observer.disconnect();main.removeEventListener('click',schedule);top.remove();footer.remove()}
}
