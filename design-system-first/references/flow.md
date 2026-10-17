# 确认流程：6 张卡，其余全由规则推导

目标：用户只做 5 次选择加 1 次终确认，就得到一套完整、自洽、校验通过的设计系统。**少问多推**：只问会改变整套结果的事，其余几十个值交给 `scripts/derive.mjs` 推导，最后把推导结果摊开给用户看，用户只改他想改的。

## 总纪律

- **一次一张卡，摆卡后直接结束这一轮**，等用户回应再继续。不在正文里列编号选项让用户回字。
- **每个选项带「为什么推荐」**，并标出推荐项。
- **先读后问**：能从项目里读到的答案不问（S0）。读到的写成「假设」，让用户在 Q1 一眼核对。
- **每张卡的回应立即追加到 `design-system/DECISIONS.md`**，对话中断后可从那里恢复，不重问。
- **没问的维度不装作问过**：在 Q6 里单独列为「声明的假设」。
- **确认按钮写清动作与对象**，例如「生成设计系统并写入 design-system/」，不写「确定」。
- 卡片工具（`card_form` / `card_choose` / `card_confirm`）不可用时：降级为 AskUserQuestion；再不行就在正文里给 2–4 个带字母的选项和推荐项，仍然**一次只问一个问题**。
- 推导脚本需要 Node 18 及以上（在 Node 26 上测过），零依赖、不联网，只写 `--out` 指定的目录。

## 流程总览

```
S0 读项目（不问）
 │  已有令牌/大量样式？ 是 → 走「已有项目：审计 → 决策码 → 迁移 → 守卫」，不走本流程
 ▼
Q1 画像（card_form）      默认值 = S0 假设；勾「其余全按推荐」可跳过 Q2 / Q4 / Q5
Q2 定档（card_choose）     轻 / 标准 / 完整
Q3 气质（card_choose）     2–3 个候选 + 预览页
Q4 密度（card_choose）     紧凑 / 标准 / 舒展
Q5 形状与动效（card_choose）锐利利落 / 适中克制 / 圆润柔和
 ▼
推导 → 校验（scripts/derive.mjs）
 ▼
Q6 终确认（card_confirm）  + 预览页；不通过则按用户的话改一项，再推导再确认
 ▼
落盘 design-system/
```

全按推荐时只剩 3 张卡：Q1、Q3、Q6。

## S0 读项目（不问）

读这些并整理成「项目画像草稿」，每条标明来源：

| 读什么 | 得到什么 |
| --- | --- |
| `package.json`、`Package.swift`、`*.xcodeproj`、`build.gradle`、`electron` 相关依赖 | 平台：web / desktop / ios / android |
| 样式文件：`*.css`、`*.scss`、`tailwind.config.*`、Swift 的 Color/Font 扩展 | 是否已有令牌；已有就转审计路径 |
| 是否有 `i18n`、`locales`、`*.xcstrings` | 语言数 |
| 是否有 `prefers-color-scheme`、`data-theme`、`Assets` 暗色变体 | 明暗 |
| git 作者数、CODEOWNERS | 团队规模 |
| `design-system/DECISIONS.md` | **存在 → 恢复**：摆一张 `card_choose`「继续上次（停在 Qn）/ 从头来」 |

判断「已有项目」：样式文件里字面颜色或字号很多、却没有集中的令牌文件。此时告诉用户一句「这个项目已经有 N 种字号 / M 种圆角，建议先审计再统一」，转 SKILL.md 的「已有项目」流程。

## Q1 画像（`card_form`，一张）

标题：「先确认这个项目的基本情况」。`summary` 写：「下面的默认值是我从项目里读到的，直接提交就是全按推荐。」

| key | type | 选项 | 默认 |
| --- | --- | --- | --- |
| `product` | select | 后台 / SaaS · 工具 / 编辑器 · 内容 / 阅读 · 营销 / 落地页 · 创作 / 社区 · 其他 | S0 推断 |
| `platform` | select | Web · 桌面应用 · iOS · Android | S0 读到 |
| `usage` | select | 长时间专注（每天几小时）· 偶尔使用 · 内容消费 | 工具类 → 长时间专注 |
| `lang` | select | 单语 · 中英双语 · 多语（含更长的语言） | S0 读到 |
| `theme` | select | 仅亮色 · 仅暗色 · 亮暗两套 | S0 读到，读不到默认两套 |
| `team` | select | 1 人 · 2–5 人 · 多人或多 agent 并行改 UI | git 作者数 |
| `fast` | bool | 其余全按推荐（跳过定档、密度、形状三张卡） | 否 |

回应 `{values:{…}}` → 写入 DECISIONS.md，并写进锚点的 `platform`、`theme`；`product / usage / lang / team` 用来给后面的推荐。

## Q2 定档（`card_choose`）

| 推荐规则 | 档 |
| --- | --- |
| 一次性页面、营销站、活动页、原型 | 轻 |
| 多页面产品、后台、有 2 人及以上改 UI | **标准** |
| 桌面应用、长期维护、多人或多 agent 并行改 UI、需要多语言 | 完整 |
| 拿不准 | 标准 |

选项文案各带一句：轻 = 只立颜色、字阶、圆角、间距、阴影、动效；标准 = 再加控件高度、层级、焦点环、状态矩阵、页面版式和守卫；完整 = 再加无障碍对比度表、多语言长度、变更记录。`recommended: true` 标在推荐项上，`desc` 写推荐理由。

## Q3 气质（`card_choose` + 预览）

