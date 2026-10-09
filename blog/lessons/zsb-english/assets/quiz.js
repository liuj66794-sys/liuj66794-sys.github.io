function zhixuStorage() { return globalThis.ZhixuStudyStorage || localStorage; }
function zhixuSessionStorage() { return globalThis.ZhixuStudySessionStorage || sessionStorage; }
/* 专升本英语课程 · 互动组件
   Quiz.render(target, questions) —— 即时反馈选择题
     questions: [{ q: 题干HTML, opts: [选项文本...], a: 正确索引, why: 解析 }]
   Progress.init(lessonId) —— 绑定 #mark-done 按钮，写入 localStorage（course.html 总览读取） */
(function () {
  var DONE_KEY = 'zsb-course-done-';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* 课页注入的教学补充：#teaching-data（或题库页 #teaching-bank）JSON。
     无补充时返回 null，所有反馈保持旧行为。 */
  function readTeachingData() {
    try {
      if (typeof document.getElementById !== 'function') return null;
      var node = document.getElementById('teaching-data') || document.getElementById('teaching-bank');
      if (!node) return null;
      var data = JSON.parse(node.textContent || '{}');
      return data && typeof data === 'object' && data.questions ? data : null;
    } catch (e) { return null; }
  }

  function letterOf(i) { return String.fromCharCode(65 + i); }

  function findCardByRef(root, ref) {
    var cards = typeof root.querySelectorAll === 'function' ? root.querySelectorAll('.qcard') : root.children;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].studyQuestion && cards[i].studyQuestion.ref === ref) return cards[i];
    }
    return null;
  }

  /* 对比自测目标必须在本组才显示按钮。渲染收尾与每次作答后各校验一次：
     恢复历史作答时，后面的题可能还没渲染出来。 */
  function finalizeCompareRefs(root) {
    (root.pendingCompareRefs || []).forEach(function (entry) {
      entry.button.hidden = !findCardByRef(root, entry.ref);
    });
  }

  /* 逐选项错项反馈：错项原因 + 分步判断、正确项成立理由、其余选项折叠、
     整句翻译与词组、原文定位、对比自测。supp 来自 #teaching-data.questions[ref]。 */
  function renderTeaching(card, root, supp, picked, item) {
    var wrap = el('div', 'qteach');
    var byOption = {};
    (supp.optionAnalysis || []).forEach(function (oa) { byOption[String(oa.option)] = oa; });
    if (picked !== item.a) {
      var wrong = byOption[String(picked)];
      var wrongBlock = el('div', 'qteach-picked', '<strong>✗ 你选 ' + letterOf(picked) + ' 为什么错</strong>');
      if (wrong && wrong.why) wrongBlock.appendChild(el('p', 'qteach-why', wrong.why));
      if (supp.steps && supp.steps.length) {
        wrongBlock.appendChild(el('p', 'qteach-label', '分步判断'));
        var steps = el('ol', 'qteach-steps');
        supp.steps.forEach(function (step) { steps.appendChild(el('li', null, step)); });
        wrongBlock.appendChild(steps);
      }
      wrap.appendChild(wrongBlock);
    }
    var correct = byOption[String(item.a)];
    var okBlock = el('div', 'qteach-correct', '<strong>✓ 正确答案 ' + letterOf(item.a) + ' 为什么成立</strong>');
    if (correct && correct.why) okBlock.appendChild(el('p', 'qteach-why', correct.why));
    wrap.appendChild(okBlock);
    var rest = (supp.optionAnalysis || []).filter(function (oa) {
      return String(oa.option) !== String(picked) && String(oa.option) !== String(item.a);
    });
    if (rest.length) {
      var details = el('details', 'qteach-rest');
      details.appendChild(el('summary', null, '其余选项解析'));
      rest.forEach(function (oa) {
        details.appendChild(el('p', 'qteach-why', '<b>' + letterOf(Number(oa.option)) + '</b>（' + (oa.verdict === 'correct' ? '正确' : '错误') + '）：' + (oa.why || '')));
      });
      wrap.appendChild(details);
    }
    if (supp.translation) wrap.appendChild(el('p', 'qteach-translation', '<b>整句翻译：</b>' + supp.translation));
    if (supp.phrases && supp.phrases.length) {
      var phrases = el('ul', 'qteach-phrases');
      supp.phrases.forEach(function (p) { phrases.appendChild(el('li', null, '<b>' + p.text + '</b> ' + p.meaning)); });
      wrap.appendChild(phrases);
    }
    if (supp.sourceContext && supp.sourceContext.quote) {
      wrap.appendChild(el('blockquote', 'qteach-source', '<b>原文定位' + (supp.sourceContext.label ? ' · ' + supp.sourceContext.label : '') + '</b><br>' + supp.sourceContext.quote));
    }
    if (supp.compareTo) {
      var compare = el('button', 'btn qteach-compare', '对比自测');
      compare.type = 'button';
      compare.setAttribute('data-compare-ref', supp.compareTo);
      // 目标题可能在后面才渲染，先登记，渲染收尾与作答后各校验一次，同组无该题则隐藏。
      (root.pendingCompareRefs = root.pendingCompareRefs || []).push({ button: compare, ref: supp.compareTo });
      compare.addEventListener('click', function () {
        var target = findCardByRef(root, supp.compareTo);
        if (!target) return;
        target.scrollIntoView({ block: 'center' });
        target.classList.add('quiz-flash');
        setTimeout(function () { target.classList.remove('quiz-flash'); }, 1600);
      });
      wrap.appendChild(compare);
    }
    card.appendChild(wrap);
    return wrap;
  }

  /* 主观题（写作/问答）：作答要点、推导、自评标准折叠区。 */
  function renderSubjective(card, sub) {
    var details = el('details', 'qteach-subjective');
    details.appendChild(el('summary', null, '作答要点与自评'));
    if (sub.keyPoints && sub.keyPoints.length) {
      details.appendChild(el('p', 'qteach-label', '作答要点'));
      var points = el('ul', 'qteach-keypoints');
      sub.keyPoints.forEach(function (p) { points.appendChild(el('li', null, p)); });
      details.appendChild(points);
    }
    if (sub.derivation) {
      details.appendChild(el('p', 'qteach-label', '推导'));
      details.appendChild(el('p', 'qteach-derivation', sub.derivation));
    }
    if (sub.selfEval && sub.selfEval.length) {
      details.appendChild(el('p', 'qteach-label', '自评标准'));
      var evals = el('ul', 'qteach-selfeval');
      sub.selfEval.forEach(function (p) { evals.appendChild(el('li', null, p)); });
      details.appendChild(evals);
    }
    card.appendChild(details);
    return details;
  }

  window.Quiz = {
    render: function (target, questions) {
      var root = typeof target === 'string' ? document.querySelector(target) : target;
      if (!root) return;
      // 若在解析中调用，先等 DOM 完整：#teaching-data 注入在 </body> 前，之后才能读到。
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { window.Quiz.render(root, questions); }, { once: true });
        return;
      }
      var key = 'l1uj-english-answers-v1:' + location.pathname + ':' + (root.id || target);
      var saved = {};
      function readSaved() {
        try {
          var value = JSON.parse(zhixuStorage().getItem(key) || '{}');
          return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (e) { return saved; }
      }
      saved = readSaved();
      function save() { try { zhixuStorage().setItem(key, JSON.stringify(saved)); } catch (e) {} }
      // Replace the listener when this group is rendered again, including a restart.
      if (root.refreshEnglishAnswers) {
        window.removeEventListener('storage', root.refreshEnglishAnswers);
        window.removeEventListener('pageshow', root.refreshEnglishAnswers);
        window.removeEventListener('zhixu:cloud-records', root.refreshEnglishAnswers);
      }
      root.refreshEnglishAnswers = function (event) {
        if (event.type === 'storage' && event.key !== null && event.key !== key) return;
        if (JSON.stringify(readSaved()) !== JSON.stringify(saved)) window.Quiz.render(root, questions);
      };
      window.addEventListener('storage', root.refreshEnglishAnswers);
      window.addEventListener('pageshow', root.refreshEnglishAnswers);
      window.addEventListener('zhixu:cloud-records', root.refreshEnglishAnswers);
      root.innerHTML = '';
      root.pendingCompareRefs = [];
      var teaching = readTeachingData();
      var total = questions.length, answered = 0, correct = 0;
      var bar = el('div', 'quiz-score', '已完成 <b>0</b> / ' + total + '，点选项即可作答');
      root.appendChild(bar);

      questions.forEach(function (item, qi) {
        var card = el('div', 'qcard');
        card.appendChild(el('p', 'qtext', '<span class="qno">' + (qi + 1) + '.</span> ' + item.q));
        var list = el('div', 'qopts');
        var locked = false;
        var signature = JSON.stringify([item.q, item.opts, item.a]);
        var ref = (root.id || target) + ':' + qi;
        var supp = teaching && teaching.questions ? teaching.questions[ref] : null;
        card.studyQuestion = { slug: 'zsb-english', lessonId: (location.pathname.match(/\/(\d{4})[^/]*\.html$/) || [,''])[1],
          ref: ref, stem: item.q, html: true,
          options: item.opts.map(function (text, i) { return { value: String(i), text: text }; }), answer: [String(item.a)], explanation: item.why || '' };
        if (supp) {
          if (supp.knowledgePoints) card.studyQuestion.knowledgePoints = supp.knowledgePoints;
          card.studyQuestion.teaching = supp;
          if (supp.subjective) card.studyQuestion.subjective = supp.subjective;
        }
        if (item.subjective && !card.studyQuestion.subjective) card.studyQuestion.subjective = item.subjective;
        // 主观题支架（写作/问答）常驻题卡底部，作答后移到最后，紧跟反馈。
        var subjective = null;
        function paintSubjective() {
          var sub = card.studyQuestion.subjective;
          if (!sub) return;
          if (!subjective) subjective = renderSubjective(card, sub);
          else card.appendChild(subjective);
        }
        paintSubjective();
        card.addEventListener('study-retry', function () { saved = readSaved(); delete saved[qi]; save(); window.Quiz.render(root, questions); });
        function choose(oi, restoring) {
          if (locked) return;
          locked = true;
          answered++;
          var ok = oi === item.a;
          if (ok) correct++;
          Array.prototype.forEach.call(list.children, function (btn, bi) {
            btn.disabled = true;
            btn.setAttribute('aria-pressed', String(bi === oi));
            if (bi === item.a) btn.classList.add('is-ok');
            else if (bi === oi) btn.classList.add('is-no');
          });
          var head = ok ? '✓ 答对了。' : '✗ 正确答案：' + item.opts[item.a] + '。';
          card.appendChild(el('div', 'qwhy', head + (item.why ? ' ' + item.why : '')));
          if (supp) renderTeaching(card, root, supp, oi, item);
          paintSubjective();
          finalizeCompareRefs(root);
          bar.innerHTML = '已完成 <b>' + answered + '</b> / ' + total + ' · 答对 <b>' + correct + '</b> 题';
          if (!restoring) {
            // Merge only this answer into the latest round. A stale tab must not
            // overwrite another answer or bring back a round that was restarted.
            var latest = readSaved();
            var changedElsewhere = JSON.stringify(latest) !== JSON.stringify(saved);
            saved = latest;
            saved[qi] = { signature: signature, picked: oi };
            save();
            document.dispatchEvent(new CustomEvent('study:attempt', { detail: { node: card, correct: ok, independent: true } }));
            if (changedElsewhere) window.Quiz.render(root, questions);
          }
        }

        item.opts.forEach(function (text, oi) {
          var b = el('button', 'opt', text);
          b.type = 'button';
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', function () {
            choose(oi, false);
          });
          list.appendChild(b);
        });

        card.appendChild(list);
        root.appendChild(card);
        var previous = saved[qi];
        if (previous && previous.signature === signature && Number.isInteger(previous.picked)
          && previous.picked >= 0 && previous.picked < item.opts.length) choose(previous.picked, true);
      });
      // 对比自测目标不在本组（或在别页）时隐藏按钮，避免点了没反应。
      finalizeCompareRefs(root);      var redo = el('button', 'btn quiz-redo', '重新练习本组（保留错题记录）');
      redo.type = 'button';
      redo.addEventListener('click', function () {
        saved = {}; save(); window.Quiz.render(root, questions);
      });
      root.appendChild(redo);
    }
  };

  window.Progress = {
    init: function (lessonId) {
      var btn = document.getElementById('mark-done');
      if (!btn) return;
      var key = DONE_KEY + lessonId;
      var refresh = function () {
        var done = false;
        try { done = zhixuStorage().getItem(key) === '1'; } catch (e) {}
        btn.classList.toggle('is-done', done);
        btn.textContent = done ? '✓ 已完成本课' : '标记本课完成';
      };
      btn.addEventListener('click', function () {
        try { zhixuStorage().setItem(key, '1'); } catch (e) {}
        refresh();
      });
      refresh();
    }
  };
})();
