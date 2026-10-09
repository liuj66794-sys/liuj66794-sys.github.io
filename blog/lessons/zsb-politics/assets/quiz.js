window.PoliticsSession = (function () {
// DOM-free session. SRS is durable; the session is a resumable view of that state.
function createCardSession({ cards, mode = 'due', limit = 10, srs, storage, key, day, getDay = () => day, random = Math.random, onChange = () => {} }) {
  const byId = new Map(cards.filter(c => c && c.id && typeof c.question === 'string' && c.question.trim() && typeof c.answer === 'string' && c.answer.trim()).map(c => [c.id, c]))
  const ids = [...byId.keys()]
  limit = Number.isInteger(limit) ? Math.min(30, Math.max(1, limit)) : 10
  const state = { version: 1, day, mode, batchIds: [], remainingIds: [], currentCardIndex: 0, reviewedIds: [], face: 'front', phase: 'idle' }
  let error = '', resumeWarning = ''
  function rollover() {
    const now = getDay()
    if (now === state.day) return false
    day = now
    Object.assign(state, { day, batchIds: [], remainingIds: [], reviewedIds: [], currentCardIndex: 0, face: 'front', phase: 'idle' })
    error = ''
    return true
  }
  function eligible(id) {
    if (!byId.has(id) || srs.get(id)?.at === day) return false
    return state.mode === 'due' ? srs.isDue(id) : state.mode === 'new' ? srs.isNew(id) : true
  }
  function queue() { return ids.filter(id => eligible(id) && !state.reviewedIds.includes(id)) }
  function persist() {
    try { storage?.setItem(key, JSON.stringify(state)); resumeWarning = '' }
    catch { resumeWarning = '本组进度暂不能保存；已评分的学习记录不受影响。' }
  }
  function emit() { persist(); onChange(view()) }
  function finishPhase() {
    if (!state.remainingIds.length) { state.currentCardIndex = 0; state.face = 'front'; state.phase = queue().length ? 'batchComplete' : 'dailyComplete' }
    else { state.currentCardIndex = Math.min(state.currentCardIndex, state.remainingIds.length - 1); state.phase = state.face }
  }
  function reconcile() {
    const currentId = state.remainingIds[state.currentCardIndex]
    state.remainingIds = state.remainingIds.filter(id => {
      if (eligible(id) && !state.reviewedIds.includes(id)) return true
      if (srs.get(id)?.at === day && !state.reviewedIds.includes(id)) state.reviewedIds.push(id)
      return false
    })
    if (!currentId || currentId !== state.remainingIds[state.currentCardIndex]) state.face = 'front'
    finishPhase()
  }
  function view() {
    return { ...state, batchIds: [...state.batchIds], remainingIds: [...state.remainingIds], reviewedIds: [...state.reviewedIds],
      currentCard: byId.get(state.remainingIds[state.currentCardIndex]) || null,
      queueLength: state.remainingIds.length, dueCount: ids.filter(id => srs.isDue(id)).length,
      newCount: ids.filter(id => srs.isNew(id)).length, available: queue().length, total: ids.length, error, resumeWarning }
  }
  function nextBatch(nextMode = state.mode) {
    if (state.phase === 'saving' || !['due', 'new', 'extra', 'lesson'].includes(nextMode)) return false
    rollover()
    state.mode = nextMode
    let pending = queue()
    if (nextMode === 'extra') pending = shuffled(pending)
    state.batchIds = pending.slice(0, limit)
    state.remainingIds = [...state.batchIds]
    state.currentCardIndex = 0; state.face = 'front'; error = ''
    finishPhase(); emit(); return true
  }
  function shuffled(list) {
    const result = [...list]
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
    return result
  }
  function ready() {
    if (rollover()) { nextBatch(); return false }
    return ['front', 'back'].includes(state.phase) && !!view().currentCard
  }
  function flip() {
    if (!ready()) return false
    state.face = state.face === 'front' ? 'back' : 'front'; state.phase = state.face; emit(); return true
  }
  function move(delta) {
    if (!ready() || !Number.isInteger(delta)) return false
    state.currentCardIndex = (state.currentCardIndex + delta + state.remainingIds.length) % state.remainingIds.length
    state.face = 'front'; state.phase = 'front'; error = ''; emit(); return true
  }
  function shuffle() {
    if (!ready()) return false
    state.remainingIds = shuffled(state.remainingIds); state.currentCardIndex = 0; state.face = 'front'; state.phase = 'front'; emit(); return true
  }
  function grade(ok, expectedId = view().currentCard?.id) {
    if (rollover()) { nextBatch(); return false }
    const c = view().currentCard
    if (typeof ok !== 'boolean' || state.phase !== 'back' || !c || c.id !== expectedId) return false
    state.phase = 'saving'; error = ''; onChange(view())
    let result
    try { result = srs.grade(c.id, ok) } catch { result = null }
    if (!result?.saved) {
      state.phase = 'back'; error = '学习记录保存失败，本卡尚未完成。请重试。'; emit(); return false
    }
    if (!state.reviewedIds.includes(c.id)) state.reviewedIds.push(c.id)
    state.remainingIds = state.remainingIds.filter(id => id !== c.id)
    state.face = 'front'; finishPhase(); emit(); return true
  }
  let restored = false
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null')
    if (saved?.version === 1 && saved.day === day && ['due', 'new', 'extra', 'lesson'].includes(saved.mode)
      && ['idle', 'front', 'back', 'saving', 'batchComplete', 'dailyComplete'].includes(saved.phase)
      && ['batchIds', 'remainingIds', 'reviewedIds'].every(k => Array.isArray(saved[k]) && saved[k].every(id => typeof id === 'string'))
      && Number.isInteger(saved.currentCardIndex) && saved.currentCardIndex >= 0 && saved.batchIds.length <= limit
      && saved.remainingIds.every(id => saved.batchIds.includes(id))) {
      Object.assign(state, { mode: saved.mode, batchIds: [...new Set(saved.batchIds)].filter(id => byId.has(id)),
        remainingIds: [...new Set(saved.remainingIds)].filter(id => byId.has(id)), reviewedIds: [...new Set(saved.reviewedIds)].filter(id => byId.has(id)),
        currentCardIndex: saved.currentCardIndex, face: saved.face === 'back' ? 'back' : 'front' })
      reconcile(); restored = true
    }
  } catch { /* Corrupt session never replaces durable SRS. */ }
  if (!restored) nextBatch(mode)
  return { view, flip, move, shuffle, grade, nextBatch, refresh() { if (rollover()) nextBatch(); else { reconcile(); emit() } } }
}

return { createCardSession };
})();
function zhixuStorage() { return globalThis.ZhixuStudyStorage || localStorage; }
function zhixuSessionStorage() { return globalThis.ZhixuStudySessionStorage || sessionStorage; }
/* ============================================================
   专升本政治 · 互动课程 — 共享交互组件（原生 JS，无依赖）  v2
   ZQ.progress  — 课程进度存取（v2 键）
   ZQ.srs       — Leitner 三盒间隔重复（闪卡）
   ZQ.wrong     — 错题本
   ZQ.mountQuiz — 选择题测验（单选/多选、即时反馈、错题入库）
   ZQ.mountCards— 考点闪卡（翻转 + 三盒自评）
   ZQ.mountDue  — 跨课到期闪卡复习（每日闪卡页）
   ZQ.mountReview — 混合随机测试
   ZQ.markDone  — “标记已学”按钮
   ============================================================ */
