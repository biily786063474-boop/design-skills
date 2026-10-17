# 来源登记

这个 skill 的流程与脚本是自己写的。下面记下参考过的外部想法，以及哪些东西没有拷贝。

| 参考对象 | 许可证 | 参考了什么 | 拷贝了文本吗 |
| --- | --- | --- | --- |
| [plugin87/ux-ui-agent-skills](https://github.com/plugin87/ux-ui-agent-skills) | MIT（版权人 Thientan Soparat） | 令牌用 DTCG 三层（primitive → semantic → component）；色板用 OKLCH 生成 11 档并校验对比度；`grill-me` 的「先读项目再提问、限题数、没问的写成声明的假设」 | 没有。只参考了公开的结构与做法，数值（步进系数、亮度阶梯、密度表）是这里自己定的 |
| [Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT（Vercel Labs） | 「一行一条可核查规则 + 固定输出格式」的审计思路（本 skill 暂未使用，留给后续审计 skill） | 没有 |
| 本机 `visual-router` | 自有 | 「给 2–3 个候选、先让用户看预览再选」的确认方式 | 不适用 |
| 本机 `ui-ux-pro-max`（插件） | 第三方插件 | `MASTER.md` 总纲加 `pages/` 按页覆盖的落盘方式；iOS 与 Android 的触控、字号下限规则出处（Apple HIG、Material） | 没有，只参考落盘结构与规则出处 |

## 说明

- 没有记录外部仓库的 commit SHA，因为没有拷贝任何文件；以后如果要拷贝其中的文本（MIT 允许，须保留版权声明），先固定到具体 commit 再拷，并在这里补一行。
- 参考的评审是用 `gh api` 只读完成的，没有安装、没有运行外部脚本。评审时没有核实的部分（例如 plugin87 的 hooks 与 MCP 的具体行为）这里没有采用。
- Apple HIG 的 17pt 正文与 44pt 触控下限、Material 的 16sp 正文与 48dp 触控下限，出处是这两家的公开设计规范；脚本里的数值按这个设定。
