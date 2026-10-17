# 规则表

每条规则一行可核查的判据。级别：**错误**（影响真实用户，必须修或登记）· **建议**（偏离设计系统或有隐患）· **提示**（可读性与基础卫生）。规则 ID 和 `scripts/audit.mjs` 里的 `RULES` 一一对应，单测逐条覆盖正反例。

## 令牌规则（需要令牌文件；缺哪类令牌就跳过哪类）

| 规则 ID | 级别 | 判据 | 修法 |
| --- | --- | --- | --- |
| `token/color-literal` | 建议 | 样式值里出现 `#hex`、`rgb()`、`hsl()`、`oklch()` 等写死的颜色（令牌文件本身与 `--自定义属性` 除外） | 等于某个颜色令牌就换成 `var(--color-…)`；不等于时脚本给出最近的令牌，让人确认 |
| `token/font-size` | 建议 | `font-size` 的 px 或 rem 值不在字阶令牌里；等于令牌时提示直接用变量 | 并到最近的档，或补一档到令牌里（要改设计系统） |
| `token/radius` | 建议 | `border-radius` 的值不在圆角令牌里（0、50%、999px 以上的胶囊除外） | 同上 |
| `token/spacing` | 建议 | `padding / margin / gap` 的 px 值不在间距阶梯里（0 与 auto 除外；负值取绝对值） | 同上 |
| `token/z-index` | 建议 | `z-index` 数字不在层级令牌里（0 除外） | 用命名层（`--z-modal` 等） |
| `token/duration` | 建议 | `transition / animation` 的时长不在时长令牌里（小于 1ms 的减弱动效覆盖除外） | 用 `var(--dur-…)` |
| `token/shadow` | 建议 | `box-shadow` 是写死的值（`none` 与 `var()` 除外） | 用阴影令牌 |

范围：CSS 声明、`<style>`、内联 `style=""`、JSX 样式对象（`fontSize: 15`、`padding: '10px 12px'`）、Tailwind 任意值（`text-[13px]`、`rounded-[10px]`、`bg-[#abc]`）。`var()`、`calc()`、`clamp()`、`min()`、`max()` 里的内容不查。

## 通用界面规则（不需要令牌）

| 规则 ID | 级别 | 判据 | 修法 |
| --- | --- | --- | --- |
| `a11y/focus-outline-none` | 错误 | CSS 块里对按钮 / 链接 / 输入框 / 带 `:focus` 的选择器写了 `outline: none` 或 `0`，且同一块里没有 `box-shadow`、`border`、`outline-color`、`background`、`text-decoration` 之类的替代；Tailwind 的 `outline-none` 同一处没有 `focus-visible:ring` 等替代。`:focus:not(:focus-visible)` 与 `[tabindex="-1"]` 放行 | 给 `:focus-visible` 一个可见样式（令牌里的焦点环：2px 实线、偏移 2） |
| `a11y/zoom-disabled` | 错误 | viewport 含 `user-scalable=no` 或 `maximum-scale=1` | 去掉，低视力用户要放大 |
| `a11y/img-alt` | 错误 | `<img>` 没有 `alt`（`alt=""` 合法，用于纯装饰；带展开属性 `{...props}` 的放行；注释里的不算） | 有意义的图写描述，装饰图写 `alt=""` |
| `a11y/click-non-semantic` | 建议 | `div / span / li / p / section / article` 上绑了点击（`onClick`、`@click`），没有 `role` 与 `tabIndex` | 改用 `<button>`；或补 `role="button"`、`tabIndex={0}` 与键盘事件 |
| `ux/transition-all` | 建议 | `transition` 里用了 `all` | 只列要动的属性（颜色、透明度、位移） |
| `ux/font-too-small` | 提示 | 字号字面值小于 11px | 抬到字阶下限；触屏平台更高（iOS 最小 11pt、Android 最小 12sp） |
| `ux/reduced-motion-missing` | 提示 | 项目里有 `transition` 或 `animation`，却没有任何文件处理 `prefers-reduced-motion` | 在全局样式加一段减弱动效的覆盖（`design-system-first` 生成的 `tokens.css` 自带） |
| `scale/half-pixel` | 提示 | 布局尺寸类属性（字号、宽高、边距、间隙、定位、圆角）里出现半像素（`.5px`）；`letter-spacing`、`transform`、边框发丝线不算 | 取偶数 px |
| `scale/odd-px` | 提示 | **没有对应令牌时**，间距或圆角用了奇数 px | 取偶数 px，或先立令牌 |
| `meta/ignore-no-reason` | 建议 | `ds-ignore` 后面没写理由 | 写成 `ds-ignore: 理由` |

## 为什么这样分级

- **错误**只给会让真实用户用不了的问题：看不见焦点、放大不了、读屏读不出图。这三类没有「风格偏好」的余地。
- **令牌偏离**给「建议」而不是「错误」：旧项目一上来就几百条，全标红没有意义；用基线把现状冻结，只防新增，才是可执行的做法。
- **提示**是基础卫生，不挡路。

## 已知会误报的地方（用 `ds-ignore` 登记）

- 容器 `tabIndex={-1}` 只是焦点陷阱的兜底落点，不画描边：`.dlg:focus { outline: none }`。
- 第三方组件的样式覆盖（例如编辑器自己画光标）。
- 图表、画布库的配置对象里恰好叫 `padding`、`fontSize`、`color` 的字段。
- 设计稿指定的品牌卡、独立窗口的特殊值。

登记时写清理由，汇总里会列出来，定期复查。
