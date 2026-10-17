# report 预设 · 汇报页固定视觉规格

> **这套规格不参与选型，不随项目变化。** 所有给用户审阅决策的 HTML 页面都长这样。
> 依据：暗色中性基调（延续 huashu-design 色彩语言）× Swiss 信息层级 × Editorial 长文可读性。

## 适用判定

| 是 report 预设 | 不是 |
|---|---|
| 评审报告、方案总结、SOP 文档 | 产品界面、落地页、App |
| 进度复盘、数据分析、调研结论 | 对外物料（封面 / Banner / 社交图） |
| 多方案对比、决策支持页 | 客户交付的品牌网站 |

判据一句话：**页面的目的是让人读完做决定** → report 预设。

---

## 一、五条硬约束

1. **本地 standalone HTML**，含 `<!doctype html>`/`<head>`/`<body>`，纯内联 CSS，**零外部依赖**（不引 CDN、不引外部字体，断网可开）
2. 放项目 `docs/` 下，**不用 artifact 托管**
3. 暗色固定，不做明暗切换（汇报页是长时间阅读场景，切换开关是噪声）
4. **一屏一个决策**：页面顶部必须是结论，不是背景介绍
5. 页面底部给**决策码** —— 一条可复制的短指令，用户复制粘回对话即完成反馈

---

## 二、色彩 token

| 用途 | 值 |
|---|---|
| 页面背景 | `#0a0a0a` |
| 卡片 / 面板 | `rgba(23,23,23,.5)` + `1px solid #262626` |
| 分隔线 | `#1f1f1f`（弱）/ `#262626`（强） |
| 主文字 | `#f5f5f5` |
| 次要文字 | `#a3a3a3` |
| 说明 / 占位 | `#737373` ~ `#525252` |
| 表头背景 | `#141414` |
| 代码块背景 | `#111` |

### 语义色（低饱和，一屏不超过 3 种）

| 语义 | 主色 | 徽章底 | 用途 |
|---|---|---|---|
| 通过 / 裁决 / 正向 | `#6ee7b7` | `rgba(16,185,129,.14)` | 结论、达标、推荐 |
| 警示 / 重点 | `#fcd34d` | `rgba(245,158,11,.14)` | 风险、需注意、待办 |
| 反对 / 否决 / 负向 | `#fda4af` | `rgba(244,63,94,.14)` | 不同意见、禁止项、崩塌 |
| 信息 / 中性 | `#7dd3fc` | `rgba(14,165,233,.14)` | 补充说明、次要分类 |
| 强调 / 特殊 | `#c4b5fd` | `rgba(139,92,246,.14)` | 需要区别于以上四类时 |

> **语义色一旦分配就不能换**。绿色永远是通过，红色永远是反对——跨报告一致，读者不用重新学。

---

## 三、结构组件

| 组件 | 用途 | 视觉标记 |
|---|---|---|
| `.verdict` | **裁决卡** — 结论、决定、推荐 | 左边框 2px `#34d399` + 极淡绿底 |
| `.dissent` | **反对卡** — 不同意见、保留的分歧、风险提示 | 左边框 2px `#fb7185` + 极淡红底 |
| `.warn` | **警示卡** — 待办、期望管理、合规红线 | 左边框 2px `#fbbf24` + 极淡黄底 |
| `.stat` | **数字块** — 关键指标，数字 30px 语义色 | 卡片内大字 + 小标签 |
| `.tw > table` | **表格** — 主力信息载体，横向可滚 | 表头 `#141414`，行 hover 微亮 |
| `.tl` | **时间线** — 流程、周循环、阶段 | 左竖线 + 节点圆点，关键节点绿点 |
| `pre` | **流程图 / 代码** — ASCII 流程用 `.flow` 绿箭头、`.dim` 灰注释、`.hi` 黄高亮 | `#111` 底 |
| `.b` | **徽章** — 状态标签 | `.b-em/.b-am/.b-sk/.b-ro/.b-vi/.b-gy` |
| `.bar` | **进度条** — 占比、达标比 | 6px 圆角条 |

### 组件使用纪律

- **反对卡不是装饰**。多方案评审时，「保留的分歧」比「一致同意」信息量更大 —— 有反对意见必须显式呈现，不要为了页面好看抹平。
- **数字块 ≤4 个一行**，超过就变成表格。
- **表格优先于卡片网格**。信息密集时表格的扫描效率高得多。
- 长表格必须裹 `.tw`（`overflow-x:auto`），页面 body 永不横向滚动。

---

## 四、排版

