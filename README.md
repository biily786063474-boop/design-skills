# design-skills

给 AI 编码助手（Claude Code 等）用的设计类 skill，自用整理后公开。
Design skills for AI coding agents (Claude Code and others), published from a personal setup.

| 目录 | 作用 |
|---|---|
| `design-system-first/` | 通用 skill：规划任何 UI 之前，用 6 张确认卡加一个推导脚本得出完整、校验通过的设计系统（字阶、间距、控件高度、圆角、颜色、阴影、动效、层级、状态矩阵、页面版式），分「轻 / 标准 / 完整」三档；已有项目走「审计 → 决策码 → 迁移 → 守卫」 |
| `report-preset/` | 汇报 / 评审 / 总结页的固定视觉预设：跨次一致比好看重要，不参与风格选型 |

## 用法

把目录放进 `~/.claude/skills/`（`report-preset/` 里的 `report-preset.md` 是一份参考规范，放进你自己的 skill 即可引用）。

## 推导脚本

`design-system-first/scripts/derive.mjs`：零依赖、不联网的 Node 脚本（Node 18 及以上，在 Node 26 上测过）。输入「锚点」（平台、档位、主题、密度、形状、主色），一次算出全部维度并自动校验，输出 DTCG 三层 `tokens.json`、`tokens.css`、`DESIGN-SYSTEM.md`、可选的预览页。

```bash
node design-system-first/scripts/derive.mjs --in design-system-first/scripts/examples/web-saas.json --out design-system/ --preview
node --test design-system-first/scripts/derive.test.mjs   # 25 个单测，含 1000+ 组合的全量扫描
```

## 说明

- `design-system-first/` 的主文档与维度清单是通用方法，不依赖任何具体项目；一次真实的事后补救案例（审计数字、落地值、踩过的验收坑）单独放在 `design-system-first/references/case-study.md`，需要量级感时再读。
- 没有放入任何第三方数据（风格库、组件库、设计系统语料）。
