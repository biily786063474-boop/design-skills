# design-skills

给 AI 编码助手（Claude Code 等）用的设计类 skill，自用整理后公开。
Design skills for AI coding agents (Claude Code and others), published from a personal setup.

| 目录 | 作用 |
|---|---|
| `design-system-first/` | 通用 skill：规划任何 UI 之前先做设计系统：字阶、圆角、间距、控件高度、动效、阴影、z-index、焦点环、状态、页面版式，分「轻 / 标准 / 完整」三档取舍；已有项目走「审计 → 决策码 → 迁移 → 守卫」 |
| `report-preset/` | 汇报 / 评审 / 总结页的固定视觉预设：跨次一致比好看重要，不参与风格选型 |

## 用法

把目录放进 `~/.claude/skills/`（`report-preset/` 里的 `report-preset.md` 是一份参考规范，放进你自己的 skill 即可引用）。

## 说明

- `design-system-first/` 的主文档与维度清单是通用方法，不依赖任何具体项目；一次真实的事后补救案例（审计数字、落地值、踩过的验收坑）单独放在 `design-system-first/references/case-study.md`，需要量级感时再读。
- 没有放入任何第三方数据（风格库、组件库、设计系统语料）。