(function () {
  "use strict";
  var NS = "zzkk:v2:";

  /* 考试日期（倒计时用）：由 sync-prep 从计划源 frontmatter 注入（script[data-exam-date]），
     独立打开旧镜像时回落到这里的默认值。考期有变，改 29周冲刺计划.md 的 exam-date。 */
  var examSource = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("script[data-study-base]") : null;
  var EXAM_DATE = (examSource && examSource.dataset && examSource.dataset.examDate) || "2027-03-27";

  /* 渲染约定：本文件不走 innerHTML——文本一律 textContent，富文本用 appendRich 组装节点，
     从根上消除“转义后拼 HTML”的 XSS 模式（esc/escRich 仅为页面内联脚本的历史约定保留导出）。 */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }
  /* 富文本渲染：**加粗** 转 <strong>，不成对的孤立 ** 一并清除——escRich 的 DOM 版 */
  function appendRich(node, s) {
    var text = String(s == null ? "" : s);
    var pair = /\*\*([^*]+)\*\*/g;
    var last = 0, m;
    while ((m = pair.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index).replace(/\*\*/g, "")));
      var strong = document.createElement("strong");
      strong.textContent = m[1];
      node.appendChild(strong);
      last = m.index + m[0].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last).replace(/\*\*/g, "")));
    return node;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* 富文本转义：先转 HTML 再把 **加粗** 渲染为 <strong>（笔记速记答案里的强调标记）；
     不成对的孤立 ** 一并清除，避免字面星号露出 */
  function escRich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*\*/g, "");
  }
  /* 各页面内联脚本直接使用全局 esc/escRich（历史约定），这里显式导出 */
  window.esc = esc;
  window.escRich = escRich;
  /* 稳定 id：djb2——与生成器 md5 前 10 位等价使用（生成器已内嵌 id 时优先） */
  function hash(s) {
    s = String(s || "");
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "h" + h.toString(36);
  }
  function today() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function daysBetween(isoA, isoB) {
    return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
  }

  var LESSON_STATUS = {
    'not-started': '未开始',
    'in-progress': '学习中',
    'exercise-complete': '已完成练习'
  };

  function numberOrZero(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function lessonHasActivity(record) {
    return !!(record && (
      numberOrZero(record.visits) > 0 || numberOrZero(record.quizAnswered) > 0 ||
      numberOrZero(record.quizTotal) > 0 || numberOrZero(record.quizRoundTotal) > 0 ||
      numberOrZero(record.cardsReviewed) > 0 || record.manualActivity ||
      record.done === true || record.manualDone === true || record.quizComplete === true ||
      record.exerciseComplete === true || record.best != null
    ));
  }

  function lessonStatus(record) {
    if (!lessonHasActivity(record)) return 'not-started';
    return record && (record.exerciseComplete === true || record.exerciseStatus === 'exercise-complete')
      ? 'exercise-complete' : 'in-progress';
  }

  /* ---------------- 课程进度 ---------------- */
  var progress = {
    key: function (lessonId) { return NS + "lesson:" + lessonId; },
    get: function (lessonId) {
      try { return JSON.parse(zhixuStorage().getItem(this.key(lessonId))) || {}; }
      catch (e) { return {}; }
    },
    update: function (lessonId, patch) {
      var cur = this.get(lessonId);
      var next = Object.assign(cur, patch, { at: new Date().toISOString() });
      try { zhixuStorage().setItem(this.key(lessonId), JSON.stringify(next)); } catch (e) {}
      document.dispatchEvent(new CustomEvent("zzkk:progress", { detail: { lessonId: lessonId } }));
      return next;
    },
    touch: function (lessonId) {
      if (!lessonId) return this.get(lessonId);
      var visitKey = NS + "visited:" + lessonId;
      try {
        if (typeof sessionStorage !== "undefined" && zhixuSessionStorage().getItem(visitKey)) return this.get(lessonId);
        if (typeof sessionStorage !== "undefined") zhixuSessionStorage().setItem(visitKey, "1");
      } catch (e) { /* sessionStorage 不可用时仍记录一次当前访问 */ }
      var cur = this.get(lessonId);
      return this.update(lessonId, { visits: numberOrZero(cur.visits) + 1 });
    },
    summary: function (lessonId) {
      var record = this.get(lessonId);
      var quizTotal = numberOrZero(record.quizTotal || record.quizRoundTotal);
      var quizAnswered = numberOrZero(record.quizAnswered);
      var quizCorrect = numberOrZero(record.quizCorrect);
      var quizComplete = record.exerciseComplete === true || record.quizComplete === true ||
        (record.best != null && quizTotal > 0);
      var status = lessonStatus(Object.assign({}, record, { exerciseComplete: quizComplete }));
      var allCorrect = record.quizAllCorrect === true || (quizComplete && quizCorrect === quizTotal && quizTotal > 0);
      return {
        lessonId: lessonId,
        status: status,
        statusLabel: LESSON_STATUS[status],
        visits: numberOrZero(record.visits),
        quizTotal: quizTotal,
        quizAnswered: quizAnswered,
        quizCorrect: quizCorrect,
        quizComplete: quizComplete,
        quizAllCorrect: allCorrect,
        reviewNeeded: record.reviewNeeded === true || record.quizReviewNeeded === true || record.cardsReviewNeeded === true,
        manualDone: record.manualDone === true || record.done === true,
        best: record.best == null ? null : numberOrZero(record.best)
      };
    },
    all: function () {
      return scanMap(NS + "lesson:");
    }
  };

  function scanMap(prefix) {
    var out = {};
    try {
      for (var i = 0; i < zhixuStorage().length; i++) {
        var k = zhixuStorage().key(i);
        if (k && k.indexOf(prefix) === 0) {
          try { out[k.slice(prefix.length)] = JSON.parse(zhixuStorage().getItem(k)); } catch (e) {}
        }
      }
    } catch (e) {}
    return out;
  }

  /* ---------------- Leitner 三盒：1 盒隔1天，2 盒隔3天，3 盒隔7天 ---------------- */
  var srs = {
    INTERVAL: [1, 3, 7],
    LIMITS: { due: 20, fresh: 10, total: 30 },
    key: function (id) { return NS + "card:" + id; },
    get: function (id) {
      try { return JSON.parse(zhixuStorage().getItem(this.key(id))) || null; }
      catch (e) { return null; }
    },
    grade: function (id, ok) {
      var previous = this.get(id);
      // Once per local day, across UI loops, reloads and other study entries.
      if (previous && previous.at === today() && Number(previous.box) >= 1) return Object.assign({ saved: true, alreadyReviewed: true }, previous);
      var cur = Object.assign({}, previous || { box: 0, streak: 0 });
      cur.box = ok ? Math.min(3, Math.max(0, Number(cur.box) || 0) + 1) : 1;
      cur.streak = ok ? Math.max(0, Number(cur.streak) || 0) + 1 : 0;
      cur.at = today();
      try { zhixuStorage().setItem(this.key(id), JSON.stringify(cur)); }
      catch (e) { return { saved: false, error: 'storage' }; }
      document.dispatchEvent(new CustomEvent('zzkk:srs', { detail: { id: id } }));
      return Object.assign({ saved: true, alreadyReviewed: false }, cur);
    },
    boxOf: function (id) { var s = this.get(id); return s ? s.box : 0; },
    isLearned: function (id) {
      var state = this.get(id);
      return !!(state && Number(state.box) >= 1);
    },
    isNew: function (id) { return !this.isLearned(id); },
    isDue: function (id) {
      var s = this.get(id);
      if (!s || Number(s.box) < 1) return false;  // 新卡另列，不冒充到期复习
      if (!s.at) return true;                     // 旧记录缺日期时保守安排复习
      var box = Math.max(1, Math.min(this.INTERVAL.length, Number(s.box)));
      var elapsed = daysBetween(s.at, today());
      return !Number.isFinite(elapsed) || !Number.isFinite(box) || elapsed >= this.INTERVAL[box - 1];
    },
    dueIds: function (ids) {
      var self = this;
      return (ids || []).filter(function (id) { return self.isDue(id); });
    },
    newIds: function (ids) {
      var self = this;
      return (ids || []).filter(function (id) { return self.isNew(id); });
    },
    learnedIds: function (ids) {
      var self = this;
      return (ids || []).filter(function (id) { return self.isLearned(id); });
    },
    stats: function (ids) {
      ids = ids || [];
      var fresh = this.newIds(ids);
      var due = this.dueIds(ids);
      return {
        total: ids.length,
        learned: ids.length - fresh.length,
        fresh: fresh.length,
        new: fresh.length,
        due: due.length
      };
    },
    plan: function (ids, limits) {
      var opts = Object.assign({}, this.LIMITS, limits || {});
      var dueIds = this.dueIds(ids);
      var newIds = this.newIds(ids);
      var totalLimit = Math.max(0, Number(opts.total));
      var dueLimit = Math.min(totalLimit, Math.max(0, Number(opts.due)));
      var freshLimit = Math.min(totalLimit, Math.max(0, Number(opts.fresh != null ? opts.fresh : opts.new)));
      var due = dueIds.slice(0, dueLimit);
      var fresh = newIds.slice(0, Math.min(freshLimit, Math.max(0, totalLimit - due.length)));
      return {
        dueIds: dueIds,
        newIds: newIds,
        due: due,
        fresh: fresh,
        new: fresh,
        dueRemaining: Math.max(0, dueIds.length - due.length),
        newRemaining: Math.max(0, newIds.length - fresh.length),
        limits: { due: due.length, fresh: fresh.length, total: due.length + fresh.length }
      };
    }
  };

  /* ---------------- 错题本 ---------------- */
  var wrong = {
    key: function (id) { return NS + "wrong:" + id; },
    get: function (id) {
      try { return JSON.parse(zhixuStorage().getItem(this.key(id))) || null; }
      catch (e) { return null; }
    },
    record: function (q, meta) {
      var cur = this.get(q.id) || { count: 0, firstAt: today() };
      cur.count++;
      cur.lastAt = today();
      cur.stem = q.question;
      cur.options = q.options.map(function (o) { return { letter: o.value, text: o.text }; });
      cur.answer = q.answer.length ? q.answer.join("") : null;
      cur.exp = q.explanation || "";
      cur.from = meta && meta.from ? meta.from : "";
      try { zhixuStorage().setItem(this.key(q.id), JSON.stringify(cur)); } catch (e) {}
      document.dispatchEvent(new CustomEvent("zzkk:wrong", { detail: { id: q.id } }));
      return cur;
    },
    remove: function (id) {
      try { zhixuStorage().removeItem(this.key(id)); } catch (e) {}
      document.dispatchEvent(new CustomEvent("zzkk:wrong", { detail: { id: id } }));
    },
    all: function () { return scanMap(NS + "wrong:"); },
    count: function () { return Object.keys(scanMap(NS + "wrong:")).length; }
  };

  function qidOf(q) { return q.id; }

  /* ---------------- 教学补充（逐选项反馈 / 主观题支架） ---------------- */

  /* 课页注入的教学补充：#teaching-data（课内）/ #teaching-bank（题库刷题页，按卷打包）。
     无补充时返回 null，判分与反馈保持旧行为。 */
  function readTeachingData() {
    try {
      if (typeof document.getElementById !== "function") return null;
      var lesson = document.getElementById("teaching-data");
      if (lesson) {
        var data = JSON.parse(lesson.textContent || "{}");
        if (data && typeof data === "object" && data.questions) return data;
      }
      var bank = document.getElementById("teaching-bank");
      if (!bank) return null;
      var bankData = JSON.parse(bank.textContent || "{}");
      var papers = bankData && bankData.papers || {};
      var questions = {};
      Object.keys(papers).forEach(function (id) {
        var qs = papers[id].questions || {};
        Object.keys(qs).forEach(function (ref) { if (!questions[ref]) questions[ref] = qs[ref]; });
      });
      return Object.keys(questions).length
        ? { version: 1, lessonId: "", sections: [], questions: questions, knowledgePoints: [] } : null;
    } catch (e) { return null; }
  }

  /* #teaching-data 注入在 </body> 前，课页脚本可能先于它执行：惰性读取，成功一次即缓存。 */
  var teachingCache = null;
  function teachingData() {
    if (teachingCache) return teachingCache;
    teachingCache = readTeachingData();
    return teachingCache;
  }

  function teachingText(value) {
    if (value == null) return "";
    return Array.isArray(value) ? value.join("；") : String(value);
  }

  function byLetterOf(supp) {
    var by = {};
    (supp.optionAnalysis || []).forEach(function (oa) { by[String(oa.option).toUpperCase()] = oa; });
    return by;
  }

  /* 富文本行：**加粗** 交给 appendRich，其余文本原样。 */
  function richLine(tag, cls, value) {
    var node = el(tag, cls);
    appendRich(node, teachingText(value));
    return node;
  }

  function richList(tag, cls, values) {
    var list = el(tag, cls);
    (values || []).forEach(function (value) { list.appendChild(richLine("li", undefined, value)); });
    return list;
  }

  /* 同页同 ref 的题卡：对比自测跳转用。 */
  function findItemByRef(container, ref) {
    var items = typeof container.querySelectorAll === "function" ? container.querySelectorAll(".q-item") : container.children;
    for (var i = 0; i < items.length; i++) {
      if (items[i].studyQuestion && items[i].studyQuestion.ref === ref) return items[i];
    }
    return null;
  }

  /* 对比自测目标必须在本组才显示按钮。渲染收尾与每次作答后各校验一次：
     恢复历史作答时，后面的题可能还没渲染出来。 */
  function finalizeCompareRefs(container) {
    (container.pendingCompareRefs || []).forEach(function (entry) {
      entry.button.hidden = !findItemByRef(container, entry.ref);
    });
  }

  /* 逐选项错项反馈：错选、漏选、分步判断、正确项成立理由、其余选项折叠、
     整句翻译与词组、原文定位、对比自测。supp 来自 #teaching-data.questions[ref]。 */
  function renderTeaching(item, container, supp, pickedLetters, answerLetters) {
    var box = el("div", "qteach");
    var byLetter = byLetterOf(supp);
    var wrongPicked = pickedLetters.filter(function (L) { return answerLetters.indexOf(L) < 0; });
    var missed = answerLetters.filter(function (L) { return pickedLetters.indexOf(L) < 0; });

    wrongPicked.forEach(function (L) {
      var block = el("div", "qteach-picked");
      block.appendChild(el("strong", undefined, "✗ 你选 " + L + " 为什么错"));
      var oa = byLetter[L];
      if (oa && oa.why) block.appendChild(richLine("p", "qteach-why", oa.why));
      box.appendChild(block);
    });
    if (wrongPicked.length && supp.wrongPick) box.appendChild(richLine("p", "qteach-why", supp.wrongPick));

    if (missed.length && answerLetters.length > 1) {
      var missBox = el("div", "qteach-missed");
      missBox.appendChild(el("strong", undefined, "漏选 " + missed.join("、") + " 为什么"));
      missed.forEach(function (L) {
        var oa = byLetter[L];
        var line = el("p", "qteach-why", L + "：");
        appendRich(line, (oa && oa.why) || "这一项也是答案的一部分。");
        missBox.appendChild(line);
      });
      if (supp.missedPick) missBox.appendChild(richLine("p", "qteach-why", supp.missedPick));
      box.appendChild(missBox);
    }

    if (supp.steps && supp.steps.length) {
      box.appendChild(el("p", "qteach-label", "分步判断"));
      box.appendChild(richList("ol", "qteach-steps", supp.steps));
    }

    var okBlock = el("div", "qteach-correct");
    okBlock.appendChild(el("strong", undefined, "✓ 正确答案 " + answerLetters.join("、") + " 为什么成立"));
    answerLetters.forEach(function (L) {
      var oa = byLetter[L];
      if (oa && oa.why) {
        var line = el("p", "qteach-why", answerLetters.length > 1 ? L + "：" : "");
        appendRich(line, oa.why);
        okBlock.appendChild(line);
      }
    });
    box.appendChild(okBlock);

    var rest = (supp.optionAnalysis || []).filter(function (oa) {
      var L = String(oa.option).toUpperCase();
      return pickedLetters.indexOf(L) < 0 && answerLetters.indexOf(L) < 0;
    });
    if (rest.length) {
      var details = el("details", "qteach-rest");
      details.appendChild(el("summary", undefined, "其余选项解析"));
      rest.forEach(function (oa) {
        var line = el("p", "qteach-why", String(oa.option).toUpperCase() + "（" + (oa.verdict === "correct" ? "正确" : "错误") + "）：");
        appendRich(line, oa.why || "");
        details.appendChild(line);
      });
      box.appendChild(details);
    }
    if (supp.translation) box.appendChild(richLine("p", "qteach-translation", "整句翻译：" + supp.translation));
    if (supp.phrases && supp.phrases.length) {
      var phrases = el("ul", "qteach-phrases");
      supp.phrases.forEach(function (p) {
        var line = el("li", undefined, p.text + " ");
        appendRich(line, p.meaning || "");
        phrases.appendChild(line);
      });
      box.appendChild(phrases);
    }
    if (supp.sourceContext && supp.sourceContext.quote) {
      var quote = el("blockquote", "qteach-source");
      quote.appendChild(el("b", undefined, "原文定位" + (supp.sourceContext.label ? " · " + supp.sourceContext.label : "")));
      quote.appendChild(document.createElement("br"));
      appendRich(quote, supp.sourceContext.quote);
      box.appendChild(quote);
    }
    if (supp.compareTo) {
      var compare = el("button", "btn qteach-compare", "对比自测");
      compare.type = "button";
      compare.setAttribute("data-compare-ref", supp.compareTo);
      // 目标题可能在后半页，先登记，render 收尾时统一校验，本组无该题则隐藏。
      (container.pendingCompareRefs = container.pendingCompareRefs || []).push({ button: compare, ref: supp.compareTo });
      compare.addEventListener("click", function () {
        var target = findItemByRef(container, supp.compareTo);
        if (!target) return;
        target.scrollIntoView({ block: "center" });
        target.classList.add("quiz-flash");
        setTimeout(function () { target.classList.remove("quiz-flash"); }, 1600);
      });
      box.appendChild(compare);
    }
    item.appendChild(box);
    return box;
  }

  /* 主观题（政治问答）：作答要点、推导、自评标准折叠区。 */
  function renderSubjective(item, sub) {
    var details = el("details", "qteach-subjective");
    details.appendChild(el("summary", undefined, "作答要点与自评"));
    if (sub.keyPoints && sub.keyPoints.length) {
      details.appendChild(el("p", "qteach-label", "作答要点"));
      details.appendChild(richList("ul", "qteach-keypoints", sub.keyPoints));
    }
    if (sub.derivation) {
      details.appendChild(el("p", "qteach-label", "推导"));
      details.appendChild(richLine("p", "qteach-derivation", sub.derivation));
    }
    if (sub.selfEval && sub.selfEval.length) {
      details.appendChild(el("p", "qteach-label", "自评标准"));
      details.appendChild(richList("ul", "qteach-selfeval", sub.selfEval));
    }
    item.appendChild(details);
    return details;
  }

  /* ---------------- 选择题测验（单选/多选） ---------------- */
  function mountQuiz(container, questions, opts) {
    // 课页可能在解析中（DOM 未完整）就调用：此时 </body> 前的 #teaching-data 尚未解析，
    // 推迟到 DOMContentLoaded，保证教学补充与判分反馈一次到位。
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mountQuiz(container, questions, opts); }, { once: true });
      return;
    }
    // Canonical payloads are normalized and validated during import, never here.
    if (questions.some(function (q) { return q.schemaVersion !== 1 || !q.id || !q.question || !Array.isArray(q.answer); })) {
      clear(container); container.appendChild(el('p', 'hint', '题目资料格式异常，请刷新课程后重试。')); return;
    }
    opts = opts || {};
    var lessonId = opts.lessonId || null;
    var fromLabel = opts.from || (lessonId || "");
    var recordWrong = opts.recordWrong !== false;
    var state = {};
    var teaching = readTeachingData();
    if (lessonId) progress.touch(lessonId);
    var resumeKey = 'l1uj-politics-answers-v1:' + location.pathname + ':' + (container.id || lessonId || 'quiz');
    var persist = !/\/(practice|review|srs|wrong)\.html$/.test(location.pathname);
    var saved = {};
    function readSaved() {
      if (!persist) return saved;
      try {
        var value = JSON.parse(zhixuStorage().getItem(resumeKey) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (e) { return saved; }
    }
    saved = readSaved();
    function save() { try { if (persist) zhixuStorage().setItem(resumeKey, JSON.stringify(saved)); } catch (e) {} }
    function restart() { saved = {}; save(); render(); }
    if (container.refreshPoliticsAnswers) {
      window.removeEventListener('storage', container.refreshPoliticsAnswers);
      window.removeEventListener('pageshow', container.refreshPoliticsAnswers);
      window.removeEventListener('zhixu:cloud-records', container.refreshPoliticsAnswers);
    }
    container.refreshPoliticsAnswers = function (event) {
      if (event.type === 'storage' && event.key !== null && event.key !== resumeKey) return;
      var latest = readSaved();
      if (JSON.stringify(latest) !== JSON.stringify(saved)) { saved = latest; render(); }
    };
    if (persist) {
      window.addEventListener('storage', container.refreshPoliticsAnswers);
      window.addEventListener('pageshow', container.refreshPoliticsAnswers);
      window.addEventListener('zhixu:cloud-records', container.refreshPoliticsAnswers);
    }

    function render() {
      clear(container);
      container.pendingCompareRefs = [];
       state = { answered: 0, correct: 0, total: questions.length, reviewNeeded: false, unassessed: 0 };
      var box = el("div", "quiz");

      questions.forEach(function (q, qi) {
        var multi = q.answer.length && q.answer.length > 1;
        var item = el("div", "q-item");
        var stem = el("div", "stem");
        stem.appendChild(el("span", "qno", String(qi + 1)));
        stem.appendChild(document.createTextNode(String(q.question == null ? "" : q.question)));
        if (multi) stem.appendChild(el("span", "mtag", " 多选"));
        if ((q.answerStatus === 'doubt')) stem.appendChild(el("span", "mtag", " 存疑?"));
        if (q.chapter) item.appendChild(el('p', 'q-metadata', '章节：' + q.chapter));
        item.appendChild(stem);

        var optsBox = el("div", "opts");
        var judge = el("div", "q-judge");
        var locked = false;
        var picked = {};
        var signature = hash(JSON.stringify([q.question, q.options.map(function (o) { return { letter: o.value, text: o.text }; }), q.answer.length ? q.answer.join('') : null]));
        item.studyQuestion = { slug: 'zsb-politics', lessonId: q.lessonId, ref: q.id, schemaVersion: 1, question: q.question, chapter: q.chapter, contentVersion: q.contentVersion, legacyQuestion: q.legacyQuestion, sourceMetadata: q.source, source: q.source.path, title: q.chapter, stem: q.question,
          options: q.options.map(function (o) { return { value: o.value, text: o.text }; }), answer: q.answer ? q.answer.slice() : [], explanation: q.explanation || '', sourceLabel: q.source.label || '', doubt: !!(q.answerStatus === 'doubt') };
        var supp = (function () { var t = teachingData(); return t && t.questions ? t.questions[item.studyQuestion.ref] : null; })();
        if (supp) {
          if (supp.knowledgePoints) item.studyQuestion.knowledgePoints = supp.knowledgePoints;
          item.studyQuestion.teaching = supp;
          if (supp.subjective) item.studyQuestion.subjective = supp.subjective;
        }
        if (q.subjective && !item.studyQuestion.subjective) item.studyQuestion.subjective = q.subjective;
        // 主观题支架（问答）常驻题卡底部，判分后移到最后，紧跟反馈。
        var subjective = null;
        function paintSubjective() {
          var sub = item.studyQuestion.subjective;
          if (!sub) return;
          if (!subjective) subjective = renderSubjective(item, sub);
          else item.appendChild(subjective);
        }
        item.addEventListener('study-retry', function () { saved = readSaved(); delete saved[signature]; save(); render(); });
        var previous = saved[signature];
        function savePick(done) {
          saved = readSaved();
          saved[signature] = { picked: Object.keys(picked).filter(function (letter) { return picked[letter]; }), done: done };
          save();
        }

        function finishPick(restoring) {
          if (locked) return;
          var pickedLetters = Object.keys(picked).filter(function (letter) { return picked[letter]; });
          if (!pickedLetters.length) return;
           locked = true;
           state.answered++;
           if (!restoring) savePick(true);
          var buttons = optsBox.querySelectorAll(".opt");
          for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;

           if (!q.answer.length || (q.answerStatus === 'doubt')) {
             state.reviewNeeded = true;
             state.unassessed++;
             judge.className = "q-judge warn";
             judge.textContent = (q.answerStatus === 'doubt') ? "⚠️ 原题答案存疑，暂不自动判分，请对照权威材料核对。" : "⚠️ 原卷未提供答案，请对照笔记或课件核对。";
             if (q.warn) {
               judge.appendChild(document.createElement("br"));
               appendRich(judge, q.warn);
             }
             syncLessonProgress();
             updateScore(false);
             return;
           }
          var ans = q.answer.slice().sort().join("");
          var mine = pickedLetters.sort().join("");
           var right = mine === ans;
           if (!restoring) document.dispatchEvent(new CustomEvent('study:attempt', { detail: { node: item, correct: right, independent: true } }));
           if (right) state.correct++;
           else {
             state.reviewNeeded = true;
             if (recordWrong && !restoring) wrong.record(q, { from: fromLabel });
           }
          for (var i = 0; i < buttons.length; i++) {
            var L = buttons[i].getAttribute("data-letter");
            if (q.answer.indexOf(L) >= 0) buttons[i].classList.add("correct");
          }
          if (!right) {
            pickedLetters.forEach(function (L) {
              if (q.answer.indexOf(L) < 0) {
                for (var i = 0; i < buttons.length; i++) {
                  if (buttons[i].getAttribute("data-letter") === L) buttons[i].classList.add("wrong");
                }
              }
            });
          }
          judge.className = "q-judge " + (right ? "ok" : "no");
          judge.textContent = right ? "✓ 回答正确" : "✗ 正确答案：";
          if (!right) {
            var answerB = document.createElement("b");
            answerB.textContent = q.answer.join("、");
            judge.appendChild(answerB);
          }
          if (q.source.label) {
            var srcSpan = el("span", "qsrc");
            appendRich(srcSpan, q.source.label);
            judge.appendChild(srcSpan);
          }
          if ((q.answerStatus === 'doubt')) judge.appendChild(el("span", "qsrc", "⚠️ 存疑题（?）——答案待老师讲评，仅供核对。"));
          if (q.explanation) {
            var expBox = document.createElement("details");
            expBox.className = "qexp";
            expBox.appendChild(el("summary", undefined, "解析"));
            appendRich(expBox, q.explanation);
            judge.appendChild(expBox);
          }
           if (supp) renderTeaching(item, container, supp, pickedLetters, q.answer.slice());
           paintSubjective();
           finalizeCompareRefs(container);
           if (opts.onJudge && !restoring) opts.onJudge(q, right);
           updateScore(!restoring);
           syncLessonProgress();
         }

        q.options.forEach(function (op) {
          var b = el("button", "opt");
          b.setAttribute("data-letter", op.value);
          b.setAttribute("aria-pressed", "false");
          b.appendChild(el("span", "letter", op.value + "."));
          b.appendChild(document.createTextNode(String(op.text == null ? "" : op.text)));
          b.addEventListener("click", function () {
            if (locked) return;
            if (!q.answer.length) {
              picked[op.value] = true;
              b.setAttribute('aria-pressed', 'true');
              finishPick(false);
              return;
            }
            if (multi) {
              picked[op.value] = !picked[op.value];
              b.classList.toggle("picked", !!picked[op.value]);
              b.setAttribute('aria-pressed', String(!!picked[op.value]));
              savePick(false);
            } else {
              picked[op.value] = true;
              b.setAttribute('aria-pressed', 'true');
              finishPick(false);
            }
          });
          optsBox.appendChild(b);
        });

        item.appendChild(optsBox);
        if (multi && q.answer.length) {
          var confirmBtn = el("button", "btn small confirm", "确认答案");
          confirmBtn.addEventListener("click", function () { finishPick(false); });
          item.appendChild(confirmBtn);
        }
        item.appendChild(judge);
        paintSubjective();
        box.appendChild(item);
        if (previous && Array.isArray(previous.picked)) {
          previous.picked.forEach(function (letter) {
            if (!q.options.some(function (op) { return op.value === letter; })) return;
            picked[letter] = true;
            var button = Array.prototype.find.call(optsBox.children, function (b) { return b.getAttribute('data-letter') === letter; });
            if (button) { button.classList.add('picked'); button.setAttribute('aria-pressed', 'true'); }
          });
          if (previous.done) finishPick(true);
        }
      });
      // 对比自测目标不在本组（或在别页）时隐藏按钮，避免点了没反应。
      finalizeCompareRefs(container);

      var score = el("div", "quiz-score");
      box.appendChild(score);
      var redo = el("button", "btn", "↺ 重做本组测验");
      redo.addEventListener("click", restart);
      score.appendChild(redo);
       container.appendChild(box);
       updateScore();
       syncLessonProgress();
     }

     function syncLessonProgress() {
       if (!lessonId || !state) return;
       var complete = state.total > 0 && state.answered === state.total;
       var allCorrect = complete && !state.reviewNeeded && state.unassessed === 0 && state.correct === state.total;
       progress.update(lessonId, {
         quizTotal: state.total,
         quizRoundTotal: state.total,
         quizAnswered: state.answered,
         quizCorrect: state.correct,
         quizComplete: complete,
         exerciseComplete: complete,
         quizAllCorrect: allCorrect,
         quizReviewNeeded: state.reviewNeeded,
         reviewNeeded: state.reviewNeeded,
         exerciseStatus: complete ? 'exercise-complete' : 'in-progress',
         status: complete ? 'exercise-complete' : 'in-progress'
       });
     }

    function updateScore(allowPersist) {
      var score = container.querySelector(".quiz-score");
      if (!score) return;
      var judged = Array.prototype.filter.call(
        container.querySelectorAll(".q-judge"),
        function (j) { return j.className.indexOf("ok") >= 0 || j.className.indexOf("no") >= 0; }
      ).length;
      var correct = Array.prototype.filter.call(
        container.querySelectorAll(".q-judge"),
        function (j) { return j.className.indexOf("ok") >= 0; }
      ).length;
      var gradable = questions.filter(function (q) { return q.answer.length && !(q.answerStatus === 'doubt'); }).length;
      var unassessedTotal = state.total - gradable;
      var old = lessonId ? progress.get(lessonId).best || 0 : 0;
      var pct = gradable ? Math.round((correct / gradable) * 100) : 0;
      var finalPct = gradable > 0 && judged === gradable ? pct : null;

      clear(score);
      var progressLine = el("span");
      progressLine.appendChild(document.createTextNode("已答 "));
      progressLine.appendChild(el("b", undefined, String(state.answered)));
      progressLine.appendChild(document.createTextNode(" / " + state.total + " · 已判 " + judged + " · 答对 "));
      progressLine.appendChild(el("b", undefined, String(correct)));
      score.appendChild(progressLine);
      if (finalPct !== null) {
        score.appendChild(el("span", "big", finalPct + "分（可判分题）"));
        score.appendChild(el("span", undefined,
          finalPct === 100 ? "满分，漂亮！"
            : finalPct >= 80 ? "不错，错题已进错题本。"
              : "建议回到正文重读后重做；错题已进错题本。"));
      } else {
        score.appendChild(el("span", undefined,
          gradable ? "做完可判分题目后计分" : "本组暂不自动计分，仅供核对"));
      }
      if (unassessedTotal > 0) score.appendChild(el("span", undefined, "另有 " + unassessedTotal + " 题无答案或存疑，不计入分数。"));

      var redo = el('button', 'btn quiz-redo', '↺ 重做本组测验（保留历史记录）');
      redo.type = 'button';
      redo.addEventListener('click', restart);
      score.appendChild(redo);
      if (allowPersist && lessonId && finalPct !== null && finalPct > old) {
        progress.update(lessonId, { best: finalPct });
      }
    }

    render();
  }

  /* ---------------- Flashcard session / lifecycle ---------------- */
  var activeCards = null;
  function mountCards(container, cards, opts) {
    opts = opts || {};
    if (container.disposeCards) container.disposeCards();
    var valid = cards.filter(function (c) { return c && c.schemaVersion === 1 && c.id && c.question && c.answer; });
    var disposed = false, painting = false, session = null, renderedId = null, card = null, debug = null;
    var lessonId = typeof opts.srs === 'string' ? opts.srs : null;
    if (lessonId) progress.touch(lessonId);
    clear(container);
    var shell = el('div', 'cards-shell'); shell.tabIndex = 0;
    var status = el('p', 'hint cards-status'); status.setAttribute('role', 'status');
    var stage = el('div', 'card-stage');
    var ctrl = el('div', 'cards-ctrl');
    var prev = el('button', 'btn', '‹ 上一张'), position = el('span', 'pos'), next = el('button', 'btn', '下一张 ›');
    var flip = el('button', 'btn', '翻转 空格'), shuffle = el('button', 'btn', '🔀 洗牌');
    [prev, position, next, flip, shuffle].forEach(function (n) { ctrl.appendChild(n); });
    var grades = el('div', 'grade-row');
    var no = el('button', 'btn no', '✗ 没记住（2）'), yes = el('button', 'btn ok', '✓ 记住了（1）'), boxInfo = el('span', 'boxinfo');
    [no, yes, boxInfo].forEach(function (n) { grades.appendChild(n); });
    var completion = el('div', 'cards-completion'); completion.setAttribute('role', 'status');
    var nextBatch = el('button', 'btn primary', '学习下一组');
    var notice = el('p', 'hint cards-notice'); notice.setAttribute('role', 'alert');
    [status, stage, ctrl, grades, completion, nextBatch, notice].forEach(function (n) { shell.appendChild(n); });
    container.appendChild(shell);
    shell.querySelectorAll('button').forEach(function (b) { b.type = 'button'; });
    var controller = { dispose: dispose, activate: activate, refresh: refresh, getState: function () { return session.view(); } };
    container.disposeCards = dispose;
    container.cardController = controller;
    if (!activeCards) activeCards = controller;
    function activate() { if (!disposed) activeCards = controller; }
    function snapshot(v) {
      return { cardId: v.currentCard ? v.currentCard.id : null, phase: v.phase,
        currentCardIndex: v.currentCardIndex, queueLength: v.queueLength,
        questionLength: v.currentCard ? v.currentCard.question.length : 0,
        answerLength: v.currentCard ? v.currentCard.answer.length : 0,
        flipStart: debug && debug.flipStart || null, flipEnd: debug && debug.flipEnd || null };
    }
    var debugHistory = [];
    function recordDebug(v) {
      debug = snapshot(v);
      container.flashcardDebug = Object.assign({}, debug);
      if (opts.debug || new URLSearchParams(location.search || '').get('debugFlashcards') === '1') {
        debugHistory.push(Object.assign({ at: Date.now() }, debug));
        if (debugHistory.length > 100) debugHistory.shift();
        container.flashcardDebugHistory = debugHistory.slice();
      }
    }
    function draw(v) {
      if (disposed || painting) return;
      painting = true;
      var c = v.currentCard;
      var complete = !c || v.phase === 'batchComplete' || v.phase === 'dailyComplete';
      if ((c && c.id) !== renderedId) {
        clear(stage); renderedId = c && c.id;
        debug = null;
        if (c) {
          card = el('div', 'flashcard');
          var front = el('div', 'face front'), back = el('div', 'face back');
          front.appendChild(el('span', 'label', c.editorialStatus === 'legacy' ? '考点 · 待审校问句' : '问题 · 回忆'));
          if (c.chapter) front.appendChild(el('span', 'ctx', '章节：' + c.chapter));
          var q = el('div', 'q'); appendRich(q, c.question); front.appendChild(q);
          back.appendChild(el('span', 'label', '答案'));
          var a = el('div', 'a'); appendRich(a, c.answer); back.appendChild(a);
          if (c.source && c.source.label) { var src = el('span', 'src'); appendRich(src, '出处：' + c.source.label); back.appendChild(src); }
          card.appendChild(front); card.appendChild(back); stage.appendChild(card);
        } else card = null;
      }
      if (card) {
        card.classList.toggle('flipped', v.face === 'back');
        card.querySelector('.front').setAttribute('aria-hidden', String(v.face === 'back'));
        card.querySelector('.back').setAttribute('aria-hidden', String(v.face !== 'back'));
        boxInfo.textContent = srs.boxOf(c.id) ? '当前第 ' + srs.boxOf(c.id) + ' 盒' : '新卡';
      }
      status.textContent = complete ? '' : '本组 ' + v.batchIds.length + ' 张 · 已完成 ' + (v.batchIds.length - v.remainingIds.length) + ' 张';
      position.textContent = c ? (v.currentCardIndex + 1) + ' / ' + v.remainingIds.length + '（待学）' : '0 / 0';
      stage.hidden = complete; grades.hidden = complete;
      prev.disabled = next.disabled = complete || v.phase === 'saving' || v.remainingIds.length < 2;
      flip.disabled = shuffle.disabled = complete || v.phase === 'saving';
      yes.disabled = no.disabled = complete || v.phase !== 'back';
      flip.setAttribute('aria-pressed', String(v.face === 'back'));
      completion.hidden = !complete;
      completion.textContent = complete ? (v.batchIds.length ? '本组已完成。' : '暂无可学习卡片。') + ' 今日还剩 ' + v.dueCount + ' 张到期卡。' : '';
      nextBatch.hidden = !complete || !v.available;
      nextBatch.disabled = !v.available || v.phase === 'saving';
      notice.textContent = [v.error, v.resumeWarning, valid.length !== cards.length ? '部分卡片资料不完整，已跳过并保留原学习记录。' : ''].filter(Boolean).join(' ');
      recordDebug(v);
      painting = false;
      if (opts.onChange) opts.onChange(v);
    }
    var store;
    try { store = zhixuSessionStorage(); } catch (e) { store = { getItem: function () { return null; }, setItem: function () { throw e; } }; }
    session = window.PoliticsSession.createCardSession({ cards: valid, srs: srs, mode: opts.mode || 'lesson',
      limit: opts.limit || Math.min(30, Math.max(1, valid.length)), storage: store,
      key: opts.sessionKey || 'zzkk:flash-session:v1:' + location.pathname + ':' + (container.id || lessonId || 'cards'),
      day: today(), getDay: today, onChange: draw });
    function doFlip() {
      activate();
      var before = session.view();
      if (!before.currentCard || !['front', 'back'].includes(before.phase)) return;
      debug = snapshot(before); debug.flipStart = Date.now(); debug.flipEnd = null;
      session.flip();
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        debug.flipEnd = Date.now(); recordDebug(session.view());
      }
    }
    function transitionEnd(e) {
      if (!card || e.target !== card || e.propertyName !== 'transform') return;
      if (debug) debug.flipEnd = Date.now(); recordDebug(session.view());
    }
    function grade(ok) {
      activate();
      var c = session.view().currentCard;
      if (session.grade(ok, c && c.id) && lessonId) {
        var p = progress.get(lessonId);
        progress.update(lessonId, { cardsReviewed: numberOrZero(p.cardsReviewed) + 1,
          cardsGood: numberOrZero(p.cardsGood) + (ok ? 1 : 0), cardsBad: numberOrZero(p.cardsBad) + (ok ? 0 : 1),
          cardsReviewNeeded: p.cardsReviewNeeded === true || !ok, manualActivity: true });
      }
    }
    function onKey(e) {
      if (disposed || activeCards !== controller || !container.isConnected || e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      var target = e.target || document.activeElement;
      if (target && target.closest && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])')) return;
      var rect = container.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      if (e.code === 'Space') { e.preventDefault(); doFlip(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); session.move(e.code === 'ArrowLeft' ? -1 : 1); }
      else if (e.key === '1' || e.key === '2') { e.preventDefault(); grade(e.key === '1'); }
    }
    function refresh() { if (!disposed && session && session.view().phase !== 'saving') session.refresh(); }
    function storageChange(e) { if (!e.key || e.key.indexOf('zzkk:v2:card:') === 0) refresh(); }
    function visibilityChange() { if (document.visibilityState === 'visible') refresh(); }
    // A page kept in the browser back/forward cache retains its DOM and listeners.
    function pageHide(e) { if (!e.persisted) dispose(); }
    function pageShow(e) { if (e.persisted) refresh(); }
    function dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('zzkk:srs', refresh);
      document.removeEventListener('visibilitychange', visibilityChange);
      window.removeEventListener('storage', storageChange);
      window.removeEventListener('zhixu:cloud-records', refresh);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      observer && observer.disconnect();
      if (activeCards === controller) activeCards = null;
      if (container.disposeCards === dispose) { delete container.disposeCards; delete container.cardController; }
    }
    var observer = typeof MutationObserver === 'function' ? new MutationObserver(function () { if (!container.isConnected) dispose(); }) : null;
    if (observer) observer.observe(document.documentElement, { childList: true, subtree: true });
    shell.addEventListener('pointerdown', activate); shell.addEventListener('focusin', activate);
    stage.addEventListener('click', doFlip); stage.addEventListener('transitionend', transitionEnd);
    flip.addEventListener('click', doFlip);
    prev.addEventListener('click', function () { activate(); session.move(-1); });
    next.addEventListener('click', function () { activate(); session.move(1); });
    shuffle.addEventListener('click', function () { activate(); session.shuffle(); });
    no.addEventListener('click', function () { grade(false); }); yes.addEventListener('click', function () { grade(true); });
    nextBatch.addEventListener('click', function () { activate(); session.nextBatch(); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('zzkk:srs', refresh);
    document.addEventListener('visibilitychange', visibilityChange);
    window.addEventListener('storage', storageChange);
    window.addEventListener('zhixu:cloud-records', refresh);
    window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow);
    controller.start = function (mode) { session.nextBatch(mode); };
    draw(session.view());
    return controller;
  }

  function mountDue(container, allCards) {
    if (container.disposeDue) container.disposeDue();
    clear(container);
    var raw = new URLSearchParams(location.search || '').get('limit');
    var limit = raw && /^\d+$/.test(raw) ? Math.max(1, Math.min(30, Number(raw))) : 10;
    var ids = allCards.filter(function (c) { return c && c.id; }).map(function (c) { return c.id; });
    var head = el('div', 'due-head'), area = el('div');
    area.id = 'daily-card-session';
    var modes = el('div', 'cards-ctrl');
    var due = el('button', 'btn', '复习到期卡'), fresh = el('button', 'btn', '学习新卡'), extra = el('button', 'btn', '随机加练');
    [due, fresh, extra].forEach(function (b) { b.type = 'button'; modes.appendChild(b); });
    container.appendChild(head); container.appendChild(area); container.appendChild(modes);
    function counts(v) {
      head.textContent = '已学到期 ' + v.dueCount + ' 张 · 未学余量 ' + v.newCount + ' 张 · 总卡量 ' + v.total + ' 张 · 本组上限 ' + limit + ' 张';
      due.disabled = v.phase === 'saving' || !v.dueCount;
      fresh.disabled = v.phase === 'saving' || !v.newCount;
      extra.disabled = v.phase === 'saving';
    }
    var ctrl = mountCards(area, allCards, { srs: true, mode: srs.dueIds(ids).length ? 'due' : 'new', limit: limit,
      sessionKey: 'zzkk:flash-session:v1:daily:' + location.pathname + ':' + limit, onChange: counts });
    due.addEventListener('click', function () { ctrl.start('due'); });
    fresh.addEventListener('click', function () { ctrl.start('new'); });
    extra.addEventListener('click', function () { ctrl.start('extra'); });
    container.disposeDue = ctrl.dispose;
    return ctrl;
  }

  /* ---------------- 标记已学 ---------------- */
  function mountDone(button, lessonId) {
    function paint() {
      var record = progress.get(lessonId);
      var done = record.manualDone === true || record.done === true;
      button.className = "btn" + (done ? " done" : " primary");
      button.textContent = done ? "✓ 已学（点击取消）" : "✓ 标记本章已学";
    }
    button.addEventListener("click", function () {
      var record = progress.get(lessonId);
      var done = record.manualDone === true || record.done === true;
      progress.update(lessonId, { done: !done, manualDone: !done, manualActivity: true });
      paint();
    });
    paint();
  }

  /* ---------------- 混合测试（复习页用） ---------------- */
  function mountReview(container, bank) {
    var hasGroups = bank.some(function (q) { return q.grp; });
    var controls = el("div", "cards-ctrl");
    controls.style.margin = "0 0 1.2rem";
    var selCourse = el("select", "btn");
    [{ v: "all", t: "全部科目" }, { v: "毛中特", t: "仅 毛中特" }, { v: "习概", t: "仅 习概" }]
      .forEach(function (o) {
        var op = document.createElement("option");
        op.value = o.v; op.textContent = o.t; selCourse.appendChild(op);
      });
    var selSrc = el("select", "btn");
    if (hasGroups) {
      [{ v: "all", t: "全部来源" }, { v: "章末", t: "仅 章末自测" }, { v: "题库", t: "仅 题库卷" }]
        .forEach(function (o) {
          var op = document.createElement("option");
          op.value = o.v; op.textContent = o.t; selSrc.appendChild(op);
        });
    }
    var selN = el("select", "btn");
    [5, 10, 15, 20].forEach(function (n) {
      var op = document.createElement("option");
      op.value = n; op.textContent = n + " 题"; if (n === 10) op.selected = true;
      selN.appendChild(op);
    });
    var go = el("button", "btn primary", "🎲 开始一轮混合测试");
    controls.appendChild(selCourse);
    if (hasGroups) controls.appendChild(selSrc);
    controls.appendChild(selN); controls.appendChild(go);
    container.appendChild(controls);

    var area = el("div");
    container.appendChild(area);

    go.addEventListener("click", function () {
      var course = selCourse.value;
      var src = selSrc.value || "all";
      var n = parseInt(selN.value, 10);
      var pool = bank.filter(function (q) {
        return (course === "all" || q.source.course === course) &&
               (src === "all" || q.grp === src || !q.grp);
      });
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      var picked = pool.slice(0, Math.min(n, pool.length));
      clear(area);
      var head = el("p", "hint", "本轮 " + picked.length + " 题，来自不同章节混合抽题。做完自动计分，错题自动进错题本。");
      area.appendChild(head);
      var mount = el("div");
      area.appendChild(mount);
      mountQuiz(mount, picked, { lessonId: "review:" + course, from: "混合测试" });
    });
  }

  window.ZQ = {
    config: { examDate: EXAM_DATE },
    lessonStatus: LESSON_STATUS,
    progress: progress,
    srs: srs,
    wrong: wrong,
    hash: hash,
    esc: esc,
    escRich: escRich,
    mountQuiz: mountQuiz,
    mountCards: mountCards,
    mountDue: mountDue,
    mountDone: mountDone,
    mountReview: mountReview
  };
})();
