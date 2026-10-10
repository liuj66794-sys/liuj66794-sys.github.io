function zhixuStorage() { return globalThis.ZhixuStudyStorage || localStorage; }
function zhixuSessionStorage() { return globalThis.ZhixuStudySessionStorage || sessionStorage; }
/* 网站镜像使用的高数互动运行时；sync-prep 覆盖镜像，不修改知识库源。
 * 在课程原组件基础上增加逐题续学；旧 zc-progress-v1 累计记录继续保留。
 *
 * 用法：
 * 1. 选择题
 *    <div class="quiz" data-answer="B">
 *      <span class="quiz-no">随堂测 1</span>
 *      <p class="quiz-q">题干……</p>
 *      <div class="quiz-opts">
 *        <button data-k="A">选项A</button> …
 *      </div>
 *      <div class="quiz-verdict"></div>
 *      <div class="quiz-exp">解析（答对后显示）</div>
 *    </div>
 * 2. 回忆卡
 *    <div class="recall">
 *      <span class="recall-tag">回忆卡</span>
 *      <p class="recall-q">先回忆……</p>
 *      <div class="recall-a">答案</div>
 *      <div class="recall-actions">
 *        <button class="reveal-btn">先回忆，再揭晓</button>
 *        <button class="good-btn">记住了</button>
 *        <button class="bad-btn">没记住</button>
 *      </div>
 *      <div class="self-msg"></div>
 *    </div>
 * 3. 进度条（可选）
 *    <div class="lesson-progress" data-total-quiz="4" data-total-recall="3"></div>
 * 4. 页面 body 标记 <body data-lesson-id="0001">，进度按此记录。
 */
