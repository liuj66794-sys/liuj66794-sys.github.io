/* 小测组件：所有 lessons/*.html 统一引用（defer）。
   用法：
   <div class="quiz" data-answer="b">
     <p class="q">题目</p>
     <div class="options">
       <button class="option" data-key="a">选项 A</button>
       <button class="option" data-key="b">选项 B</button>
       ...
     </div>
     <p class="feedback"></p>
   </div>
   规则：选项文案须等长（字数/字符数一致），不给格式线索。
   判分即时：点选后锁定本题，正确项标绿，错选标红。 */

document.querySelectorAll(".quiz").forEach((quiz) => {
  const answer = quiz.dataset.answer;
  const feedback = quiz.querySelector(".feedback");
  const buttons = quiz.querySelectorAll("button.option");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => {
        b.disabled = true;
        if (b.dataset.key === answer) b.classList.add("correct");
      });

      if (btn.dataset.key === answer) {
        feedback.textContent = "✓ 正确。" + (quiz.dataset.explain || "");
        feedback.className = "feedback ok";
      } else {
        btn.classList.add("wrong");
        feedback.textContent = "✗ 不对，绿色是正确答案。" + (quiz.dataset.explain || "");
        feedback.className = "feedback bad";
      }
    });
  });
});