| 元素 | 规格 |
|---|---|
| 正文 | 15px / 行高 1.75 |
| H1 | 38px / 600 / `letter-spacing:-.02em`（移动端 29px） |
| 章节眉标 `h2` | 12px / 大写 / `letter-spacing:.15em` / `#737373` |
| 章节标题 `.sectitle` | 25px / 600 |
| H3 | 17px / 600 |
| 表格 | 13.5px |
| 代码 | 12.5px / `ui-monospace` |
| 内容宽度 | `max-width:1080px` |
| 字体栈 | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` |

**圆角**：徽章/小元素 `6-8px` · 卡片 `14px` · 代码块 `12px`
**动效**：只用 `transition:color .15s / background-color .15s`。不做位移、缩放、入场动画。

---

## 五、页面骨架

```
nav（sticky 锚点导航，章节多于 4 个时必加）
header.hero
  ├─ .eyebrow  文档类型 + 版本
  ├─ h1        标题
  ├─ .lede     一段话说清这份文档解决什么（≤3 行）
  └─ .meta     日期 / 数据量 / 来源等元信息
section#结论      ← 必须第一个：核心裁决 / 摘要 / 数字块
section#...       ← 论证与细节
section#下一步    ← 必须最后一个：待办 / 决策码
footer            ← 出处、关联文件路径
```

**每个 section 的固定三件套**：`h2` 眉标（英文）→ `.sectitle` 中文标题 → `.secnote` 一句话说明。

---

## 六、可复制 CSS 基底

```css
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:#0a0a0a;color:#f5f5f5;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased}
a{color:inherit}

