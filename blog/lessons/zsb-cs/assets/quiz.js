function zhixuStorage() { return globalThis.ZhixuStudyStorage || localStorage; }
function zhixuSessionStorage() { return globalThis.ZhixuStudySessionStorage || sessionStorage; }
/* Computer-science quiz: retain two-attempt feedback and the existing mistakes store.
   Restoring a round only paints its choices; it never records another wrong attempt. */
(function () {
  var STORE = 'zsb-mistakes-v1';
  var ROUND = 'l1uj-cs-answers-v1:' + location.pathname;
  var unsaved = {};
  function read(key) {
    if (Object.prototype.hasOwnProperty.call(unsaved, key)) return unsaved[key];
    try {
      var value = JSON.parse(zhixuStorage().getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) { return {}; }
  }
  function write(key, data) {
    try { zhixuStorage().setItem(key, JSON.stringify(data)); delete unsaved[key]; }
    catch (e) { unsaved[key] = data; }
  }
  document.addEventListener('DOMContentLoaded', function () {
    var match = location.pathname.match(/(\d{4})[^/]*\.html$/);
    var lid = match ? match[1] : null;
    var all = read(STORE);
    var rec = lid ? (all[lid] || (all[lid] = {})) : {};
    var round = read(ROUND);
    var quizzes = Array.prototype.slice.call(document.querySelectorAll('.quiz[data-answer]'));
    var restoreQuestions = [];
    var wrongThisRound = 0;
    var panel;
    function refreshRecords() {
      all = read(STORE);
      rec = lid ? (all[lid] || (all[lid] = {})) : {};
      round = read(ROUND);
      wrongThisRound = 0;
      restoreQuestions.forEach(function (restore) { restore(); });
      summary();
    }
    function summary() {
      if (!panel) return;
      var wrongs = Object.keys(rec).filter(function (key) { return rec[key] && rec[key].wrongs > 0; });
      var unfixed = wrongs.filter(function (key) { return !rec[key].fixed; });
      panel.querySelector('.quiz-log-summary').textContent = '本轮答错 ' + wrongThisRound + ' 次 · 本课历史错题 ' + wrongs.length + ' 道（待订正 ' + unfixed.length + ' 道）';
    }
    quizzes.forEach(function (quiz, index) {
      var qn = index + 1;
      quiz.id = quiz.id || 'q' + qn;
      var answer = quiz.getAttribute('data-answer');
      var title = quiz.querySelector('.quiz-q');
      var feedback = quiz.querySelector('.quiz-feedback');
      var options = Array.prototype.slice.call(quiz.querySelectorAll('.quiz-opts li'));
      var text = title ? title.textContent.trim() : '';
      var signature = JSON.stringify([text, answer, options.map(function (node) { return node.textContent; })]);
      var attempts = [];
      quiz.studyQuestion = { slug: 'zsb-cs', lessonId: lid, ref: 'q:' + qn, answer: [answer] };
      quiz.addEventListener('study-retry', function () { round = read(ROUND); delete round[qn]; write(ROUND, round); refreshRecords(); });
      function flag() {
        var past = rec[qn];
        if (!title) return;
        var badge = title.querySelector('.quiz-flag');
        if (!past || !past.wrongs) { if (badge) badge.remove(); return; }
        if (!badge) { badge = document.createElement('span'); badge.className = 'quiz-flag'; title.appendChild(badge); }
        badge.textContent = (past.fixed ? '已订正 · 曾错 ' : '曾错 ') + past.wrongs + ' 次';
      }
      function choose(picked, restoring) {
        // Read both stores at the action boundary: other lessons share the
        // mistakes store, while other tabs may have reset this practice round.
        if (!restoring) refreshRecords();
        if (quiz.classList.contains('done') || attempts.indexOf(picked) >= 0) return;
        var selected = options.find(function (node) { return node.getAttribute('data-opt') === picked; });
        if (!selected) return;
        attempts.push(picked);
        selected.setAttribute('aria-pressed', 'true');
        selected.setAttribute('aria-disabled', 'true');
        if (picked === answer) {
          quiz.classList.add('done');
          selected.classList.add('correct');
          if (!restoring && rec[qn] && rec[qn].wrongs) { rec[qn].fixed = true; if (lid) write(STORE, all); }
          feedback.textContent = attempts.length === 1 ? '✓ 一次答对' : '✓ 第 ' + attempts.length + ' 次选对，再看一眼解析';
          feedback.className = 'quiz-feedback ok';
        } else {
          wrongThisRound++;
          selected.classList.add('wrong');
          if (!restoring && lid) {
            var item = rec[qn] || (rec[qn] = { wrongs: 0, fixed: false, t: text });
            item.wrongs++; item.fixed = false; write(STORE, all);
          }
          if (attempts.length >= 2) {
            quiz.classList.add('done');
            options.forEach(function (node) { if (node.getAttribute('data-opt') === answer) node.classList.add('correct'); });
            feedback.textContent = '✗ 正确答案是 ' + answer.toUpperCase() + '，请看解析；错题已保留';
          } else feedback.textContent = '✗ 再试一次，已保存这次选择';
          feedback.className = 'quiz-feedback bad';
        }
        if (quiz.classList.contains('done')) options.forEach(function (node) { node.setAttribute('aria-disabled', 'true'); });
        if (!restoring) {
          round[qn] = { signature: signature, attempts: attempts.slice() }; write(ROUND, round);
          document.dispatchEvent(new CustomEvent('study:attempt', { detail: { node: quiz, correct: picked === answer, independent: attempts.length === 1 } }));
        }
        flag(); summary();
      }
      options.forEach(function (node) {
        node.setAttribute('role', 'button'); node.tabIndex = 0;
        node.setAttribute('aria-pressed', 'false');
        node.addEventListener('click', function () { choose(node.getAttribute('data-opt'), false); });
        node.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.getAttribute('data-opt'), false); }
        });
      });
      function restore() {
        attempts = [];
        quiz.classList.remove('done');
        feedback.textContent = '';
        feedback.className = 'quiz-feedback';
        options.forEach(function (node) {
          node.classList.remove('correct', 'wrong');
          node.setAttribute('aria-pressed', 'false');
          node.setAttribute('aria-disabled', 'false');
        });
        var previous = round[qn];
        if (previous && previous.signature === signature && Array.isArray(previous.attempts)) {
          previous.attempts.slice(0, 2).forEach(function (picked) { choose(picked, true); });
        }
        flag();
      }
      restoreQuestions.push(restore);
      restore();
    });
    window.addEventListener('storage', function (event) {
      if (event.key === null || event.key === ROUND || event.key === STORE) refreshRecords();
    });
    window.addEventListener('pageshow', refreshRecords);
    window.addEventListener('zhixu:cloud-records', refreshRecords);
    if (lid && quizzes.length) {
      panel = document.createElement('div'); panel.className = 'quiz-log';
      panel.innerHTML = '<p class="quiz-log-title">本课测验小结</p><p class="quiz-log-summary"></p><p><a href="mistakes.html">统一错题本 →</a></p>';
      var restart = document.createElement('button'); restart.type = 'button'; restart.className = 'btn quiz-redo';
      restart.textContent = '重新练习本课（保留错题记录）';
      restart.addEventListener('click', function () { write(ROUND, {}); location.reload(); });
      panel.appendChild(restart);
      quizzes[quizzes.length - 1].after(panel); summary();
    }
    if (/^#q\d+$/.test(location.hash)) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ block: 'center' });
    }
  });
})();
