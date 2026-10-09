import { getStudyStorage } from './study-storage.mjs'
// These are explicit teaching traces, not an interpreter for arbitrary C input.
export const checks = {
  address: { question: 'int a = 10; int *p = &a; 此时 *p 是什么？', choices: ['a 的地址', 'a 中的值 10', 'p 自身的地址'], answer: 1,
    why: ['a 的地址保存在 p 中；*p 还多了一步：沿这个地址访问 a。', '对。p 指向 a，因此读取 *p 得到 a 中的 10。', 'p 自身的地址写作 &p。*p 访问的是 p 指向的 a。'] },
  write: { question: 'int a=10, b=30; int *p=&a; p=&b; *p=40; 执行后是什么状态？', choices: ['a=40，b=30', 'a=10，b=40', 'a=40，b=40'], answer: 1,
    why: ['p=&b 已把指向改成 b，后面的 *p 不再访问 a。', '对。先改指向，再沿新指向修改 b；a 一直是 10。', '一次 *p=40 只写入当前指向的 b，不会同时修改 a。'] },
  array: { question: 'int a[3]={10,20,30}; int *p=a; int x=*(p+1); 执行后？', choices: ['x=20，p 仍指向 a[0]', 'x=20，p 改为指向 a[1]', 'x=10，p 仍指向 a[0]'], answer: 0,
    why: ['对。p+1 计算下一个元素的地址，* 读取该元素；没有给 p 赋值。', '把“计算 p+1”和“修改 p”混淆了。只有 p++、p=p+1 等才会改变 p。', 'p 虽未改变，但 *(p+1) 访问的是后一个元素 a[1]，值为 20。'] },
  increment: { question: 'int a[3]={10,20,30}; int *p=a; int x=(*p)++; 执行后？', choices: ['x=10，a[0]=10，p 指向 a[1]', 'x=11，a[0]=11，p 指向 a[0]', 'x=10，a[0]=11，p 指向 a[0]'], answer: 2,
    why: ['括号使 ++ 作用于 *p（元素），而不是 p（指针）。指针没有前进。', '后置自增把旧值交给 x，再让元素加 1。要让 x 得到新值，应写 ++(*p)。', '对。后置形式交出旧值 10，目标元素变成 11，指针不动。'] },
  swap: { question: '函数的形参 x、y 是 int*。只执行 int *t=x; x=y; y=t; 会改变外面的 a、b 吗？', choices: ['会，因为参数是指针', '不会，只交换了形参指针的指向', '只会改变 a'], answer: 1,
    why: ['拿到地址还不够。这段代码没有向 *x 或 *y 写值，只改了形参副本。', '对。C 按值传参，指针形参也是副本。要改目标值，赋值左侧需要访问目标对象。', '代码既未向 *x 写入，也未向 *y 写入，所以 a、b 都没有改变。'] },
  transfer: { question: '根据上面的独立题，选择最终状态。', choices: ['x=2，y=6，a={2,7,6}，p 指向 a[1]', 'x=4，y=6，a={2,9,6}，p 指向 a[1]', 'x=2，y=6，a={2,7,6}，p 指向 a[2]'], answer: 0,
    why: ['对。*p++ 取旧位置的 2，再移动指针；随后修改 a[1]，最后读取 a[2]。', '*p++ 使用自增前的指针值，所以 x=2，不是 4。试着在第三行结束处停一下。', '最后的 p+1 没有改写 p。读取 a[2] 后，p 仍然指向 a[1]。'] },
}