1. 从 `references/moods.md` 按「产品类型 × 明暗」筛出 2–3 个候选（用户已给品牌色则只有 1 个候选：用他的色，问是否继续）。
2. 为每个候选跑一遍推导（默认密度与形状取该气质的默认值），写到 `design-system/.candidates/<id>/preview.html`，用 `canvas_open_html` 打开（没有画布就告诉用户文件路径）。
3. 摆卡：选项 = 候选，`desc` 写一句气质描述和适用场景；`allowOther: true`，让用户可以直接给品牌色十六进制。
4. 回应 → 锚点 `accent`、`neutral`、`fonts`；同时把该气质的默认形状记为 Q5 的推荐。

## Q4 密度（`card_choose`）

选项文案要带「实际样子」，用推导出的真实值，不空讲：

- 紧凑：正文 13px，控件 28px 高，区块间距 16px（适合长时间专注的数据密集界面）
- 标准：正文 14px，控件 32px 高，区块间距 20px
- 舒展：正文 16px，控件 40px 高，区块间距 24px

触屏平台（iOS / Android）在选项里加一句：「正文和控件会自动抬到平台下限（17pt / 44pt 或 16sp / 48dp）」。

推荐：长时间专注或数据密集 → 紧凑（Web、桌面）或标准；偶尔使用或内容消费 → 舒展或标准；触屏优先 → 标准。

## Q5 形状与动效（`card_choose`）

| 选项 | 圆角基准 | 动效 | 适合 |
| --- | --- | --- | --- |
| 锐利利落 | 4px | 100–360ms，克制 | 专业工具、数据密集 |
| 适中克制 | 8px | 120–450ms | 通用，**默认推荐** |
| 圆润柔和 | 12px | 150–500ms，小控件有轻微回弹 | 消费、创作、社区 |

推荐：跟 Q3 选中气质的默认形状走。

## 推导

把 Q1–Q5 的结果写成 `design-system/anchors.json`（字段见 `scripts/derive.mjs` 文件头），然后：

```bash
node <skill 目录>/scripts/derive.mjs --in design-system/anchors.json --out design-system/ --preview
```

- 退出码 0：全部校验通过。
- 退出码 1：有失败项，**不要继续**。把失败项原样告诉用户，并说明是推导规则的问题还是锚点的问题（例如主色太浅导致对比度不够，脚本会自动换档并在「主色说明」里写明）。
- 退出码 2：输入有问题（锚点缺字段或写错），修正后重跑。

## Q6 终确认（`card_confirm` + 预览页）

先用 `canvas_open_html` 打开 `design-system/preview.html`，再摆卡。

`facts`（最多 10 项）：档位 · 平台 · 气质与主色 · 密度 · 形状与动效 · 字阶（7 个值）· 控件高度 · 圆角 · 校验（N 项全部通过）· 声明的假设（几条）。

`confirmLabel`：「生成设计系统并写入 design-system/」；`cancelLabel`：「我要改一项」。

- `accepted: true` → 落盘（见下）。
- `accepted: false` 且带 `note`：按 note 改。想改的是气质、密度、形状 → 回到对应那张卡重问；想改某个具体值 → 写进 `overrides`（`key` + `value` + **必填的 `reason`**，会登记为例外），重新推导、重新校验。然后再摆一次 Q6。

## 落盘

`design-system/` 下最终有：

| 文件 | 说明 |
| --- | --- |
| `tokens.json` | DTCG 三层（primitive → semantic → component），源文件 |
| `tokens.css` | 由 tokens.json 同一次推导生成，**不手改** |
| `DESIGN-SYSTEM.md` | 总纲：锚点、各维度与出处、状态矩阵、页面版式、守卫、例外登记、校验结果 |
| `DECISIONS.md` | 每张卡的回应、推荐值、用户改动、声明的假设 |
| `anchors.json` | 推导输入，改它再重新推导就能整体调整 |
| `preview.html` | 预览页 |
| `pages/<页面>.md` | 按页覆盖（可选）：页面与总纲的偏差，只写偏差；总纲不存在偏差时没有这个文件 |

标准档起，再做一件事：把守卫接进项目的检查命令（新文件字面值为零、旧文件按基线只减不增）。守卫就是 `design-audit` 的基线模式：先把 `audit.mjs`（单文件、零依赖）拷进项目（例如 `scripts/design-audit.mjs`），具体命令写在生成的 `DESIGN-SYSTEM.md` 的「守卫」一节：第一次 `--update-baseline` 把现状记为基线，之后每次检查比基线多就退出码 1。项目的 CI 不能依赖外部安装路径，所以必须拷进项目。接进哪个检查命令取决于项目；改项目的检查命令前先用确认卡复述要改什么，用户点了再改，并告诉用户做了什么。

## DECISIONS.md 格式

```markdown
# 设计系统决策记录

## S0 读项目（假设）
- 平台：Web（来源：package.json 有 react）
- 语言：单语（来源：没有 i18n 目录）

## Q1 画像 · 已确认
回应：product=后台 / platform=Web / usage=长时间专注 / lang=单语 / theme=亮暗两套 / team=2–5 人 / fast=否

## Q2 定档 · 已确认
推荐：标准（理由：多页面、2 人及以上）　选择：标准

## Q3 气质 · 已确认
候选：graphite-blue / forest / teal　推荐：graphite-blue　选择：graphite-blue，主色改为 #2f6fed（用户给的）

## Q4 密度 · 已确认
……

## 声明的假设（没问过用户）
- 动效缓动用 ease-out，不加弹簧
- 断点用 640 / 1024 / 1440

## 覆盖与例外
| 键 | 推导值 | 覆盖为 | 理由 |
```

写入时每条带「推荐 → 选择」，用户偏离推荐的地方一眼能看到。
