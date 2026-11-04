# JSON 格式化与对比工具

[English](README.md) | 简体中文

Chrome 扩展（Manifest V3）：零权限、纯本地、无广告的 JSON 工具箱。采用 Web Worker 解析与懒加载渲染，减少处理大 JSON 时的界面阻塞。不收集任何数据，不发起网络请求。

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
  shared/              # 导航、国际化、错误展示、复制、基础树节点与 Worker 客户端
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
| `pages/shared → core/json-path` | 树节点与算法共用 JSON Pointer 编码，避免特殊 key 的路径不一致。其余重计算通过 Worker 执行。 |
| `shared/worker-client → worker/index` | `runTask(action, payload)` 返回 Promise；请求按 id 配对，全部完成才结束忙碌状态；任务或通信失败统一返回 `ok: false`。 |
| `worker/tasks → core` | 每个 Worker 独立缓存最近一次 format/minify/parse 的数据供 search 使用。`includeData: false` 仅省略传回页面的数据，不清除缓存。 |
| `core` | 不依赖 DOM、Chrome API 或 Worker 全局对象；无效输入抛出异常，由任务层转换为错误响应。数字原文字面量的扫描与恢复集中在 `json.js`。 |

共享模块只提取已有的共同职责；两种树视图不通过通用渲染框架强行合并。新增任务时，先将算法放入 `core/`，再接入 `worker/tasks.js`；新增运行时文件还需加入 `build_release.py` 的白名单。

## 开发验证

需要 Node.js 20+ 和 Python 3，无需 `npm install`：

```bash
npm test
python3 build_release.py --check
```

测试覆盖数字字面量与特殊 key、搜索缓存与结果上限、结构及文本对比、Worker 并发和故障响应，以及发布包的间接模块依赖。浏览器交互仍需按下文的功能清单验证。

### 性能验证

`npm run bench` 运行搜索和对比算法基准，每个场景预热 2 次、测量 7 次取中位数。脚本支持传入旧版模块/源码目录，方便在同一环境比较；内存数据是调用前后分配增量，包含待回收临时对象，不代表峰值或常驻内存。避免同时运行其他基准。

2026-11-04 在 Linux、i5-12400、Node 24.16.0 上，以 `f070f32` 为基线测得以下结果（合成数据，不代表所有文件或设备）：

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 100 万元素数组搜索 | 110.59 ms | 16.03 ms |
| 20 万字段对象搜索 | 59.22 ms | 45.65 ms |
| 5 万条嵌套记录结构对比 | 142.66 ms | 24.36 ms |
| 5 万条记录按主键倒序对比 | 181.80 ms | 48.32 ms |
| 两侧各 1,500 行全部变更，精确文本 diff | 58.87 ms | 38.02 ms |

搜索只保存活动容器游标，只为前 500 个命中生成路径，但仍统计所有命中。结构对比复用路径栈；Myers 文本 diff 只保存有效对角线，该最坏测试场景的追踪缓冲区由约 72 MB 降为 18 MB。相同文本避免建立两份行数组。

树视图显示前 200 项及命中/差异所在子项，未显示区间可继续分页；对象 key 列表在容器内复用。层级展开只作用于按需生成的节点，不再预遍历整个 JSON。清空同时释放 Worker 搜索缓存和页面对比索引，未完成操作的旧响应不会重新填回结果。

可选浏览器基准使用开发环境已有的 Playwright 和 Chromium，不增加扩展运行时依赖：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node bench/browser.mjs . --verify
# 使用自定义 Chromium 时额外设置 CHROMIUM_EXECUTABLE=/path/to/chromium
```

它启动临时本地 HTTP 服务并验证远端命中、分页、差异导航及清空。在 Chromium 153 的一次前后对照中，2 万项数组末尾单个差异的双树节点从 40,002 降为 404，对比至绘制完成约 787 → 81 ms；搜索节点从 20,001 降为 202。浏览器耗时包含 Worker、传输、DOM 和绘制；搜索还包含 300 ms 防抖，因此不能与算法基准直接比较。HTTP 预览不验证扩展安装及 Chrome 国际化。

当前仍完整解析输入并在需要树视图时跨 Worker 传输对象，文本视图也保留完整输出；它不是流式解析器或滚动虚拟列表。极深结构的递归对比/渲染以及大量同时展开的节点仍有限制。文本 diff 中间差异超过 3,000 行时继续采用整块替换。若进一步面向超大文件，应先对实际文件测量这些环节。

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