(function () {
  'use strict';

  window.ZC = window.ZC || {};

  var STORE_KEY = 'zc-progress-v1';
  var LESSON_ID = (document.body && document.body.dataset.lessonId) ||
    (location.pathname.split('/').pop() || 'index');
  var ITEMS_KEY = 'zc-progress-items-v1:' + LESSON_ID;
  var itemsCache = null;

  function loadAll() {
    try { return JSON.parse(zhixuStorage().getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveAll(d) {
    try { zhixuStorage().setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* 隐私模式等 */ }
  }
  function rec() {
    var d = loadAll();
    if (!d[LESSON_ID]) d[LESSON_ID] = { visits: 0, quizRight: 0, quizTotal: 0, recallOk: 0, recallNo: 0 };
    return d[LESSON_ID];
  }
  function commit(r) {
    var d = loadAll();
    d[LESSON_ID] = r;
    saveAll(d);
    ZC.refreshProgress();
    document.dispatchEvent(new CustomEvent('zc-progress'));
  }

  /*
   * 进度口径：zc-progress-v1 里的 quizTotal/quizRight/recallOk/recallNo
   * 是旧版本的跨轮累计，不能拿来判断当前课是否完成。当前轮次从带题号的
   * zc-progress-items-v1 计算，并将可解释的快照以附加字段写回旧记录。
   * 这些字段都是加法迁移，旧记录中的未知字段会原样保留。
   */
  var STATUS_LABELS = {
    'not-started': '未开始',
    'in-progress': '学习中',
    'exercise-complete': '已完成练习'
  };

  function attemptsOf(state) {
    return state && Array.isArray(state.attempts) ? state.attempts : [];
  }

  function recordHasActivity(record) {
    return !!(record && (
      Number(record.visits) > 0 || Number(record.quizAnswered) > 0 ||
      Number(record.recallAnswered) > 0 || Number(record.quizTotal) > 0 ||
      Number(record.recallOk) > 0 || Number(record.recallNo) > 0 ||
      record.manualActivity
    ));
  }

  function recordStatus(record) {
    if (!recordHasActivity(record)) return 'not-started';
    return record.exerciseComplete === true ? 'exercise-complete' : 'in-progress';
  }

  function currentSummary() {
    var record = rec();
    var items = readItems();
    var quizzes = Array.from(document.querySelectorAll('.quiz'));
    var recalls = Array.from(document.querySelectorAll('.recall'));
    var quizAnswered = 0;
    var quizCorrect = 0;
    var quizFirstTryCorrect = 0;
    var quizReviewNeeded = false;
    var recallAnswered = 0;
    var recallGood = 0;
    var recallBad = 0;
    var recallReviewNeeded = false;

    quizzes.forEach(function (quiz) {
      var state = items.quiz[quiz.dataset.progressId];
      var attempts = attemptsOf(state);
      var answer = quiz.dataset.answer || '';
      var hasWrong = attempts.some(function (picked) { return picked !== answer; });
      if (hasWrong) quizReviewNeeded = true;
      if (state && state.done) {
        quizAnswered++;
        quizCorrect++;
        if (attempts.length === 1) quizFirstTryCorrect++;
      }
    });
    recalls.forEach(function (card) {
      var state = items.recall[card.dataset.progressId];
      if (!state || !state.vote) return;
      recallAnswered++;
      if (state.vote === 'good') recallGood++;
      else {
        recallBad++;
        recallReviewNeeded = true;
      }
    });

    var quizTotal = quizzes.length;
    var recallTotal = recalls.length;
    /* 主站进度将题目与回忆卡的已完成项合并计数；掌握证据仍单独保留。 */
    var total = quizTotal + recallTotal;
    var answered = quizAnswered + recallAnswered;
    var correct = quizCorrect + recallGood;
    var exerciseComplete = total > 0 && answered === total;
    var allCorrect = quizTotal > 0 && exerciseComplete && !quizReviewNeeded &&
      !recallReviewNeeded && quizCorrect === quizTotal && recallGood === recallTotal;
    var reviewNeeded = quizReviewNeeded || recallReviewNeeded;
    var status = exerciseComplete ? 'exercise-complete' : recordStatus(record);
    return {
      lessonId: LESSON_ID,
      status: status,
      statusLabel: STATUS_LABELS[status],
      quizTotal: quizTotal,
      quizAnswered: quizAnswered,
      quizCorrect: quizCorrect,
      quizFirstTryCorrect: quizFirstTryCorrect,
      quizReviewNeeded: quizReviewNeeded,
      recallTotal: recallTotal,
      recallAnswered: recallAnswered,
      recallGood: recallGood,
      recallBad: recallBad,
      total: total,
      answered: answered,
      correct: correct,
      exerciseComplete: exerciseComplete,
      allCorrect: allCorrect,
      reviewNeeded: reviewNeeded,
      recallReviewNeeded: recallReviewNeeded,
      mastery: exerciseComplete ? (allCorrect ? 'verified' : 'needs-review') : 'unassessed',
      visits: Number(record.visits) || 0,
      legacy: {
        quizRight: Number(record.quizRight) || 0,
        quizTotal: Number(record.quizTotal) || 0,
        recallOk: Number(record.recallOk) || 0,
        recallNo: Number(record.recallNo) || 0
      }
    };
  }

  function persistSummary(summary) {
    var d = loadAll();
    var record = d[LESSON_ID];
    if (!record || typeof record !== 'object') record = {};
    var fields = {
      status: summary.status,
      exerciseStatus: summary.status,
      exerciseComplete: summary.exerciseComplete,
      allCorrect: summary.allCorrect,
      mastery: summary.mastery,
      quizRoundTotal: summary.quizTotal,
      quizAnswered: summary.quizAnswered,
      quizCorrect: summary.quizCorrect,
      quizFirstTryCorrect: summary.quizFirstTryCorrect,
      quizReviewNeeded: summary.quizReviewNeeded,
      recallRoundTotal: summary.recallTotal,
      recallAnswered: summary.recallAnswered,
      recallGood: summary.recallGood,
      recallBad: summary.recallBad,
      answered: summary.answered,
      correct: summary.correct,
      reviewNeeded: summary.reviewNeeded
    };
    var changed = false;
    Object.keys(fields).forEach(function (key) {
      if (record[key] !== fields[key]) {
        record[key] = fields[key];
        changed = true;
      }
    });
    if (changed) {
      d[LESSON_ID] = record;
      saveAll(d);
    }
  }

  // 旧累计没有题号，单独保存为历史，不能反推哪些题已经作答。
  function freshItems() {
    var old = rec();
    return { quiz: {}, recall: {}, legacy: {
      quizRight: old.quizRight || 0, quizTotal: old.quizTotal || 0,
      recallOk: old.recallOk || 0, recallNo: old.recallNo || 0
    } };
  }
  function readItems() {
    try {
      var raw = zhixuStorage().getItem(ITEMS_KEY);
      // A successful null read means deleted/reset, not a storage failure.
      if (raw === null) itemsCache = null;
      var saved = JSON.parse(raw);
      if (saved && saved.quiz && saved.recall && saved.legacy) itemsCache = saved;
    } catch (e) { /* 存储不可用时，本页仍可练习 */ }
    return itemsCache || (itemsCache = freshItems());
  }
  function saveItems(items) {
    itemsCache = items;
    try { zhixuStorage().setItem(ITEMS_KEY, JSON.stringify(items)); } catch (e) {}
  }
  // 同时兼容 KaTeX 渲染前后的 DOM，题干或选项变化后不套用旧题答案。
  function itemText(node) {
    if (!node) return '';
    var copy = node.cloneNode(true);
    copy.querySelectorAll('.katex').forEach(function (math) {
      var tex = math.querySelector('annotation');
      if (tex) math.replaceWith(document.createTextNode(tex.textContent));
    });
    return copy.textContent.replace(/\$/g, '').replace(/\\[()[\]]/g, '').replace(/\s+/g, '');
  }
  function itemId(node, index, selector, options) {
    var text = itemText(node.querySelector(selector)) + '|' + (node.dataset.answer || '');
    (options || []).forEach(function (option) { text += '|' + itemText(option); });
    var hash = 5381;
    for (var i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return index + '-' + hash.toString(36);
  }

  /* 标记访问（每次会话只记一次） */
  function markVisit() {
    try {
      if (!zhixuSessionStorage().getItem('zc-visited-' + LESSON_ID)) {
        zhixuSessionStorage().setItem('zc-visited-' + LESSON_ID, '1');
        var r = rec();
        r.visits = (r.visits || 0) + 1;
        commit(r);
      }
    } catch (e) { /* sessionStorage 不可用则跳过 */ }
  }

  /* ---------- 选择题 ---------- */
  function setupQuiz(quiz, index) {
    var answer = quiz.dataset.answer;
    var opts = quiz.querySelectorAll('.quiz-opts button');
    var verdict = quiz.querySelector('.quiz-verdict');
    var id = itemId(quiz, index, '.quiz-q', opts);
    quiz.dataset.progressId = id;
    quiz.studyQuestion = { slug: 'zsb-math', lessonId: LESSON_ID, ref: 'quiz:' + id, answer: [answer] };
    quiz.addEventListener('study-retry', function () { var items = readItems(); delete items.quiz[id]; saveItems(items); restore(); ZC.refreshProgress(); });
    if (verdict) verdict.setAttribute('role', 'status');

    function restore(state) {
      state = state || { attempts: [] };
      var attempts = attemptsOf(state);
      var hasWrong = attempts.some(function (picked) { return picked !== answer; });
      quiz.classList.toggle('done', !!state.done);
      quiz.classList.toggle('needs-review', hasWrong);
      quiz.dataset.answered = state.done ? '1' : '0';
      quiz.dataset.correct = state.done ? '1' : '0';
      quiz.dataset.firstTryCorrect = state.done && attempts.length === 1 ? '1' : '0';
      quiz.dataset.reviewNeeded = hasWrong ? '1' : '0';
      opts.forEach(function (button) {
        button.disabled = !!state.done;
        button.setAttribute('aria-pressed', String(attempts.includes(button.dataset.k)));
        button.classList.toggle('correct', !!state.done && button.dataset.k === answer);
        button.classList.toggle('wrong', attempts.includes(button.dataset.k) && button.dataset.k !== answer);
      });
      if (verdict && attempts.length) {
        verdict.textContent = state.done
          ? (attempts.length === 1 ? '✓ 一次答对，漂亮！' : '✓ 答对了（第一次选错了，别急，看清错在哪）')
          : '✗ 再想想——先别急着看解析。';
        verdict.className = 'quiz-verdict ' + (state.done ? 'ok' : 'no');
      } else if (verdict) { verdict.textContent = ''; verdict.className = 'quiz-verdict'; }
    }
    restore(readItems().quiz[id]);
    quiz.refreshStudyAnswer = function () { restore(readItems().quiz[id]); };

      opts.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var items = readItems();
          var state = items.quiz[id] || { attempts: [], done: false };
          if (!Array.isArray(state.attempts)) state.attempts = [];
          if (state.done || state.attempts.includes(btn.dataset.k)) { restore(state); return; }
          var k = btn.dataset.k;
          state.attempts.push(k);
        state.done = k === answer;
          items.quiz[id] = state;
          saveItems(items);
          restore(state);
          document.dispatchEvent(new CustomEvent('study:attempt', { detail: { node: quiz, correct: k === answer, independent: state.attempts.length === 1 } }));
          if (k === answer) {
          /* 一个练习轮次每题只结算一次；返回课程恢复题目，不重复累计。 */
          var r = rec();
          r.quizTotal = (r.quizTotal || 0) + 1;
            if (state.attempts.length === 1) r.quizRight = (r.quizRight || 0) + 1;
            commit(r);
          } else ZC.refreshProgress();
        });
      });
  }

  /* ---------- 回忆卡 ---------- */
  function setupRecall(card, index) {
    var reveal = card.querySelector('.reveal-btn');
    var good = card.querySelector('.good-btn');
    var bad = card.querySelector('.bad-btn');
    var msg = card.querySelector('.self-msg');
    var id = itemId(card, index, '.recall-q');
    card.dataset.progressId = id;
    card.studyQuestion = { slug: 'zsb-math', lessonId: LESSON_ID, ref: 'recall:' + id, kind: 'recall', answer: [] };
    card.addEventListener('study-retry', function () { var items = readItems(); delete items.recall[id]; saveItems(items); restore(); ZC.refreshProgress(); });
    if (msg) msg.setAttribute('role', 'status');

    function restore(state) {
      state = state || {};
      card.classList.toggle('shown', !!state.shown);
      card.classList.toggle('voted-good', state.vote === 'good');
      card.classList.toggle('voted-bad', state.vote === 'bad');
      card.classList.toggle('needs-review', state.vote === 'bad');
      card.dataset.answered = state.vote ? '1' : '0';
      card.dataset.correct = state.vote === 'good' ? '1' : '0';
      card.dataset.reviewNeeded = state.vote === 'bad' ? '1' : '0';
      if (good) good.disabled = !!state.vote;
      if (bad) bad.disabled = !!state.vote;
      if (msg && !state.vote) msg.textContent = '';
      if (msg && state.vote) msg.textContent = state.vote === 'good'
        ? '已记录。隔天和一周后回来再测这张卡。'
        : '已记录——“没记住”的卡才是最值得练的。建议现在重读一遍，明天再来。';
    }
    function update(vote) {
      var items = readItems();
      var state = items.recall[id] || {};
      if (vote && state.vote) { restore(state); return; }
      state.shown = true;
      if (vote) state.vote = vote;
      items.recall[id] = state;
      saveItems(items);
      restore(state);
      if (vote) {
        document.dispatchEvent(new CustomEvent('study:attempt', { detail: { node: card, correct: vote === 'good', independent: true } }));
        var r = rec();
        var field = vote === 'good' ? 'recallOk' : 'recallNo';
        r[field] = (r[field] || 0) + 1;
        commit(r);
      } else ZC.refreshProgress();
    }
    restore(readItems().recall[id]);
    card.refreshStudyAnswer = function () { restore(readItems().recall[id]); };

    if (reveal) reveal.addEventListener('click', function () {
      update();
      if (window.ZC.renderMath) ZC.renderMath(card);
    });
    if (good) good.addEventListener('click', function () {
      update('good');
    });
    if (bad) bad.addEventListener('click', function () {
      update('bad');
    });
  }

  /* ---------- 本课进度条 ---------- */
  function setupProgress(bar) {
    bar.dataset.totalQuiz = bar.dataset.totalQuiz ||
      String(document.querySelectorAll('.quiz').length);
    bar.dataset.totalRecall = bar.dataset.totalRecall ||
      String(document.querySelectorAll('.recall').length);
    var restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'lesson-restart';
    restart.textContent = '重新练习本课（保留累计记录）';
    restart.style.cssText = 'display:block;min-height:44px;margin:0 0 1rem;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--accent);font:inherit;cursor:pointer';
    restart.addEventListener('click', function () {
      saveItems(freshItems());
      location.reload();
    });
    bar.insertAdjacentElement('afterend', restart);
    ZC.refreshProgress();
  }

  ZC.refreshProgress = function () {
    var summary = currentSummary();
    persistSummary(summary);
    document.querySelectorAll('.lesson-progress').forEach(function (bar) {
      var items = readItems();
      var tq = parseInt(bar.dataset.totalQuiz || '0', 10);
      var tr = parseInt(bar.dataset.totalRecall || '0', 10);
      bar.dataset.status = summary.status;
      bar.dataset.exerciseStatus = summary.status;
      bar.dataset.answered = String(summary.answered);
      bar.dataset.correct = String(summary.correct);
      bar.dataset.reviewNeeded = summary.reviewNeeded ? '1' : '0';
      bar.dataset.exerciseComplete = summary.exerciseComplete ? '1' : '0';
      bar.dataset.allCorrect = summary.allCorrect ? '1' : '0';
      var parts = [];
      var quizzes = Array.from(document.querySelectorAll('.quiz')).map(function (q) { return items.quiz[q.dataset.progressId]; });
      var recalls = Array.from(document.querySelectorAll('.recall')).map(function (card) { return items.recall[card.dataset.progressId]; });
      if (tq > 0) parts.push('本轮随堂测 ' + quizzes.filter(function (q) { return q && q.done; }).length + '/' + tq + ' 已完成（首次答对 ' + quizzes.filter(function (q) { return q && q.done && attemptsOf(q).length === 1; }).length + '）');
      if (tr > 0) parts.push('回忆卡 ' + recalls.filter(function (card) { return card && card.vote; }).length + '/' + tr + ' 已测');
      if (summary.reviewNeeded) parts.push('待巩固：有答错或没记住的项目');
      parts.unshift('状态：' + summary.statusLabel);
      var legacy = items.legacy;
      if (legacy.quizTotal || legacy.recallOk || legacy.recallNo) parts.push('历史累计：随堂测 ' + legacy.quizTotal + ' 次，首次答对 ' + legacy.quizRight + ' 次；回忆卡 ' + (legacy.recallOk + legacy.recallNo) + ' 次');
      if (parts.length) bar.textContent = '📊 ' + parts.join(' · ');
    });
  };

  /* 当前课的机器可读快照，供统一学习状态适配层使用。 */
  ZC.getLessonSummary = function () { return currentSummary(); };
  ZC.summary = ZC.getLessonSummary;

  /* ---------- 首页课程地图（可选） ---------- */
  ZC.decorateIndex = function () {
    var d = loadAll();
    document.querySelectorAll('a[data-lesson]').forEach(function (a) {
      var id = a.dataset.lesson;
      var li = a.closest('li');
      if (!li) return;
      var st = li.querySelector('.status');
      var r = d[id];
      var status = recordStatus(r);
      var active = status !== 'not-started';
      var exerciseComplete = status === 'exercise-complete';
      a.classList.toggle('visited', active);
      a.classList.toggle('in-progress', status === 'in-progress');
      a.classList.toggle('exercise-complete', exerciseComplete);
      if (st) {
        var bits = [STATUS_LABELS[status]];
        if (exerciseComplete && r.reviewNeeded) bits.push('待巩固');
        if (r && r.quizRoundTotal) bits.push('测 ' + (r.quizAnswered || 0) + '/' + r.quizRoundTotal);
        if (r && r.recallRoundTotal) bits.push('卡 ' + (r.recallAnswered || 0) + '/' + r.recallRoundTotal);
        if (r && ((r.quizTotal || 0) || (r.recallOk || 0) || (r.recallNo || 0))) {
          bits.push('历史累计：测 ' + (r.quizRight || 0) + '/' + (r.quizTotal || 0));
        }
        st.textContent = bits.join(' · ');
        st.className = 'status ' + status + (active ? ' visited' : '');
      }
    });
  };

  function init() {
    markVisit();
    document.querySelectorAll('.quiz').forEach(setupQuiz);
    document.querySelectorAll('.recall').forEach(setupRecall);
    document.querySelectorAll('.lesson-progress').forEach(setupProgress);
    if (document.body.dataset.indexPage === '1') ZC.decorateIndex();
    function refreshStoredAnswers(event) {
      if (event.type === 'storage' && event.key !== null && event.key !== ITEMS_KEY && event.key !== 'zc-progress-v1') return;
      itemsCache = null;
      document.querySelectorAll('.quiz').forEach(function (node) { if (node.refreshStudyAnswer) node.refreshStudyAnswer(); });
      document.querySelectorAll('.recall').forEach(function (node) { if (node.refreshStudyAnswer) node.refreshStudyAnswer(); });
      ZC.refreshProgress();
    }
    if (window.addEventListener) {
      window.addEventListener('storage', refreshStoredAnswers);
      window.addEventListener('pageshow', refreshStoredAnswers);
      window.addEventListener('zhixu:cloud-records', refreshStoredAnswers);
      window.addEventListener('l1uj:backup-imported', refreshStoredAnswers);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
