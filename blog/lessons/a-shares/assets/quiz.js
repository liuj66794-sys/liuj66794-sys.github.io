/* gupiao 课程共享交互组件：即时反馈测验 + 费曼自测
   用法（测验）：
   <div class="quiz" data-answer="2" data-explain="解析文字">
     <p class="q">问题</p>
     <ul class="opts"><li>选项A</li><li>选项B</li><li>选项C</li></ul>
   </div>
   data-answer 为正确项的 0 基索引。
   用法（费曼）：
   <div class="feynman" data-topic="用一句话向完全不懂的人解释：什么是一手">
     <h3>费曼自测（5 分钟）</h3>
     <p>不看讲义，出声讲一遍：</p>
   </div>
*/
(function () {
  // 测验
  document.querySelectorAll('.quiz').forEach(function (quiz) {
    var answer = parseInt(quiz.dataset.answer, 10);
    var explain = quiz.dataset.explain || '';
    var fb = document.createElement('div');
    fb.className = 'fb';
    quiz.appendChild(fb);
    var opts = quiz.querySelectorAll('.opts li');
    opts.forEach(function (li, i) {
      li.addEventListener('click', function () {
        if (quiz.classList.contains('done')) return;
        quiz.classList.add('done');
        opts.forEach(function (o) { o.classList.add('locked'); });
        if (i === answer) {
          li.classList.add('correct');
          fb.innerHTML = '<strong>✓ 答对了。</strong>' + explain;
        } else {
          li.classList.add('wrong');
          opts[answer].classList.add('correct');
          fb.innerHTML = '<strong>✗ 再想想。</strong>' + explain;
        }
      });
    });
  });

  // 费曼自测
  document.querySelectorAll('.feynman').forEach(function (box) {
    var topic = box.dataset.topic || '本课核心概念';
    var q = document.createElement('p');
    q.innerHTML = '<strong>' + topic + '</strong>';
    box.appendChild(q);
    var btns = document.createElement('div');
    btns.className = 'btns';
    var verdicts = [
      ['讲得顺', '过关！把这个概念用自己的话写进知识库 concepts/（铁律 1）。'],
      ['磕磕绊绊', '还没过关：重读本课"为什么是重点"那一节，明天再讲一遍。'],
      ['讲不出来', '标记进《未懂清单》——这就是以后请教姑婆或问我的弹药。']
    ];
    var v = document.createElement('div');
    v.className = 'verdict';
    verdicts.forEach(function (pair) {
      var b = document.createElement('button');
      b.textContent = pair[0];
      b.addEventListener('click', function () {
        v.textContent = pair[1];
        v.classList.add('show');
      });
      btns.appendChild(b);
    });
    box.appendChild(btns);
    box.appendChild(v);
  });
})();
