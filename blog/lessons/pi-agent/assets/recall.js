/* 回忆卡组件：lessons/*.html 统一引用（defer）。
   用法：
   <div class="recall">
     <p class="q">问题（先在心里或纸上作答）</p>
     <button class="reveal" type="button">显示答案</button>
     <div class="answer" hidden>答案（可含 <pre><code>）</div>
     <div class="self-grade" hidden>
       <span>自评：</span>
       <button class="grade ok" type="button">想起来了</button>
       <button class="grade no" type="button">没想起来</button>
     </div>
     <p class="feedback"></p>
   </div>
   规则：答案默认遮蔽，必须主动回忆后才揭示；自评仅当场反馈，不做持久记录。
   原理：retrieval practice——主动回忆比重复阅读更能加固长期记忆。 */

document.querySelectorAll(".recall").forEach((card) => {
  const reveal = card.querySelector(".reveal");
  const answer = card.querySelector(".answer");
  const gradeBox = card.querySelector(".self-grade");
  const feedback = card.querySelector(".feedback");

  reveal.addEventListener("click", () => {
    answer.hidden = false;
    gradeBox.hidden = false;
    reveal.disabled = true;
  });

  card.querySelectorAll(".grade").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".grade").forEach((b) => (b.disabled = true));
      if (btn.classList.contains("ok")) {
        feedback.textContent = "✓ 很好——主动回忆成功，这条知识的长期记忆又加固了一次。";
        feedback.className = "feedback ok";
      } else {
        feedback.textContent = "✗ 没关系，这正是最有价值的发现：把这条记入易错点，回到对应章节重看一遍，明天再回忆一次。";
        feedback.className = "feedback bad";
      }
    });
  });
});
