# JSON 格式化与对比工具

[English](README.md) | 简体中文

Chrome 扩展（Manifest V3）：零权限、纯本地、无广告的 JSON 工具箱。采用 Web Worker 解析与虚拟滚动渲染，减少处理大 JSON 时的界面阻塞。不收集任何数据，不发起网络请求。

当前版本见 [`manifest.json`](manifest.json) 中的 `version` 字段。

## 功能

| 页面 | 说明 |
| --- | --- |
| **JSON 格式化** | 美化（2 空格 / 4 空格 / Tab）；语法错误提示，浏览器提供位置时显示行列并跳转；树形折叠、按层级展开、key/值搜索与高亮跳转；一键复制 |
| **JSON 压缩** | 去除空白压缩为单行；提示无效 JSON，显示可用的行列位置 |
| **JSON 转义 / 去转义** | 文本与 JSON 字符串互转，一键复制 |
| **JSON 对比** | 双 JSON 结构化 diff（新增 / 删除 / 变更 / 类型变化）；数组按下标或主键配对；可忽略指定路径；树形高亮与「只看差异」；文本逐行 diff |

侧边栏可在各工具页之间切换。界面支持中文（简体）与英文（`_locales/`）。

## 本地加载（开发者模式）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库**根目录**（包含 `manifest.json` 的目录，不要选 `dist/` 里的 zip）
5. 点击工具栏中的扩展图标，即可打开 JSON 工具箱

快捷键：多数页面支持 **Cmd/Ctrl + Enter** 执行当前操作。

## 项目结构

```
manifest.json          # 扩展清单，仍从仓库根目录加载
*.html                 # 五个工具页的稳定入口
src/
  background.js        # Service Worker：点击扩展图标时打开工具页
  pages/               # 页面交互、视图状态与渲染
    formatter.js
    compare.js
    transform.js       # 压缩、转义、去转义共用页面逻辑
  shared/              # 导航、国际化、虚拟树/文本视图、复制与 Worker 协议
  core/                # 纯算法：JSON 排版、路径、搜索、结构对比、文本对比等
  worker/
    index.js           # Web Worker 消息入口
    tasks.js           # 操作分发、搜索数据缓存与错误响应
styles/app.css         # 五个页面共用样式
icons/                 # 扩展图标（manifest 引用）
_locales/              # 国际化文案
tests/                 # 算法与通信契约、发布文件检查
bench/                 # 搜索/对比算法基准与可选浏览器验证
package.json           # 原生 ES modules 与测试命令，无第三方依赖
gen_icons.py           # 重新生成 icons/ 下 PNG（可选）
build_release.py       # 发布检查与白名单打包（Python 标准库）
STORE_LISTING.md       # Chrome 商店上架文案与表单说明
PRIVACY.md             # 中英文隐私政策（由当前公开仓库托管）
store-assets/          # 商店截图和宣传图（不打进扩展 ZIP）
```

运行时代码使用浏览器原生 ES modules，无需安装依赖或构建即可加载扩展。每个 HTML 只加载一个页面入口，导航生成后统一应用翻译，不依赖全局函数和多个 script 标签的先后顺序。

| 边界 | 职责与约定 |
| --- | --- |
| `pages → shared` | 页面管理自己的状态；共享层负责浏览器交互。格式化树和对比树保留各自的展开、搜索及差异逻辑。 |
| `pages/shared → core` | 视图使用 JSON Pointer 与文本行偏移索引；JSON 解析、搜索与对比通过 Worker 执行。 |
| `shared/worker-client → worker/index` | 请求按 id 配对，全部完成才结束忙碌状态。页面启用串行队列，同类未发送任务只保留最新输入；清空取消排队任务，取消结果带 `cancelled: true`。 |
| `worker/tasks → core` | 每个 Worker 独立缓存文档与最近一次对比。页面通过 `retainSnapshot`/`snapshotId` 复用解析结果；`includeData: false` 省略对象传输，切树视图再取。清空使快照失效，压缩页不保留不需要的搜索数据。 |
| `core` | 不依赖 DOM、Chrome API 或 Worker 全局对象；无效输入抛出异常，由任务层转换为错误响应。数字原文字面量的扫描与恢复集中在 `json.js`。 |

