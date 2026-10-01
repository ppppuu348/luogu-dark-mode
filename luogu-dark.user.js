// ==UserScript==
// @name         洛谷深色模式 · Luogu Dark
// @namespace    https://www.luogu.com.cn/
// @version      5.0
// @description  给洛谷全部页面（题目/列表/比赛/排行榜/记录/个人中心/团队/讨论/题解/提交）的卡片赋予 #383838 半透明深色效果；统一色板变量、修复残留白块（下拉浮层、弹窗、编辑器、分页、上传框）、适配 Prism 与 CodeMirror 代码配色，并支持一键开关与半透明度调节
// @author       You
// @match        https://www.luogu.com.cn/*
// @match        https://*.luogu.com.cn/*
// @match        https://*.luogu.com/*
// @match        https://*.luogu.me/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

/* =============================================================================
 * 设计理念（与原 luogu-dark.txt 保持一致，只是做得更彻底）
 * -----------------------------------------------------------------------------
 * 1. 只改「卡片」，不强制整页变黑。页面底色仍交给洛谷自己的主题，
 *    我们只在卡片上铺一层 #383838 @ 55% 的半透明深色，让站点主题透出来。
 * 2. 一切颜色走 token。所有色值集中在「色板」一节，并同时以 CSS 变量
 *    --ld-* 暴露在 :root 上，方便用 Stylus 或 DevTools 单独微调，
 *    不必再进脚本里全文搜索色值。
 * 3. 优先复用洛谷自带的主题变量。高亮色一律用
 *    var(--lcolor--primary, 52,152,219) 这类变量兜底，站点换主题时自动跟随。
 * 4. 尊重站点原有的「内联颜色」。用户的等级色、题目难度色等是站点用
 *    style="color:..." 写死的，我们一律用 :not([style*="color"]) 放行，
 *    不做「统一刷白」这种破坏信息的覆盖。
 * 5. 半透明 + 低对比层次。文字分三档（主/次/弱），边框 8% 白，阴影柔和，
 *    避免在深色卡片上出现纯白大色块（下拉浮层、弹窗、编辑器是重灾区）。
 * 6. 不靠 DOM 硬改来做视觉。除「给站点内联色补 alpha」这一处必要修补外，
 *    全部用 CSS 完成；JS 只负责注入、路由分包与性能控制，尽量不影响页面逻辑。
 * ========================================================================== */

