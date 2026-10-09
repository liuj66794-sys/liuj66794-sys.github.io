# Agent 求职学习 Resources

## Knowledge

- 本地：`推荐一个比Claudecode更适合学习的Agent项目_知识解析.md`
  视频（47.5 分钟）的结构化解析，覆盖 Agent Loop / Context / Session / 压缩 / 扩展机制 8 个单元。Use for：阶段 1+2 概念课的骨架与概念清单。注意：这是二手转述（音译项目名、未标数据时间），引用其观点时以一手资料复核。
- 本地：`pi_agent学习计划.txt`
  原始四个月学习计划（PatchPilot 项目设计、Pi 四层学习法、评测方案）。Use for：本路线图的素材来源；PatchPilot 的需求定义。
- [Repo: badlogic/pi-mono](https://github.com/badlogic/pi-mono)
  开源 Agent toolkit（packages: pi-ai / pi-agent-core / pi-coding-agent / pi-tui）。现有证据表明视频中的"PyAgent/Pye"即此项目。Use for：阶段 1+2 每个概念单元的一手源码对照；面试时可引用的真实仓库。
- [Site: pi.dev](https://pi.dev)
  pi 官方站点与文档（定位：minimal agent harness，extensions / skills / prompt templates）。Use for：扩展机制、运行模式单元的权威描述。
- [TypeScript Handbook — The Basics / for the New Programmer](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html)
  TS 官方手册。Use for：阶段 0 模块 A 所有 TS 课程的权威依据与延伸阅读。
- [Node.js 官方文档](https://nodejs.org/docs/latest/api/)
  fs、child_process、stream 等 API 的一手参考。Use for：阶段 0 模块 B；PatchPilot 工具实现时查阅。
- [MDN Web Docs：Promise](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise) 与 [async function](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/async_function)
  JS 异步原语的权威参考（中文）。Use for：阶段 0 模块 A 异步课；写异步代码卡住时的一手查阅。
- [Paper: ReAct — Synergizing Reasoning and Acting in Language Models (arXiv:2210.03629)](https://arxiv.org/abs/2210.03629)
  ReAct 范式原始论文。Use for：单元 1（Agent Loop）的原始出处；面试被问"ReAct 是什么"时的标准答案来源。
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
  Anthropic 工程团队的 Agent 设计模式总结。Use for：概念课的观点复核；面试中"业界共识"类回答的依据。
- [Vitest 官方文档](https://vitest.dev/)
  测试框架文档。Use for：阶段 0 模块 C；动手课验收测试的写法参考。

## Wisdom (Communities)

- pi 社区 Discord（从 [pi-mono README](https://github.com/badlogic/pi-mono) 进入）
  pi 的真实使用者与扩展作者聚集地。Use for：阶段 1+2 读源码卡住时提问；了解真实使用场景。
- [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/)、[r/ChatGPTCoding](https://www.reddit.com/r/ChatGPTCoding/)
  Agent/Coding 工具讨论较活跃的英文社区。Use for：了解行业动态与面试风向；不作为知识来源。

## Gaps

- "PyAgent/Pye = pi-mono"尚需最终确认（观看原片或追溯仓库历史）。确认前课程表述为"pi（视频中称 PyAgent/Pye）"。
- 虾皮/安克等大厂 Agent 岗位的真实面试题，目前只有视频转述，缺一手面经。建议学习期间在牛客/一亩三分地积累真实面经，补充到本文件。
- CrowCode"四层渐进式压缩"的具体内容，视频未展开，待找到一手资料后补充。