/* 导航 */
nav{position:sticky;top:0;z-index:50;background:rgba(10,10,10,.86);
  backdrop-filter:saturate(160%) blur(14px);border-bottom:1px solid #262626}
.navwrap{max-width:1080px;margin:0 auto;padding:11px 24px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.navbrand{font-size:12.5px;color:#525252;letter-spacing:.06em;margin-right:8px;white-space:nowrap}
nav a{font-size:12.5px;color:#a3a3a3;text-decoration:none;padding:5px 10px;border-radius:8px;
  transition:color .15s,background-color .15s;white-space:nowrap}
nav a:hover{color:#f5f5f5;background:#1c1c1c}

/* 布局 */
main{max-width:1080px;margin:0 auto;padding:0 24px 120px}
header.hero{padding:76px 0 48px;border-bottom:1px solid #1f1f1f;margin-bottom:56px}
.eyebrow{display:inline-block;font-size:11.5px;letter-spacing:.16em;color:#737373;
  border:1px solid #2e2e2e;border-radius:999px;padding:5px 13px;margin-bottom:22px}
h1{font-size:38px;line-height:1.25;margin:0 0 18px;letter-spacing:-.02em;font-weight:600}
.lede{font-size:16.5px;color:#a3a3a3;max-width:660px;margin:0 0 30px;line-height:1.8}
.meta{display:flex;gap:26px;flex-wrap:wrap;font-size:12.5px;color:#525252}
.meta b{color:#d4d4d4;font-weight:500}
section{margin-bottom:76px;scroll-margin-top:76px}
h2{font-size:12px;letter-spacing:.15em;color:#737373;font-weight:600;text-transform:uppercase;margin:0 0 10px}
h2+.sectitle{font-size:25px;font-weight:600;margin:0 0 12px;letter-spacing:-.01em;line-height:1.35}
.secnote{color:#a3a3a3;margin:0 0 30px;max-width:720px;font-size:14.5px}
h3{font-size:17px;font-weight:600;margin:38px 0 14px}
h4{font-size:14.5px;font-weight:600;margin:24px 0 10px;color:#e5e5e5}
p{margin:0 0 14px}

/* 卡片与语义卡 */
.card{background:rgba(23,23,23,.5);border:1px solid #262626;border-radius:14px;padding:24px 26px;margin-bottom:18px}
.grid{display:grid;gap:16px}
.g2{grid-template-columns:repeat(auto-fit,minmax(290px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}
.verdict{border-left:2px solid #34d399;background:rgba(16,185,129,.05);border-radius:0 14px 14px 0;padding:20px 24px;margin:22px 0}
.dissent{border-left:2px solid #fb7185;background:rgba(244,63,94,.05);border-radius:0 14px 14px 0;padding:20px 24px;margin:22px 0}
.warn{border-left:2px solid #fbbf24;background:rgba(245,158,11,.05);border-radius:0 14px 14px 0;padding:20px 24px;margin:22px 0}
.vlabel{font-size:11px;letter-spacing:.14em;font-weight:600;margin-bottom:8px}
.verdict .vlabel{color:#6ee7b7}.dissent .vlabel{color:#fda4af}.warn .vlabel{color:#fcd34d}

/* 数字块 */
.stat{background:rgba(23,23,23,.5);border:1px solid #262626;border-radius:14px;padding:20px}
.stat .num{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-bottom:6px}
.stat .lab{font-size:12.5px;color:#737373;line-height:1.5}
.n-em{color:#6ee7b7}.n-am{color:#fcd34d}.n-sk{color:#7dd3fc}.n-ro{color:#fda4af}.n-vi{color:#c4b5fd}

/* 表格 */
.tw{overflow-x:auto;margin:18px 0;border:1px solid #262626;border-radius:14px}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}
th{text-align:left;padding:12px 16px;background:#141414;color:#a3a3a3;font-weight:500;
  font-size:12px;letter-spacing:.05em;border-bottom:1px solid #262626;white-space:nowrap}
td{padding:12px 16px;border-bottom:1px solid #1f1f1f;color:#d4d4d4;vertical-align:top}
tr:last-child td{border-bottom:none}
tbody tr{transition:background-color .15s}
tbody tr:hover{background:rgba(255,255,255,.018)}
td b,th b{color:#f5f5f5;font-weight:600}

/* 徽章 */
.b{display:inline-block;font-size:11.5px;padding:2px 9px;border-radius:6px;font-weight:500;white-space:nowrap;line-height:1.6}
.b-em{background:rgba(16,185,129,.14);color:#6ee7b7}
.b-am{background:rgba(245,158,11,.14);color:#fcd34d}
.b-sk{background:rgba(14,165,233,.14);color:#7dd3fc}
.b-ro{background:rgba(244,63,94,.14);color:#fda4af}
.b-vi{background:rgba(139,92,246,.14);color:#c4b5fd}
.b-gy{background:#1f1f1f;color:#a3a3a3}

/* 代码与流程图 */
code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:12.5px;
  background:#171717;border:1px solid #262626;padding:1.5px 6px;border-radius:5px;color:#e5e5e5}
pre{background:#111;border:1px solid #262626;border-radius:12px;padding:20px 22px;overflow-x:auto;
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:12.5px;
  line-height:1.85;color:#d4d4d4;margin:16px 0}
pre code{background:none;border:none;padding:0;font-size:inherit}
.flow{color:#6ee7b7}.dim{color:#525252}.hi{color:#fcd34d}

/* 列表 */
ul,ol{margin:0 0 14px;padding-left:20px}
li{margin-bottom:7px;color:#d4d4d4}
li::marker{color:#525252}
.clean{list-style:none;padding-left:0}
.clean li{padding-left:22px;position:relative}
.clean li::before{content:"→";position:absolute;left:0;color:#525252}

/* 时间线 */
.tl{border-left:1px solid #262626;padding-left:24px;margin:20px 0 20px 6px}
.tl .it{position:relative;padding-bottom:22px}
.tl .it::before{content:"";position:absolute;left:-29px;top:7px;width:7px;height:7px;
  border-radius:50%;background:#404040;border:2px solid #0a0a0a}
.tl .it.on::before{background:#34d399}
.tl .tm{font-size:11.5px;color:#737373;letter-spacing:.05em;margin-bottom:3px}
.tl .tt{font-size:14.5px;font-weight:500;margin-bottom:3px}
.tl .td{font-size:13px;color:#a3a3a3}

/* 进度条 */
.bar{height:6px;background:#1f1f1f;border-radius:999px;overflow:hidden;margin:8px 0 4px}
.bar > i{display:block;height:100%;border-radius:999px}

/* 决策码 */
.dcode{background:#111;border:1px solid #2e2e2e;border-radius:12px;padding:18px 20px;margin:20px 0}
.dcode .dlabel{font-size:11px;letter-spacing:.14em;color:#737373;margin-bottom:10px}
.dcode .dcmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#fcd34d;
  display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dcode button{background:#1f1f1f;border:1px solid #2e2e2e;color:#a3a3a3;font-size:12px;
  padding:5px 12px;border-radius:8px;cursor:pointer;transition:color .15s,border-color .15s}
.dcode button:hover{color:#f5f5f5;border-color:#525252}

hr{border:none;border-top:1px solid #1f1f1f;margin:44px 0}
footer{border-top:1px solid #1f1f1f;padding:34px 0 0;color:#525252;font-size:12.5px;line-height:1.9}

@media (max-width:640px){
  h1{font-size:29px}
  header.hero{padding:48px 0 34px}
  main{padding:0 18px 80px}
  .navwrap{padding:10px 18px}
  .card{padding:20px}
  section{margin-bottom:56px}
}
```

---

## 七、决策码

页面底部固定给一条可复制短指令，让静态 HTML 形成决策闭环：

```html
<div class="dcode">
  <div class="dlabel">复制这条粘回对话</div>
  <div class="dcmd">
    <span id="cmd">/pick T2 T5</span>
    <button onclick="navigator.clipboard.writeText(document.getElementById('cmd').textContent);this.textContent='已复制'">复制</button>
  </div>
</div>
```

选项可勾选时，用 JS 让指令随勾选实时更新。这是页面里**唯一允许写 JS 的地方**（外加复制按钮），其余保持静态。

---

## 八、自查

- [ ] 断网能打开（零外部依赖，字体用系统栈）
- [ ] 第一屏就是结论，不是背景介绍
- [ ] 有反对意见 / 风险的，用 `.dissent` 显式呈现了，没有为了好看抹平
- [ ] 语义色按约定用（绿=通过 / 红=反对 / 黄=警示），没有自创配色
- [ ] 一屏内语义色不超过 3 种
- [ ] 长表格裹了 `.tw`，body 不横向滚动
- [ ] 章节多于 4 个时有 sticky 锚点导航
- [ ] 底部有决策码
- [ ] 640px 宽度下不塌