export const traces = {
  address: { title: '沿着地址找到变量', frames: [
    { code: 'int a = 10;', cells: [['a', '10']], pointer: 'p 尚未声明', note: '先有一个保存整数 10 的变量 a。' },
    { code: 'int *p = &a;', cells: [['a', '10'], ['p', '&a']], pointer: 'p → a', note: '把 a 的地址交给 p。p 存的是地址，不是把 10 当作地址。' },
    { code: 'int value = *p;', cells: [['a', '10'], ['p', '&a'], ['value', '10']], pointer: 'p → a', note: '沿 p 找到 a，读取 10 并复制给 value。读取没有改变 a 或 p。' },
  ] },
  write: { title: '每次只追踪一句赋值', frames: [
    { code: 'int a=10, b=30; int *p=&a;', cells: [['a', '10'], ['b', '30'], ['p', '&a']], pointer: 'p → a', note: '起点：p 指向 a，a 和 b 分别为 10、30。' },
    { code: '*p = 20;', cells: [['a', '20'], ['b', '30'], ['p', '&a']], pointer: 'p → a', note: '左侧是 *p，改的是目标变量 a。' },
    { code: 'p = &b;', cells: [['a', '20'], ['b', '30'], ['p', '&b']], pointer: 'p → b', note: '左侧是 p，改的是指向；a、b 的内容没变。' },
    { code: '*p = 40;', cells: [['a', '20'], ['b', '40'], ['p', '&b']], pointer: 'p → b', note: '现在沿 p 访问的是 b，所以只把 b 改成 40。' },
  ] },
  array: { title: '区分 p+1 与 p++', frames: [
    { code: 'int a[3]={10,20,30}; int *p=a;', cells: [['a[0]', '10'], ['a[1]', '20'], ['a[2]', '30']], pointer: 'p → a[0]', note: '起点：p 指向数组首元素。' },
    { code: 'int x = *(p + 1);', cells: [['a[0]', '10'], ['a[1]', '20'], ['a[2]', '30'], ['x', '20']], pointer: 'p → a[0]', note: '算出后一个元素的地址并取值。p 没有被修改。' },
    { code: 'p++;', cells: [['a[0]', '10'], ['a[1]', '20'], ['a[2]', '30'], ['x', '20']], pointer: 'p → a[1]', note: '这一句才改变 p。现在 p[0] 是 a[1]，值为 20。' },
    { code: '*p = 25;', cells: [['a[0]', '10'], ['a[1]', '25'], ['a[2]', '30'], ['x', '20']], pointer: 'p → a[1]', note: '修改当前元素 a[1]。先前复制到 x 的 20 不会跟着变。' },
  ] },
  swap: { title: '跟着临时变量完成交换', frames: [
    { code: 'swap(&a, &b);', cells: [['a', '10'], ['b', '20']], pointer: 'x → a；y → b', note: '函数取得两个地址的副本。先看清 x、y 各自指向谁。' },
    { code: 'int t = *x;', cells: [['a', '10'], ['b', '20'], ['t', '10']], pointer: 'x → a；y → b', note: '先备份 a 的旧值。没有 t，下一句覆盖后就找不回 10。' },
    { code: '*x = *y;', cells: [['a', '20'], ['b', '20'], ['t', '10']], pointer: 'x → a；y → b', note: '把 b 的值复制给 a。此时两者同为 20，但旧值仍在 t 里。' },
    { code: '*y = t;', cells: [['a', '20'], ['b', '10'], ['t', '10']], pointer: 'x → a；y → b', note: '把 t 中保存的旧值交给 b。交换的是值，指向始终不变。' },
  ] },
}

