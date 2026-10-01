# 洛谷深色模式 · Luogu Dark Mode

[![Version](https://img.shields.io/badge/version-5.0-blue.svg)](https://github.com/ppppuu348/luogu-dark-mode)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/ppppuu348/luogu-dark-mode/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/platform-Tampermonkey-orange.svg)](https://www.tampermonkey.net/)

一个为洛谷（Luogu）量身定制的深色模式用户脚本。  
A custom dark mode user script for Luogu.  
旨在提供舒适、统一且高度可定制的深色浏览体验，覆盖几乎全部常用页面。

[中文](#中文) | [English](#english)

---

## 效果图

> 图片显示可能受网络影响，若加载失败请刷新重试。

<img width="3188" height="1765" alt="屏幕截图 2026-10-01 150507" src="https://github.com/user-attachments/assets/5cf44a60-c554-4f83-b6d1-7277c88ceae8" />
<br/>
<img width="3188" height="1767" alt="屏幕截图 2026-10-01 150329" src="https://github.com/user-attachments/assets/b2fbcfff-63a3-467f-9d7d-c2125d7ad0fe" />
<br/>
<img width="3186" height="1774" alt="屏幕截图 2026-10-01 150340" src="https://github.com/user-attachments/assets/4440ac1c-1625-44c0-8b5f-c6248a938a90" />
<br/>
<img width="3190" height="1774" alt="屏幕截图 2026-10-01 150359" src="https://github.com/user-attachments/assets/f2747aac-e2af-4382-a516-04c10e2dd07c" />
<br/>
<img width="3193" height="1767" alt="屏幕截图 2026-10-01 150441" src="https://github.com/user-attachments/assets/dc7487a5-0294-4dac-a182-eddf26ca4af4" />

---

## English

### Features

- **Card-based Dark Theme** — Applies a semi-transparent `#383838` background to cards, allowing Luogu's original theme to shine through elegantly.
- **Adjustable Depth** — Press `Alt+L` to open the settings panel and adjust card opacity, test case opacity, and global saturation in real-time.
- **Universal Compatibility** — Works seamlessly on `www.luogu.com.cn`, `*.luogu.com.cn`, `*.luogu.com`, and `*.luogu.me`.
- **Comprehensive Page Coverage** — Fully tested and optimized for: problems, solutions, contests, rankings, records, user center, teams, discussions, articles, and the home page. Includes legacy pages (e.g., AmazeUI homepage) and edge-case pages (e.g., image hosting, tickets, article editor).
- **Advanced Code Highlighting** — Unified One Dark Pro color scheme for solutions (Prism) and the submit editor (CodeMirror 6).
- **Smart Adaptation** — Detects the host theme (light/dark) and applies appropriate fallback colors. Fixes hardcoded light-mode styles (e.g., white backgrounds, invisible text) in the original site.
- **One-click Toggle** — Turn the dark mode on/off directly from the Tampermonkey menu.
- **Hide Footer** — Optional toggle in the settings panel to hide the footer.
- **Zero Hardcoded Colors** — Leverages Luogu's native CSS variables and semantic classes, preserving original accent colors (e.g., difficulty tags, AC/WA status).

### Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Install the script:  
   [luogu-dark-mode.user.js](https://raw.githubusercontent.com/ppppuu348/luogu-dark-mode/main/luogu-dark-mode.user.js)
3. Open any Luogu page — it just works.

### Usage

- **`Alt+L`** — Open / close the settings panel.
- **Settings Panel** — Adjust card opacity, test-case opacity, global saturation, and toggle the footer.
- **Tampermonkey Menu** — Toggle on/off, quick opacity presets, and open the settings panel.

### Compatibility

- **Browsers**: Chrome / Edge / Firefox (requires Tampermonkey).
- **Sites**: `www.luogu.com.cn`, `*.luogu.com.cn`, `*.luogu.com`, `*.luogu.me`

### Development Notes

This script was developed with assistance from AI tools ([DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)) for code review, debugging, and iterative refinement. All design decisions and final code were verified in a real browser by the author. The architecture prioritizes CSS variables (`--ld-*`) and avoids hardcoding colors wherever possible.

### Disclaimer

This script is a personal open-source project. The author is not responsible for any issues or damages caused by using this script. Use at your own risk.

### License

MIT

---

## 中文

### 功能特性

- **深色卡片** — 半透明 `#383838` 底色，站点原主题透出来，拒绝死黑。
- **透明度深度可调** — 快捷键 `Alt+L` 打开设置面板，实时调节卡片深浅、测试点透明度及全局淡度（降饱和）。
- **代码高亮** — 题解（Prism）、提交框（CodeMirror 6）统一使用 One Dark Pro 配色。
- **全覆盖适配** — 不仅覆盖题目、题解、比赛、排行榜、评测记录、个人中心、团队、讨论、文章、首页等主要页面，还针对图床、工单、文章编辑器、私信、通知中心等冷门页面做了专项适配。
- **智能宿主检测** — 自动识别站点浅色/深色主题，修复原站写死的白底白字、内联不可读颜色，并在深色模式下保留题目难度、评测状态等语义色。
- **一键开关** — 油猴菜单里可以随时关闭深色模式。
- **隐藏底栏** — 设置面板里可切换隐藏底部版权信息。
- **零硬编码色彩** — 优先复用洛谷自带主题变量与语义类，站点换肤也能自动跟随。

### 安装

1. 先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 安装脚本：  
   [luogu-dark-mode.user.js](https://raw.githubusercontent.com/ppppuu348/luogu-dark-mode/main/luogu-dark-mode.user.js)
3. 打开任意洛谷页面，即可自动生效。

### 使用

- **快捷键 `Alt+L`** — 打开 / 关闭设置面板（按 `Esc` 可快速关闭）。
- **设置面板** — 调节卡片透明度（提供 55% / 85% 预设）、测试点透明度（100% / 70% / 45% 预设）、全局淡度，以及隐藏底栏。
- **油猴菜单** — 切换开关、快速选透明度档位、打开设置面板、恢复默认。

### 兼容

- **浏览器**：Chrome / Edge / Firefox（需要 Tampermonkey）
- **域名**：`www.luogu.com.cn`、`*.luogu.com.cn`、`*.luogu.com`

### 支持页面

脚本已在上述页面测试通过。其他洛谷页面可能也有效，但尚未完全验证。

### 开发说明

本脚本在开发过程中使用了 AI 辅助工具（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)），用于代码审查、调试和迭代优化。所有设计决策和最终代码均由作者在真实浏览器中逐项验证。代码架构优先使用 CSS 变量（`--ld-*`），尽量避免硬编码颜色。

### 免责声明

本脚本为个人开源项目。作者不对使用本脚本造成的任何问题或损失负责，请自行评估风险后使用。

### 许可证

MIT