(function () {
    'use strict';

    /* =========================================================================
     * ①  可调配置（改这里就够了）
     * ====================================================================== */

    // 卡片底色与透明度：CARD_ALPHA 越小越透，1 表示不透明
    var CARD_RGB   = '56, 56, 56';   // #383838
    // ★ 默认取 0.85：P13501 实测 0.55 在白底宿主上会合成为 rgb(146,146,146) 中灰，
    //   全页会有 144 个元素对比度低于 2.2（标题 2.14、侧栏小字 1.19）。
    //   0.85 合成成 rgb(56,56,56)，实测可用；滑条可随时调回 0.55 或更低。
    var CARD_ALPHA = 0.85;
    var CARD_ALPHA_MIN = 0.55;       // 「原脚本观感档」，面板里给一个快捷按钮

    // ★ 设置面板
    var PANEL_KEY   = 'Alt+L';         // 打开/关闭设置面板（可改 'Alt+Shift+L'）
    var ALPHA_MIN   = 0.30;            // 允许调到很透（浅色宿主下会偏灰，用户自选）
    var ALPHA_MAX   = 1.00;
    var UI_FONT     = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    var UI_BG       = '#2a2a2a';       // 面板底色：不透明，避免和页面半透明层叠加
    var UI_BG_SOFT  = '#333333';
    var UI_BORDER   = '#555555';
    var UI_FG       = '#f0f0f0';

    // 站点内联色（题目标签、难度条、进度格）统一补到的透明度
    var TAG_ALPHA  = 0.55;

    // 输入框 / 浮层 / 按钮底的透明度（比卡片更浅一点，保持层次）
    var PANEL_RGB   = '0, 0, 0';
    var PANEL_ALPHA = 0.25;

    // 代码框底色：站点默认透明，叠在半透明卡片上几乎看不出边界。
    // 改成不透明深色底（与提交框编辑器同色），边界清楚，也和截图一致。
    var CODE_RGB   = '30, 30, 30';   // #1e1e1e
    var CODE_ALPHA = 1;

    // 圆角
    var RADIUS = '6px';

    // ★ 层级透明度：都按「卡片 alpha × 百分比」派生，保证永远是「比卡片略深的半透明」，
    //   而不是死黑实色。样例框 80%、引用框 70%。
    var SAMPLE_RATIO = 0.80;
    var QUOTE_RATIO  = 0.70;
    var QUOTE_RGB    = '0, 0, 0';    // 引用框叠加用的基色（半透明，不是实色底）

    // 是否把整页背景也压暗（默认关闭，保持原脚本「只改卡片」的理念）
    var COVER_PAGE = false;

    // ★ 代码框斜度：卡片 alpha × 该倍率 → 比卡片略深的半透明底（不是死黑实色）。
    //   CODE_RGB/CODE_ALPHA 保留作后备，但代码框优先走这个倍率。
    var CODE_RATIO = 0.85;
    // ★ 样例区代码框单独一档：比普通代码框更透，避免在样例框(0.68)里再陷出一层。
    //   = 卡片 alpha × 0.40（默认 0.85 → 0.34）
    var SAMPLE_CODE_RATIO = 0.40;

    // 是否把 #383838 之类的中性色内联样式也补 alpha（默认关闭，只处理彩色）
    var ALPHA_NEUTRAL = false;

    // ★ 底栏：文字统一白色；可整块隐藏（面板里切换，默认展示）
    var HIDE_FOOTER = false;

    // 多个脚本副本同时注入时，只让第一个生效
    if (window.__LUOGU_DARK_CARD__) return;
    window.__LUOGU_DARK_CARD__ = true;

    /* =========================================================================
     * ②  色板：唯一色值来源
     *     改动这里会同时影响 CSS 变量与全部规则
     * ====================================================================== */

    var PALETTE = {
        fg:          '#ffffff',   // 卡片内主文字
        fgSoft:      '#d6d6d6',   // 正文
        fgMuted:     '#a0a0a0',   // 次要说明、时间、计数
        fgFaint:     '#888888',   // 占位符、极弱信息
        fgHeading:   '#f0f0f0',   // 标题
        link:        '#7fc4ff',
        linkHover:   '#b8ddff',
        primary:     'rgb(var(--lcolor--primary, 52, 152, 219))',
        primaryDark: '#2980b9',
        primarySoft: '#5dade2',
        vip:         '#d1af60',
        inlineCode:  '#ffc4c4',
        code:        '#d4d4d4',   // 代码文字
        codeBg:      'rgba(' + CODE_RGB + ', ' + CODE_ALPHA + ')',   // 代码块底色

        // 浮层 / 输入类控件（不透明，避免透过内容）
        surface:     '#2a2a2a',
        surfaceHi:   '#333333',
        surfaceDeep: '#2b2b2b',
        border:      '#555555',
        borderHi:    '#888888',

        // 边框与分隔（白 + 透明度）
        hairline:    'rgba(255, 255, 255, 0.08)',
        hairlineSoft:'rgba(255, 255, 255, 0.06)',
        track:       '#252526',
        thumb:       '#555555',
        thumbHi:     '#777777',

        // ★ VS Code One Dark Pro 代码配色（键名保持不变，只换值）
        synKeyword:  '#c678dd',   // 关键字 int / for / if / using / namespace
        synControl:  '#56b6c2',   // 预处理 #include / #define
        synFunction: '#61afef',   // 函数名 work / min / max
        synNumber:   '#d19a66',   // 数字 1003 / 0 / -1
        synString:   '#98c379',   // 字符串
        synComment:  '#5c6370',   // 注释 // 更新两次
        synType:     '#e5c07b',   // 类型名 long long / size_t
        // One Dark Pro 的「变量 / 属性」红，以及运算符浅灰；Dark+ 表里没有这两项
        synVariable: '#e06c75',   // 变量 / 属性
        synOperator: '#abb2bf',   // 运算符

        // 编辑器结构色
        editorBg:    '#1e1e1e',
        editorGutter:'#858585',
        editorActive:'#2a2a2a',
        editorSelect:'#264f78',

        // 语义色
        success:     '#a5dc86',

        // 卡片本体不在这里定义：--ld-card 由 4.1 直接写在 :root 上
        // （放在色板里会变成 var(--ld-card, var(--ld-card…)) 自引用，整条声明会失效）
        // 样例框：按原脚本设计保持透明，只靠卡片底色托着。
        // 不要再给它独立背景色 —— 否则「输入输出样例」下面会套出三层框。
        layerFallback1: 'transparent',
        layerFallback2: 'transparent',
        panel:       'rgba(' + PANEL_RGB + ', ' + PANEL_ALPHA + ')',
        shadow:      'rgba(0, 0, 0, 0.4)',
        shadowDeep:  'rgba(0, 0, 0, 0.6)'
    };

    // 暴露成 CSS 变量：--ld-fg、--ld-surface……
    var ROOT_VARS = (function () {
        var out = ':root{';
        Object.keys(PALETTE).forEach(function (k) {
            // card / panel / code 等组合值也一并暴露，便于外部覆盖
            out += '\n    --ld-' + k.replace(/[A-Z]/g, function (c) {
                return '-' + c.toLowerCase();
            }) + ': ' + PALETTE[k] + ';';
        });
        return out + '\n}';
    })();

    /* =========================================================================
     * ③  选择器片段（集中管理，方便补新组件）
     * ====================================================================== */

    // 浮层类：下拉菜单、语言选择、Popper 弹层……
    var SEL_POPOVER = 'body .dropdown, body .v-popper__popper, body .v-popper__inner, ' +
        'body .v-popper--theme-dropdown, body [class*="lang-select"], ' +
        'body [class*="language-select"], body [class*="select-menu"], ' +
        'body .lfe-dropdown, body .lfe-select, body .combo-wrapper.full';

    // 站点「带内联颜色」的元素一律放行（等级色、难度色、题目状态色）
    var NOT_INLINE_COLOR = ':not([style*="color"])';

    /* =========================================================================
     * ④  样式表
     * ====================================================================== */

    var CSS_PARTS = [];

    /* ---------- 4.1 色板变量与「只用于注入，不影响页面」的初始化 -------------- */
    CSS_PARTS.push(ROOT_VARS + '\n' + [
        '/* 让 color-scheme 走深色，原生控件（滚动条、日期选择）自动跟随 */',
        ':root { color-scheme: dark !important; }',

        '/* ★ 卡片透明度：沿用原脚本设计（rgba + alpha），不做任何颜色加深。',
        '   滑条写 --ld-layer-alpha；浅色宿主额外加一个补偿量（默认 0.55+0.30=0.85），',
        '   这是原脚本缺的「宿主主题检测」，深色宿主仍严格等于滑条值。 */',
        ':root {',
        '    --ld-layer-alpha: ' + CARD_ALPHA + ';',
        '    --ld-card-alpha: var(--ld-layer-alpha);',
        '    --ld-card: rgba(' + CARD_RGB + ', var(--ld-card-alpha, ' + CARD_ALPHA + '));',
        '    /* ★ 样例框 / 引用框：卡片 alpha × 百分比 → 比卡片略深，但仍是半透明，不是死黑 */',
        '    --ld-sample-alpha: calc(var(--ld-layer-alpha) * ' + SAMPLE_RATIO + ');',
        '    --ld-quote-alpha: calc(var(--ld-layer-alpha) * ' + QUOTE_RATIO + ');',
        '    /* ★ 代码框：卡片 alpha × 0.85，半透明比卡片略深，不再是死黑实色 */',
        '    --ld-code-alpha: calc(var(--ld-layer-alpha) * ' + CODE_RATIO + ');',
        '    --ld-sample: rgba(' + CARD_RGB + ', var(--ld-sample-alpha));',
        '    --ld-quote: rgba(' + QUOTE_RGB + ', var(--ld-quote-alpha));',
        '    --ld-code-bg: rgba(' + CARD_RGB + ', var(--ld-code-alpha));',
        '    /* ★ 样例区代码框专用（更透，避免在样例框里再陷出第三层）；',
        '       题解页 markdown 代码框与提交页 CodeMirror 继续用 --ld-code-bg，不受影响 */',
        '    --ld-sample-code-alpha: calc(var(--ld-layer-alpha) * ' + SAMPLE_CODE_RATIO + ');',
        '    --ld-sample-code-bg: rgba(' + CARD_RGB + ', var(--ld-sample-code-alpha));',
        '    /* ★ 测试点方块专属透明度（Alt+L 面板可调）。',
        '       站点用 .lcolor-bg-green-3 等语义类把底色写死为不透明 rgb()，',
        '       所以这里不重写颜色（保住色相），只调整个方块的不透明度。 */',
        '    --ld-testcase-alpha: 1;',
        '    /* ★ 全局「淡度」：由 Alt+L 面板滑块写入 --ld-saturate（默认 100%，即不修改）。',
        '       作用在 html 上做 saturate() 降饱和，用于「颜色太艳、看久了眼睛累」的场景。',
        '       放在 html 上不会改变 position:fixed 的包含块（根元素的包含块本就是视口）。 */',
        '    --ld-saturate: 100%;',
        '    --ld-layer-1: var(--ld-sample);',
        '    --ld-layer-2: var(--ld-code-bg);',
        '    /* 语法高亮：与截图一致的统一色值，Prism 与 CodeMirror 共用同一套 */',
        '    --ld-syn-keyword: ' + PALETTE.synKeyword + ';',
        '    --ld-syn-control: ' + PALETTE.synControl + ';',
        '    --ld-syn-function: ' + PALETTE.synFunction + ';',
        '    --ld-syn-number: ' + PALETTE.synNumber + ';',
        '    --ld-syn-string: ' + PALETTE.synString + ';',
        '    --ld-syn-comment: ' + PALETTE.synComment + ';',
        '    --ld-syn-type: ' + PALETTE.synType + ';',
        '    --ld-syn-variable: ' + PALETTE.synVariable + ';',
        '    --ld-syn-operator: ' + PALETTE.synOperator + ';',
        '    --ld-syn-plain: ' + PALETTE.code + ';',
        '}',
        '/* ★ 全局淡度：saturate(100%) = 原样，不受影响；调低则整页降饱和（更「淡」）。',
        '   加 !important 只是防止站点自身对 html 设 filter（实测站点没有）。 */',
        'html { filter: saturate(var(--ld-saturate, 100%)) !important; }',

        '/* ★ 卡片本体兜底文字色：站点默认 #404040，在深色卡上几乎不可见 */',
        '.l-card { color: var(--ld-fg-soft) !important; }'
    ].join('\n'));

    /* ---------- 4.2 卡片本体 ------------------------------------------------- */
    CSS_PARTS.push([
        '/* ========== 卡片背景 ========== */',
        '.theme-page {',
        '    --theme-card-background: var(--ld-card) !important;',
        '    --theme-card-backdrop-filter: none !important;',
        '}',
        '.l-card,',
        '.l-card::before,',
        '.l-card::after {',
        '    background: var(--ld-card) !important;',
        '    backdrop-filter: none !important;',
        '    -webkit-backdrop-filter: none !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    box-shadow: 0 4px 20px var(--ld-shadow) !important;',
        '}',
        '/* 卡片内的分区不再叠第二层底色，避免越套越黑 */',
        '.l-card .l-card { background: transparent !important; box-shadow: none !important; }'
    ].join('\n'));

    /* ---------- 4.3 文字层次 ------------------------------------------------- */
    CSS_PARTS.push([
        '/* ========== 文字层次 ========== */',
        '.l-card .stat .stat-text, .l-card .stat .name, .l-card .stat .value,',
        '.l-card .header-card .stat-text,',
        '.l-card .l-flex-info-row > a.name,',
        '.l-card .l-flex-info-row time,',
        '.l-card .menu .entry,',
        'footer, footer p, footer a, footer span, footer .copyright, footer .copyright a {',
        '    color: var(--ld-fg) !important;',
        '}',
        '/* ★ 记录详情右侧信息行的「值」→ 白色，但必须排除语义色类 .lcolor--*。',
        '   这条原来写 `.l-flex-info-row > span:last-child` 无排除，会把',
        '   「评测状态 Accepted」和「评测分数 100」的 .lcolor--green-3 刷成白色。',
        '   收窄后站点自己的 .lcolor--* 规则自然生效（零硬编码）。',
        '   实测这两行的值 span 都是 .l-flex-info-row 的 last-child。 */',
        '.l-card .l-flex-info-row > span:last-child:not([class*="lcolor"]) {',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card p,',
        '.l-card .lfe-marked, .l-card .lfe-marked p, .l-card .lfe-marked li,',
        '.l-card .lfe-marked strong, .l-card .lfe-marked em,',
        '.l-card .lfe-marked td, .l-card .lfe-marked th,',
        '.l-card .attachments, .l-card .attachments .item, .l-card .attachments span,',
        '.l-card .attachments svg,',
        '.l-card .lfe-h2, .l-card .lfe-h3, .l-card .lfe-h4,',
        '.l-card section .title { color: var(--ld-fg-soft) !important; }',
        '.l-card .lfe-h1, .l-card .lfe-h5, .l-card .lfe-h6 { color: var(--ld-fg-heading) !important; }',
        '.l-card .lfe-caption, .l-card .lfe-caption time,',
        '.l-card .selected-tags .lcolor--grey-3,',
        '.l-card .result .count,',
        '.l-card .page-bar .total,',
        '.l-card .attachments .light-text { color: var(--ld-fg-muted) !important; }',
        '/* ★ 记录详情右侧信息行的「标签」（所属题目/评测状态/评测分数/提交时间）→ 白色。',
        '   原来和上面那组共用 var(--ld-fg-muted)（灰 rgb(160,160,160)），按要求改为白色。 */',
        '.l-card .l-flex-info-row > span:first-child { color: var(--ld-fg) !important; }',
        /* 链接：非内联色的才是我们自己的链接 */
        '.l-card .lfe-marked a,',
        '.l-card .attachments a,',
        '.l-card .l-flex-info-row a' + NOT_INLINE_COLOR + ',',
        '.l-card .solution-list .row a' + NOT_INLINE_COLOR + ',',
        '.l-card .row .title a, .l-card .row .pid a,',
        '.l-card .selected-tags a,',
        '.l-card .result a.lfe-caption,',
        '.l-card .header-container a,',
        '.l-card .table .row .username a, .l-card .table .row .title a,',
        'footer a { color: var(--ld-link) !important; }',
        '.l-card .lfe-marked a:hover, .l-card .attachments a:hover,',
        '.l-card .row .title a:hover, .l-card .table .row .username a:hover,',
        '.l-card .table .row .title a:hover,',
        '.l-card .l-flex-info-row a' + NOT_INLINE_COLOR + ':hover,',
        '.l-card .solution-list .row a' + NOT_INLINE_COLOR + ':hover,',
        'footer a:hover { color: var(--ld-link-hover) !important; }',
        '.l-card .lfe-marked hr, .l-card .l-flex-info-row,',
        '.l-card .table .row-wrap, .l-card .table .row,',
        '.l-card .list-wrap .row-wrap, .l-card .list-wrap .row {',
        '    border-color: var(--ld-hairline) !important;',
        '}',
        '.l-card .lfe-marked :not(pre) > code,',
        '.l-card .announcement code, .l-card .bulletin code, .l-card .notice code,',
        '.l-card .feed-card-content code, .l-card .markdown-body :not(pre) > code {',
        '    background: rgba(255, 255, 255, 0.08) !important;',
        '    color: var(--ld-inline-code) !important;',
        '    border: none !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.4 标题去横线 ------------------------------------------------- */
    CSS_PARTS.push([
        '/* ★ 去掉正文标题下面自带的横线 */',
        '.l-card .lfe-marked h1, .l-card .lfe-marked h2, .l-card .lfe-marked h3,',
        '.l-card .lfe-marked h4, .l-card .lfe-marked h5, .l-card .lfe-marked h6,',
        '.l-card .lfe-h1, .l-card .lfe-h2, .l-card .lfe-h3,',
        '.l-card .lfe-h4, .l-card .lfe-h5, .l-card .lfe-h6 {',
        '    border-bottom: none !important;',
        '    padding-bottom: 0 !important;',
        '    box-shadow: none !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.5 代码块（样例框 / 题解 / 预览） ----------------------------- */
    CSS_PARTS.push([
        '/* ========== 样例区：目标结构「卡片 → 代码框」两层 ==========',
        '   ⚠️ DOM 实测：.io-sample(725x269) > .io-sample-block(355x253) > pre.lfe-code(355x197)',
        '   .io-sample-block 就是那个「套在外面的大框」，必须透明，让代码框直接坐在卡片上。 */',
        '.l-card .io-sample { background: transparent !important; }',
        '.l-card .io-sample-block { background: transparent !important; }',
        '/* ★ 「输入输出样例」大标题下不要再套框：这两个容器不参与任何边框/阴影，',
        '   只有里面的代码框自己有框。 */',
        '.l-card .io-sample, .l-card .io-sample-block,',
        '.l-card .io-sample > div, .l-card .io-sample-block > div {',
        '    border: none !important;',
        '    box-shadow: none !important;',
        '}',
        '/* ★ 代码显示框：原脚本那套独立深色底 rgba(0,0,0,0.35)，比卡片深 */',
        '.l-card .io-sample pre, .l-card .io-sample pre.lfe-code,',
        '.l-card pre.lfe-code, .l-card .lfe-code,',
        '.l-card .lfe-marked pre, .l-card .markdown-body pre,',
        '.l-card .preview pre, .l-card .code-block pre {',
        '    background: var(--ld-layer-2) !important;',
        '    color: ' + PALETTE.code + ' !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    border-radius: ' + RADIUS + ' !important;',
        '    padding: 1em !important;',
        '    overflow-x: auto !important;',
        '    box-sizing: border-box !important;',
        '    margin: 1em 0 !important;',
        '}',
        '.l-card .io-sample pre code, .l-card pre.lfe-code code,',
        '.l-card .lfe-code code, .l-card .lfe-marked pre code,',
        '.l-card .markdown-body pre code, .l-card .preview pre code {',
        '    background: transparent !important; /* 内部透明，彻底解决双层背景 */',
        '    border: none !important;',
        '    padding: 0 !important;',
        '    color: ' + PALETTE.code + ' !important;',
        '    display: block !important;',
        "    font-family: 'Consolas', 'Monaco', 'Courier New', monospace !important;",
        '}',
        '/* ★ 只覆盖「样例区」代码框的底色：更透，与样例框(0.68)接近，不陷出第三层。',
        '   题解页 markdown 代码框 / 提交页 CodeMirror 不在此选择器内，保持 --ld-code-bg 不变。 */',
        '.l-card .io-sample pre, .l-card .io-sample pre.lfe-code {',
        '    background: var(--ld-sample-code-bg) !important;',
        '}',
        '.l-card .io-sample .lfe-caption, .l-card .io-sample .lfe-caption b {',
        '    background: transparent !important;',
        '    color: var(--ld-fg-soft) !important;',
        '    border-color: transparent !important;',
        '}',
        '.l-card .io-sample .lfe-caption button {',
        '    color: var(--ld-primary) !important;',
        '    border-color: var(--ld-primary) !important;',
        '    background: transparent !important;',
        '}',
        '.l-card .io-sample .lfe-caption button:hover { background: rgba(52, 152, 219, 0.15) !important; }'
    ].join('\n'));

    /* ---------- 4.6 复制按钮 ------------------------------------------------ */
    CSS_PARTS.push([
        '/* ★ 复制按钮：站点默认 opacity:0（靠代码框 hover 才淡入）→ 深色下直接看不见。',
        '   目标：默认可见 + 融入代码框（透明底，只有白图标）+ hover 才给极淡白底反馈。',
        '   ★ 绝不覆盖 transition / transform / position —— 保留站点原生动画。 */',
        'html body button.copy-button, html body .copy-button,',
        'html body .lfe-marked button.copy-button,',
        'html body [class*="copy"] > button, html body button[class*="copy"] {',
        '    color: ' + PALETTE.fg + ' !important;',
        '    fill: ' + PALETTE.fg + ' !important;',
        '    stroke: none !important;',
        '    opacity: 1 !important;',
        '    visibility: visible !important;',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '    border: none !important;',
        '    box-shadow: none !important;',
        '}',
        '/* hover：只有极淡白底，字/图标保持白色 */',
        'html body button.copy-button:hover, html body .copy-button:hover,',
        'html body [class*="copy"] > button:hover, html body button[class*="copy"]:hover {',
        '    color: ' + PALETTE.fg + ' !important;',
        '    fill: ' + PALETTE.fg + ' !important;',
        '    background: rgba(255, 255, 255, 0.1) !important;',
        '    background-color: rgba(255, 255, 255, 0.1) !important;',
        '    border: none !important;',
        '}',
        'html body button.copy-button svg, html body button.copy-button path,',
        'html body .copy-button svg, html body .copy-button path,',
        'html body [class*="copy"] > button svg, html body button[class*="copy"] svg {',
        '    color: var(--ld-fg) !important;',
        '    fill: var(--ld-fg) !important;',
        '    stroke: none !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.7 按钮 / 标签 / 输入控件 ------------------------------------ */
    CSS_PARTS.push([
        '/* ========== 按钮统一样式 ========== */',
        '.l-card .button-transparent,',
        '.l-card.burger .body button.solid,',
        '.l-card button.transparent,',
        '.l-card .menu .button {',
        '    color: var(--ld-fg) !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.7) !important;',
        '    background: transparent !important;',
        '}',
        '.l-card .button-transparent:hover,',
        '.l-card.burger .body button.solid:hover,',
        '.l-card button.transparent:hover {',
        '    color: var(--ld-fg) !important;',
        '    border-color: var(--ld-fg) !important;',
        '    background: rgba(255, 255, 255, 0.1) !important;',
        '}',
        '/* 实心按钮：跟随站点主题色。',
        '   ★ 排除 .lcolor-var-red-3（语义红按钮，如文章编辑页的「删除文章」）——',
        '     否则会被强制成蓝底白字无边框，丢掉它的语义红。 */',
        '.l-card button.solid:not(.lcolor-var-red-3), .l-card a.solid:not(.lcolor-var-red-3),',
        '.l-card .result button.solid:not(.lcolor-var-red-3),',
        '.l-card .inquiry-header .solid:not(.lcolor-var-red-3),',
        '.l-card .inquiry-header a.solid:not(.lcolor-var-red-3) {',
        '    background-color: var(--ld-primary) !important;',
        '    color: var(--ld-fg) !important;',
        '    border-width: 0 !important;',
        '    border-style: none !important;',
        '}',
        '.l-card button.solid:hover, .l-card a.solid:hover,',
        '.l-card .result button.solid:hover,',
        '.l-card .inquiry-header .solid:hover { background-color: var(--ld-primary-dark) !important; }',
        '/* ★★ 文章编辑页（/article/<id>/edit）的「查看文章 / 删除文章」按钮：',
        '   改成题目页「复制题目 / 加入题单」(button-transparent) 的同款观感——',
        '   透明底 + rgba(255,255,255,0.7) 细描边 + 白字 + 3px 圆角（圆角/内边距沿用站点原值）。',
        '   实测原状：查看文章 = bg rgb(52,152,219) 蓝底白字；',
        '             删除文章 = bg rgb(231,76,60) 红底白字（带 lcolor-var-red-3）。',
        '   ⚠️ 已知副作用：删除文章会失去它的红色语义（变成与查看文章一致的白描边），',
        '      因为题目页那套样式本身就是「透明底 + 白描边」。若要保留红描边需要写死',
        '      rgb(231,76,60)，与「不硬编码」冲突，故未做——如需请告知。',
        '   ★ 用 :is(html) 提升特异性：此前不带 :is 的同等规则实测未生效（级联异常）。 */',
        ':is(html) body .l-card .right a.solid.l-button,',
        ':is(html) body .l-card .right button.solid {',
        '    background-color: transparent !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-width: 0.571429px !important;',
        '    border-style: solid !important;',
        '    border-color: rgba(255, 255, 255, 0.7) !important;',
        '}',
        '/* =========================================================',
        '   图床页（/image）专项。实测白底/白线：',
        '   · div.drop（725x240 拖放区）bg rgb(250,250,250) + 四边 border rgb(232,232,232)',
        '   · div.image-block（263x211 图片卡）同上',
        '   参考提交页上传框（.l-card.burger .drop）的处理：深底 + hairline 边框。',
        '   黑字：time（发布时间）与 span（130.02KB）都是 rgb(89,89,89) → muted。',
        '   ========================================================= */',
        ':is(html) body .l-card .drop, :is(html) body .drop {',
        '    background-color: var(--ld-surface) !important;',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        ':is(html) body .l-card .image-block, :is(html) body .image-block {',
        '    background-color: var(--ld-surface) !important;',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        ':is(html) body .image-block time,',
        ':is(html) body .image-block span,',
        ':is(html) body .image-block .lfe-caption {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* =========================================================',
        '   工单页（/ticket/*）专项。实测：',
        '   · div.top-bar（"工单列表"那条）bg rgb(255,255,255) 纯白 ← 脚本无任何规则命中',
        '   · h1.title（链 h1.title < .ticket-banner < main）color rgb(64,64,64) 深灰',
        '   · hr 分割线 border-top rgb(232,232,232) 白线',
        '   注：div.cs-upload 的 rgb(255,249,204) 淡黄是「拖放图片」的语义提示色，保留不动。',
        '   ========================================================= */',
        'html body .top-bar {',
        '    /* 用 --ld-surface-hi(#333333) 而不是 --ld-surface(#2a2a2a)：',
        '       后者与 .theme-page 页面底同色，会让顶栏失去层次（用户反馈）。 */',
        '    background-color: var(--ld-surface-hi) !important;',
        '    /* 站点这条 bar 的文字是 rgb(51,51,51) 深色，压暗底后必须同时提亮字色 */',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 工单列表的「牌子」：实测是无类名的 span（100x20，bg rgb(232,232,232)），',
        '   链：span < .left.row < .row.space-between < .ticket-card。',
        '   与比赛列表/专栏牌子同一处理：深色底 + 浅色字。 */',
        'html body .ticket-card .left.row span,',
        'html body .l-card .ticket-card .left.row span {',
        '    background-color: var(--ld-panel) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '/* =========================================================',
        '   创建工单页（/ticket/new）专项。实测：',
        '   · div.title（"工单类型/综合问题"等小节标题）color rgb(64,64,64)，',
        '     在 rgb(42,42,42) 底上对比度仅 1.38 → 不可辨认。',
        '   · button.lcolor-var-blue-4（"一般咨询"等 3 个）color/border rgb(20,85,143)',
        '     对比度仅 1.57 → 不可辨认。其余牌子都是 -3 亮色变体，正常。',
        '   · div.side-info 的 border-left rgb(232,232,232) = 那条白竖线。',
        '   ★ 牌子提亮采用站点自带的颜色阶梯变量，保留色相、零硬编码：',
        '     --lcolor--blue-3 = "52, 152, 219"（-4 是暗色，-3 是亮色）。',
        '   ========================================================= */',
        'html body div.title {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        ':is(html) body button.lcolor-var-blue-4 {',
        '    color: rgb(var(--lcolor--blue-3)) !important;',
        '    border-top-color: rgb(var(--lcolor--blue-3)) !important;',
        '    border-right-color: rgb(var(--lcolor--blue-3)) !important;',
        '    border-bottom-color: rgb(var(--lcolor--blue-3)) !important;',
        '    border-left-color: rgb(var(--lcolor--blue-3)) !important;',
        '}',
        '/* ★ 通用错误页卡片：站点用 .l-card.error-background（2 个类，特异性高于我的',
        '   .l-card 单类规则）把底色写死为 rgb(255,255,255)，所以整块 1168x600 全白。',
        '   实测出现于 /user/<不可见用户> 等出错页。加同/更高特异性的规则覆盖。 */',
        'html body .l-card.error-background,',
        'html body .error-background,',
        'html body .l-card .error-background {',
        '    background-color: var(--ld-card) !important;',
        '}',
        'html body .l-card.error-background *,',
        'html body .error-background * {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 空内容的「原始 Markdown」容器被代码块样式画成了空框：',
        '   实测 /training/1099646（题单简介为空）会渲染 <div.lfe-marked><pre.lfe-marked-original></pre></div>，',
        '   该 pre childNodes = 0、textLen = 0，却被我统一的 pre 样式（深底 + rgba(255,255,255,0.08)',
        '   边框 + 6px 圆角）画成一个 725x33 的空框，即用户看到的「自带小框」。',
        '   用 :empty 只命中「真正的空 pre」，有内容（正常显示原始 Markdown）时不受影响。',
        '   只把底色与边框置透明 —— 不动尺寸/内边距，符合「不改布局」约束。 */',
        'html body pre.lfe-marked-original:empty,',
        'html body .lfe-marked-original:empty {',
        '    background-color: transparent !important;',
        '    border-top-color: transparent !important;',
        '    border-right-color: transparent !important;',
        '    border-bottom-color: transparent !important;',
        '    border-left-color: transparent !important;',
        '}',
        '/* ★ 错误页上的侧边导航（nav.sidebar.lside.bar）实测 bg rgb(255,255,255) 纯白 +',
        '   文字 rgb(38,38,38) 深色（其它页面是 rgb(56,56,56)）。枚举证明它【没有任何',
        '   CSS 规则设置背景色】（我脚本里也没有），完全靠站点样式，而该错误页状态下',
        '   站点给的是浅色。用 :has(.error-background) 限定「只在错误页生效」，',
        '   避免影响正常页面的侧栏观感。 */',
        'html body:has(.error-background) nav.sidebar,',
        'html body:has(.error-background) .sidebar.lside,',
        'html body:has(.error-background) .user-nav {',
        '    background-color: var(--ld-surface-hi) !important;',
        '}',
        'html body:has(.error-background) nav.sidebar span,',
        'html body:has(.error-background) nav.sidebar a,',
        'html body:has(.error-background) .sidebar.lside span,',
        'html body:has(.error-background) .sidebar.lside a,',
        'html body:has(.error-background) .user-nav span,',
        'html body:has(.error-background) .user-nav a {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* =========================================================',
        '   题库列表页（/problem/list）的浅色分隔线。实测：',
        '   · div.menu-container border-bottom rgb(232,232,232)（筛选标签栏下沿）',
        '   · div.section border-bottom rgb(232,232,232)',
        '   只改 border-*-color，不动宽度。',
        '   ========================================================= */',
        'html body .l-card .menu-container,',
        'html body .menu-container {',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '}',
        'html body .l-card .section,',
        'html body .section {',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '}',
        '/* =========================================================',
        '   ★★ 独立 404 页（如 /setting 这类不存在的路径）：',
        '   它【不在 Vue 应用壳内】，另有一套 .wrapped / .lfe-body / .card.message 布局，',
        '   并自带带「登录 注册」的页头，因此此前所有 .l-card 体系规则完全够不着。实测：',
        '   · main.wrapped.lfe-body.mobile-body  bg rgb(239,239,239)',
        '   · div.card.message.padding-default  bg rgb(255,255,255) + 字 rgba(0,0,0,0.75)',
        '   · div.user-nav（页头右侧）          bg rgba(255,255,255,0.5)',
        '   · 页头 span「登录」                 color rgb(51,51,51)',
        '   ========================================================= */',
        'html body main.wrapped.lfe-body,',
        'html body .wrapper.wrapped,',
        'html body .main-container {',
        '    background-color: var(--ld-surface) !important;',
        '}',
        'html body .card.message {',
        '    background-color: var(--ld-card) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .card.message *,',
        'html body .wrapper.wrapped .header span,',
        'html body .wrapper.wrapped .header a,',
        'html body .wrapper.wrapped .header .user-nav {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .wrapper.wrapped .header .user-nav,',
        'html body .wrapper.wrapped .header {',
        '    background-color: transparent !important;',
        '}',
        '/* ★★ 编辑器「帮助」弹窗（点工具栏 ? 打开）：',
        '   实测 dom 为 .cs-dialog-container（遮罩 rgba(0,0,0,0.2)）> .cs-dialog + .cs-dialog-header，',
        '   而 .cs-dialog 是 bg rgb(255,255,255) 纯白、header/正文都是 rgb(64,64,64) 深字。',
        '   它是 teleport 到 body 的浮层，不带 .l-card，故必须独立覆盖。',
        '   （历史版本 🕘 等其它 cs-dialog 共用同一套类名，一并覆盖。） */',
        'html body .cs-dialog,',
        'html body .cs-dialog-header,',
        'html body .cs-dialog-body,',
        'html body .cs-dialog-footer,',
        'html body .cs-dialog-content {',
        '    background-color: var(--ld-card) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .cs-dialog :not(a):not(button):not([class*="lcolor"]):not([class*="token"]):not(svg):not(path) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .cs-dialog-container {',
        '    background-color: rgba(0, 0, 0, 0.5) !important;',
        '}',
        '/* ★★ 编辑器「设置 / 更多」等其它内联浮层：统一给深色底（teleport 到 body，不带 .l-card） */',
        'html body .l-card.container.type-burger,',
        'html body .l-card.container {',
        '    background-color: var(--ld-card) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 工单创建页左侧说明栏的白竖线（div.side-info border-left rgb(232,232,232)） */',
        'html body .side-info {',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        '/* =========================================================',
        '   首页（/）专项 —— 这是洛谷最老的 AmazeUI 布局（.am-* / .lg-*），',
        '   与其它页面的 .l-card 体系完全不同，几乎未深色化。实测：',
        '   · BODY bg rgb(255,255,255) · MAIN / .main-container bg rgb(239,239,239)',
        '   · .lg-article bg rgba(255,255,255,0.7) · .am-panel / .am-slider bg rgb(255,255,255)',
        '   · input.am-form-field / textarea bg rgb(255,255,255)',
        '   · header.am-comment-hd bg rgb(248,248,248)',
        '   ★ 宽泛规则用 :has(.lg-index-content) 限定「只在首页生效」，避免影响其它页面。',
        '   ========================================================= */',
        'html body:has(.lg-index-content),',
        'html body:has(.lg-index-content) .main-container,',
        'html body:has(.lg-index-content) main {',
        '    background-color: var(--ld-surface) !important;',
        '}',
        'html body:has(.lg-index-content) .lg-article,',
        'html body:has(.lg-index-content) .am-panel,',
        'html body:has(.lg-index-content) .am-slider,',
        'html body:has(.lg-index-content) .am-slider-slide,',
        'html body:has(.lg-index-content) .am-slider-desc {',
        '    background-color: var(--ld-card) !important;',
        '}',
        'html body:has(.lg-index-content) .am-comment-hd,',
        'html body:has(.lg-index-content) .am-comment-bd {',
        '    background-color: var(--ld-panel) !important;',
        '}',
        'html body:has(.lg-index-content) input.am-form-field,',
        'html body:has(.lg-index-content) .am-form-field,',
        'html body:has(.lg-index-content) textarea {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-top-color: var(--ld-border) !important;',
        '    border-right-color: var(--ld-border) !important;',
        '    border-bottom-color: var(--ld-border) !important;',
        '    border-left-color: var(--ld-border) !important;',
        '}',
        '/* ★ 首页文字提亮。实测残留深色文字 9 处（全部 rgb(64,64,64) / rgb(81,81,81) /',
        '   rgb(52,73,94)）：H2「…的运势」· .lg-punch-result「§ 大凶 §」·「装弱」·',
        '   .lg-bold「忌：」· SVG text「120」·「暂无推荐」· STRONG「推荐题库」·',
        '   .lg-fg-bluedark「进行中」。',
        '   用 main 作用域的宽泛规则提亮，并排除 a/按钮/输入框/语义 class。 */',
        'html body:has(.lg-index-content) main :not(a):not(button):not(input):not(textarea):not(select):not([class*="am-btn"]):not([class*="am-panel-"]):not([class*="lg-fg-"]):not([class*="lg-bg-"]) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* SVG <text> 用的是 fill 而非 color，单独处理 */',
        'html body:has(.lg-index-content) main svg text,',
        'html body:has(.lg-index-content) main text {',
        '    fill: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 语义色 .lg-fg-bluedark（rgb(52,73,94) 深蓝，深卡上不可读）：保留蓝色相、提亮 */',
        'html body:has(.lg-index-content) .lg-fg-bluedark {',
        '    color: var(--ld-link) !important;',
        '}',
        '/* ★★ 图表悬浮框：首页的图表是 Highcharts（div.highcharts-container），',
        '   悬浮框是 <g class="highcharts-tooltip"> 内的 <path>（底+边框）+ <text>，',
        '   只在 hover 时插入 SVG，实测无法用合成事件复现，因此按 Highcharts 稳定的',
        '   类名定位（安全：该类名是 Highcharts API 的一部分）。',
        '   Highcharts 默认把底色/边框写成 SVG 呈现属性（fill=rgba(247,247,247,.85) /',
        '   stroke=silver），优先级最低，CSS 可覆盖。',
        '   → 底色改深、边框由「白线」改深色线、文字保持白色（已由上面的规则设为白）。 */',
        'html body .highcharts-tooltip path,',
        'html body .highcharts-tooltip > path,',
        'html body .highcharts-tooltip path:first-child,',
        'html body .highcharts-tooltip path:last-child {',
        '    fill: var(--ld-surface) !important;',
        '    stroke: var(--ld-border) !important;',
        '}',
        'html body .highcharts-tooltip text,',
        'html body .highcharts-tooltip tspan {',
        '    fill: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 图表自身的网格线 / 轴线：Highcharts 默认是浅灰，深底上刺眼 → 改用 hairline */',
        'html body .highcharts-grid-line,',
        'html body .highcharts-axis-line,',
        'html body .highcharts-tick {',
        '    stroke: var(--ld-hairline) !important;',
        '}',
        'html body .highcharts-axis-labels text,',
        'html body .highcharts-legend-item text,',
        'html body .highcharts-title text,',
        'html body .highcharts-subtitle text,',
        'html body .highcharts-yaxis-title text,',
        'html body .highcharts-xaxis-title text {',
        '    fill: ' + PALETTE.fg + ' !important;',
        '}',
        '/* =========================================================',
        '   题单广场（/training/list）专项。实测浅底浅边：',
        '   · div.category-card（283x97 顶部分类卡）border rgb(232,232,232)，',
        '     其中 .active 的 bg 是 rgb(240,247,255) 淡蓝',
        '   · div.training-card（364x116 题单卡）bg rgb(250,250,250) + border rgb(232,232,232)',
        '   深色文字：.card-title rgb(38,38,38) · .card-desc / span rgb(89,89,89)',
        '   ========================================================= */',
        'html body .category-card {',
        '    /* ★ 不能设 transparent：这几张卡位于页面「云彩背景图」之上，',
        '       透明会让亮色背景图透出，白字不可读（实测回归）。给实心深色底。 */',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        'html body .category-card.active {',
        '    background-color: var(--ld-surface-hi) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-top-color: var(--ld-border) !important;',
        '    border-right-color: var(--ld-border) !important;',
        '    border-bottom-color: var(--ld-border) !important;',
        '    border-left-color: var(--ld-border) !important;',
        '}',
        'html body .training-card {',
        '    background-color: var(--ld-surface) !important;',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        '/* ★ 环形进度条的底轨：SVG <circle cx=50 cy=50 r=41 fill="#fff">（.liquid-chart 内，共 18 个）。',
        '   fill="#fff" 是「呈现属性」，优先级最低，普通 CSS 即可覆盖（无需 !important，仍加上保险）。',
        '   改成比卡片底(--ld-surface #2a2a2a)浅一档的 --ld-surface-hi(#333333)。 */',
        'html body .liquid-chart circle[fill="#fff"],',
        'html body .liquid-chart circle[fill="#FFF"],',
        'html body .liquid-chart circle[fill="#ffffff"] {',
        '    fill: var(--ld-surface-hi) !important;',
        '}',
        'html body .training-card .card-title,',
        'html body .category-card .card-title {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .training-card .card-desc,',
        'html body .category-card .card-desc,',
        'html body .training-card span,',
        'html body .category-card span {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        'html body main.main h1.title,',
        'html body .ticket-banner h1,',
        'html body .ticket-banner .title {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 分割线：只改 border-top-color，不动宽度 */',
        'html body main.main hr,',
        'html body .l-card hr {',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '}',
        '/* ★ 工单编辑页的上传文件框（div.upload-card 949x137）：',
        '   实测 bg rgb(250,250,250) 白 + border rgb(232,232,232) 0.571429px dashed。',
        '   参考提交页上传框（.l-card.burger .drop）→ 深底 + hairline 边框。',
        '   ★ 只改 border-*-color，保留站点的 dashed 虚线样式与宽度。',
        '   注：编辑器内的 div.cs-upload（bg rgb(255,249,204) + 黄虚线 4.57px）',
        '       是「拖放图片到此」的语义高亮层，保留不动。 */',
        'html body .l-card .upload-card {',
        '    background-color: var(--ld-surface) !important;',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '   → background-color: var(--ld-primary-dark)（蓝），会把「透明描边风格」的',
        '   实心按钮刷成蓝色。实测这类按钮都放在 .btn-actions 容器里',
        '   （文章编辑页「查看文章/删除文章」、云剪贴板页「编辑」等），',
        '   这里用 :is(html) 提特异性覆盖为「略亮的深色底 + 白字 + 更亮的白边」，不变蓝。 */',
        ':is(html) body .l-card .btn-actions a.solid:hover,',
        ':is(html) body .l-card .btn-actions button.solid:hover,',
        ':is(html) body .l-card .right a.solid.l-button:hover,',
        ':is(html) body .l-card .right button.solid:hover {',
        '    background-color: rgba(255, 255, 255, 0.1) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: rgba(255, 255, 255, 0.9) !important;',
        '}',

        '/* ========== 内联式表单控件 ========== */',
        '.l-card .combo-wrapper,',
        '.l-card .combo-wrapper.combo,',
        '.l-card .combo-wrapper.form-item,',
        '.l-card .combo-wrapper.form-item.block-item.combo,',
        '.l-card.burger .combo-wrapper.lang-select,',
        '.l-card.burger .combo-wrapper.light-black {',
        '    background-color: var(--ld-surface) !important;',
        '    border: 1px solid var(--ld-border) !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .combo-wrapper .text, .l-card .combo-wrapper .text *,',
        '.l-card .combo-wrapper input, .l-card .combo-wrapper input[type="text"],',
        '.l-card .combo-wrapper .text input,',
        '.l-card.burger .combo-wrapper .text {',
        '    background-color: transparent !important;',
        '    color: var(--ld-fg) !important;',
        '    border: none !important;',
        '    box-shadow: none !important;',
        '}',
        '.l-card .combo-wrapper .placeholder, .l-card input.search-text::placeholder,',
        '.l-card .refined-input input::placeholder { color: var(--ld-fg-faint) !important; }',
        '.l-card .combo-wrapper .arrow svg,',
        '.l-card .refined-input .east, .l-card .refined-input .search-icon,',
        '.l-card .refined-input .west, .l-card .refined-input .west svg { color: var(--ld-fg-soft) !important; }',
        '.l-card .combo-wrapper .ruler { background-color: transparent !important; border-color: var(--ld-border) !important; }',

        '/* 关键词 / 搜索框：外层浅底 + 内层完全透明，避免深色圆角套娃 */',
        '.l-card .refined-input, .l-card .refined-input.search-text {',
        '    background: rgba(255, 255, 255, 0.06) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    border-radius: 4px !important;',
        '    box-shadow: none !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .refined-input > *, .l-card .refined-input * { background: transparent !important; }',
        '.l-card .refined-input input, .l-card .refined-input input.search-text,',
        '.l-card input.search-text, .l-card input.scoreboard-search,',
        '.l-card .refined-input.scoreboard-search input,',
        '.l-card input[placeholder*="UID"], .l-card input[placeholder*="用户名"],',
        '.l-card input[placeholder*="关键词"], .l-card input[placeholder*="搜索"],',
        '.l-card .tag-select-area .search-box input {',
        '    background: transparent !important;',
        '    border: none !important;',
        '    border-radius: 0 !important;',
        '    box-shadow: none !important;',
        '    outline: none !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .refined-input.scoreboard-search {',
        '    background: rgba(255, 255, 255, 0.06) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    border-radius: 4px !important;',
        '    box-shadow: none !important;',
        '}',
        '.l-card input[placeholder*="UID"]::placeholder,',
        '.l-card input[placeholder*="用户名"]::placeholder,',
        '.l-card input[placeholder*="关键词"]::placeholder,',
        '.l-card input[placeholder*="搜索"]::placeholder,',
        '.l-card .refined-input.scoreboard-search input::placeholder { color: var(--ld-fg-muted) !important; }',

        '/* 标签按钮 */',
        '.l-card button.tag-button, .l-card .toggle-tag, .l-card .tag-select-area .toggle-tag {',
        '    background: var(--ld-surface) !important;',
        '    border: 1px solid var(--ld-border) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card button.tag-button:hover, .l-card .toggle-tag:hover {',
        '    background: var(--ld-surface-hi) !important;',
        '    border-color: var(--ld-border-hi) !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .search-option label, .l-card .search-option svg { color: var(--ld-fg-soft) !important; }',
        '.l-card .tag-select-area .title { color: var(--ld-fg-heading) !important; }',
        '.l-card .lfe-marked h1, .l-card .lfe-marked h2, .l-card .lfe-marked h3 { color: var(--ld-fg-heading) !important; }',
        '.l-card .lfe-marked blockquote {',
        '    /* ★ 卡片 alpha × 70%，半透明略深，不是死黑实色 */',
        '    background: var(--ld-quote) !important;',
        '    border-left: 4px solid rgba(255, 255, 255, 0.2) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '    padding: 0.5em 1em !important;',
        '    margin: 1em 0 !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.8 页内 tab / 菜单 ------------------------------------------- */
    CSS_PARTS.push([
        '/* ========== 页内 tab / 菜单 ========== */',
        '.l-card .menu .entry, .l-card .menu .items li .entry,',
        '.l-card .rank-tabs a, .l-card .rank-tabs span { color: var(--ld-fg-soft) !important; }',
        '.l-card .menu .entry.selected, .l-card .menu .items li .entry.selected,',
        '.l-card .rank-tabs a.active, .l-card .rank-tabs .selected,',
        '.l-card .scoreboard-header nav li.selected { color: var(--ld-primary) !important; }'
    ].join('\n'));

    /* ---------- 4.9 浮层：下拉 / Popper / 弹窗 -------------------------------- */
    CSS_PARTS.push([
        '/* =========================================================',
        '   ★★★ 下拉框、语言切换等浮层：必须用不透明底色，',
        '        半透明会让下面的正文透上来，可读性直接崩掉',
        '   ========================================================= */',
        'html ' + SEL_POPOVER + ' {',
        '    /* ★ 只用 background-color 长写：background 简写会重置 background-image，',
        '       把 popover 里的封面图（内联 background-image）一并清成 none。 */',
        '    background-color: var(--ld-surface) !important;',
        '    border: 1px solid var(--ld-border) !important;',
        '    border-radius: 4px !important;',
        '    box-shadow: 0 4px 12px var(--ld-shadow-deep) !important;',
        '    color: var(--ld-code) !important;',
        '}',
        '/* ★ 语言选择框单独走代码框同一套半透明系数（其余浮层暂保持不透明，等确认）。',
        '   实测该框结构：div.dropdown.shown > div.dropdown-operations > ul > li（没有 <a>），',
        '   且 teleport 到 body 下、不带 lang-select 类，所以用 :has(.dropdown-operations) 做内容感知匹配。 */',
        'html body [class*="lang-select"], html body [class*="language-select"],',
        'html body .l-card.burger .combo-wrapper.lang-select,',
        'html body .dropdown.shown:has(.dropdown-operations) {',
        '    /* ★ 同样改长写，避免简写重置 background-image（同类隐患统一处理） */',
        '    background-color: var(--ld-code-bg) !important;',
        '}',
        'html body .dropdown ul, html body .v-popper__popper ul,',
        'html body .v-popper__inner ul, html body .v-popper--theme-dropdown ul,',
        'html body [class*="lang-select"] ul, html body [class*="dropdown"] ul,',
        'html body .lfe-dropdown ul { background: transparent !important; }',
        'html body .dropdown li, html body .dropdown a, html body .dropdown div,',
        'html body .v-popper__popper li, html body .v-popper__popper a, html body .v-popper__popper div,',
        'html body .v-popper__inner li, html body .v-popper__inner a, html body .v-popper__inner div,',
        'html body .v-popper--theme-dropdown li, html body .v-popper--theme-dropdown a,',
        'html body .v-popper--theme-dropdown div,',
        'html body [class*="lang-select"] li, html body [class*="lang-select"] a,',
        'html body [class*="dropdown"] li, html body [class*="dropdown"] a,',
        'html body .lfe-dropdown li, html body .lfe-dropdown a {',
        '    color: ' + PALETTE.code + ' !important;',
        '    /* ★ 长写：简写 background 会把 popover 内 div 的 background-image 清成 none */',
        '    background-color: transparent !important;',
        '}',
        'html body .dropdown li:hover, html body .dropdown a:hover,',
        'html body .v-popper__popper li:hover, html body .v-popper__popper a:hover,',
        'html body .v-popper__inner li:hover, html body .v-popper__inner a:hover,',
        'html body .v-popper--theme-dropdown li:hover, html body .v-popper--theme-dropdown a:hover,',
        'html body [class*="lang-select"] li:hover,',
        'html body [class*="dropdown"] li:hover, html body [class*="dropdown"] a:hover,',
        'html body .lfe-dropdown li:hover, html body .lfe-dropdown a:hover {',
        '    background-color: #3a3a3a !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        'html body .v-popper__arrow-container .v-popper__arrow-inner,',
        'html body .v-popper__arrow-container .v-popper__arrow-outer {',
        '    border-color: var(--ld-surface) !important;',
        '    background: var(--ld-surface) !important;',
        '}',

        '/* ★ SweetAlert2 弹窗（复制成功、提交确认等） */',
        '.swal2-popup {',
        '    background-color: var(--ld-surface-deep) !important;',
        '    color: var(--ld-fg) !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.1) !important;',
        '    box-shadow: 0 4px 20px var(--ld-shadow-deep) !important;',
        '}',
        '.swal2-title { color: var(--ld-fg) !important; }',
        '.swal2-html-container { color: ' + PALETTE.code + ' !important; }',
        '.swal2-success-circular-line-left, .swal2-success-circular-line-right,',
        '.swal2-success-fix { background-color: var(--ld-surface-deep) !important; }',
        '.swal2-icon.swal2-success { border-color: var(--ld-success) !important; color: var(--ld-success) !important; }',
        '.swal2-icon.swal2-success [class^=swal2-success-line] { background-color: var(--ld-success) !important; }',
        '.swal2-icon.swal2-success .swal2-success-ring { border: 4px solid rgba(165, 220, 134, 0.3) !important; }',
        '.swal2-styled.swal2-confirm { background-color: var(--ld-primary) !important; }',
        '.swal2-styled.swal2-cancel { background-color: var(--ld-surface-hi) !important; color: var(--ld-fg) !important; }',

        '/* 通用模态框 / 遮罩 */',
        '.lfe-modal .lfe-modal-body, .lfe-modal .lfe-modal-content, .lfe-dialog,',
        '.modal .modal-content, .modal-content, .popup-content {',
        '    background: var(--ld-surface) !important;',
        '    color: var(--ld-fg) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '}',
        '.lfe-modal .lfe-modal-header, .lfe-modal .lfe-modal-footer {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '    color: var(--ld-fg) !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.10 页脚、列表、分页、进度 ---------------------------------- */
    CSS_PARTS.push([
        '/* ========== 页脚链接悬停 ========== */',
        'footer a:hover { color: var(--ld-link-hover) !important; }',

        '/* ========== 列表 / 表格骨架 ========== */',
        '.l-card .list-wrap, .l-card .list-wrap.table, .l-card .list-wrap.table.border,',
        '.l-card .table, .l-card .table.border {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '}',
        '.l-card .list .header-wrap, .l-card .list .header,',
        '.l-card .list-wrap .header-wrap, .l-card .list-wrap .header,',
        '.l-card .table .header-wrap, .l-card .table .header {',
        '    background: transparent !important;',
        '    border: none !important;',
        '    box-shadow: none !important;',
        '}',
        '.l-card .header-container, .l-card .header-container .sortable,',
        '.l-card .header-container span, .l-card .table .header-container .sortable { color: var(--ld-fg-soft) !important; }',
        '.l-card .table .header-container .lfe-caption { color: var(--ld-fg-muted) !important; }',
        '.l-card .list-wrap .row-wrap, .l-card .list-wrap .row,',
        '.l-card .table .row-wrap, .l-card .table .row {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline-soft) !important;',
        '}',
        '/* ★ 行 hover 不再在这里统一给背景：表格页保留，列表页完全交给站点原生悬停 */',
        '.l-card .table .row:hover { background: rgba(255, 255, 255, 0.06) !important; }',
        '/* ★★★ 禁止任何「大容器」hover 高亮：',
        '   实测题解页 .row-wrap > .row = 725x578（整篇题解的容器），',
        '   contest/list 的 .row-wrap = 1125x1311（整张列表），',
        '   给它们加 :hover 会造成「整块被点亮」。这些规则已全部删除，',
        '   卡片/整行悬停交回站点原生样式。 */',
        '/* ★ .list-wrap:not(.table)：记录列表容器是 `.list-wrap.table`（同时带两个类），',
        '   若不加 :not(.table)，这条透明规则会以「同特异性、源码更靠后」压掉上面',
        '   `.l-card .table .row:hover` 的浅色高亮，导致评测记录行 hover 时背景变空。 */',
        '.l-card .list-wrap:not(.table) .row:hover,',
        '.l-card.solution-list .row:hover, .l-card.solution-list .row-wrap:hover,',
        '.l-card .solution-list .row:hover, .l-card .solution-list .row-wrap:hover {',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '}',
        '.l-card .row .pid, .l-card .table .row .rank, .l-card .table .row .user,',
        '.l-card .table .row .total { color: var(--ld-fg-soft) !important; }',
        '.l-card .table .row [class*="time"], .l-card .table .row .light-text,',
        '.l-card .table .row .secondary, .l-card .table .row .total .td-runtime { color: var(--ld-fg-muted) !important; }',
        '/* ★ 分数 span 必须排除语义色类 .lcolor--*：站点用 .lcolor--green-3 / red-3 / orange-3',
        '   给分数上 AC/WA 语义色，被这条白字规则命中就全变白（丢失绿/红语义）。',
        '   收窄后站点自己的 .lcolor--* 规则自然生效 —— 零硬编码，站点换色自动跟随。',
        '   容器（.status / .score / .full-score / .total .td-score）不排除，保持 var(--ld-fg)。 */',
        '.l-card .table .row .status, .l-card .table .row .status span:not([class*="lcolor"]),',
        '.l-card .table .row .score:not([class*="lcolor"]), .l-card .table .row .score span:not([class*="lcolor"]),',
        '.l-card .table .row .full-score, .l-card .table .row .full-score *,',
        '.l-card .table .row [class*="full-score"],',
        '.l-card .table .row .total .td-score { color: var(--ld-fg) !important; }',

        '/* ========== 进度框 ========== */',
        '.l-card .progress-frame {',
        '    background: rgba(0, 0, 0, 0.5) !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.25) !important;',
        '    box-shadow: none !important;',
        '    box-sizing: border-box !important;',
        '    padding: 0 !important;',
        '}',
        '.l-card .progress-frame > .square { border: none !important; margin: 0 !important; }',

        '/* ========== 底部工具条 / 分页 ========== */',
        '.l-card .bottom-wrap, .l-card .toolbar {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '}',
        '.l-card .bottom-wrap.float {',
        '    background: #383838 !important;',
        '    border-top: 1px solid rgba(255, 255, 255, 0.1) !important;',
        '    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.35) !important;',
        '}',
        '.l-card .toolbar .btn-checkbox { color: var(--ld-link) !important; }',
        '.l-card .page-bar .total strong { color: var(--ld-fg) !important; }',
        '.l-card .page-bar button {',
        '    background: transparent !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.15) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .page-bar button:hover { border-color: rgba(255, 255, 255, 0.4) !important; color: var(--ld-fg) !important; }',
        '.l-card .page-bar button.selected {',
        '    background: var(--ld-primary) !important;',
        '    border-color: var(--ld-primary) !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .selected-tags .lfe-caption { color: var(--ld-fg-muted) !important; }'
    ].join('\n'));

    /* ---------- 4.10b 比赛列表页（contest/list）------------------------------ */
    CSS_PARTS.push([
        '/* =========================================================',
        '   比赛列表页（原脚本没覆盖这块）',
        '   ========================================================= */',
        '/* ★ 结果计数 .filter-result-count .number 是站点内联色 rgba(0,0,0,0.75)',
        '   （黑字配白底），在深色卡上几乎不可见，纠正为跟随卡片文字色。',
        '   只改计数本身，不动旁边作者名的等级色。 */',
        '.l-card .filter-result-count,',
        '.l-card .filter-result-count .number,',
        '.l-card .result .count .number,',
        '.l-card .row .number, .l-card .list-wrap .row .number {',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .filter-result-count a, .l-card .filter-result-count strong {',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .row .name, .l-card .list-wrap .row .name,',
        '.l-card .row .provider-display, .l-card .list-wrap .row .provider-display,',
        '.l-card .row .provider, .l-card .list-wrap .row .provider {',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '/* 状态图标（进行中 / 已结束等）：卡片上按次要文字处理 */',
        '.l-card .row .icon-status, .l-card .list-wrap .row .icon-status {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* 比赛类型标签保留站点本身的色底，只保证文字可读 */',
        '.l-card .row .tag, .l-card .list-wrap .row .tag { color: var(--ld-fg) !important; }',
        '/* ★★★ 比赛列表页的筛选卡片（.l-card.filter-card）：',
        '   未选中态原来是 rgb(87,87,87) + 透明底，在深色卡上对比度 1.02，整排隐形。',
        '   现在改成与「题目列表页 主题库/洛谷/CF/AT 选项卡」同一套设计：',
        '   未选中 = 主题蓝文字 + 主题蓝边框 + 透明底 + 3px 圆角 + 1px 8px 内边距；',
        '   选中 = 主题蓝实底 + 白字。站点样式带 data-v-* 作用域，所以用 html body 压特异性。 */',
        'html body .l-card.filter-card button.option,',
        'html body .l-card.filter-card .l-options button.option,',
        'html body .l-card.filter-card button[class~="option"],',
        'html body .l-card button.option {',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '    border: none !important;',
        '    /* ★ 未选中字色对齐题目列表页：白字（原为 var(--ld-primary) 蓝字） */',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-radius: 3px !important;',
        '    padding: 1px 8px !important;',
        '    /* 与题目列表「主题库/洛谷/CF/AT」选项卡逐项对齐。',
        '       注意 display 不设：contest 的父级 .l-options 是 flex，flex 子项必然 blockify，',
        '       覆盖 display 也无效，且会造成两页无意义的差异。 */',
        '    font-size: 16px !important;',
        '    font-weight: 400 !important;',
        '    line-height: 24px !important;',
        '    margin: 0 8px 0 0 !important;',
        '    cursor: pointer !important;',
        '    transition: 0.3s !important;',
        '}',
        'html body .l-card.filter-card button.option:hover,',
        'html body .l-card button.option:hover {',
        '    /* ★ hover：极淡白底，不加边框、不改字色（字已是白色） */',
        '    background: rgba(255, 255, 255, 0.12) !important;',
        '    background-color: rgba(255, 255, 255, 0.12) !important;',
        '    border: none !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    cursor: pointer !important;',
        '}',
        '/* 选中态：主题蓝实底 + 白字（与题目列表选项卡一致，无边框、cursor default） */',
        'html body .l-card.filter-card button.option.active,',
        'html body .l-card.filter-card button.option.selected,',
        'html body .l-card button.option.active,',
        'html body .l-card button.option.selected {',
        '    background: var(--ld-primary) !important;',
        '    background-color: var(--ld-primary) !important;',
        '    border: none !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    cursor: default !important;',
        '}',
        '/* ★★★ 不再给任何行/卡容器加 hover 背景（大容器会点亮整块）。',
        '   contest 卡片的悬停反馈由站点原生样式负责，我不再插手。 */',
        '/* 卡片内部的 .row 子容器（.title-row / .left.row / .right.row / .info-row）始终保持透明 */',
        'html body .l-card .row .row:hover,',
        'html body .l-card .row .row,',
        'html body .l-card [class*="title-row"]:hover,',
        'html body .l-card [class*="info-row"]:hover {',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '}',
        'html body .l-card .row .name:hover, html body .l-card .row .title:hover,',
        'html body .l-card .row time:hover, html body .l-card .row .time:hover,',
        'html body .l-card .row [class*="time"]:hover,',
        'html body .l-card .row .provider-display:hover,',
        '/* ★★ 排除按钮：这两段原来写成「.row 里任意 a / span」，特异性 (0,4,2) 高于',
        '   `.l-card a.solid:hover` 的 (0,2,2)，会把 <a> 按钮的蓝底覆盖成 transparent，',
        '   导致 hover 时按钮「消失」。这里从源头加 :not(...) 排除按钮类。 */',
        'html body .l-card .row a:not(.l-button):not(.solid):not([class*="button"]):hover,',
        'html body .l-card .row span:not(.l-button):not(.solid):not([class*="button"]):hover,',
        'html body .l-card .list-wrap .row .name:hover,',
        'html body .l-card .list-wrap .row [class*="time"]:hover,',
        'html body .l-card .list-wrap .row a:not(.l-button):not(.solid):not([class*="button"]):hover {',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '    box-shadow: none !important;',
        '}',
        '/* 子元素自身的底色也清掉，避免出现「框里还有框」 */',
        'html body .l-card .row .name, html body .l-card .row .title,',
        'html body .l-card .row time, html body .l-card .row [class*="time"],',
        'html body .l-card .list-wrap .row .name, html body .l-card .list-wrap .row [class*="time"] {',
        '    background: transparent !important;',
        '    background-color: transparent !important;',
        '}',
        '/* 筛选卡的标签文字（比赛分类 / 比赛赛制） */',
        'html body .l-card.filter-card .filter-label, html body .l-card.filter .filter-label {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* 筛选卡里可能出现的下拉框 / 复选项也一并跟随 */',
        'html body .l-card.filter-card .combo-wrapper { background: ' + PALETTE.surface + ' !important; }',
        '/* 列表头 / 分页 / 筛选沿用统一骨架，这里只补比赛页特有的容器 */',
        '.l-card .row .name a, .l-card .list-wrap .row .name a { color: var(--ld-link) !important; }',
        '.l-card .row .name a:hover, .l-card .list-wrap .row .name a:hover { color: var(--ld-link-hover) !important; }'
    ].join('\n'));

    /* ---------- 4.11 题目列表页 ---------------------------------------------- */
    CSS_PARTS.push([
        '/* =========================================================',
        '   题目列表页',
        '   ========================================================= */',
        '.l-card section .title { color: var(--ld-fg-heading) !important; }',
        '.l-card .block-item.category ul,',
        '.l-card .block-item.category ul.luogu,',
        '.l-card .block-item.category ul.rmj {',
        '    background: transparent !important;',
        '    border: none !important;',
        '    box-shadow: none !important;',
        '    padding: 0 !important;',
        '}',
        '.l-card .block-item.category ul li {',
        '    background: transparent !important;',
        '    border: none !important;',
        '    color: var(--ld-fg) !important;',
        '    opacity: 1 !important;',
        '}',
        '.l-card .block-item.category ul li:hover {',
        '    background: rgba(255, 255, 255, 0.1) !important;',
        '    color: var(--ld-fg) !important;',
        '}',
        '.l-card .block-item.category ul li.selected {',
        '    background: var(--ld-primary) !important;',
        '    color: var(--ld-fg) !important;',
        '    opacity: 1 !important;',
        '    border-radius: 3px !important;',
        '}',
        '.l-card .result .count .number { color: var(--ld-fg) !important; font-weight: bold !important; }',

        '/* ★ 最优解高亮：只对带 green-1 背景的 .problem 生效 */',
        '.l-card .table .row .problem[style*="green-1"],',
        '.l-card .table .row [style*="--lfe-color--green-1"] {',
        '    background-color: rgba(83, 196, 26, 0.12) !important;',
        '}',
        '/* 当前用户高亮的纠偏放在常驻样式表里（见 CSS_FIXES），关闭深色后也要生效 */'
    ].join('\n'));

    /* ---------- 4.12 题解页 ------------------------------------------------- */
    CSS_PARTS.push([
        '/* =========================================================',
        '   题解页面',
        '   ========================================================= */',
        '/* ★ 取消鼠标悬停在题解上的整个文本框亮起效果（规则已在 4.10 统一定义，此处不重复） */',
        '.l-card.solution-list .header nav ul li { color: var(--ld-fg-soft) !important; }',
        '.l-card.solution-list .header nav ul li.selected { color: var(--ld-primary) !important; }',
        '.l-card.solution-list .header b { color: var(--ld-fg) !important; }',
        '.l-card.solution-list .lfe-caption, .l-card.solution-list .lfe-caption time { color: var(--ld-fg-muted) !important; }',

        '/* ★ 题解底部吸附操作栏 */',
        '.l-card .float.operations {',
        '    background: var(--ld-surface-deep) !important;',
        '    border-top: 1px solid rgba(255, 255, 255, 0.15) !important;',
        '    box-shadow: 0 -4px 12px var(--ld-shadow-deep) !important;',
        '    padding: 10px 16px !important;',
        '    z-index: 100 !important;',
        '}',
        '.l-card .float.operations .button { color: var(--ld-fg-soft) !important; fill: var(--ld-fg-soft) !important; }',
        '.l-card .float.operations .button:hover { color: var(--ld-fg) !important; fill: var(--ld-fg) !important; }',
        '.l-card .float.operations .thumb-up.active,',
        '.l-card .float.operations .thumb-up.voted,',
        '.l-card .float.operations .thumb-up.enable,',
        '.l-card .operations .thumb-up.active, .l-card .operations .thumb-up.voted,',
        '.l-card .operations .thumb-up.enable { color: var(--ld-primary) !important; fill: var(--ld-primary) !important; }',
        '.l-card .float.operations .thumb-up.active:hover,',
        '.l-card .float.operations .thumb-up.voted:hover,',
        '.l-card .float.operations .thumb-up.enable:hover { color: var(--ld-primary-soft) !important; fill: var(--ld-primary-soft) !important; }',

        '/* ★ 题解 / 文章正文：文字全部白色。',
        '   注意实际类名是 .lfe-marked-wrap，不能只写 .lfe-marked；',
        '   :not([style*="color"]) 用来放行用户名/等级标识的内联色。 */',
        '.l-card .lfe-marked, .l-card .lfe-marked-wrap, .l-card .marked,',
        '.l-card .lfe-marked p, .l-card .lfe-marked-wrap p, .l-card .marked p,',
        '.l-card .lfe-marked li, .l-card .lfe-marked-wrap li, .l-card .marked li,',
        '.l-card .lfe-marked strong, .l-card .lfe-marked-wrap strong,',
        '.l-card .lfe-marked em, .l-card .lfe-marked-wrap em,',
        '.l-card .lfe-marked td, .l-card .lfe-marked-wrap td,',
        '.l-card .lfe-marked th, .l-card .lfe-marked-wrap th,',
        '.l-card .lfe-marked h1, .l-card .lfe-marked h2, .l-card .lfe-marked h3,',
        '.l-card .lfe-marked h4, .l-card .lfe-marked h5, .l-card .lfe-marked h6,',
        '.l-card .lfe-marked-wrap h1, .l-card .lfe-marked-wrap h2, .l-card .lfe-marked-wrap h3,',
        '.l-card .solution-article, .l-card .article-content, .l-card .markdown-body {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★★ 文章页正文的外层白底：实测结构为',
        '   main.lcolor-bg-background.main  (rgb(42,42,42)，脚本已生效)',
        '     └ div  ← 【无 class】bg rgb(255,255,255)、1201x4149  ← 白色底真凶',
        '         └ .article-content (transparent) → .lfe-marked-wrap (transparent)',
        '   这层 div 在 .l-card 之外，所以上面那批 `.l-card .article-content` 规则够不着它。',
        '   定位方式：结构位置（main 的直接子元素）+ 无 class + 「用已知子元素做父级锚点」。',
        '   CSS 没有父选择器，:has() 是唯一表达「父级」的方式；四条同时满足 → 全站仅命中 1 个',
        '   元素（已实测 hasSelectorMatchCount = 1）。',
        '   ★ 目标值透明：透出 main 的 rgb(42,42,42)，不新增层。',
        '   ★ 只用 background-color，不用 background 简写（避免重置 background-image）。 */',
        '/* ★★ 正文「通栏带」：浅色模式实测——只有正文区有一层不透明白底，',
        '   且它是【无 class 的 1201 宽 div】（全宽），不是 768 宽的 .article-content；',
        '   头部与评论区都是透明的、直接坐在 main 的浅灰底上。',
        '   所以这里只给这一层上色，复刻「页面底 + 一条通栏带」的层次。',
        '   （上一轮曾给三个 768 宽 wrapper 各上卡片底 → 因 .article-comment 有',
        '     margin-top:30px 而断裂成「三个黑框」，那是基于错误假设，已回退。）',
        '   ★ 只用 background-color，不用 background 简写。 */',
        'html body main.main > div:not([class]):has(> .article-content) {',
        '    background-color: var(--ld-card) !important;',
        '}',
        '/* =========================================================',
        '   文章页（/article/*）专项：这些元素全都在 .l-card 之外，',
        '   所以脚本里那批 `.l-card …` 规则一律够不着，必须用 main.main 作用域。',
        '   ========================================================= */',
        '/* ① 文章页不可读文字 → 浅色（实测均为站点浅色主题的深字） */',
        'html body main.main .article-banner h1.title {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body main.main .article-banner .label {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* ★ 选 A（忠实复刻浅色模式）：浅色模式实测「标签 rgba(0,0,0,0.5) 浅、',
        '   值 rgb(64,64,64) 深」→ 深色模式对应「标签 --ld-fg-muted、值 --ld-fg(白)」。',
        '   实测三个值（作者 .luogu-username、发布时间 time、分类 div）**都是 .label 的',
        '   相邻兄弟元素**，所以用 .label + * 一条即可精准命中全部值，无需逐个列举。 */',
        'html body main.main .article-banner .label + * {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body main.main .article-comment h3.lfe-h3.section-title,',
        'html body main.main .article-comment h4.lfe-h4 {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body main.main .comment-filter-line > span {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* ② 层次感：完整浅色模式里「头部 / 正文 / 评论区」是三个有区分的块。',
        '   ★ 已回退：实测浅色模式里头部与评论区都是 transparent，',
        '     只有正文有一层不透明白底（见上方「通栏带」规则）。',
        '     给三个 wrapper 各上卡片底会因 .article-comment 的 margin-top:30px',
        '     而断裂成三个黑框，故本条不再设置任何背景。 */',
        '/* ③ 悬浮操作栏（点赞/收藏/不推荐）：站点原样式是白底 rgb(255,255,255)。',
        '   实测选择器 main.main .article-content .actions（60x228，链 .actions.left-mode）。',
        '   用比卡片更深的 --ld-surface，在卡片底上形成明确的一块。 */',
        'html body main.main .article-content .actions {',
        '    background-color: transparent !important;',
        '}',
        '/* ★ 单条评论的头部行：站点自带 bg rgb(250,250,250) 白底（非纯白，',
        '   所以此前按 rgb(255,255,255) 过滤时没扫到）。让它透明 → 与 .l-card.reply-item',
        '   的卡片底统一，消除「用户名行白底 / 正文深底」的分层割裂。',
        '   实测链：div.meta < div.l-card.reply-item。 */',
        'html body .l-card.reply-item .meta {',
        '    background-color: var(--ld-panel) !important;',
        '}',
        '/* ★ 评论/回复里的「回复于 xxx」时间文字：站点原值 rgba(0,0,0,0.5)（浅色主题的',
        '   半透明黑），落在深色底上几乎不可见，而脚本从未覆盖它。',
        '   用 .time 类（不是 time 标签）统一修 —— 横幅里「发布时间」的值是裸 <time> 标签',
        '   （已由 .label + * 置白），用类选择器不会误伤它；内层 <time> 自动继承。',
        '   实证：文章页 6 个 .time 全部落在深底 rgb(54,54,54) 上（lightBgCount=0）。',
        '   注：表格页的行内时间早已由 `[class*="time"]` 规则处理，本条只补评论场景。 */',
        'html body .time {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* ★★ 点赞/收藏/不推荐的操作按钮：激活态与未激活态文字都是白色，看不出状态。',
        '   实测站点原值：未激活 svg color rgb(89,89,89)（深底上对比度≈1.9:1，过暗）、',
        '   激活 svg color rgb(52,152,219)（= --ld-primary，语义色本身是正确的）。',
        '   设计意图：未激活 = 白色轮廓，激活 = 蓝色轮廓。color 与 fill 同时给，',
        '   因为 svg 图标可能只认其中一个。文章页底部栏与题解页悬浮栏共用此规则。 */',
        'html body .actions .button-2line:not(.active) .text,',
        'html body .actions .button-2line:not(.active) svg {',
        '    color: ' + PALETTE.fg + ' !important;',
        '    fill: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .actions .button-2line.active .text,',
        'html body .actions .button-2line.active svg {',
        '    color: var(--ld-primary) !important;',
        '    fill: var(--ld-primary) !important;',
        '}',
        '/* =========================================================',
        '   讨论区（/discuss/*）专项。实测白底真凶：',
        '   div.author 251,251,251（回复头部行）· div.textarea.casket.cs-main 255（编辑区）',
        '   · div.cs-header 255（编辑器工具栏）· .combo-wrapper .text 255（排序下拉）',
        '   · span.btn-float-open 250（浮动回复按钮）',
        '   全部用长写属性、零硬编码，作用域收在 .l-card 内。',
        '   ========================================================= */',
        '/* ① 回复头部行 → --ld-panel（与文章页评论 meta 同一做法）',
        '   ★ 必须排除表格场景：实测主题商店（/theme）的表头/单元格也叫 .author',
        '     （链：.author < .header-wrap < .list-wrap.table），会被这条误伤成黑块。',
        '     用 :not(.list-wrap.table *) 收窄，只作用于讨论区/通知中心的回复头部行。 */',
        'html body .l-card .author:not(.list-wrap.table *) {',
        '    background-color: var(--ld-panel) !important;',
        '}',
        '/* ② 富文本编辑器（casket / CodeMirror 外壳）：编辑区 + 工具栏 + 头部 */',
        'html body .l-card .textarea.casket,',
        'html body .l-card .cs-main,',
        'html body .l-card .cs-header {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 工具栏里的按钮/图标 → 浅色 */',
        'html body .l-card .cs-header * {',
        '    color: var(--ld-fg-soft) !important;',
        '    fill: var(--ld-fg-soft) !important;',
        '}',
        '/* 编辑区内已由 CodeMirror 规则处理（cm-content 实测 rgba(56,56,56,0.72) 正常），',
        '   这里只补 placeholder 与边框 */',
        'html body .l-card .textarea.casket ::placeholder,',
        'html body .l-card .textarea.casket .cm-placeholder {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* ③ 浮动回复按钮 */',
        'html body .l-card .btn-float-open {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ④ 排序下拉（外层 + 内层文本行，与文章页 .combo-wrapper .text 同一做法） */',
        'html body .l-card .combo-wrapper {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .l-card .combo-wrapper .text {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: var(--ld-border) !important;',
        '}',
        '/* ⑤ 「N 条回复」计数行 → 白色（用户明确要求白色，不是 muted）',
        '   实测承载元素类名为 reply-info（我此前按 reply-in 子串匹配命中）。 */',
        'html body [class*="reply-in"],',
        'html body [class*="reply-in"] * {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★★ 讨论区补充：以下元素实测【不在 .l-card 内】（它们的祖先底色是白色页面底），',
        '   所以上面带 .l-card 的规则够不着，必须放宽到 html body 作用域。',
        '   实测确认：combo-wrapper 的最近不透明祖先底色 = rgb(255,255,255)。 */',
        'html body .combo-wrapper,',
        'html body .combo-wrapper .text {',
        '    /* ★ --ld-surface(#2a2a2a) 比页面底 --ld-card 还深 → 看起来「陷进去」。',
        '       改用 --ld-surface-hi(#333333)，比 #2a2a2a 浅一档。 */',
        '    background-color: var(--ld-surface-hi) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: var(--ld-border) !important;',
        '}',
        '/* ★★ 讨论区编辑器的白线：实测三处 + 一处伪元素',
        '   · .textarea.casket.cs-main  四边 border 1.71429px rgb(221,221,221)  ← 外框白线',
        '   · .cs-header  border-bottom 0.571429px rgb(221,221,221)            ← 工具栏下边',
        '   · .cs-footer  border-top    0.571429px rgb(221,221,221)            ← 底栏上边',
        '   · .casket::before border-right-color rgb(255,255,255)              ← 编辑区/预览区竖线',
        '   统一改为 --ld-hairline（rgba(255,255,255,0.08)）。只改 border-*-color，',
        '   不动 border-width（1.71429px / 0.571429px 保持站点原值）。 */',
        'html body .textarea.casket.cs-main {',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        'html body .cs-header {',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '}',
        'html body .cs-footer {',
        '    border-top-color: var(--ld-hairline) !important;',
        '}',
        'html body .casket::before,',
        'html body .cs-main::before {',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '    border-color: var(--ld-hairline) !important;',
        '}',
        '/* ★★ 真正的「编辑区 / 预览区中间白线」：',
        '   用 elementFromPoint 沿编辑器横向取点实测，承载者是',
        '   div.cs-editor.cs-midline.cs-zone-half（361x300）的 border-right，',
        '   值 0.571429px rgb(221,221,221)。类名 cs-midline 即「中间线」。',
        '   ⚠️ 上一轮我改的 .casket::before 是错元素（那条不是中间线），故用户仍看到白线。',
        '   只改 border-right-color，不动 border-width（0.571429px 保持站点原值）。 */',
        'html body .cs-midline {',
        '    border-right-color: var(--ld-hairline) !important;',
        '}',
        '/* 工具栏分组按钮的浅色右边框（span.cs-toolbar-group 1.71429px rgb(221,221,221)） */',
        'html body .cs-toolbar-group {',
        '    border-right-color: var(--ld-hairline) !important;',
        '}',
        '/* ★ 专栏编辑页（/article/<id>/edit）的编辑器外框：实测该页类名是',
        '   `casket cs-main`（**没有 textarea 类**），所以我此前写的',
        '   `.textarea.casket.cs-main` 不匹配 → 外框仍是 rgb(221,221,221)。',
        '   这里改用 `.casket.cs-main`（同时覆盖带/不带 textarea 的两种情形）。 */',
        'html body .casket.cs-main,',
        'html body .textarea.casket.cs-main {',
        '    border-top-color: var(--ld-hairline) !important;',
        '    border-right-color: var(--ld-hairline) !important;',
        '    border-bottom-color: var(--ld-hairline) !important;',
        '    border-left-color: var(--ld-hairline) !important;',
        '}',
        '/* ★★ 编辑器「全屏」变白 —— 实测根因（在 /article/<id>/edit 上复现确认）：',
        '   1) 这不是 Fullscreen API：document.fullscreenElement 为 null，',
        '      站点是给 .casket.cs-main 加上 class **cs-full-screen**（固定定位铺满）。',
        '   2) 更关键：全屏时站点把编辑器【重新挂到 .lfe-body 下】',
        '      实测链：div.casket.cs-main < div.lfe-body < body < html',
        '      —— 它脱离了 .l-card！因此我所有 .l-card 作用域的规则全部失效，',
        '      整块回退成站点浅色：.casket 白底、.cs-header 白底、',
        '      CodeMirror 正文变成站点的 rgb(64,64,64) 深字。',
        '   3) 所以全屏规则必须【不带 .l-card 限定】。',
        '   预览区实测类名是 .cs-viewer（不是 .cs-preview）。 */',
        'html body .cs-full-screen,',
        'html body .cs-full-screen .cs-header,',
        'html body .cs-full-screen .cs-content,',
        'html body .cs-full-screen .cs-editor,',
        'html body .cs-full-screen .cs-viewer,',
        'html body .cs-full-screen .cs-toolbar,',
        'html body .cs-full-screen .cs-footer {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 编辑区（CodeMirror）用项目统一的代码底色 */',
        'html body .cs-full-screen .cm-editor,',
        'html body .cs-full-screen .cm-scroller,',
        'html body .cs-full-screen .cm-content,',
        'html body .cs-full-screen .v-codemirror {',
        '    background-color: var(--ld-code-bg) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body .cs-full-screen .cm-line {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 行号槽改用 muted，避免纯白过亮 */',
        'html body .cs-full-screen .cm-gutters {',
        '    background-color: var(--ld-code-bg) !important;',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* 预览区（.cs-viewer）里渲染后的 Markdown 正文：排除链接（保留链接色）、',
        '   拖放提示层（语义黄）与语法高亮 token。 */',
        'html body .cs-full-screen .cs-viewer :not(a):not([style*="color"]):not(.cs-upload):not(.cs-upload *):not([class*="token"]):not([class*="lcolor"]) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 兜底：若站点改用真正的 Fullscreen API，也一并覆盖（标准 + -webkit- 前缀） */',
        'html body .casket:fullscreen,',
        'html body .cs-main:fullscreen,',
        'html body :fullscreen .casket,',
        'html body :fullscreen .cs-main,',
        'html body .casket:-webkit-full-screen,',
        'html body .cs-main:-webkit-full-screen,',
        'html body :-webkit-full-screen .casket,',
        'html body :-webkit-full-screen .cs-main {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 顶部导航搜索框（点击搜索图标后内联展开，非 teleport 浮层）：',
        '   实测 .nav-search .search-wrap input 是 bg rgb(255,255,255) + color rgb(255,255,255)',
        '   → 白底白字。它在 .lfe-body 内（不在 .l-card），所以不加 .l-card 限定。 */',
        'html body .nav-search input,',
        'html body .search-wrap input {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: var(--ld-border) !important;',
        '}',
        'html body .nav-search input::placeholder,',
        'html body .search-wrap input::placeholder {',
        '    color: var(--ld-fg-muted) !important;',
        '}',
        '/* ★ 数字输入框（置顶量等，input[type="number"].input）：',
        '   实测 330x31 bg rgb(255,255,255) + color rgb(255,255,255) → 白底白字。',
        '   我的输入框规则只覆盖了 input[type="text"] 与 input:not([type])，漏了 number。 */',
        'html body .l-card input[type="number"] {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: rgba(255, 255, 255, 0.15) !important;',
        '}',
        'html body .l-card input[type="number"]::placeholder {',
        '    color: #a0a0a0 !important;',
        '}',
        '/* =========================================================',
        '   通知中心（/user/notification）专项。实测 DOM 嵌套：',
        '   .l-card.wrapper > .main > .list.notice-body > .list-scroll >',
        '   .list-wrap.block.border > .row-wrap > .row > .notice-card',
        '   · .list-wrap / .row-wrap 实测本来就透明、无边框（不是它们画框）',
        '   · 真正多余的是 .list.notice-body（bg rgba(0,0,0,0.25) + 四边 border）',
        '     和 .row 的 border-bottom',
        '   目标：只保留 .notice-card 这一层。全部只改颜色，不动 border-width。',
        '   ========================================================= */',
        'html body .l-card .list.notice-body {',
        '    background-color: transparent !important;',
        '    border-top-color: transparent !important;',
        '    border-right-color: transparent !important;',
        '    border-bottom-color: transparent !important;',
        '    border-left-color: transparent !important;',
        '}',
        'html body .l-card .row {',
        '    border-bottom-color: transparent !important;',
        '}',
        '/* 通知标题：站点原值 rgba(0,0,0,0.85) 深字，脚本未覆盖（.title 是裸 div，',
        '   不在 .lfe-marked-wrap 规则范围内）→ 白字。 */',
        'html body .l-card .notice-card .title {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 通知项在浅色模式下是「平铺」的，没有独立卡片框 → .notice-card 的',
        '   背景与四边边框也必须去掉（上一轮误留了它）。',
        '   通知项之间的区分靠 .row 的极淡分隔线 rgba(255,255,255,0.06)（保留）。 */',
        'html body .l-card .notice-card {',
        '    background-color: transparent !important;',
        '    border-top-color: transparent !important;',
        '    border-right-color: transparent !important;',
        '    border-bottom-color: transparent !important;',
        '    border-left-color: transparent !important;',
        '}',
        '/* ★ 通知页顶部标题栏 .notice-header（实测 982x72）才是剩下的那个黑框：',
        '   bg rgba(0,0,0,0.25) + 四边 rgba(255,255,255,0.08) → 同样置透明。 */',
        'html body .l-card .notice-header {',
        '    background-color: transparent !important;',
        '    border-top-color: transparent !important;',
        '    border-right-color: transparent !important;',
        '    border-bottom-color: transparent !important;',
        '    border-left-color: transparent !important;',
        '}',
        '/* ★ 私信页滚动条隐藏（保留滚动能力）。实测真正的滚动容器是',
        '   div.panel-content（280x432，overflow:auto，scrollable:true，联系人列表）；',
        '   .list-scroll / .history / .stack 一并写上以便其它状态下也能生效。 */',
        'html body .l-card .panel-content::-webkit-scrollbar,',
        'html body .l-card .list-scroll::-webkit-scrollbar,',
        'html body .l-card .history::-webkit-scrollbar,',
        'html body .l-card .stack::-webkit-scrollbar {',
        '    width: 0 !important;',
        '    height: 0 !important;',
        '    display: none !important;',
        '}',
        'html body .l-card .panel-content,',
        'html body .l-card .list-scroll,',
        'html body .l-card .history,',
        'html body .l-card .stack {',
        '    scrollbar-width: none !important;',
        '    -ms-overflow-style: none !important;',
        '}',
        '/* =========================================================',
        '   私信（/chat）专项：实测 4 类元素带站点浅色边框 rgb(232,232,232)：',
        '   .side 的 border-right · .search / .panel-title / .item 的 border-bottom。',
        '   按用户要求「全部去除」→ border-*-color: transparent（不用 hairline）。',
        '   注：.l-card.wrapper 自身的 rgba(255,255,255,0.08) 边框是我设的 hairline，',
        '       不是白线，保持不变。',
        '   ========================================================= */',
        'html body .l-card .side {',
        '    /* 用户要求：把「联系人列表 / 聊天区」中间的分隔线加回来（深色细线） */',
        '    border-right-color: var(--ld-hairline) !important;',
        '}',
        'html body .l-card .search,',
        'html body .l-card .panel-title,',
        'html body .l-card .item {',
        '    border-bottom-color: transparent !important;',
        '}',
        '/* 联系人项 hover：站点是「变灰」，改为比卡片略深的深色以保持深色语言 */',
        'html body .l-card .side .item:hover {',
        '    background-color: var(--ld-panel) !important;',
        '}',
        '/* ★ 消息气泡：实测 .message-block.left/right 内的 .message 都是',
        '   站点浅色底 rgb(232,232,232) + 浅字 rgb(214,214,214) → 浅底浅字不可读。',
        '   改为深色气泡 + 白字（--ld-panel 比卡片深一档，左右气泡同色即可辨识）。 */',
        'html body .l-card .message-block .message {',
        '    background-color: var(--ld-panel) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 白线补漏：打开会话后新增的两处站点浅色边框 rgb(232,232,232)',
        '   · .top-container 的 border-bottom（会话顶部标题栏下）',
        '   · .editor 的 border-top（输入区上沿） */',
        'html body .l-card .top-container {',
        '    border-bottom-color: transparent !important;',
        '}',
        'html body .l-card .editor {',
        '    border-top-color: transparent !important;',
        '}',
        '/* ★★ 气泡尾巴的「白色小角」：实测是 .message-block .message::after 这个',
        '   CSS 三角（content:"" / width:0 / height:0 / position:absolute），',
        '   用 border-left-color: rgb(232,232,232) 4px 画出来的站点浅色三角。',
        '   改成与气泡同色 var(--ld-panel)，左右两侧的尾巴都覆盖。',
        '   （border-top/bottom 是透明边，是三角的斜边，保持不动。） */',
        'html body .l-card .message-block .message::after {',
        '    border-left-color: var(--ld-panel) !important;',
        '    border-right-color: var(--ld-panel) !important;',
        '}',
        'html body .btn-float-open {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 编辑器底部栏（cs-footer 实测 722x25 白底）与内部输入框 */',
        'html body .cs-footer {',
        '    background-color: var(--ld-surface) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        'html body .cs-footer *,',
        'html body .l-card.reply-editor input,',
        'html body .cs-main input {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '    border-color: var(--ld-border) !important;',
        '}',
        '/* ③-b 评论排序下拉：深底 + 浅字（实测 .comment-filter-line > .combo-wrapper，128x31） */',
        'html body main.main .comment-filter-line .combo-wrapper {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 白块真凶：下拉的文本行 div.text.lform-size-middle（128x31）自带',
        '   背景 rgb(255,255,255) + 字色 rgb(255,255,255)（白底白字）。',
        '   上一轮把深底加在了父级 .combo-wrapper 上，被子元素自己的白底整个盖住，',
        '   所以必须直接命中这个子元素。 */',
        'html body main.main .comment-filter-line .combo-wrapper .text {',
        '    background-color: var(--ld-surface) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ④ 正文标题下的横线：站点给 h2 加了 border-bottom 0.571429px rgb(216,216,216)，',
        '   深色底上是一条刺眼白线。只改 border-bottom-color，不动 border-width。',
        '   h1/h3~h6 一并加上以防其它文章出现同类横线。 */',
        'html body main.main .lfe-marked-wrap h1, html body main.main .lfe-marked-wrap h2,',
        'html body main.main .lfe-marked-wrap h3, html body main.main .lfe-marked-wrap h4,',
        'html body main.main .lfe-marked-wrap h5, html body main.main .lfe-marked-wrap h6 {',
        '    border-bottom-color: transparent !important;',
        '}',
        '/* ★★ 连带必改：上面把正文底色压成深色后，正文文字仍是站点浅色主题的深字',
        '   rgb(64,64,64)，叠在 rgb(42,42,42) 上对比度只有 1.38:1 → 完全不可读。',
        '   根因同上：.lfe-marked-wrap 也在 .l-card 之外，',
        '   所以那一整批 `.l-card .lfe-marked-wrap …` 白字规则同样够不着它。',
        '   这里用 main.main 作用域补一条等价的浅色文字规则；',
        '   ★ 沿用原规则的排除条件（:not(a) / :not([style*="color"])）以保住语义色与内联色。 */',
        '/* ★★ 追加 :not(.actions *)：操作栏（点赞/收藏/不推荐）在 .article-content 之内，',
        '   会被这条通配规则钉成白字，导致激活态文字无法变蓝（fill 不受影响所以只有',
        '   图标变蓝）。实测三种等价写法均可用（Chrome 支持 Selectors L4），',
        '   其中 :not(.actions *) 排除最精确：命中 1215 个、按钮后代命中 0 个。 */',
        'html body main.main .article-content :not(a):not([style*="color"]):not(summary):not([class*="token"]):not(.actions *):not([class*="lcolor"]),',
        'html body main.main .lfe-marked-wrap :not(a):not([style*="color"]):not(summary):not([class*="token"]):not(.actions *):not([class*="lcolor"]),',
        'html body main.main .lfe-marked :not(a):not([style*="color"]):not(summary):not([class*="token"]):not(.actions *):not([class*="lcolor"]),',
        'html body main.main .marked :not(a):not([style*="color"]):not(summary):not([class*="token"]):not(.actions *):not([class*="lcolor"]) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        'html body main.main .article-content a:not([style*="color"]),',
        'html body main.main .lfe-marked-wrap a:not([style*="color"]) {',
        '    color: var(--ld-link) !important;',
        '}',
        '/* 正文里所有「自己没有内联颜色」的元素统一白字；',
        '   显式排除带内联 color 的 <a>，避免把用户名/等级标识刷成白色。 */',
        '.l-card .lfe-marked-wrap :not(a):not([style*="color"]):not(summary):not([class*="token"]):not([class*="lcolor"]),',
        '.l-card .lfe-marked :not(a):not([style*="color"]):not(summary):not([class*="token"]):not([class*="lcolor"]),',
        '.l-card .marked :not(a):not([style*="color"]):not(summary):not([class*="token"]):not([class*="lcolor"]),',
        '.l-card .lfe-marked-wrap a:not([style*="color"]),',
        '.l-card .lfe-marked a:not([style*="color"]) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 注意：题解文章页（/article/*）的正文不在 .l-card 里，而是直接躺在',
        '   .main(245,245,245) 这种浅色底上。那里绝不能刷白字，否则白底白字。',
        '   所以这里只处理确实落在深色卡片内的 .lfe-marked / .lfe-marked-wrap。',
        '   用户名链接带内联色，靠 :not 放行。 */',
        'html body .l-card .lfe-marked-wrap :not(a):not([style*="color"]):not(summary):not([class*="token"]):not([class*="lcolor"]),',
        'html body .l-card .lfe-marked :not(a):not([style*="color"]):not(summary):not([class*="token"]):not([class*="lcolor"]) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★★ 陶片放逐页（/judgement）的权限变更牌子。实测该处牌子是',
        '   span.permission-change 内的 span，站点给「浅灰底 rgb(232,232,232) + 深字 rgb(87,87,87)」。',
        '   我上面的通用白化规则只改了字色、没改底色 → 白字叠浅灰底，几乎不可读。',
        '   这里把牌子底色压暗，让白字有托底。',
        '   ★ 其中「撤销」带站点语义类 .lcolor--red-3（= 231, 76, 60），',
        '     已在上面各通配规则里用 :not([class*="lcolor"]) 放行，改由站点变量还原红色，',
        '     零硬编码。 */',
        'html body .permission-change span {',
        '    background-color: var(--ld-panel) !important;',
        '}',
        'html body .permission-change span[class*="lcolor"] {',
        '    background-color: transparent !important;',
        '    color: rgb(var(--lcolor--red-3)) !important;',
        '}',
        '/* ★ 站点用内联色把正文/按钮写成 rgba(0,0,0,0.5) 这种「配白底的黑字」，',
        '   在深色卡上等于隐形。这里对「带内联 color 的正文元素」统一纠正为白色；',
        '   a[style*=color] 里的用户名/等级色不带 rgba(0,0,0 前缀，所以不会被误伤。 */',
        '.l-card [style*="color: rgba(0, 0, 0"], .l-card [style*="color:rgba(0, 0, 0"],',
        '.l-card [style*="color: rgba(0,0,0"], .l-card [style*="color:rgba(0,0,0"],',
        '.l-card [style*="color: rgb(0, 0, 0"], .l-card [style*="color: rgb(64, 64, 64"],',
        '.l-card .lfe-marked button, .l-card .lfe-marked-wrap button {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 「查看全文 / 查看文章」这类按钮：白字，不是黑字。',
        '   站点把 pill 按钮写成 rgba(0,0,0,0.5) 且特异性较高，这里直接点名压过去。',
        '   ★ 不要用 .header a / .solution-article a 这类宽选择器 ——',
        '   用户名链接就在 .solution-article 里并带内联等级色，会被一起刷白。 */',
        '.l-card a[class*="read"], .l-card button[class*="read"],',
        '.l-card .read-more, .l-card .readmore, .l-card .readmore-btn,',
        '.l-card .solution-more, .l-card .expand, .l-card .collapse,',
        '.l-card button.transparent, .l-card .lfe-marked button {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 不要给 .l-card .lfe-caption a 上色：底部工具栏那排「复制 Markdown /',
        '   中文 / 展开 / 进入 IDE 模式」就是 .lfe-caption 里的 <a>，会被误伤成白色。',
        '   这几个按钮保持站点默认色。 */',
        '/* 「查看文章」pill 按钮在题解列表 .header 的右侧；',
        '   只命中 .right，绝不能写 .header a —— 用户名在 .header .left 里，会被刷白 */',
        'html body .l-card .solution-article .header .right a,',
        'html body .l-card .header .right a,',
        'html body .l-card .header span.right a {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* 题解页的管理组提示块：里面的小字原本是配白底的灰，深色卡上要提亮 */',
        '.l-card .admin-public-comment, .l-card .admin-public-comment * ,',
        '.l-card blockquote.admin-public-comment p {',
        '    color: var(--ld-fg-soft) !important;',
        '}',

        '/* 题解页 / 文章页的目录、标签 */',
        '.l-card .lfe-marked img { border-radius: 4px; }',
        '.l-card .sidebar .card, .l-card .toc, .l-card .catalog {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .toc a, .l-card .catalog a { color: var(--ld-link) !important; }'
    ].join('\n'));

    /* ---------- 4.13 比赛页 ------------------------------------------------ */
    CSS_PARTS.push([
        '/* =========================================================',
        '   比赛页',
        '   ========================================================= */',
        '.l-card .join-card p { color: var(--ld-fg-muted) !important; }',
        '.l-card .join-card { background: transparent !important; }',
        '.l-card .contest-type-block .tag { color: var(--ld-fg) !important; }',
        '.l-card.panel { background: var(--ld-card) !important; }',
        '.l-card .lcolor--vip { color: var(--ld-vip) !important; }',
        '/* ★ 难度筛选里 NOI/NOI+/CTSC 用的是 lcolor--lapis-4 = rgb(14,29,105) 近黑藏青，',
        '   在深色卡上几乎和背景融为一体。这里微调成同色系但可辨认的靛蓝。',
        '   注意这些难度元素不一定在 .l-card 内，所以不加 .l-card 前缀；',
        '   只覆盖 lapis 系列，不动 PALETTE 里的其它配色 token。 */',
        '.lcolor--lapis-1, .lcolor--lapis-2, .lcolor--lapis-3, .lcolor--lapis-4,',
        '[class*="lapis-"] {',
        '    color: #7d8ff0 !important;',
        '}',

        '/* ★ 比赛模式题目切换（A, B, C, D…） */',
        '.l-card .contest-problem-switch .contest-problem-no { color: var(--ld-fg) !important; }',
        '.l-card .contest-problem-switch .contest-problem {',
        '    background-color: rgba(255, 255, 255, 0.05) !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.15) !important;',
        '}',
        '.l-card .contest-problem-switch .contest-problem:hover {',
        '    background-color: rgba(255, 255, 255, 0.1) !important;',
        '    border-color: rgba(255, 255, 255, 0.3) !important;',
        '}',
        '.l-card .contest-problem-switch .contest-problem.current {',
        '    background-color: rgba(0, 0, 0, 0.3) !important;',
        '    border-color: rgba(255, 255, 255, 0.4) !important;',
        '}',

        '/* ★ 公告 / 比赛须知 / 讨论条目 */',
        '.l-card .announcement, .l-card .announcements > *,',
        '.l-card .bulletin, .l-card .bulletin > *,',
        '.l-card .notice, .l-card .notice > *,',
        '.l-card .discuss-item, .l-card .post-item, .l-card .comment-item,',
        '.l-card [class*="announce"], .l-card [class*="bulletin"], .l-card [class*="notice"] {',
        '    background: var(--ld-panel) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .announcement a, .l-card .bulletin a, .l-card .notice a,',
        '.l-card [class*="announce"] a, .l-card [class*="bulletin"] a, .l-card [class*="notice"] a {',
        '    color: var(--ld-link) !important;',
        '}',

        '/* ★ 问答 / 澄清 */',
        '.l-card .inquiry-header { background: transparent !important; border: none !important; }',
        '.l-card .inquiry-header-left h3 { color: var(--ld-fg-heading) !important; }',
        '.l-card .inquiry-feed, .l-card .feed-card,',
        '.l-card .feed-card--clarification, .l-card .feed-card--inquire {',
        '    background: var(--ld-panel) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .feed-card:hover { border-color: rgba(255, 255, 255, 0.15) !important; }',
        '.l-card .feed-card-header, .l-card .feed-card-meta, .l-card .feed-card-meta span { color: #b0b0b0 !important; }',
        '.l-card .feed-card-meta a, .l-card .feed-card-content a { color: var(--ld-link) !important; }',
        '.l-card .feed-card-content { color: var(--ld-fg-soft) !important; }'
    ].join('\n'));

    /* ---------- 4.14 排行榜 / 记录 / 个人中心 / 团队 / 讨论 ------------------ */
    CSS_PARTS.push([
        '/* =========================================================',
        '   排行榜页',
        '   ========================================================= */',
        '.l-card .scoreboard-header nav li { color: var(--ld-fg-soft) !important; }',

        '/* =========================================================',
        '   评测记录页（列表 + 详情）',
        '   ========================================================= */',
        ':root[data-ld-page="record"] .l-card .row-wrap,',
        ':root[data-ld-page="record"] .l-card .row,',
        ':root[data-ld-page="record"] .l-card table tr {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline-soft) !important;',
        '}',
        ':root[data-ld-page="record"] .l-card .status,',
        ':root[data-ld-page="record"] .l-card .status span:not([class*="lcolor"]) { color: var(--ld-fg) !important; }',
        '.l-card .record-status, .l-card .compile-result, .l-card .judge-result {',
        '    background: var(--ld-panel) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '/* ★ 测试点方块：站点用语义背景类 .lcolor-bg-green-3 等给每个测试点上色，',
        '   所以必须排除 [class*="lcolor-bg"]，否则绿/红方块会被刷成透明、整块区域失去层次。',
        '   （AC 文字本身站点原值就是白色，语义色由底方块表达。） */',
        '.l-card .test-case:not([class*="lcolor-bg"]), .l-card .case-item, .l-card .subtask {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .test-case .name, .l-card .case-item .name, .l-card .subtask .name { color: var(--ld-fg) !important; }',
        '/* ★ 测试点方块透明度：由面板滑块写入 --ld-testcase-alpha 驱动。',
        '   用 opacity 而非改 background-color —— 站点语义色是按类写死的不透明 rgb()，',
        '   只有 opacity 能在「不硬编码任何颜色、保住绿/红/橙色相」的前提下统一调透明度。 */',
        'html body .l-card .test-case,',
        'html body .l-card .case-item,',
        'html body .l-card .subtask {',
        '    opacity: var(--ld-testcase-alpha, 1) !important;',
        '}',

        '/* =========================================================',
        '   个人中心 / 团队 / 讨论区',
        '   ========================================================= */',
        '.l-card .user-header, .l-card .user-info, .l-card .profile-header {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '}',
        '.l-card .user-header .name, .l-card .user-info .name,',
        '.l-card .profile-header .name, .l-card .user-header .username { color: var(--ld-fg) !important; }',
        '.l-card .user-header .slogan, .l-card .user-info .slogan,',
        '.l-card .user-header .description, .l-card .user-info .description { color: var(--ld-fg-muted) !important; }',
        '.l-card .user-header .stat .value, .l-card .user-info .stat .value, .l-card .profile .stat .value { color: var(--ld-fg) !important; }',
        '.l-card .user-header .stat .name, .l-card .user-info .stat .name, .l-card .profile .stat .name { color: var(--ld-fg-muted) !important; }',

        '/* 练习情况热力图：站点用色块写死，卡片上统一压暗 */',
        '.l-card .heatmap .cell, .l-card .practice-chart .cell, .l-card .graph .cell { opacity: 0.85; }',
        '.l-card .heatmap .legend, .l-card .practice-chart .legend { color: var(--ld-fg-muted) !important; }',

        '/* 团队 / 讨论卡片里的标签、徽章 */',
        '.l-card .team-card, .l-card .forum-card, .l-card .thread-item, .l-card .discuss-list .item {',
        '    background: var(--ld-panel) !important;',
        '    border: 1px solid var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .team-card:hover, .l-card .forum-card:hover, .l-card .thread-item:hover {',
        '    border-color: rgba(255, 255, 255, 0.15) !important;',
        '}',
        '.l-card .team-card .title, .l-card .forum-card .title, .l-card .thread-item .title { color: var(--ld-fg) !important; }',
        '.l-card .team-card .meta, .l-card .forum-card .meta, .l-card .thread-item .meta { color: var(--ld-fg-muted) !important; }',

        '/* 徽章 / 等级色用站点内联色，这里只保证底色不刺眼 */',
        '.l-card .badge, .l-card .lfe-badge { background: transparent !important; }',

        '/* 首页卡片网格与轮播 */',
        '.l-card .card-list .item, .l-card .grid .item, .l-card .carousel .item {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        '.l-card .card-list .item .title, .l-card .grid .item .title { color: var(--ld-fg) !important; }'
    ].join('\n'));

    /* ---------- 4.15 提交 / 编辑页 ------------------------------------------ */
    CSS_PARTS.push([
        '/* =========================================================',
        '   提交页面',
        '   ========================================================= */',
        '.l-card.burger .header, .l-card.burger .header nav, .l-card.burger .header nav ul {',
        '    border-bottom: none !important;',
        '    box-shadow: none !important;',
        '}',
        '.l-card.burger .header nav li { color: var(--ld-fg) !important; border-bottom: none !important; }',
        '.l-card.burger .header nav li.selected { color: var(--ld-primary) !important; border-bottom: none !important; }',
        '.l-card.burger .combo-wrapper .arrow svg { color: var(--ld-fg) !important; }',
        '.l-card.burger .body label, .l-card.burger .light-black {',
        '    color: ' + PALETTE.code + ' !important;',
        '    background-color: transparent !important;',
        '}',
        '.l-card.burger .body p, .l-card.burger .body p.light-black { color: var(--ld-fg-muted) !important; }',
        '.l-card.burger .body p b { color: var(--ld-fg) !important; font-weight: bold !important; }',
        '.l-card.burger .body input[type="checkbox"] + label svg { color: var(--ld-primary) !important; }',
        '.l-card.burger h3 { color: var(--ld-fg-heading) !important; }',

        '/* 提交文件页面上传框 */',
        '.l-card.burger .drop {',
        '    background: var(--ld-surface) !important;',
        '    border: 1px dashed #666666 !important;',
        '    border-radius: 4px !important;',
        '    color: ' + PALETTE.code + ' !important;',
        '    transition: background 0.15s, border-color 0.15s !important;',
        '}',
        '.l-card.burger .drop:hover { background: var(--ld-surface-hi) !important; border-color: var(--ld-border-hi) !important; }',
        '.l-card.burger .drop svg { color: var(--ld-syn-keyword) !important; }',
        '.l-card.burger .drop span { color: ' + PALETTE.code + ' !important; }',

        '/* 评测状态页 / 重测等操作区 */',
        '.l-card .operations, .l-card .action-bar, .l-card .toolbar.float {',
        '    background: transparent !important;',
        '    border-color: var(--ld-hairline) !important;',
        '}'
    ].join('\n'));

    /* ---------- 4.16 代码高亮：Prism + CodeMirror ---------------------------- */
    CSS_PARTS.push([
        '/* =========================================================',
        '   ★ 题解 / 文章代码高亮（Prism.js，VS Code Dark+ 配色）',
        '   ========================================================= */',
        'html body pre[class*="language-"] {',
        '    background: var(--ld-layer-2) !important;',
        '    color: ' + PALETTE.code + ' !important;',
        '    border: 1px solid rgba(255, 255, 255, 0.1) !important;',
        '    border-radius: ' + RADIUS + ' !important;',
        '    padding: 1em !important;',
        '    box-sizing: border-box !important;',
        '}',
        'html body pre[class*="language-"] code {',
        '    background: transparent !important;',
        '    color: var(--ld-syn-plain) !important;',
        '    border: none !important;',
        '    padding: 0 !important;',
        '    display: block !important;',
        '}',
        '/* 题解里代码框外面的 .code-container 不要再套一层底色 */',
        'html body .lfe-marked .code-container, html body .l-card .code-container {',
        '    background: transparent !important;',
        '    border-color: rgba(255, 255, 255, 0.1) !important;',
        '    border-radius: ' + RADIUS + ' !important;',
        '}',
        'html body pre[class*="language-"] .token.keyword,',
        'html body pre[class*="language-"] .token.boolean,',
        'html body pre[class*="language-"] .token.atrule { color: var(--ld-syn-keyword) !important; }',
        'html body pre[class*="language-"] .token.directive-hash,',
        'html body pre[class*="language-"] .token.directive,',
        'html body pre[class*="language-"] .token.macro,',
        'html body pre[class*="language-"] .token.preprocessor { color: var(--ld-syn-control) !important; }',
        '/* Prism 的 C/C++ 语法把 #include 的 include 也归到 .token.keyword，',
        '   按截图它应该是关键字蓝（只有 # 号是紫色），这里单独纠正 */',
        'html body pre[class*="language-"] .token.directive-hash + .token.keyword,',
        'html body pre[class*="language-"] .token.directive-hash ~ .token.keyword {',
        '    color: var(--ld-syn-keyword) !important;',
        '}',
        'html body pre[class*="language-"] .token.function,',
        'html body pre[class*="language-"] .token.tag { color: var(--ld-syn-function) !important; }',
        'html body pre[class*="language-"] .token.number,',
        'html body pre[class*="language-"] .token.constant { color: var(--ld-syn-number) !important; }',
        'html body pre[class*="language-"] .token.string,',
        'html body pre[class*="language-"] .token.char,',
        'html body pre[class*="language-"] .token.attr-value { color: var(--ld-syn-string) !important; }',
        'html body pre[class*="language-"] .token.comment,',
        'html body pre[class*="language-"] .token.prolog,',
        'html body pre[class*="language-"] .token.doctype { color: var(--ld-syn-comment) !important; }',
        'html body pre[class*="language-"] .token.type,',
        'html body pre[class*="language-"] .token.class-name,',
        'html body pre[class*="language-"] .token.builtin,',
        'html body pre[class*="language-"] .token.attr-name { color: var(--ld-syn-type) !important; }',
        '/* One Dark Pro：运算符浅灰 #abb2bf，变量/属性红 #e06c75，标点用浅灰 */',
        'html body pre[class*="language-"] .token.operator { color: var(--ld-syn-operator) !important; }',
        'html body pre[class*="language-"] .token.variable,',
        'html body pre[class*="language-"] .token.property,',
        'html body pre[class*="language-"] .token.parameter,',
        'html body pre[class*="language-"] .token.symbol { color: var(--ld-syn-variable) !important; }',
        'html body pre[class*="language-"] .token.punctuation { color: var(--ld-syn-operator) !important; }',
        'html body pre[class*="language-"] .token.plain-text,',
        'html body pre[class*="language-"] .token.namespace { color: var(--ld-syn-plain) !important; }',

        '/* =========================================================',
        '   ★ 提交页代码编辑器（CodeMirror 6）',
        '   ========================================================= */',
        'html body .cm-content .ͼb { color: var(--ld-syn-keyword) !important; }  /* 关键字 / 类型 */',
        'html body .cm-content .ͼg { color: var(--ld-syn-function) !important; } /* 函数名 */',
        'html body .cm-content .ͼd { color: var(--ld-syn-number) !important; }   /* 数字 */',
        'html body .cm-content .ͼe { color: var(--ld-syn-string) !important; }   /* 字符串 */',
        '/* ★ 实测：CodeMirror 的 .ͼm 类在本编辑器里承载的是【数学块】',
        '   （$x$ / $G=(V,E)$ / $$ 等，共 21 个元素全部是数学），而非注释。',
        '   原按注释映射到 synComment(#5c6370) 偏暗。',
        '   ★ 颜色选型：改用本脚本已有的 One Dark Pro 暖黄 --ld-syn-type(#e5c07b)，',
        '     它在代码框底 rgb(60,60,60) 上对比度约 6.0:1（用户提的 #994400 只有 1.56:1，',
        '     实测几乎看不清）。复用既有 token，零硬编码。 */',
        'html body .cm-content .ͼm { color: var(--ld-syn-type) !important; }',
        'html body .cm-content .ͼ5 { color: var(--ld-syn-plain) !important; }    /* 变量 */',
        'html body .cm-content .ͼc { color: var(--ld-syn-type) !important; }     /* 类型 / 类名 */',
        'html body .cm-content .ͼi { color: var(--ld-syn-keyword) !important; }  /* 标识符 */',
        'html body .cm-content .ͼo { color: var(--ld-syn-operator) !important; }  /* 运算符 */',
        'html body .cm-content .ͼp { color: var(--ld-syn-operator) !important; }  /* 标点 */',
        'html body .cm-content .ͼh { color: var(--ld-syn-variable) !important; }  /* 变量/属性 */',
        '/* ★ 提交框编辑器：也用半透明代码框底（卡片 alpha × 0.85），与题面/题解一致 */',
        'html body .cm-editor, html body .cm-scroller,',
        'html body .cm-editor .cm-gutters, html body .cm-editor .cm-content {',
        '    background-color: var(--ld-code-bg) !important;',
        '}',
        'html body .cm-editor { border-radius: ' + RADIUS + ' !important; }',
        'html body .cm-gutters {',
        '    background-color: var(--ld-code-bg) !important;',
        '    color: var(--ld-editor-gutter) !important;',
        '    border-right: 1px solid var(--ld-surface-hi) !important;',
        '}',
        'html body .cm-activeLineGutter { background-color: var(--ld-editor-active) !important; color: var(--ld-fg) !important; }',
        'html body .cm-line { color: ' + PALETTE.code + ' !important; }',
        'html body .cm-activeLine { background-color: rgba(255, 255, 255, 0.05) !important; }',
        'html body .cm-cursor { border-left-color: var(--ld-fg) !important; }',
        'html body .cm-selectionBackground { background-color: var(--ld-editor-select) !important; }',
        'html body .cm-panels, html body .cm-tooltip {',
        '    background: var(--ld-surface) !important;',
        '    color: ' + PALETTE.code + ' !important;',
        '    border-color: var(--ld-border) !important;',
        '}',
        'html body .cm-tooltip-autocomplete ul li[aria-selected] { background: #094771 !important; color: var(--ld-fg) !important; }',

        '/* 旧版 Ace / Monaco 编辑器兜底 */',
        'html body .ace_editor { background-color: var(--ld-editor-bg) !important; }',
        'html body .monaco-editor, html body .monaco-editor-background { background-color: var(--ld-editor-bg) !important; }'
    ].join('\n'));

    /* ---------- 4.17 滚动条 ------------------------------------------------- */
    CSS_PARTS.push([
        '/* ========== 滚动条 ========== */',
        '::-webkit-scrollbar { width: 10px; height: 10px; }',
        '::-webkit-scrollbar-track { background-color: var(--ld-track) !important; }',
        '::-webkit-scrollbar-thumb { background-color: var(--ld-thumb) !important; border-radius: 5px !important; }',
        '::-webkit-scrollbar-thumb:hover { background-color: var(--ld-thumb-hi) !important; }',
        '::-webkit-scrollbar-corner { background-color: var(--ld-track) !important; }',
        '* { scrollbar-color: var(--ld-thumb) var(--ld-track) !important; }'
    ].join('\n'));

    /* ---------- 4.18 整页压暗（可选，默认关闭） ------------------------------ */
    if (COVER_PAGE) {
        CSS_PARTS.push([
            '/* ========== 整页压暗（配置开启时才注入） ========== */',
            'html, body { background-color: #1b1b1b !important; }',
            '.theme-page, .lfe-body, #app, main { background-color: transparent !important; }'
        ].join('\n'));
    }

    /* ---------- 4.19 打印与无障碍兜底 -------------------------------------- */
    CSS_PARTS.push([
        '/* ========== 打印时不改样式 ========== */',
        '@media print {',
        '    .l-card, .l-card::before, .l-card::after {',
        '        background: #ffffff !important;',
        '        color: #000000 !important;',
        '        box-shadow: none !important;',
        '    }',
        '    .l-card, .l-card * { color: #000000 !important; }',
        '}',
        '/* ========== 降低动画偏好 ========== */',
        '@media (prefers-reduced-motion: reduce) {',
        '    .l-card, .l-card * { transition: none !important; animation-duration: 0.01ms !important; }',
        '}'
    ].join('\n'));

    var CSS = CSS_PARTS.join('\n\n');

    /* =========================================================================
     * ⑤  运行时
     * ====================================================================== */

    var STYLE_ID   = 'luogu-dark-card-style';
    var FIX_ID     = 'luogu-dark-card-fixes';
    var ALPHA_ATTR = 'data-ld-a';          // 标记已处理过的内联色元素
    var rAF        = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    var pending    = false;

    /* 这两条是对站点「写死颜色」的定点纠偏，开关关闭时也应保留（避免白底白字）。
       其余深色规则全部放进可禁用的主样式表。 */
    var CSS_FIXES = [
        '/* ★ 当前用户高亮：站点用浅灰 rgba(200,200,200) 写死 → 换成深灰半透明 */',
        '.l-card .table .row [style*="rgba(200, 200, 200"],',
        '.l-card .table .row [style*="rgba(200,200,200"] {',
        '    background-color: rgba(255, 255, 255, 0.08) !important;',
        '}',
        '/* ★ 底栏：文字全部白色（含 copyright 与链接），链接 hover 保持浅蓝 */',
        'footer, footer *, footer a, footer span, footer p, footer div,',
        'footer .copyright, footer .copyright a, footer .copyright span {',
        '    color: #ffffff !important;',
        '}',
        'footer a:hover, footer .copyright a:hover { color: #b8ddff !important; }',
        '/* ★ 底栏：完全透明，不要独立色块 —— 让它透出 .theme-page 的深色底，',
        '   视觉上与页面融为一体，白字由深色底托底仍可读。',
        '   （原为 var(--ld-surface)，那会让底栏成为页面底上的一块独立深色） */',
        'footer, footer.lcolor-bg-background, .lfe-footer {',
        '    background-color: transparent !important;',
        '}',
        '/* ★ .theme-page：站点最外层容器，站点自带白底（var(--theme-body-back)=#ffffff），',
        '   脚本此前从未覆盖它。footer 透明后必须有深色托底，否则白字叠白底不可读。',
        '   只改 background-color，不动尺寸/布局。 */',
        'html body .theme-page {',
        '    background-color: var(--ld-surface) !important;',
        '}',
        '/* ★★ 页面级深色底：题目页有 .theme-page 承载页面底色，但个人中心这类页面',
        '   没有 .theme-page，底色直接落在 main.lcolor-bg-background 上（rgb(245,245,245)），',
        '   导致卡片 rgba(56,56,56,0.85) 叠出偏灰的合成色。这里把页面底压成深色。',
        '   只改 background-color，不动尺寸/结构。底栏的更深色底在 CSS_FIXES 里更晚定义，会覆盖。 */',
        'html body .lcolor-bg-background,',
        'html body main.main,',
        'html body main.lcolor-bg-background.main {',
        '    background-color: var(--ld-surface) !important;',
        '}',
        '/* ★ 个人中心：站点在深色卡片里塞了不透明白底容器，导致白字叠白底。',
        '   只改颜色，不动尺寸/结构。 */',
        '/* ========== 个人中心专项（只改颜色） ========== */',
        '/* ① 主页热力图：只把「无活动」格子（灰白）压深，彩色数据格一律不动 */',
        'html body .l-card .heat-map-cell[style*="232, 232, 232"],',
        'html body .l-card .heat-map-cell[style*="255, 255, 255"] {',
        '    /* ★ 目标 rgb(38,38,38)：比卡片底(约 rgb(54,54,54))深 16 阶，',
        '       明显可辨但不纯黑。用固定不透明色保证稳定可比。 */',
        '    background-color: #262626 !important;',
        '}',
        '/* ② 个性签名 → 纯白 */',
        'html body .l-card .slogan, html body .l-card .lfe-caption.slogan,',
        'html body .l-card .user-header .slogan {',
        '    color: #ffffff !important;',
        '}',
        '/* ③ 卡片内的实体分区（动态条目 .feed / 专栏卡片 / 题库卡片 / 收藏题单）：',
        '   背景比卡片底略深一档，形成层次。',
        '   ⚠️ .inner-card 自己就带 l-card 类，会被 `.l-card .l-card{background:transparent}`',
        '   压掉，所以这里用 :is() 提特异性。 */',
        ':is(html) body .l-card .inner-card,',
        ':is(html) body .l-card .feed-card,',
        ':is(html) body .l-card .activity-item,',
        ':is(html) body .l-card .moment,',
        ':is(html) body .l-card .list-item {',
        '    background-color: rgba(0, 0, 0, 0.25) !important;',
        '}',
        '/* ★ 动态条目 .feed 只保留深色分隔线，内部不填充（回到卡片底色） */',
        ':is(html) body .l-card .feed {',
        '    background-color: transparent !important;',
        '}',
        '/* ④ 动态条目的分隔线 → 比内部区域更深的深色线（原来是 rgb(232,232,232) 白线）。',
        '   层次：卡片底 rgb(54) < 内部区域 < 分隔线 */',
        ':is(html) body .l-card .feed,',
        ':is(html) body .l-card .feed-card,',
        ':is(html) body .l-card .activity-item,',
        ':is(html) body .l-card .moment {',
        '    border-bottom-color: rgba(0, 0, 0, 0.65) !important;',
        '    border-top-color: rgba(0, 0, 0, 0.65) !important;',
        '}',
        ':is(html) body .l-card .inner-card {',
        '    border-color: rgba(0, 0, 0, 0.55) !important;',
        '}',
        '/* ⑤ 【专栏页】分类标签行 nav.select-header-tiny li → 白字（原来 rgba(0,0,0,0.5) 黑字）',
        '   实测：li 无类名，父容器是 nav.select-header-tiny（已在 .l-card.burger 内）。',
        '   选中项 .selected 已由通用链接规则处理为浅蓝，这里只兜非选中项。 */',
        'html body .l-card nav.select-header-tiny li:not(.selected),',
        'html body .l-card nav.select-header-tiny li:not(.selected) * {',
        '    color: #ffffff !important;',
        '}',
        '/* ⑤-b 【专栏页 + 文章广场】小牌子（「个人记录」/「题解 AT_abc411_f」/「科技·工程」）',
        '   → 深色底 + 亮色字。实测 .row.info 有 4 个子元素：[0] 牌子 SPAN（pad 0 7px、自带 border 0.571px），',
        '   [1] DIV.lfe-caption.time（"发布时间…"）、[2][3] DIV.article-actions（计数）——',
        '   后三个 DIV 内部还嵌着 span，所以必须用「直接子」选择器 > span，否则会误伤。',
        '   ★ 不写 .inner-card：专栏页卡片有该类、文章广场的卡片没有，放宽到 .l-card 一处覆盖两页。',
        '   ★ 不用 box-shadow / 不新增 border：只改原有 border 的颜色（border-color），',
        '     border-width 保持站点的 0.571429px 不变。 */',
        'html body .l-card .row.info > span {',
        '    background-color: rgba(0, 0, 0, 0.35) !important;',
        '    color: #e8e8e8 !important;',
        '    border-color: rgba(255, 255, 255, 0.18) !important;',
        '}',
        '/* ★ 文章广场左侧导航 + 「精选合集」列表文字 → 白色。',
        '   实测两处都是 span.name，链为 .l-card > .colored-link-selector > a > span.name，',
        '   站点浅色主题给的是深色字 rgb(39,39,39) / rgb(51,51,51)，落在深卡上不可读。',
        '   这两处原先完全没有规则命中（不是被覆盖，是没被处理）。 */',
        'html body .l-card .colored-link-selector .name {',
        '    color: var(--ld-fg) !important;',
        '}',
        '/* ★ 全站分页栏（.page-bar 在 .l-card 之外，所以不加 .l-card 限定，全站统一）。',
        '   实测未选中按钮是 bg rgb(255,255,255) + color rgb(255,255,255) → 白底白字看不见。',
        '   只改颜色，不动尺寸；selected 显式声明以防被 :not(.selected) 误伤。 */',
        'html body .page-bar button:not(.selected) {',
        '    background-color: rgba(255, 255, 255, 0.08) !important;',
        '    color: var(--ld-fg) !important;',
        '    border-color: rgba(255, 255, 255, 0.16) !important;',
        '}',
        'html body .page-bar button.selected {',
        '    background-color: var(--ld-primary) !important;',
        '    color: var(--ld-fg) !important;',
        '    border-color: var(--ld-primary) !important;',
        '}',
        '/* 「共 N 页」等分页栏文字 → 浅灰（容器级兜住，文本节点分段时也能生效） */',
        'html body .page-bar, html body .page-bar *:not(button) {',
        '    color: var(--ld-fg-soft) !important;',
        '}',
        'html body .page-bar button:not(.selected) {',
        '    color: var(--ld-fg) !important;',
        '}',
        '/* ⑤-c 【专栏页】文章标题 → 白色（实测：A 无类名，链 .inner-card > .row.title > a） */',
        'html body .l-card.inner-card .row.title a,',
        'html body .l-card.inner-card .row.title a * {',
        '    color: #ffffff !important;',
        '}',
        '/* ⑤-d 【练习页】「难易度统计」的线全部去掉（不要深色线，也不要白线）。',
        '   实测：容器 DIV.difficulty-tags（border-bottom rgb(232,232,232)），',
        '   内层每行 DIV.row 的 border-top 是白线，**border-left / border-right 也是**',
        '   （9 行各自的左右边框垂直连成两条竖白线）→ 四条边一起置透明。',
        '   只改 border-color，border-width 保持 0.571429px 不动。',
        '   ★ 不动行内 SPAN 的边框 —— 那是难度标签的语义色（如入门 rgba(233,64,84,.55)）。 */',
        'html body .l-card .difficulty-tags {',
        '    border-bottom-color: transparent !important;',
        '}',
        'html body .l-card .difficulty-tags .row {',
        '    border-top-color: transparent !important;',
        '    border-left-color: transparent !important;',
        '    border-right-color: transparent !important;',
        '    border-bottom-color: transparent !important;',
        '}',
        '/* ⑤-e 【关注页】「互相关注」牌子 → 深色底 + 亮色字。',
        '   实测：牌子是 .avatar-right 的「直接子 span」（pad 0 7px、自带 border 0.571px）；',
        '   .avatar-right 另有 3 个子 DIV（含 929x36 的大容器），原来写 `> *` 会把它们',
        '   也套上框 → 就是「多出额外的框」的原因。',
        '   ★ 只改 border-color，不加 border / 不加 box-shadow，形状完全不动。 */',
        'html body .l-card .follow-container .avatar-right > span {',
        '    background-color: rgba(0, 0, 0, 0.35) !important;',
        '    color: #e8e8e8 !important;',
        '    border-color: rgba(255, 255, 255, 0.18) !important;',
        '}',
        '/* ⑥ 个人中心的搜索框 / 输入框 */',
        'html body .l-card .refined-input, html body .l-card .search-box,',
        'html body .l-card input[type="text"], html body .l-card input:not([type]) {',
        '    background-color: var(--ld-surface) !important;',
        '    color: #ffffff !important;',
        '    border-color: rgba(255, 255, 255, 0.15) !important;',
        '}',
        'html body .l-card .refined-input input::placeholder,',
        'html body .l-card input::placeholder {',
        '    color: #a0a0a0 !important;',
        '}',
        '/* ★★ 评论区 textarea：原有输入框规则只写了 input，漏了 textarea，',
        '   导致它保持站点白底 rgb(255,255,255)，而文字被刷成白色 → 白底白字看不见。',
        '   实测 textarea 在 .l-card 内（inCard: true）且 matchesCardTextarea: true，',
        '   所以收窄在 .l-card 内即可精准命中，不波及其它页面的非卡片 textarea。',
        '   ★ 只用 background-color，不用 background 简写。 */',
        'html body .l-card textarea {',
        '    background-color: var(--ld-surface) !important;',
        '    color: #ffffff !important;',
        '    border-color: rgba(255, 255, 255, 0.15) !important;',
        '}',
        'html body .l-card textarea::placeholder,',
        'html body .l-card textarea::-webkit-input-placeholder {',
        '    color: #a0a0a0 !important;',
        '}',
        '/* ⚠️ ::-moz-placeholder 必须单独成条：逗号选择器列表里只要有 1 个',
        '   浏览器不支持的伪元素，整条规则会被整块丢弃（Chromium 就属于这种情况）。 */',
        'html body .l-card textarea::-moz-placeholder {',
        '    color: #a0a0a0 !important;',
        '}',
        '/* ⑦ 专栏文章摘要 / 正文容器 → 白色（这些元素不是标准 p/h，之前漏掉了） */',
        'html body .l-card .content,',
        'html body .l-card span.content,',
        'html body .l-card .article-item,',
        'html body .l-card .article-item *,',
        'html body .l-card .article-summary {',
        '    color: #ffffff !important;',
        '}',
        'html body .l-card .user-header-bottom,',
        'html body .l-card .cover-upload,',
        'html body .l-card .user-header {',
        '    background-color: transparent !important;',
        '}',
        '/* 注意：.inner-card 不在这里置透明 —— 它要「比卡片深一档」，',
        '   由下方 :is() 那条规则给 rgba(0,0,0,0.25)。两条若都写会互相覆盖。 */',
        '/* 个人中心里白底白字的输入框（图床链接框） */',
        'html body .l-card input[type="text"],',
        'html body .l-card input:not([type]) {',
        '    background-color: var(--ld-surface) !important;',
        '    color: #ffffff !important;',
        '}',
        '/* 个人中心标签页：原来被站点刷了白底 */',
        'html body .l-card .entry {',
        '    background-color: transparent !important;',
        '}',
        '/* 个人中心统计数字：白字叠白底 → 改成卡片次要文字色 */',
        'html body .l-card .stat-text.name,',
        'html body .l-card .stat-text.value,',
        'html body .l-card .user-stat-data,',
        'html body .l-card .user-stat-data * {',
        '    color: ' + PALETTE.fgSoft + ' !important;',
        '}',
        '/* 个人中心/列表页的无内联色链接：站点蓝在深卡上只有 2.4:1 → 提亮。',
        '   带内联色的（等级色/排名色）不动。',
        '   ★ 分两级：题解/文章内的链接保持站点蓝（原设计），其余用浅蓝。',
        '   ★★ 必须排除按钮类（.l-button / .solid / *button*），否则会把 <a> 按钮的',
        '   白字刷成浅蓝，叠在蓝底上只有 1.35:1 —— 这就是绑定/解绑按钮看不清的原因。',
        '   ★★ 同样排除红色语义按钮 .lcolor-var-red-3（注销账户），不动它。 */',
        'html body .l-card a:not([style*="color"]):not(.l-button):not(.solid):not([class*="button"]):not(.lcolor-var-red-3) {',
        '    color: ' + PALETTE.link + ' !important;',
        '}',
        'html body .l-card .lfe-marked a:not([style*="color"]):not(.l-button):not(.solid),',
        'html body .l-card .lfe-marked-wrap a:not([style*="color"]):not(.l-button):not(.solid),',
        'html body .l-card .lfe-caption a:not([style*="color"]):not(.l-button):not(.solid) {',
        '    color: ' + PALETTE.primary + ' !important;',
        '}',
        '/* ========== 实心按钮（solid / l-button）正常态 + hover 态修复 ==========',
        '   实测问题：<a class="solid l-button ..."> 的按钮被上面的通用链接色规则刷成浅蓝，',
        '   且 hover 时被 `.row a:hover{background:transparent}` 覆盖成透明。',
        '   这里用 :is() 提特异性，确保：正常态 = 蓝底 + 白字；hover = 深蓝底 + 白字，',
        '   与原生 <button class="solid"> 的表现完全一致。',
        '   ★ 排除 .lcolor-var-red-3（注销账户）不动。 */',
        ':is(html) body .l-card a.solid:not(.lcolor-var-red-3),',
        ':is(html) body .l-card a.l-button:not(.lcolor-var-red-3),',
        ':is(html) body .l-card button.solid:not(.lcolor-var-red-3) {',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        ':is(html) body .l-card a.solid:not([class*="lcolor-var-"]):not(.button-transparent):not(.l-button):not(.btn-actions *):hover,',
        ':is(html) body .l-card button.solid:not([class*="lcolor-var-"]):not(.button-transparent):not(.btn-actions *):hover {',
        '    background-color: var(--ld-primary-dark) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        '/* ★ 语义色按钮（lcolor-var-*）与透明描边按钮（button-transparent / l-button /',
        '   .btn-actions 内的 .solid）的 hover：改为「中性变深」（--ld-panel），',
        '   不再被上面那条通用规则刷成蓝色。',
        '   （用户反馈：各页面按钮 hover 不变深而变蓝 —— 根因就是上面那条通用规则的 :hover 分支。） */',
        ':is(html) body .l-card a.solid[class*="lcolor-var-"]:hover,',
        ':is(html) body .l-card button.solid[class*="lcolor-var-"]:hover,',
        '/* 语义色按钮里不带 .solid 的（如云剪贴板的「删除」lcolor-var-red-3、',
        '   「设为非公开」lcolor-var-cyan-3）也要有 hover，否则完全无反馈 */',
        ':is(html) body .l-card a[class*="lcolor-var-"]:hover,',
        ':is(html) body .l-card button[class*="lcolor-var-"]:hover,',
        ':is(html) body .l-card a.button-transparent:hover,',
        ':is(html) body .l-card button.button-transparent:hover,',
        ':is(html) body .l-card a.l-button:hover,',
        ':is(html) body .l-card button.l-button:hover,',
        ':is(html) body .l-card .btn-actions a.solid:hover,',
        ':is(html) body .l-card .btn-actions button.solid:hover {',
        '    background-color: var(--ld-panel) !important;',
        '    color: ' + PALETTE.fg + ' !important;',
        '}',
        ':is(html) body .l-card li.selected:not([style*="color"]),',        ':is(html) body .l-card li.selected:not([style*="color"]) *,',
        ':is(html) body .l-card li.selected a:not([style*="color"]) {',
        '    color: ' + PALETTE.link + ' !important;',
        '}',
        '/* ★ 个人中心当前选中的 tab（span.entry.selected）站点用蓝 rgb(52,152,219)，',
        '   在深卡上只有 2.4:1 → 提亮到浅蓝 */',
        '/* ★ 个人中心当前选中的 tab：站点把蓝色写在内联/更高特异性规则上，',
        '   所以这里用 :is() 提高特异性 + !important 压过去（只改颜色） */',
        ':is(html) body .l-card .entry.selected:not([style*="color"]),',
        ':is(html) body .l-card .entry.selected:not([style*="color"]) *,',
        ':is(html) body .l-card .menu .entry.selected:not([style*="color"]),',
        ':is(html) body .l-card .menu .entry.selected:not([style*="color"]) * {',
        '    color: ' + PALETTE.link + ' !important;',
        '}',
        '/* ★ 站点用内联色写死的「配白底黑字」（rgba(0,0,0,0.75) / rgba(0,0,0,0.5) 等），',
        '   落在深色卡片上不可读。只匹配内联黑字，不会碰等级色（rgb(254,76,97) 等）。 */',
        'html body .l-card [style*="color: rgba(0, 0, 0"],',
        'html body .l-card [style*="color:rgba(0, 0, 0"],',
        'html body .l-card [style*="color: rgba(0,0,0"],',
        'html body .l-card [style*="color:rgba(0,0,0"],',
        'html body .l-card [style*="color: rgb(64, 64, 64"],',
        'html body .l-card [style*="color: rgb(38, 38, 38"],',
        'html body .l-card [style*="color: rgb(51, 51, 51"] {',
        '    color: ' + PALETTE.fgSoft + ' !important;',
        '}',
        '/* ★ 面板里的「隐藏底栏」开关：默认展示，勾选后整块隐藏 */',
        'html[data-ld-footer="hide"] footer,',
        'html[data-ld-footer="hide"] .lfe-footer,',
        'html[data-ld-footer="hide"] .footer,',
        'html[data-ld-footer="hide"] .columba-footer {',
        '    display: none !important;',
        '}'
    ].join('\n');

    /* ---------- 5.1 注入样式：不依赖 document.head，document-start 也稳 ----- */

    var injected = false;

    function makeStyle(id, text) {
        var style = document.createElement('style');
        style.id = id;
        style.textContent = text;
        return style;
    }

    function inject() {
        if (injected) return true;
        var host = document.documentElement || document.head;
        if (!host) return false;
        // 追加到 <html> 末尾：即使站点之后重建 <head> 也不会丢
        if (!document.getElementById(STYLE_ID)) host.appendChild(makeStyle(STYLE_ID, CSS));
        if (!document.getElementById(FIX_ID))   host.appendChild(makeStyle(FIX_ID, CSS_FIXES));
        injected = true;
        return true;
    }

    function injectWhenReady() {
        if (inject()) return;
        var tries = 0;
        var timer = setInterval(function () {
            if (inject() || ++tries > 300) clearInterval(timer);
        }, 10);
    }

    injectWhenReady();

    /* ---------- 5.2 路由分包：给 <html> 打页面标记，CSS 按页微调 ------------- */

    function pageType() {
        var p = location.pathname;
        if (/^\/problem\/[^/]+\/solution/.test(p)) return 'solution';
        if (/^\/problem\/[^/]+\/submit/.test(p))   return 'submit';
        if (/^\/problem\/list/.test(p))            return 'list';
        if (/^\/problem\//.test(p))                return 'problem';
        if (/^\/contest\//.test(p))                return 'contest';
        if (/^\/training\//.test(p))               return 'training';
        if (/^\/record\//.test(p))                 return 'record';
        if (/^\/user\//.test(p))                   return 'user';
        if (/^\/team\//.test(p))                   return 'team';
        if (/^\/discuss\//.test(p))                return 'discuss';
        if (/^\/article\//.test(p))                return 'article';
        if (/^\/ranking/.test(p))                  return 'ranking';
        if (/^\/paste\//.test(p))                  return 'paste';
        if (p === '/' || p === '')                 return 'home';
        return 'other';
    }

    var lastUrl = '';
    function syncRoute(force) {
        if (!force && location.href === lastUrl) return;
        lastUrl = location.href;
        if (document.documentElement) {
            document.documentElement.setAttribute('data-ld-page', pageType());
        }
    }
    syncRoute(true);

    /* ---------- 5.2b 宿主主题检测：决定卡片用哪一档透明度 -------------------- */

    // 解析 computed 背景色。注意：用了 color-mix() 之后，浏览器会把结果
    // 返回成 color(srgb r g b / a) 而不是 rgb()/rgba()，两种都要认。
    function cssColor(color) {
        var s = String(color);
        var m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) };
        m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/);
        if (m) {
            return {
                r: Math.round(parseFloat(m[1]) * 255),
                g: Math.round(parseFloat(m[2]) * 255),
                b: Math.round(parseFloat(m[3]) * 255),
                a: m[4] === undefined ? 1 : parseFloat(m[4])
            };
        }
        return null;
    }

    function luminance(c) {
        function f(v) { v = v / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }

    // 取页面最外层的不透明底色：html → body → .theme-page → main 兜底
    // ★ 个人中心等页面没有 .theme-page，html/body 又都是透明的，浅色底其实在
    //   main.lcolor-bg-background 上；以前只找前三层会直接失明（data-ld-theme = null）。
    function pageBackground() {
        var nodes = [
            document.documentElement,
            document.body,
            document.querySelector('.theme-page'),
            document.querySelector('main.main'),
            document.querySelector('main'),
            document.querySelector('.lcolor-bg-background'),
            document.querySelector('.full-container'),
            document.querySelector('.lfe-body')
        ];
        for (var i = 0; i < nodes.length; i++) {
            if (!nodes[i]) continue;
            var c = cssColor(getComputedStyle(nodes[i]).backgroundColor);
            if (c && c.a >= 0.999) return c;
        }
        return null;
    }

    var hostTheme = '';
    function detectTheme(force) {
        var root = document.documentElement;
        if (!root) return null;
        var bg = pageBackground();
        if (!bg) return hostTheme || null;
        var theme = luminance(bg) > 0.5 ? 'light' : 'dark';
        if (theme !== hostTheme || force) {
            hostTheme = theme;
            root.setAttribute('data-ld-theme', theme);
        }
        return theme;
    }

    /* ---------- 5.3 站点内联色补 alpha（唯一一处 DOM 修补） ------------------ */

    function isNeutral(r, g, b) {
        // 中性灰（白/黑/灰）默认不动，避免把「当前用户高亮」之类压成同色
        return Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && (r > 240 || r < 24);
    }

    function parseColor(color) {
        if (!color) return null;
        var m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (!m) return null;
        return {
            r: +m[1], g: +m[2], b: +m[3],
            a: m[4] === undefined ? 1 : parseFloat(m[4])
        };
    }

    function alphaColor(color, alpha) {
        var c = parseColor(color);
        if (!c) return color;
        return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + alpha + ')';
    }

    function needAlpha(color) {
        if (!color) return false;
        var c = parseColor(color);
        if (!c) return false;
        if (Math.abs(c.a - TAG_ALPHA) < 0.01) return false;          // 已经处理过
        if (!ALPHA_NEUTRAL && isNeutral(c.r, c.g, c.b)) return false; // 中性色放行
        return true;
    }

    function patch(el) {
        if (el.getAttribute(ALPHA_ATTR) === '1') return;
        var s = el.style;
        if (needAlpha(s.backgroundColor)) s.backgroundColor = alphaColor(s.backgroundColor, TAG_ALPHA);
        if (needAlpha(s.borderColor))     s.borderColor     = alphaColor(s.borderColor, TAG_ALPHA);
        if (needAlpha(s.color))           s.color           = alphaColor(s.color, TAG_ALPHA);
        el.setAttribute(ALPHA_ATTR, '1');
    }

    /* 不用 NodeList.prototype.forEach：旧内核没有它，一旦抛错整段修补都会失效 */
    function forEachEl(root, selector, fn) {
        var list = root.querySelectorAll(selector);
        for (var i = 0; i < list.length; i++) fn(list[i]);
    }

    function applyAlpha() {
        pending = false;
        syncRoute(false);

        try {
            forEachEl(document, 'span[style*="background-color"], span[style*="border-color"]', function (el) {
                if (el.getAttribute(ALPHA_ATTR) === '1') return;
                if (el.closest('.table') && (el.classList.contains('problem') || el.classList.contains('total'))) {
                    el.setAttribute(ALPHA_ATTR, '1');   // 表格里的题号格/总分行交给 CSS
                    return;
                }
                patch(el);
            });

            forEachEl(document, '.progress-frame > .square', patch);
        } catch (e) {
            /* 站点结构变化时静默降级，绝不打断页面 */
        }
    }

    function schedule() {
        if (pending) return;
        pending = true;
        rAF(applyAlpha);
    }

    /* ---------- 5.4 观察 DOM：合并成每帧一次，避免高频回调卡页面 ------------ */

    syncRoute(true);
    detectTheme(true);
    applyAlpha();

    if (typeof MutationObserver === 'function' && document.documentElement) {
        var observer = new MutationObserver(function (records) {
            // 站点切换主题、SPA 换页都可能改底色，这里顺带复查
            detectTheme(false);
            // 只有真的新增了节点才需要重扫，纯属性变化直接跳过
            for (var i = 0; i < records.length; i++) {
                if (records[i].type === 'childList' && records[i].addedNodes.length) {
                    schedule();
                    return;
                }
            }
            syncRoute(false);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
        // 兜底：SPA 里没有 MutationObserver 时用低频轮询
        setInterval(schedule, 1000);
    }

    window.addEventListener('popstate', function () { syncRoute(true); schedule(); });
    window.addEventListener('hashchange', function () { syncRoute(true); schedule(); });

    /* 低频复查：站点有的组件是先渲染元素、之后再写回 inline 颜色，
       这类改动不会产生新增节点。这里只数「还没打标记的元素」，
       数到才重扫，比监听全站 style 属性开销小得多。 */
    setInterval(function () {
        try {
            var list = document.querySelectorAll('span[style*="background-color"], span[style*="border-color"]');
            var fresh = 0;
            for (var i = 0; i < list.length; i++) {
                if (list[i].getAttribute(ALPHA_ATTR) !== '1') fresh++;
            }
            if (fresh) schedule();
        } catch (e) { /* ignore */ }
    }, 1500);

    /* ---------- 5.5 同源 iframe：洛谷的预览/编辑器会用 iframe --------------- */

    function patchFrame(frame) {
        try {
            var doc = frame.contentDocument;
            if (!doc || !doc.documentElement) return;
            if (!doc.getElementById(STYLE_ID)) {
                doc.documentElement.appendChild(makeStyle(STYLE_ID, CSS));
            }
            if (!doc.getElementById(FIX_ID)) {
                doc.documentElement.appendChild(makeStyle(FIX_ID, CSS_FIXES));
            }
            toggleStyles(doc, enabled);
        } catch (e) {
            /* 跨域 iframe 直接放弃 */
        }
    }

    setInterval(function () {
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) patchFrame(frames[i]);
    }, 2000);

    /* ---------- 5.6 开关与调节：优先用油猴菜单，没有就退化成快捷键 --------- */

    var KEY_ENABLED = 'luoguDarkCard.enabled';
    var KEY_ALPHA   = 'luoguDarkCard.alpha';
    var KEY_TC_ALPHA = 'luoguDarkCard.testcaseAlpha';
    var KEY_SATURATE = 'luoguDarkCard.saturate';

    function readValue(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        } catch (e) { /* ignore */ }
        try {
            var raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
    }

    function writeValue(key, value) {
        try {
            if (typeof GM_setValue === 'function') return GM_setValue(key, value);
        } catch (e) { /* ignore */ }
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    var enabled = readValue(KEY_ENABLED, true);
    var alpha   = Number(readValue(KEY_ALPHA, CARD_ALPHA)) || CARD_ALPHA;
    // 测试点方块透明度：默认 1（完全不透明 = 站点原观感），范围复用 ALPHA_MIN..1
    var tcAlpha = readValue(KEY_TC_ALPHA, 1);
    tcAlpha = (tcAlpha === null || tcAlpha === undefined || tcAlpha === '') ? 1 : Number(tcAlpha);
    if (isNaN(tcAlpha)) tcAlpha = 1;

    // 全局「淡度」：1 = 100%（默认，完全不改观感）；允许 0.3 ~ 1
    var saturate = readValue(KEY_SATURATE, 1);
    saturate = (saturate === null || saturate === undefined || saturate === '') ? 1 : Number(saturate);
    if (isNaN(saturate)) saturate = 1;
    saturate = Math.min(1, Math.max(0.3, Math.round(saturate * 100) / 100));

    /* 开关的实现：直接禁用主样式表。
       这样做的好处是「关闭」等于样式根本不存在，不会留下半截残色。 */
    function toggleStyles(doc, on) {
        try {
            var nodes = doc.querySelectorAll('style#' + STYLE_ID);
            for (var i = 0; i < nodes.length; i++) nodes[i].disabled = !on;
        } catch (e) { /* ignore */ }
    }

    function toggleAll(on) {
        toggleStyles(document, on);
        try {
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                if (frames[i].contentDocument) toggleStyles(frames[i].contentDocument, on);
            }
        } catch (e) { /* ignore */ }
    }

    function setEnabled(on) {
        enabled = !!on;
        writeValue(KEY_ENABLED, enabled);
        toggleAll(enabled);
    }

    function setAlpha(value) {
        alpha = Math.min(ALPHA_MAX, Math.max(ALPHA_MIN, Math.round(value * 100) / 100));
        writeValue(KEY_ALPHA, alpha);
        var root = document.documentElement;
        // 只覆盖这一个量：卡片、样例框、代码框、浮层各自的分层关系全靠 var() 传导，
        // 不在这里逐个改 token，避免"改了外层忘了内层"。
        if (root) root.style.setProperty('--ld-layer-alpha', String(alpha));
        if (updatePanel) updatePanel();
    }

    // ★ 测试点透明度：只写 --ld-testcase-alpha，方块的不透明度全靠这个变量传导。
    //   不做任何颜色硬编码，站点换语义色也照样跟随。
    function setTcAlpha(value) {
        tcAlpha = Math.min(1, Math.max(0.1, Math.round(value * 100) / 100));
        writeValue(KEY_TC_ALPHA, tcAlpha);
        var root = document.documentElement;
        if (root) root.style.setProperty('--ld-testcase-alpha', String(tcAlpha));
        if (updatePanel) updatePanel();
    }

    // ★ 全局淡度：只写 --ld-saturate（百分比字符串），整页降饱和全靠 html 上那条
    //   filter: saturate(var(--ld-saturate)) 传导，不逐个改色值，因此不会「改了外层忘了内层」。
    //   100% = 完全不修改（默认），符合「默认不改变观感」的要求。
    function setSaturate(value) {
        saturate = Math.min(1, Math.max(0.3, Math.round(value * 100) / 100));
        writeValue(KEY_SATURATE, saturate);
        var root = document.documentElement;
        if (root) root.style.setProperty('--ld-saturate', Math.round(saturate * 100) + '%');
        if (updatePanel) updatePanel();
    }

    /* ---------- 5.7 设置面板：单变量驱动 + 三级实时预览 ---------------------- */

    // 面板里显示的百分比 = 实际写入 CSS 的 alpha（所见即所得，不再有隐藏补偿）
    function themeAlpha() {
        return alpha;
    }

    // 与 CSS 里的 --ld-layer-1/2 保持同一套算法，预览才和实际一致
    function mixLayers(rgbText, percent) {
        var p = String(rgbText).split(',');
        return p.map(function (x) { return Math.round((parseFloat(x) || 0) * percent / 100); });
    }

    function rgbToHex(c) {
        var h = function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? '0' + s : s; };
        return '#' + h(c[0]) + h(c[1]) + h(c[2]);
    }

    function pageBaseColor() {
        var roots = [document.documentElement, document.body, document.querySelector('.theme-page')];
        for (var i = 0; i < roots.length; i++) {
            if (!roots[i]) continue;
            var c = cssColor(getComputedStyle(roots[i]).backgroundColor);
            if (c && c.a >= 0.999) return [c.r, c.g, c.b];
        }
        return [255, 255, 255];
    }

    function buildPanel() {
        var box = document.createElement('div');
        box.id = 'luogu-dark-card-panel';
        box.style.cssText = [
            'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483000',
            'display:none', 'box-sizing:border-box', 'width:270px', 'padding:14px 16px 16px',
            'background:' + UI_BG, 'color:' + UI_FG,
            'border:1px solid ' + UI_BORDER, 'border-radius:10px',
            'box-shadow:0 12px 40px rgba(0,0,0,0.7)',
            'font:13px/1.6 ' + UI_FONT,
            'color-scheme:dark', 'user-select:none'
        ].join(';') + ';';
        box.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">',
            '  <b style="font-size:13px;color:' + UI_FG + '">洛谷深色卡片</b>',
            '  <button data-ld="close" title="关闭 (Esc)" style="cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;width:24px;height:24px;line-height:1;font-size:15px">×</button>',
            '</div>',
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#c8c8c8">',
            '  <span>卡片深度 / 不透明度</span><span data-ld="value" style="color:' + UI_FG + ';font-weight:600"></span>',
            '</div>',
            '<input data-ld="range" type="range" min="' + ALPHA_MIN + '" max="' + ALPHA_MAX + '" step="0.01" style="width:100%;margin:0 0 4px;accent-color:#3498db;cursor:pointer">',
            '<div style="display:flex;justify-content:space-between;color:#8a8a8a;font-size:11px;margin-bottom:8px">',
            '  <span>更透 ' + Math.round(ALPHA_MIN * 100) + '%</span><span>' + Math.round(ALPHA_MAX * 100) + '% 更实</span>',
            '</div>',
            '<div style="display:flex;gap:6px;margin-bottom:12px">',
            '  <button data-ld="preset55" title="原脚本观感档" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">原版 55%</button>',
            '  <button data-ld="preset85" title="白底宿主推荐档" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">推荐 85%</button>',
            '</div>',
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">',
            '  <label for="ld-hide-footer" style="cursor:pointer;color:#c8c8c8">隐藏底栏</label>',
            '  <input data-ld="hideFooter" id="ld-hide-footer" type="checkbox" style="cursor:pointer;width:16px;height:16px;accent-color:#3498db">',
            '</div>',
            '<div style="border-top:1px solid ' + UI_BORDER + ';margin:0 0 12px"></div>',
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#c8c8c8">',
            '  <span>测试点透明度</span><span data-ld="tcValue" style="color:' + UI_FG + ';font-weight:600"></span>',
            '</div>',
            '<input data-ld="tcRange" type="range" min="0.1" max="1" step="0.01" style="width:100%;margin:0 0 4px;accent-color:#3498db;cursor:pointer">',
            '<div style="display:flex;justify-content:space-between;color:#8a8a8a;font-size:11px;margin-bottom:8px">',
            '  <span>更透 10%</span><span>100% 更实</span>',
            '</div>',
            '<div style="display:flex;gap:6px;margin-bottom:12px">',
            '  <button data-ld="tcPreset100" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">100%</button>',
            '  <button data-ld="tcPreset70" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">70%</button>',
            '  <button data-ld="tcPreset45" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">45%</button>',
            '</div>',
            '<div style="border-top:1px solid ' + UI_BORDER + ';margin:0 0 12px"></div>',
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#c8c8c8">',
            '  <span>全局淡度</span><span data-ld="satValue" style="color:' + UI_FG + ';font-weight:600"></span>',
            '</div>',
            '<input data-ld="satRange" type="range" min="0.3" max="1" step="0.01" style="width:100%;margin:0 0 4px;accent-color:#3498db;cursor:pointer">',
            '<div style="display:flex;justify-content:space-between;color:#8a8a8a;font-size:11px;margin-bottom:8px">',
            '  <span>更淡 30%</span><span>100% 原色</span>',
            '</div>',
            '<div style="display:flex;gap:6px;margin-bottom:12px">',
            '  <button data-ld="satPreset100" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">100%</button>',
            '  <button data-ld="satPreset80" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">80%</button>',
            '  <button data-ld="satPreset60" style="flex:1;cursor:pointer;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:4px 0;font-family:inherit;font-size:11px">60%</button>',
            '</div>',
            '<div style="color:#c8c8c8;margin-bottom:6px">三级层次预览</div>',
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">',
            '  <div style="text-align:center"><div data-ld="pv-card" style="height:38px;border-radius:6px;border:1px solid rgba(255,255,255,0.16)"></div><div style="font-size:11px;color:#9a9a9a;margin-top:4px">卡片</div></div>',
            '  <div style="text-align:center"><div data-ld="pv-sample" style="height:38px;border-radius:6px;border:1px solid rgba(255,255,255,0.16)"></div><div style="font-size:11px;color:#9a9a9a;margin-top:4px">样例框</div></div>',
            '  <div style="text-align:center"><div data-ld="pv-code" style="height:38px;border-radius:6px;border:1px solid rgba(255,255,255,0.16)"></div><div style="font-size:11px;color:#9a9a9a;margin-top:4px">代码框</div></div>',
            '</div>',
            '<div data-ld="note" style="color:#8a8a8a;font-size:11px;margin-bottom:12px"></div>',
            '<button data-ld="reset" style="cursor:pointer;width:100%;background:' + UI_BG_SOFT + ';color:' + UI_FG + ';border:1px solid ' + UI_BORDER + ';border-radius:6px;padding:6px 0;font-family:inherit">恢复默认 ' + Math.round(CARD_ALPHA * 100) + '%</button>',
            '<div style="color:#7a7a7a;font-size:11px;margin-top:10px">快捷键 ' + PANEL_KEY + ' 开 / 关</div>'
        ].join('');
        var style = document.createElement('style');
        // 强制覆盖站点可能的全局样式；#id 前缀保证特异性
        style.textContent = '#luogu-dark-card-panel, #luogu-dark-card-panel * { box-sizing:border-box !important; font-family:' + UI_FONT + ' !important; } #luogu-dark-card-panel button:hover { background:#3d3d3d !important; }';
        box.appendChild(style);
        document.documentElement.appendChild(box);
        return box;
    }

    var panel = null;
    var panelOpen = false;
    var updatePanel = null;

    /* 底栏显隐：写 html 上的属性（规则在常驻样式表里），并持久化 */
    var KEY_FOOTER = 'luoguDarkCard.hideFooter';
    var hideFooter = readValue(KEY_FOOTER, HIDE_FOOTER);

    function applyFooter() {
        var root = document.documentElement;
        if (!root) return;
        if (hideFooter) root.setAttribute('data-ld-footer', 'hide');
        else root.removeAttribute('data-ld-footer');
    }

    function setHideFooter(on) {
        hideFooter = !!on;
        writeValue(KEY_FOOTER, hideFooter);
        applyFooter();
        if (updatePanel) updatePanel();
    }

    function refreshPanel() {
        if (!panel) return;
        var range = panel.querySelector('[data-ld="range"]');
        var valueEl = panel.querySelector('[data-ld="value"]');
        if (range && +range.value !== alpha) range.value = String(alpha);
        if (valueEl) valueEl.textContent = Math.round(alpha * 100) + '%';
        var cb = panel.querySelector('[data-ld="hideFooter"]');
        if (cb && cb.checked !== hideFooter) cb.checked = hideFooter;
        // ★ 测试点透明度：滑块位置 + 百分比显示
        var tcRange = panel.querySelector('[data-ld="tcRange"]');
        var tcValueEl = panel.querySelector('[data-ld="tcValue"]');
        if (tcRange && Math.abs(parseFloat(tcRange.value) - tcAlpha) > 0.0001) tcRange.value = String(tcAlpha);
        if (tcValueEl) tcValueEl.textContent = Math.round(tcAlpha * 100) + '%';
        var satRange = panel.querySelector('[data-ld="satRange"]');
        var satValueEl = panel.querySelector('[data-ld="satValue"]');
        if (satRange && Math.abs(parseFloat(satRange.value) - saturate) > 0.0001) satRange.value = String(saturate);
        if (satValueEl) satValueEl.textContent = Math.round(saturate * 100) + '%';
        var note = panel.querySelector('[data-ld="note"]');
        if (note) {
            note.textContent = '卡片 alpha = ' + Math.round(alpha * 100) + '%'
                + ' · 宿主 ' + (hostTheme === 'light' ? '浅色' : '深色')
                + ' · 代码框固定 #1e1e1e';
        }

        // 预览色块必须和页面上的实际合成色一致。
        // 卡片/样例框/代码框可能叠在 .theme-page 之类「自己带背景」的祖先上，
        // 手算合成很容易搞错层级，所以这里用一组探针交给浏览器自己算。
        var host = document.querySelector('.theme-page') || document.body || document.documentElement;
        var probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;';
        var cardP = document.createElement('div');
        cardP.style.cssText = 'width:8px;height:8px;background:var(--ld-card);';
        probe.appendChild(cardP);
        host.appendChild(probe);

        function compositeOf(el) {
            // 从元素往根收集半透明层，遇到第一个不透明层即停（它是底）
            var chain = [], n = el;
            while (n && n.nodeType === 1) {
                var c = cssColor(getComputedStyle(n).backgroundColor);
                if (c && c.a > 0.001) { chain.push(c); if (c.a >= 0.999) break; }
                n = n.parentElement;
            }
            // 必须从「最外层 → 最内层」方向合成：chain 是「内 → 外」，所以反向遍历
            var base = [255, 255, 255];
            for (var i = chain.length - 1; i >= 0; i--) {
                // 不透明层本身就是底，直接替换；半透明层才叠上去
                var layer = chain[i];
                base = layer.a >= 0.999
                    ? [layer.r, layer.g, layer.b]
                    : overRgb([layer.r, layer.g, layer.b, layer.a], base);
            }
            return base;
        }

        // 样例框 / 代码框直接镜像页面上的真实元素，保证预览 100% 一致
        // 注意：P1001 的卡片元素本身也带 io-sample 类，所以样例框必须限定在卡片之外找
        var sampleEl = document.querySelector('.l-card .io-sample, .l-card .io-sample-block')
            || document.querySelector('.io-sample:not(.l-card), .io-sample-block:not(.l-card)');
        var codeEl = document.querySelector('.l-card .io-sample pre, .l-card pre.lfe-code, .l-card .lfe-code')
            || document.querySelector('.l-card pre[class*="language-"], pre.lfe-code');
        var mirrors = [
            ['pv-card', cardP],
            ['pv-sample', sampleEl],
            ['pv-code', codeEl]
        ];
        for (var i = 0; i < mirrors.length; i++) {
            var swatch = panel.querySelector('[data-ld="' + mirrors[i][0] + '"]');
            if (!swatch) continue;
            var src = mirrors[i][1];
            if (!src) {
                // 页面上没有对应元素（比如题解页没有样例框）→ 显示兜底色
                swatch.style.background = mirrors[i][0] === 'pv-sample' ? 'var(--ld-layer-1)' : 'var(--ld-layer-2)';
                swatch.title = '本页无此元素，显示兜底色';
                continue;
            }
            var rgb = compositeOf(src);
            swatch.style.background = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
            swatch.title = rgbToHex(rgb) + '  rgb(' + rgb.join(', ') + ')';
        }
        probe.remove();
    }

    function overRgb(fg, bg) {
        return [
            Math.round(fg[0] * fg[3] + bg[0] * (1 - fg[3])),
            Math.round(fg[1] * fg[3] + bg[1] * (1 - fg[3])),
            Math.round(fg[2] * fg[3] + bg[2] * (1 - fg[3]))
        ];
    }

    function openPanel() {
        if (!panel) panel = buildPanel();
        panel.style.display = 'block';
        panelOpen = true;
        refreshPanel();
    }

    function closePanel() {
        if (panel) panel.style.display = 'none';
        panelOpen = false;
    }

    function togglePanel() { if (panelOpen) closePanel(); else openPanel(); }

    function bindPanel() {
        if (!panel) return;
        var range = panel.querySelector('[data-ld="range"]');
        if (range) range.addEventListener('input', function () { setAlpha(parseFloat(range.value)); });
        var reset = panel.querySelector('[data-ld="reset"]');
        if (reset) reset.addEventListener('click', function () { setAlpha(CARD_ALPHA); });
        var p55 = panel.querySelector('[data-ld="preset55"]');
        if (p55) p55.addEventListener('click', function () { setAlpha(CARD_ALPHA_MIN); });
        var p85 = panel.querySelector('[data-ld="preset85"]');
        if (p85) p85.addEventListener('click', function () { setAlpha(0.85); });
        var hf = panel.querySelector('[data-ld="hideFooter"]');
        if (hf) hf.addEventListener('change', function () { setHideFooter(hf.checked); });
        // ★ 测试点透明度滑块 + 三个预设档
        var tcRange = panel.querySelector('[data-ld="tcRange"]');
        if (tcRange) tcRange.addEventListener('input', function () { setTcAlpha(parseFloat(tcRange.value)); });
        var satRange = panel.querySelector('[data-ld="satRange"]');
        if (satRange) satRange.addEventListener('input', function () { setSaturate(parseFloat(satRange.value)); });
        var sp100 = panel.querySelector('[data-ld="satPreset100"]');
        if (sp100) sp100.addEventListener('click', function () { setSaturate(1); });
        var sp80 = panel.querySelector('[data-ld="satPreset80"]');
        if (sp80) sp80.addEventListener('click', function () { setSaturate(0.8); });
        var sp60 = panel.querySelector('[data-ld="satPreset60"]');
        if (sp60) sp60.addEventListener('click', function () { setSaturate(0.6); });
        var tcp100 = panel.querySelector('[data-ld="tcPreset100"]');
        if (tcp100) tcp100.addEventListener('click', function () { setTcAlpha(1); });
        var tcp70 = panel.querySelector('[data-ld="tcPreset70"]');
        if (tcp70) tcp70.addEventListener('click', function () { setTcAlpha(0.7); });
        var tcp45 = panel.querySelector('[data-ld="tcPreset45"]');
        if (tcp45) tcp45.addEventListener('click', function () { setTcAlpha(0.45); });
        var close = panel.querySelector('[data-ld="close"]');
        if (close) close.addEventListener('click', closePanel);
    }

    updatePanel = refreshPanel;

    if (!panel) { panel = buildPanel(); bindPanel(); }

    // 面板本体也要跟着主题走（站点切主题时 data-ld-theme 会变，刷新一次预览）
    if (document.documentElement) {
        var panelObserver = new MutationObserver(function () { refreshPanel(); });
        panelObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ld-theme'] });
    }

    function keyMatches(ev, key) {
        var code = 'Key' + key;
        return ev.code ? ev.code === code : String(ev.key).toUpperCase() === key;
    }

    function bindShortcut() {
        window.addEventListener('keydown', function (ev) {
            try {
                if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
                if (ev.key === 'Escape' && panelOpen) { ev.preventDefault(); closePanel(); return; }
                if (PANEL_KEY === 'Alt+L' && keyMatches(ev, 'L') && !ev.shiftKey) { ev.preventDefault(); togglePanel(); return; }
                if (PANEL_KEY === 'Alt+Shift+L' && keyMatches(ev, 'L') && ev.shiftKey) { ev.preventDefault(); togglePanel(); }
            } catch (e) { /* ignore */ }
        }, true);
    }

    bindShortcut();

    setEnabled(enabled);
    setAlpha(alpha);
    setTcAlpha(tcAlpha);
    setSaturate(saturate);
    applyFooter();

    var menuIds = [];

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        try {
            menuIds.push(GM_registerMenuCommand(
                (enabled ? '✅' : '⬜') + ' 深色卡片：开 / 关',
                function () {
                    setEnabled(!enabled);
                    refreshMenu();
                }
            ));
            [0.55, 0.65, 0.75, 0.85, 1.0].forEach(function (v) {
                menuIds.push(GM_registerMenuCommand('🎚 卡片深度 ' + Math.round(v * 100) + '%', function () {
                    setAlpha(v);
                    refreshMenu();
                }));
            });
            menuIds.push(GM_registerMenuCommand('⚙️ 打开设置面板（' + PANEL_KEY + '）', function () {
                openPanel();
            }));
            menuIds.push(GM_registerMenuCommand('↩︎ 恢复默认 ' + Math.round(CARD_ALPHA * 100) + '%', function () {
                setAlpha(CARD_ALPHA);
                refreshMenu();
            }));
        } catch (e) { /* ignore */ }
    }

    function refreshMenu() {
        if (typeof GM_unregisterMenuCommand !== 'function') return;
        try {
            menuIds.forEach(function (id) { GM_unregisterMenuCommand(id); });
            menuIds = [];
            registerMenu();
        } catch (e) { /* ignore */ }
    }

    registerMenu();

    // 暴露最小 API，方便在控制台里手动调 / 自测
    window.LuoguDarkCard = {
        setEnabled: setEnabled,
        setAlpha: setAlpha,
        openPanel: openPanel,
        closePanel: closePanel,
        alpha: function () { return alpha; },
        enabled: function () { return enabled; },
        theme: function () { return hostTheme; },
        page: pageType
    };
})();