export const storageKey = 'zhixu:cs-pointer:1'
const stepIds = ['cs-address', 'cs-write', 'cs-array', 'cs-increment', 'cs-swap', 'cs-transfer', 'cs-practice']
export function cleanState(raw) {
  return cleanCourseState(raw, { stepIds, checks, traces })
}
export function cleanCourseState(raw, { stepIds, checks, traces, signature }) {
  const next = { version: 1, step: stepIds.includes(raw?.step) ? raw.step : stepIds[0], answers: {}, labs: {} }
  if (signature) next.signature = signature
  if (raw?.version !== 1 || (signature && raw.signature !== signature)) return { ...next, step: stepIds[0] }
  if (Number.isSafeInteger(raw.updatedAt) && raw.updatedAt >= 0) next.updatedAt = raw.updatedAt
  for (const [id, q] of Object.entries(checks)) {
    const a = raw.answers?.[id]
    if (a && Number.isInteger(a.choice) && a.choice >= 0 && a.choice < q.choices.length) next.answers[id] = { choice: a.choice, submitted: a.submitted === true }
  }
  for (const [id, trace] of Object.entries(traces)) {
    const n = raw.labs?.[id]
    if (Number.isInteger(n) && n >= 0 && n < trace.frames.length) next.labs[id] = n
  }
  return next
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function mountPointerLesson(doc = document) {
  const course = doc.querySelector('.cs-course')
  if (!course || course.dataset.mounted) return
  const data = doc.getElementById('cs-course-data')
  let config
  try { config = data ? JSON.parse(data.textContent) : { stepIds, checks, traces, storageKey } }
  catch { return } // The readable lesson stays usable if its configuration is damaged.
  return mountCourse(doc, course, config)
}

function mountCourse(doc, course, config) {
  const { stepIds, checks, traces, storageKey } = config
  const cleanState = raw => cleanCourseState(raw, config)
  course.dataset.mounted = 'true'
  let state = cleanState(null)
  let storageWarning = false
  try { state = cleanState(JSON.parse(getStudyStorage().getItem(storageKey))) } catch { storageWarning = true }
  const path = course.querySelector('.cs-path')
  const status = doc.createElement('p')
  status.className = 'cs-save-status'
  status.setAttribute('role', 'status')
  status.textContent = storageWarning ? '暂时无法读取记录；仍可继续学习。' : '小练习与学习位置保存在此浏览器。'
  path.append(status)
  function save() {
    state.updatedAt = Date.now()
    try { getStudyStorage().setItem(storageKey, JSON.stringify(state)); status.textContent = '已保存到此浏览器。' }
    catch { status.textContent = '未能保存；本页可继续学习，关闭后进度可能丢失。' }
  }
  const sections = [...course.querySelectorAll('[data-cs-step]')]
  let all = false
  const mode = doc.createElement('button')
  mode.type = 'button'; mode.className = 'cs-mode'; mode.textContent = '展开全部，方便查阅'
  mode.setAttribute('aria-pressed', 'false'); path.append(mode)
  const counter = doc.createElement('p'); counter.className = 'cs-step-status'; path.prepend(counter)
  function show(id, move = false) {
    if (!stepIds.includes(id)) return
    state.step = id
    sections.forEach(section => { section.hidden = !all && section.id !== id })
    path.querySelectorAll('a').forEach(link => {
      if (link.hash === '#' + id) link.setAttribute('aria-current', 'step')
      else link.removeAttribute('aria-current')
    })
    counter.textContent = `当前小节 ${stepIds.indexOf(id) + 1} / ${stepIds.length}`
    if (move) {
      const heading = doc.getElementById(id).querySelector('h2')
      heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start' })
      history.replaceState(history.state, '', '#' + id)
      save()
    }
  }
  mode.addEventListener('click', () => {
    all = !all; mode.setAttribute('aria-pressed', String(all))
    mode.textContent = all ? '回到逐节学习' : '展开全部，方便查阅'
    show(state.step)
  })
  path.querySelectorAll('a').forEach(link => link.addEventListener('click', event => { event.preventDefault(); show(link.hash.slice(1), true) }))
  sections.forEach((section, i) => {
    const nav = doc.createElement('nav'); nav.className = 'cs-section-nav'; nav.setAttribute('aria-label', '小节切换')
    if (i) {
      const prev = doc.createElement('button'); prev.type = 'button'; prev.textContent = '← 上一小节'
      prev.addEventListener('click', () => show(stepIds[i - 1], true)); nav.append(prev)
    }
    if (i < stepIds.length - 1) {
      const next = doc.createElement('button'); next.type = 'button'; next.className = 'cs-primary'; next.textContent = '继续下一小节 →'
      next.addEventListener('click', () => show(stepIds[i + 1], true)); nav.append(next)
    }
    section.append(nav)
  })
  for (const host of course.querySelectorAll('[data-cs-lab]')) {
    const id = host.dataset.csLab, trace = traces[id]
    if (!trace) continue
    host.className = 'cs-lab'
    host.innerHTML = `<h3>${esc(trace.title)}</h3><p class="cs-muted">先预测下一句改变什么，再向前走一步。</p><div class="cs-trace" aria-live="polite"></div><div class="cs-lab-actions"><button type="button" data-prev>上一步</button><span data-count></span><button type="button" data-next>下一步</button><button type="button" data-reset>回到起点</button></div>`
    let n = state.labs[id] ?? 0
    const render = () => {
      const f = trace.frames[n]
      host.parentElement.querySelectorAll('[data-cs-map] [data-node]').forEach(node => {
        node.classList.toggle('cs-node-active', node.dataset.node === f.active)
      })
      host.querySelector('.cs-trace').innerHTML = `<p class="cs-code-label">当前步骤</p><pre><code>${esc(f.code)}</code></pre><div class="cs-memory">${f.cells.map(([name, value]) => `<div class="cs-cell"><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>${f.pointer ? `<p class="cs-pointer-arrow">${esc(f.pointer)}</p>` : ''}<p>${esc(f.note)}</p>`
      host.querySelector('[data-count]').textContent = `${n + 1} / ${trace.frames.length}`
      host.querySelector('[data-prev]').disabled = n === 0
      host.querySelector('[data-next]').disabled = n === trace.frames.length - 1
      host.querySelector('[data-reset]').disabled = n === 0
    }
    const go = (index) => { n = index; state.labs[id] = n; render(); save() }
    host.querySelector('[data-prev]').addEventListener('click', () => go(Math.max(0, n - 1)))
    host.querySelector('[data-next]').addEventListener('click', () => go(Math.min(trace.frames.length - 1, n + 1)))
    host.querySelector('[data-reset]').addEventListener('click', () => go(0))
    render()
  }
  for (const host of course.querySelectorAll('[data-cs-check]')) {
    const id = host.dataset.csCheck, q = checks[id]
    if (!q) continue
    host.className = 'cs-check'
    host.innerHTML = `<form><fieldset><legend>停一下，自己判断</legend><p class="cs-check-question">${esc(q.question)}</p>${q.choices.map((choice, i) => `<label><input type="radio" name="cs-${id}" value="${i}"><span>${esc(choice)}</span></label>`).join('')}</fieldset><button class="cs-primary" type="submit">检查我的判断</button><p class="cs-feedback" role="status"></p></form>`
    const inputs = [...host.querySelectorAll('input')], feedback = host.querySelector('.cs-feedback')
    function explain() {
      const a = state.answers[id]
      feedback.textContent = a?.submitted ? (a.choice === q.answer ? '判断正确。' : '再看一下。') + q.why[a.choice].replace(/^对。/, '') : ''
      feedback.dataset.result = a?.submitted ? (a.choice === q.answer ? 'correct' : 'retry') : ''
    }
    inputs.forEach((input, i) => {
      input.checked = state.answers[id]?.choice === i
      input.addEventListener('change', () => { state.answers[id] = { choice: i, submitted: false }; explain(); save() })
    })
    host.querySelector('form').addEventListener('submit', event => {
      event.preventDefault()
      const picked = inputs.find(input => input.checked)
      if (!picked) { feedback.textContent = '请先选择一个判断，再核对理由。'; inputs[0].focus(); return }
      state.answers[id] = { choice: Number(picked.value), submitted: true }; explain(); save()
    })
    explain()
  }
  function applyHash() {
    let id
    try { id = decodeURIComponent(location.hash.slice(1)) } catch { id = '' }
    const target = doc.getElementById(id)
    const parent = target?.closest('[data-cs-step]')
    if (parent) { show(parent.id); save(); target.scrollIntoView({ block: 'start' }) }
    else if (/^q\d+$/.test(id)) show('cs-practice')
    else show(state.step)
  }
  applyHash()
  window.addEventListener('hashchange', applyHash)
  // The shared session link normally scrolls without changing the hash. Reveal
  // its target before the existing handler runs, retaining its unanswered logic.
  doc.addEventListener('click', event => {
    if (event.target.closest?.('a[href="#study-current-question"]')) show('cs-practice', true)
  }, true)
  // Shell-generated heading IDs become available after its module starts.
  const integrateSession = () => {
    const result = doc.querySelector('body > .study-session-result')
    if (!result) return false
    result.querySelector('h2').textContent = '原课测验完成情况'
    const note = doc.createElement('p'); note.textContent = `这里统计原课的 ${course.querySelectorAll('.quiz').length} 道测验；前面的小练习用于理解检查，另行保存。`
    result.querySelector('h2').after(note)
    doc.getElementById('cs-practice').append(result)
    applyHash()
    return true
  }
  if (!integrateSession()) {
    const observer = new MutationObserver(() => { if (integrateSession()) observer.disconnect() })
    observer.observe(doc.body, { childList: true })
  }
}

if (typeof document !== 'undefined') mountPointerLesson()
