/* 小测验组件：配合 quiz.css 使用。
   每课在 <script> 中定义全局 window.quizExplanations：
   { q1: { A: "...", B: "...", ... }, q2: { ... } }
   其中 key 与 radio 的 name 对应。 */
function checkAnswer(button) {
  const quiz = button.closest('.quiz');
  const answer = quiz.dataset.answer;
  const name = quiz.querySelector('input[type="radio"]').name;
  const selected = quiz.querySelector('input[name="' + name + '"]:checked');
  const feedback = quiz.querySelector('.quiz-feedback');

  if (!selected) {
    feedback.textContent = '请先选择一个答案。';
    feedback.className = 'quiz-feedback wrong';
    return;
  }

  const chosen = selected.value;
  feedback.textContent = window.quizExplanations[name][chosen];
  feedback.className = chosen === answer ? 'quiz-feedback correct' : 'quiz-feedback wrong';
}
