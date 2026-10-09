# Mission: Agent 方向求职——从零基础到能讲透、能手写 Coding Agent

## Why

约 1 年后参加 Agent 方向岗位（如虾皮、安克等大厂）的实习/校招面试。面试官考的不是"会调框架"，而是能讲清 Agent 的核心设计原理（Agent Loop、Session 存储、Context 组装、压缩策略、扩展机制）并回答追问。同时需要一个亲手实现的项目（PatchPilot）作为面试实证——"我不仅懂，我还自己写过"。

## Success looks like

- 能在白板上讲清 Agent Loop、Tool 系统、Context Assembly、Session（JSONL + parent_id 反向链表 + rewind）、上下文压缩（摘要节点 K + 滑动窗口）、语义不分裂、Hook 扩展机制，并经受住追问
- 拥有亲手实现的 PatchPilot：v0.1 最小闭环（任务 → 读文件 → 改代码 → 跑测试 → 输出 diff → JSONL trace）+ Session 存储 + 压缩 + 一个 Hook 插件，可现场演示并逐行讲自己的代码
- 完成一份 PatchPilot vs Pi vs Kimi Code 的对比分析，可直接用作面试材料或技术文章
- 每个面试高频点都同时有"原理理解"和"亲手代码"两条腿

## Constraints

- 学习者接近零基础（TS/Node、LLM API、Git/测试、Agent 概念均不熟练），课程需从零搭起，多用类比、少堆术语
- 每周可投入 8–12 小时，每周推进 2–3 课
- 操作系统为 Windows，所有命令与步骤需适配 Windows
- 全程中文授课
- 交错式结构：每个概念必须当周在 PatchPilot 里动手落地，不允许"先囤概念后补实战"

## Out of scope

- 生产级特性：沙箱、代码物理回退、权限系统的完整实现——理解概念即可，不实现
- MCP、多 Agent（Sub-Agent 派生）、向量数据库长期记忆——面试之后或选学
- Python 生态与 AI/ML 库——后期做评测脚本时再按需补
- 其他 Agent 框架（LangChain/LangGraph 等）的深入学习——只在对比分析中提及
- PatchPilot 的"产品化"（UI 美化、发布分发）——它是面试载体，不是产品