共享虚拟视图负责窗口索引和 DOM 生命周期；页面保留各自的搜索、配对、筛选和导航逻辑。新增任务时，先将算法放入 `core/`，再接入 `worker/tasks.js`；新增运行时文件还需加入 `build_release.py` 的白名单。

## 开发验证

需要 Node.js 20+ 和 Python 3，无需 `npm install`：

```bash
npm test
python3 build_release.py --check
```

测试覆盖数字字面量与特殊 key、搜索缓存与结果上限、结构及文本对比、Worker 并发和故障响应，以及发布包的间接模块依赖。浏览器交互仍需按下文的功能清单验证。

### 性能验证

`npm run bench` 运行搜索和对比算法基准，每个场景预热 2 次、测量 7 次取中位数。脚本支持传入旧版模块/源码目录，方便在同一环境比较；内存数据是调用前后分配增量，包含待回收临时对象，不代表峰值或常驻内存。避免同时运行其他基准。

第一轮（`61480ce`），2026-11-04 在 Linux、i5-12400、Node 24.16.0 上，以 `f070f32` 为基线测得以下结果（合成数据，不代表所有文件或设备）：

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 100 万元素数组搜索 | 110.59 ms | 16.03 ms |
| 20 万字段对象搜索 | 59.22 ms | 45.65 ms |
| 5 万条嵌套记录结构对比 | 142.66 ms | 24.36 ms |
| 5 万条记录按主键倒序对比 | 181.80 ms | 48.32 ms |
| 两侧各 1,500 行全部变更，精确文本 diff | 58.87 ms | 38.02 ms |

搜索只保存活动容器游标，只为前 500 个命中生成路径，但仍统计所有命中。结构对比复用路径栈；Myers 文本 diff 只保存有效对角线，该最坏测试场景的追踪缓冲区由约 72 MB 降为 18 MB。相同文本避免建立两份行数组。

第二轮以 `61480ce` 为基线继续优化：

- 树改为扁平虚拟视图，用区间描述未展开的连续兄弟，滚动只创建视口附近的 DOM。百万元素数组不为每项预建行对象；层级展开、特殊 key、搜索跳转、差异筛选和主键同步继续可用，不再靠 10 万节点预算或「更多」按钮控制渲染。
- 文本保留完整原文和紧凑行偏移索引，按行与列窗口渲染，支持超长单行及超过浏览器滚动尺寸上限的结果。文本 diff 用区间索引，不再只显示前 50,000 行。小结果保留原生文本显示。
- Worker 缓存当前文档及对比快照，切换视图不再重复解析，也不在纯文本比较时传输左右对象。串行队列在发送前合并过期任务；清空取消排队任务并释放缓存。
- 结构对比改用迭代活动帧。20,000 层合成数据从栈溢出变为约 7 ms，50,000 条常规结构相等对比约 24 → 22 ms（7 次中位数）。若浏览器无法克隆深层对象，仅该异常路径通过快照原文恢复；普通对象不在主线程重复解析。

本机 Chromium 153 实测：20,000 层 JSON 可通过真实 Worker 返回数据；10.12 MiB 重复对比预热后，传对象/仅传摘要往返中位数约 59/22 ms（包含输入传输，复用缓存解析）。文本组件单独渲染 10 MB／10 万行约 6.4 ms、5 MiB 单行约 8.1 ms，DOM 分别为 80 和 4 个；这些是组件单次测量，不含输入框、Worker 解析和传输，不能当成整个操作耗时。

`bench/tree-rendering.mjs` 用同一个最小 DOM 比较视图生成开销：200×200 数值展开从约 183 → 12 ms，DOM 从 242,412 → 193；访问 12 万基础值的末尾从 402 → 1 ms。它验证分配和节点规模，不包含浏览器布局/绘制。实际浏览器由下面的验证入口覆盖。

可选浏览器验证使用开发环境已有的 Playwright 和 Chromium，不增加扩展运行时依赖：

```bash
# 若本地可直接 import playwright，则无需 PLAYWRIGHT_MODULE。
export PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
# 可选：export CHROMIUM_EXECUTABLE=/path/to/chromium
node bench/browser.mjs . --verify
node bench/text-view.mjs
node bench/tree-view.mjs
node bench/worker-transfer.mjs
```

