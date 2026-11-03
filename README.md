# JSON 格式化与对比工具

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

## 项目结构（简要）

```
manifest.json          # 扩展清单
background.js          # Service Worker（打开工具页）
worker.js              # Web Worker：大 JSON 解析等
formatter.html/js      # 格式化页
minify.html            # 压缩页（逻辑在 transform.js）
escape.html / unescape.html
compare.html / compare.js
navigation.js / i18n.js / transform.js
formatter.css
icons/                 # 扩展图标（manifest 引用）
_locales/              # 国际化文案
gen_icons.py           # 重新生成 icons/ 下 PNG（可选）
build_release.py       # 发布检查与白名单打包（Python 标准库）
STORE_LISTING.md       # Chrome 商店上架文案与表单说明
PRIVACY.md             # 中英文隐私政策（由当前公开仓库托管）
store-assets/          # 商店截图和宣传图（不打进扩展 ZIP）
```

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

脚本检查版本号、两种语言的名称和简介长度、翻译键、图标尺寸及 HTML 资源引用，再仅打包 20 个运行时文件。输出为 `dist/json-formatter-extension-<version>.zip` 和对应的 `.zip.sha256` 校验文件。`manifest.json` 位于 ZIP 根目录；文档、截图、开发配置和 `.git` 不会被收录。`dist/` 已加入 Git 忽略规则。

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
