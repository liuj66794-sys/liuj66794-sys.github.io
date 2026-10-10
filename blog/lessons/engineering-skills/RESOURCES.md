# Mattpocock Skills 学习资源

## Knowledge

这些资源是我们学习的主要来源。所有 skills 都已安装到本地 `~/.agents/skills/` 目录下，每个 skill 的 `SKILL.md` 是权威说明。

### 总览与导航

- [`~/.agents/skills/ask-matt/SKILL.md`](file:///C:/Users/38623/.agents/skills/ask-matt/SKILL.md)
  所有 skills 的“路由器”。当你不知道该用哪个 skill 时，先读它。它把 skills 组织成 main flow（idea → ship）、on-ramps、codebase health、vocabulary layer 和 standalone skills。**2026-08-05 新增 `PHASE-BOUNDARIES.md` 决策树**：帮你判断当前处在哪个阶段边界、该用哪个 skill。

- [`~/.agents/skills/setup-matt-pocock-skills/SKILL.md`](file:///C:/Users/38623/.agents/skills/setup-matt-pocock-skills/SKILL.md)
  在真实项目里使用 engineering skills 之前的配置步骤：issue tracker、triage labels、domain docs（CONTEXT.md / ADR）。

### 核心工程工作流

- [`~/.agents/skills/grilling/SKILL.md`](file:///C:/Users/38623/.agents/skills/grilling/SKILL.md) / [`grill-with-docs/SKILL.md`](file:///C:/Users/38623/.agents/skills/grill-with-docs/SKILL.md) / [`grill-me/SKILL.md`](file:///C:/Users/38623/.agents/skills/grill-me/SKILL.md)
   relentless interview（ relentless 提问）的核心技能。`grill-with-docs` 会在提问过程中更新 `CONTEXT.md` 和 ADR；`grill-me` 是无代码库时的纯对话版本。**注意（2026-07 更新）**：grilling 已改为 round-by-round（分轮）frontier 采访制——每轮问完整个 frontier（前提已确定的所有决策），问题格式固定为 `❓ **Q1** - **标题**:` + `➡️` 推荐答案，同轮问题之间用水平线 `---` 分隔（2026-08-20 起）；不再是"一次只问一个问题"。

- [`~/.agents/skills/to-spec/SKILL.md`](file:///C:/Users/38623/.agents/skills/to-spec/SKILL.md)
  把当前对话整理成 PRD/spec，发布到 issue tracker。

- [`~/.agents/skills/to-tickets/SKILL.md`](file:///C:/Users/38623/.agents/skills/to-tickets/SKILL.md)
  把 spec 拆成 tracer-bullet tickets，每个 ticket 声明 blocking edges。

- [`~/.agents/skills/implement/SKILL.md`](file:///C:/Users/38623/.agents/skills/implement/SKILL.md)
  基于 spec/tickets 实现功能，内部驱动 `/tdd`，最后跑 `/code-review`。

- [仓库 `skills/in-progress/implement-spec/SKILL.md`](https://github.com/mattpocock/skills/blob/main/skills/in-progress/implement-spec/SKILL.md)（2026-08-21 新增，in-progress 实验性，本地暂未安装）
  implement 的并行放大版：把 spec 的 tickets 当作带阻塞边的任务图，后台并行派发 implementer 子 agent（各自 worktree/分支），由 merger 子 agent 合并成单个 PR，解锁新 frontier 就继续派发，收尾跑 code-review。与 wayfinder 的 frontier 概念同源。

- [`~/.agents/skills/tdd/SKILL.md`](file:///C:/Users/38623/.agents/skills/tdd/SKILL.md)
  测试驱动开发的规则： seams、anti-patterns、red-green 循环。

- [`~/.agents/skills/code-review/SKILL.md`](file:///C:/Users/38623/.agents/skills/code-review/SKILL.md)
  双轴代码审查：Standards（是否符合项目规范 + Fowler code smells）和 Spec（是否实现需求）。**2026-08-06 起 subagent 派发改为跨 harness 中性**：不再点名 Claude Code 的 `Agent` 工具，只描述派发形态（并行 spawn 子 agent），机制留给各客户端——对多客户端混用的我们是利好。

- [`~/.agents/skills/wizard/SKILL.md`](file:///C:/Users/38623/.agents/skills/wizard/SKILL.md)（2026-07-28 从 in-progress 毕业，engineering）
  生成交互式 bash 向导脚本，带人完成只有人能做的步骤：开通基础设施、配置凭证/CI secrets、操作第三方后台、一次性迁移。现为 model-invoked；**2026-08-06 起不再给出分钟数预估**（进度按阶段数计）。

### 调试、设计与架构

- [`~/.agents/skills/diagnosing-bugs/SKILL.md`](file:///C:/Users/38623/.agents/skills/diagnosing-bugs/SKILL.md)
  难 bug 的诊断流程：先建 tight feedback loop，再 reproduce、hypothesise、instrument、fix、post-mortem。**2026-08-06 新增 Redact（脱敏）规则**：粘贴调用及输出、构造 curl 循环、收集 artifact 前必须先脱敏，防止活 token 进入对话（源于 Snyk 审计 W007 高危项）；HITL 模板也会警告 `capture` 会把值打印回终端。

- [`~/.agents/skills/codebase-design/SKILL.md`](file:///C:/Users/38623/.agents/skills/codebase-design/SKILL.md)
  共享设计词汇：module、interface、depth、seam、adapter、leverage、locality；如何设计 deep module。

- [`~/.agents/skills/improve-codebase-architecture/SKILL.md`](file:///C:/Users/38623/.agents/skills/improve-codebase-architecture/SKILL.md)
  扫描代码库，找出 deepening opportunities，生成 HTML 报告，然后进入 grilling 循环。

- [`~/.agents/skills/domain-modeling/SKILL.md`](file:///C:/Users/38623/.agents/skills/domain-modeling/SKILL.md)
  主动构建和打磨项目的领域模型：维护 `CONTEXT.md`、写 ADR、challenge 模糊术语。

### 规划、研究与交接

- [`~/.agents/skills/wayfinder/SKILL.md`](file:///C:/Users/38623/.agents/skills/wayfinder/SKILL.md)
  大型/模糊项目的 wayfinding：在 issue tracker 上绘制 shared map，逐个解决决策型 ticket。

- [`~/.agents/skills/triage/SKILL.md`](file:///C:/Users/38623/.agents/skills/triage/SKILL.md)
  对 issue/PR 进行分类、验证、grill，输出 agent-ready brief。

- [`~/.agents/skills/research/SKILL.md`](file:///C:/Users/38623/.agents/skills/research/SKILL.md)
  启动后台 agent 针对 primary sources 做研究，输出带引用的 Markdown。

- [`~/.agents/skills/handoff/SKILL.md`](file:///C:/Users/38623/.agents/skills/handoff/SKILL.md)
  把当前对话压缩成 handoff 文档，供新 session 继续工作。

- [`~/.agents/skills/prototype/SKILL.md`](file:///C:/Users/38623/.agents/skills/prototype/SKILL.md)
  写一次性原型来回答设计问题（状态模型、UI 感觉），得到答案后删除或归档。

- [`~/.agents/skills/to-questionnaire/SKILL.md`](file:///C:/Users/38623/.agents/skills/to-questionnaire/SKILL.md)（2026-07-28 从 in-progress 毕业，productivity）
  把你回答不了的决策变成一份 Markdown 问卷，交给能回答的人异步填写或开会共填。它拷问的是"寄给谁、要回什么"，而不是主题本身——ask-matt 把它定位为 `/grill-me` 的反向操作。

- [`~/.agents/skills/wait-what/SKILL.md`](file:///C:/Users/38623/.agents/skills/wait-what/SKILL.md)（2026-08-05 新增，productivity）
  当 agent 说的一句话你没看懂时立刻触发，agent 用大白话 + 你 `CONTEXT.md` 里的词汇重新解释。

- [`~/.agents/skills/teach/SKILL.md`](file:///C:/Users/38623/.agents/skills/teach/SKILL.md)
  在当前目录建立跨 session 的学习工作区（本目录就是它产出的）。

- [仓库 `skills/in-progress/retro/SKILL.md`](https://github.com/mattpocock/skills/blob/main/skills/in-progress/retro/SKILL.md)（2026-08-24 新增，in-progress 实验性，本地暂未安装）
  对一次编码会话做回顾（retrospective）：分析指定会话（默认当前会话）的原始记录，从导航指针、自动检查、评审用编码规范、AGENTS.md 瘦身、工具经济、空转指令、信息获取七个维度找出改进 agent 环境的候选，按严重度排序呈现给用户。

### 写作与通用工具

- [`~/.agents/skills/writing-for-agents/SKILL.md`](file:///C:/Users/38623/.agents/skills/writing-for-agents/SKILL.md)（原 `writing-great-skills`，2026-07-27 改名并扩大范围）
  如何写给 agent 看的文档：skills、AGENTS.md/CLAUDE.md、任何通过指针触达的文档。核心原则不变：predictability、context load vs cognitive load、information hierarchy、leading words。GLOSSARY.md 已并入 SKILL.md，skill 专有机制拆到 SKILL-MECHANICS.md；现为 model-invoked。

- [`~/.agents/skills/writing-shape/SKILL.md`](file:///C:/Users/38623/.agents/skills/writing-shape/SKILL.md) / [`writing-beats/SKILL.md`](file:///C:/Users/38623/.agents/skills/writing-beats/SKILL.md) / [`writing-fragments/SKILL.md`](file:///C:/Users/38623/.agents/skills/writing-fragments/SKILL.md)
  写作三阶段：fragments（探索）、beats（按节奏组装）、shape（成文）。**注意：这三个在仓库里仍属 in-progress（实验性），行为可能变化。**

> 已从仓库删除（2026-08-05，勿用于新工作）：`ubiquitous-language`、`design-an-interface`、`qa`、`request-refactor-plan` 四个 deprecated skill 已**彻底删除**（`skills/deprecated/` 只剩一个 README 墓碑），同时整个 personal 桶（`edit-article`、`obsidian-vault`）也被移除。`batch-grill-me` 此前在 in-progress，现已不在仓库任何分类中。本地 `~/.agents/skills/` 已于 2026-08-07 同步到 v1.2.3，上述失效 skill 均已从本地卸载。
>
> **本地安装异常（2026-09-09 发现，待修复）**：2026-09-08 本地混入了一套第三方 `claudekit` skill 包——新增了 `design`、`design-system`、`ui-styling` 三个不属于 Matt 仓库的目录，并**覆盖**了 Matt 版的 `code-review`、`diagnosing-bugs`、`tdd`（内容是重组过的衍生版，不再是仓库原文；例如 diagnosing-bugs 丢了"Build a feedback loop"六阶段结构和独立 Redact 小节）。仓库新出的 `retro`、`implement-spec` 也尚未安装。待网络通了按 NOTES.md 约定重跑 `npx skills@latest add mattpocock/skills -g -y` 恢复；期间学习以上游 GitHub 为准，本地路径仅供参考。

## Wisdom (Communities)

- [Matt Pocock 的 GitHub Skills 仓库](https://github.com/mattpocock/skills)
  skills 的源码和更新来源。如果发现本地 skill 行为与预期不符，先检查仓库是否有新版本或相关 issue。

- [Total TypeScript / ai-hero.dev 社区](https://www.aihero.dev/)
  Matt Pocock 围绕 AI 辅助开发的教学内容发源地，适合理解 skills 背后的设计理念。

> 用户偏好：暂未要求加入社区；后续若改变，记录于此。