各入口启动临时本地 HTTP 服务，检查远端命中、长行/滚动末尾、复制、双树导航、视图切换、深层传输及清空；HTTP 预览不验证扩展安装及 Chrome 国际化。`bench/text-rendering.mjs` 是候选渲染方案的独立实验，实际组件数据以 `text-view.mjs` 为准。基准不要同时运行。

边界：输入和结果仍完整保留在内存中，不是流式解析器；展开全部仍需扫描容器并建立逻辑索引。大结果的原生浏览器查找只覆盖已挂载的窗口，完整 JSON 可通过树搜索定位，完整文本可用复制按钮或聚焦结果后 Ctrl/Cmd+A、C 获取。文本 diff 中间差异超过 3,000 行仍采用整块替换。上述测量不是对任意文件、深度或设备的速度保证。

日常使用优先按上文加载扩展。仅预览页面时可运行 `python3 -m http.server 8000`，访问 `http://localhost:8000/formatter.html`；原生模块不支持直接双击 HTML 的 `file://` 方式，HTTP 预览也不提供 Chrome 扩展国际化 API。

## 重新生成图标

需要 Python 3，无第三方依赖：

```bash
python3 gen_icons.py
```

输出目录为 `icons/`（会覆盖现有 PNG）。

## 打包发布

需要 Python 3，无第三方依赖：

```bash
python3 build_release.py --check
python3 build_release.py
```

脚本检查版本号、两种语言的名称和简介长度、翻译键、图标尺寸、HTML 资源引用，以及 JavaScript 静态导入和 Worker 入口的相对路径，再按白名单打包运行时文件。输出为 `dist/json-formatter-extension-<version>.zip` 和对应的 `.zip.sha256` 校验文件。`manifest.json` 位于 ZIP 根目录；测试、文档、截图、开发配置和 `.git` 不会被收录。`dist/` 已加入 Git 忽略规则。

上传前将 ZIP 解压到一个新目录，在 `chrome://extensions/` 中加载该目录并完成下面的检查。以后发布更新时先提高 `manifest.json` 的版本号，再重新打包。

### 首次上架

1. 在 [Chrome Web Store 开发者控制台](https://chrome.google.com/webstore/devconsole/)注册账号，阅读并接受协议，支付页面显示的一次性注册费。参见[注册说明](https://developer.chrome.com/docs/webstore/register)。
2. 填写发布者名称并验证联系邮箱，按控制台提示完成账号信息。为 Google 账号启用两步验证；这是发布前的[官方要求](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)。
3. 隐私政策由当前公开仓库托管：填写 [公开隐私政策网址](https://github.com/michaelHMK/json-formatter-extension/blob/main/PRIVACY.md)。修改本地 [PRIVACY.md](PRIVACY.md) 后，提交并推送到 `main` 分支即可更新公开版本；上传商店前用未登录窗口确认链接可访问。
4. 新建商店条目，上传 `dist/` 下的扩展 ZIP，按 [STORE_LISTING.md](STORE_LISTING.md) 填写中英文描述、隐私表单和测试说明，并上传 `store-assets/` 下对应语言的图片。
5. 选择分发地区和公开可见性，检查预览后提交审核。可选择审核通过后自动发布或自行发布，参见[官方发布流程](https://developer.chrome.com/docs/webstore/publish)。

### 上传前功能检查

- 点击扩展图标打开工具页；在扩展管理页确认没有加载错误。
- 检查格式化的三种缩进、无效 JSON 定位、树形展开、搜索、复制与清空。
- 检查压缩、转义和去转义，包括换行、引号、反斜杠和 Unicode 文本。
- 检查 JSON 对比的新增、删除、值及类型变化，数组主键配对、忽略路径、只看差异与文本对比。
- 在中文和英文浏览器语言下检查文字，断网后重复主要操作。
- 发布材料与实际版本保持一致，不承诺未经验证的文件处理速度。

## 隐私

- 不申请 host、storage 等敏感权限（见 `manifest.json`）
- 所有处理在浏览器本地完成，无第三方 SDK、无遥测
- 完整说明见 [隐私政策](PRIVACY.md)；商店使用[公开托管版本](https://github.com/michaelHMK/json-formatter-extension/blob/main/PRIVACY.md)
