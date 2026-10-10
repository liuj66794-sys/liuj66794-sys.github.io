# Agent 求职课程 Glossary

Coding Agent 学习路线（见 [MISSION.md](./MISSION.md)）的规范术语表。所有课件、速查表与 learning record 统一使用这里的措辞。术语只在验收通过后入册——能压缩出准确定义，才算真正理解。

## Terms

### 运行时与工具

**Node.js**:
让 JavaScript 脱离浏览器、直接在操作系统上运行的环境，可读文件、跑命令、发网络请求。Coding Agent 的运行底座。
_Avoid_: JS 运行时（太泛）、Node 框架

**npm**:
Node.js 自带的包管理器，安装他人写好的工具，并通过 package.json 管理项目脚本。
_Avoid_: 应用商店

**npx**:
npm 自带的命令执行器：本地没有对应工具时临时下载并运行它（如 `npx tsx`）。
_Avoid_: 包安装器（它不负责长期安装）

**tsx**:
把 TypeScript 当场转译为 JavaScript 并直接运行的工具；不做类型检查。
_Avoid_: TS 编译器、类型检查器

**package.json**:
项目的"身份证"：记录依赖清单与 `scripts` 可运行脚本。`npm run <名字>` 即执行其中的命令别名。
_Avoid_: 配置文件（太泛）

**tsc**:
TypeScript 官方编译器；配合 tsconfig.json 使用，`tsc --noEmit` 只做类型检查——不生成文件、不运行代码。
_Avoid_: 运行器（那是 tsx 的分工）

**tsconfig.json**:
tsc 的配置文件，规定类型检查的严格程度与模块解析规则；`strict: true` 打开全部严格检查。
_Avoid_: 项目身份证（那是 package.json）

### TypeScript 类型

**类型标注 (type annotation)**:
写在变量、参数或返回值处的类型声明（如 `name: string`），让 TypeScript 在运行前就发现类型错误。
_Avoid_: 类型注释

**模板字符串 (template string)**:
用反引号包裹、内嵌 `${表达式}` 求值的字符串字面量。
_Avoid_: 字符串拼接

**interface**:
描述对象形状（必须包含哪些字段、各是什么类型）的契约；是定义 Agent 工具结构的首选方式。
_Avoid_: 类、类型别名

**形状 (shape)**:
一个对象"必须有哪些字段、字段各是什么类型"的整体结构；interface 描述的就是形状。
_Avoid_: 格式、样子

**any**:
关闭类型检查的兜底类型；只作临时占位，能用具体类型就不用它。
_Avoid_: 万能类型（它其实什么都不能保证）

**Record<string, T>**:
描述"键为字符串、值为 T"的对象容器的形状——是容器描述，不是"获取内容"的动作。
_Avoid_: 获取所有条目

### 模块与工程

**模块 (module)**:
按职责拆分代码的文件单位；一个文件就是一个模块，内部默认私有，靠 export 暴露、import 引入。
_Avoid_: 包（package 是 npm 的发布单位，不是模块）

**export**:
把模块里的 interface、常量、函数或类型暴露给其他模块使用的关键字——不止于类。
_Avoid_: 暴露类（太窄）

**import**:
从其他模块引入它 export 的内容；路径以 `./` 开头表示本地文件，省略 `./` 会被当成 npm 包。
_Avoid_: 引入包

**ESM**:
JavaScript 官方模块标准；import/export 语法即来自它。
_Avoid_: require / module.exports（那是旧的 CommonJS 体系）

### Agent 概念

**工具 (Tool)**:
Agent 可调用的一个具名能力，由 name、description、execute 三部分构成；description 会被塞进给模型的上下文。
_Avoid_: 函数（Tool 是带描述的契约，不只是函数）

**注册表 (registry)**:
以工具名为键、Tool 为值的对象（`Record<string, Tool>`），Agent 通过它查询"我有哪些工具"并按名调度。
_Avoid_: 工具列表、工具清单

### 异步与 Promise

**异步 (async)**:
发起耗时操作后不原地等结果、先拿"凭证"离开的执行方式；结果出来后再凭凭证取回。与同步（一行执行完才走下一行）相对。
_Avoid_: 多线程、并行（异步是"不冻住地等"，不是"同时干"）

**Promise**:
"未来结果的凭证"：代表一个尚未完成的异步操作的对象，只有 pending（等待中）/ fulfilled（已成功）/ rejected（已失败）三种状态。
_Avoid_: 回调、结果本身（Promise 是凭证，不是结果）

**async / await**:
写异步代码的标准语法：async 标在函数前，返回值自动包成 Promise；await 写在 Promise 前（只能在 async 函数内），暂停当前函数等 Promise 兑现并取出结果，但不冻住整个程序。
_Avoid_: 同步等待、冻住程序

**try / catch**:
接住已抛出错误的语法：try 包住可能失败的代码，里面任何一句抛错就立即跳到 catch 继续执行，程序不崩；await 一个 rejected 的 Promise 抛出的错误也用它接。
_Avoid_: 预防错误（它是接住已发生的错误，不是让错误不发生）

### Node.js 核心

**Buffer**:
Node.js 里装原始字节（未解码的 0/1 数据）的容器；readFile 不传 `"utf-8"` 时返回的就是它，传了才解码成文本。
_Avoid_: 字符串（Buffer 是字节，不是文本）

> 待入册（第 6 课验收通过后补录）：子进程、stdout / stderr、退出码、promisify。
