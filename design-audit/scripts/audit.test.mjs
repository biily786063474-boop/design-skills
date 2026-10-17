// node --test scripts/audit.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadTokens, checkDecl, parseCss, scanText, audit, countsOf, compareBaseline, formatText, RULES } from './audit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, 'audit.mjs')
const TOKENS = `:root{
 --fs-xs:11px;--fs-sm:12px;--fs-md:14px;--fs-lg:16px;
 --radius-sm:8px;--radius-md:12px;
 --space-0:0px;--space-4:4px;--space-8:8px;--space-12:12px;--space-16:16px;--gap-item:12px;
 --dur-fast:120ms;--dur-base:200ms;
 --z-base:0;--z-modal:40;
 --shadow-sm:0 1px 2px #00000014;
 --color-accent:#3b6fe0;--color-bg:#f7f8fb;--color-text-1:#1a1c22;
}
:root[data-theme="dark"]{--shadow-sm:0 1px 2px #00000059;--color-bg:#0d0e12}`
const T = loadTokens(TOKENS)
const ctx = { tokens: T }
const rulesOf = (arr) => arr.map((x) => x.rule).sort()

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'))
  for (const [name, body] of Object.entries(files)) { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
  return dir
}
const cli = (args, cwd) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' })

test('每条规则都有严重度与标题', () => {
  for (const [id, r] of Object.entries(RULES)) { assert.ok(['error', 'warn', 'info'].includes(r.sev), id); assert.ok(r.title, id) }
})

test('令牌解析：最后一个声明没有分号（压缩过的 CSS）也能读到', () => {
  const m = loadTokens(':root{--fs-md:14px;--radius-sm:8px}')
  assert.ok(m.fs.has(14) && m.radius.has(8))
})

test('令牌解析：分类、去重、颜色归一化', () => {
  assert.deepEqual([...T.fs.keys()], [11, 12, 14, 16])
  assert.equal(T.fs.get(14), '--fs-md')
  assert.ok(T.space.has(12) && T.space.get(12) === '--space-12') // 先出现的名字优先
  assert.ok(T.dur.has(120)); assert.ok(T.z.has(40)); assert.ok(T.color.has('#3b6fe0'))
  assert.equal(new Set(T.shadow.values()).size, 1, '亮暗两套同名阴影只算一个令牌名')
})

test('颜色字面值：命中并给最近令牌；等于令牌时直接说用哪个；var() 不报', () => {
  const a = checkDecl('color', '#3b6fe0', ctx)
  assert.equal(a[0].rule, 'token/color-literal'); assert.match(a[0].msg, /--color-accent/)
  assert.equal(checkDecl('color', 'var(--color-accent)', ctx).length, 0)
  assert.equal(checkDecl('color', 'transparent', ctx).length, 0)
  assert.equal(checkDecl('color', 'currentColor', ctx).length, 0)
  assert.equal(checkDecl('background', 'linear-gradient(#fff, #000)', ctx).filter((x) => x.rule === 'token/color-literal').length, 2)
  assert.equal(checkDecl('color', 'rgba(0,0,0,.4)', ctx)[0].rule, 'token/color-literal')
  assert.equal(checkDecl('--my-var', '#fff', ctx).length, 0, '自定义属性本身不算')
  assert.equal(checkDecl('content', '"#fff"', ctx).length, 0)
})

test('字号：不在字阶 → 最近令牌；等于令牌 → 请用变量；var/clamp 不报；rem 按 16 换算', () => {
  assert.match(checkDecl('font-size', '13px', ctx)[0].msg, /--fs-sm|--fs-md/)
  assert.match(checkDecl('font-size', '14px', ctx)[0].msg, /等于 --fs-md/)
  assert.equal(checkDecl('font-size', 'var(--fs-md)', ctx).length, 0)
  assert.equal(checkDecl('font-size', 'clamp(12px, 2vw, 18px)', ctx).length, 0)
  assert.match(checkDecl('font-size', '0.875rem', ctx)[0].msg, /等于 --fs-md/)
  assert.ok(checkDecl('font-size', '9px', ctx).some((x) => x.rule === 'ux/font-too-small'))
  assert.ok(!checkDecl('font-size', '11px', ctx).some((x) => x.rule === 'ux/font-too-small'))
})

test('圆角：0、50%、胶囊不报；不在阶梯报；奇数 px 在无令牌时提示', () => {
  assert.equal(checkDecl('border-radius', '0', ctx).length, 0)
  assert.equal(checkDecl('border-radius', '9999px', ctx).length, 0)
  assert.equal(checkDecl('border-radius', '50%', ctx).length, 0)
  assert.equal(checkDecl('border-radius', '7px', ctx)[0].rule, 'token/radius')
  assert.equal(checkDecl('border-top-left-radius', '10px', ctx)[0].rule, 'token/radius')
  assert.equal(checkDecl('border-radius', '7px', {})[0].rule, 'scale/odd-px')
  assert.equal(checkDecl('border-radius', '8px', {}).length, 0)
})

test('间距：多值逐个查；负值取绝对值；auto 与 0 不报；calc 里的不查', () => {
  assert.deepEqual(rulesOf(checkDecl('padding', '10px 16px', ctx)), ['token/spacing', 'token/spacing'])
  assert.equal(checkDecl('margin', '0 auto', ctx).length, 0)
  assert.equal(checkDecl('margin', '-4px', ctx)[0].msg.includes('等于 --space-4'), true)
  assert.equal(checkDecl('padding', 'calc(100% - 13px)', ctx).length, 0)
  assert.equal(checkDecl('gap', '13px', ctx)[0].rule, 'token/spacing')
  assert.equal(checkDecl('padding-top', '13px', {})[0].rule, 'scale/odd-px')
})

test('z-index、动效时长、阴影', () => {
  assert.equal(checkDecl('z-index', '999', ctx)[0].rule, 'token/z-index')
  assert.equal(checkDecl('z-index', '0', ctx).length, 0)
  assert.match(checkDecl('z-index', '40', ctx)[0].msg, /等于 --z-modal/)
  assert.match(checkDecl('transition', 'opacity 150ms ease', ctx)[0].msg, /--dur-fast/)
  assert.match(checkDecl('transition', 'opacity .2s', ctx)[0].msg, /等于 --dur-base/)
  assert.equal(checkDecl('transition', 'opacity var(--dur-fast)', ctx).length, 0)
  assert.equal(checkDecl('transition', 'opacity 0.01ms', ctx).length, 0)
  assert.equal(checkDecl('box-shadow', '0 2px 4px #0003', ctx).some((x) => x.rule === 'token/shadow'), true)
  assert.equal(checkDecl('box-shadow', 'none', ctx).length, 0)
  assert.equal(checkDecl('box-shadow', 'var(--shadow-sm)', ctx).length, 0)
})

test('transition: all；半像素（边框发丝线除外）', () => {
  assert.ok(checkDecl('transition', 'all .2s', ctx).some((x) => x.rule === 'ux/transition-all'))
  assert.ok(!checkDecl('transition', 'opacity .2s', ctx).some((x) => x.rule === 'ux/transition-all'))
  assert.ok(checkDecl('width', '10.5px', ctx).some((x) => x.rule === 'scale/half-pixel'))
  assert.ok(!checkDecl('border', '0.5px solid var(--color-bg)', ctx).some((x) => x.rule === 'scale/half-pixel'))
})

test('parseCss：多行值、注释里的大括号、url 里的分号、嵌套', () => {
  const css = `/* { not a block } */
.a { background: url(data:image/png;base64,AAAA); color: red;
  margin: 0
    8px }
.b { &:hover { padding: 4px } }
@media (min-width: 600px) { .c { gap: 8px } }`
  const { decls, blocks } = parseCss(css, { lineComments: true })
  assert.deepEqual(decls.map((d) => d.prop), ['background', 'color', 'margin', 'padding', 'gap'])
  assert.equal(decls.find((d) => d.prop === 'margin').value.replace(/\s+/g, ' '), '0 8px')
  assert.equal(decls.find((d) => d.prop === 'margin').line, 3)
  assert.equal(blocks.length, 5)
})

test('焦点环：有替代不报；:focus:not(:focus-visible) 不报；非交互选择器不报；无替代报错误', () => {
  const run = (css) => scanText('a.css', css, ctx).findings.filter((x) => x.rule === 'a11y/focus-outline-none')
  assert.equal(run('.btn:focus { outline: none; }').length, 1)
  assert.equal(run('button { outline: 0; }').length, 1)
  assert.equal(run('.btn:focus { outline: none; box-shadow: 0 0 0 2px var(--color-accent); }').length, 0)
  assert.equal(run('.btn:focus:not(:focus-visible) { outline: none; }').length, 0)
  assert.equal(run('.card { outline: none; }').length, 0)
  assert.equal(run('[tabindex="-1"]:focus { outline: none; }').length, 0)
  assert.equal(RULES['a11y/focus-outline-none'].sev, 'error')
})

test('JSX：数字字号与间距、字符串值、zIndex；其他键不误报', () => {
  const src = `const s = { fontSize: 15, padding: '10px 12px', zIndex: 5, id: 13, count: 7, margin: 0 }`
  const r = scanText('a.tsx', src, ctx).findings
  assert.deepEqual(rulesOf(r), ['token/font-size', 'token/spacing', 'token/spacing', 'token/z-index'].sort())
})

test('Tailwind 任意值', () => {
  const r = scanText('a.tsx', '<div className="text-[13px] rounded-[10px] p-[13px] z-[999] bg-[#abcdef] gap-[8px]" />', ctx).findings
  assert.deepEqual(rulesOf(r), ['token/color-literal', 'token/font-size', 'token/radius', 'token/spacing', 'token/spacing', 'token/z-index'].sort())
})

test('HTML：缩放被禁、img 缺 alt（alt="" 与展开属性放行）、div 上绑点击', () => {
  const html = `<meta name="viewport" content="width=device-width, maximum-scale=1">
<img src="a.png">
<img src="b.png" alt="">
<img {...props}>
<div onClick={go}>x</div>
<div onClick={go} role="button" tabIndex={0}>ok</div>
<button onClick={go}>ok</button>`
  const r = scanText('a.html', html, ctx).findings
  assert.deepEqual(rulesOf(r), ['a11y/click-non-semantic', 'a11y/img-alt', 'a11y/zoom-disabled'])
  assert.deepEqual(r.map((x) => x.line).sort(), [1, 2, 5])
})

test('注释里写的 <img>、fontSize: 15 不算代码；真标签照常查', () => {
  const src = `// 页面是 file:// 加载的，<img> 会失败，例如 { fontSize: 15 }
/* <img src="x.png"> 和 padding: '10px' 在注释里 */
const a = <img src="real.png" />`
  const r = scanText('a.tsx', src, ctx).findings
  assert.deepEqual(r.map((x) => `${x.line}:${x.rule}`), ['3:a11y/img-alt'])
  assert.equal(scanText('a.html', '<!-- <img src="x"> -->\n<p>hi</p>', ctx).findings.length, 0)
  assert.equal(scanText('a.html', '<p>文档里写 <img> 标签</p>', ctx).findings.length, 0)
})

test('半像素只看布局尺寸：letter-spacing、transform 不算', () => {
  assert.equal(checkDecl('letter-spacing', '-.5px', ctx).length, 0)
  assert.equal(checkDecl('transform', 'translateY(.5px)', ctx).length, 0)
  assert.ok(checkDecl('font-size', '11.5px', ctx).some((x) => x.rule === 'scale/half-pixel'))
  assert.ok(checkDecl('padding', '4.5px', ctx).some((x) => x.rule === 'scale/half-pixel'))
})

test('令牌值写成秒或 rem 也能换算', () => {
  const m = loadTokens(':root{--dur-fast:0.15s;--dur-base:.24s;--fs-md:0.875rem;--sp-4:0.25rem}')
  assert.ok(m.dur.has(150) && m.dur.has(240) && m.fs.has(14) && m.space.has(4))
})

test('令牌名别名：--sp-* / --duration-* / --rounded-* / --elevation-* 也认', () => {
  const m = loadTokens(':root{--sp-4:4px;--duration-fast:120ms;--rounded-md:12px;--elevation-1:0 1px 2px #0003;--text-md:14px;--zindex-modal:40}')
  assert.ok(m.space.has(4) && m.dur.has(120) && m.radius.has(12) && m.shadow.size === 1 && m.fs.has(14) && m.z.has(40))
})

test('<style> 与内联 style 里的字面值，行号对得上', () => {
  const html = `<html>
<style>
.x { border-radius: 7px; }
</style>
<div style="font-size: 13px; color: var(--color-accent)"></div>`
  const r = scanText('a.html', html, ctx).findings
  assert.deepEqual(r.map((x) => `${x.line}:${x.rule}`).sort(), ['3:token/radius', '5:token/font-size'])
})

test('忽略：有理由 → 登记；没理由 → 不算并提醒；写在上一行也行', () => {
  const css = `/* ds-ignore: 设计稿指定 */
.a { color: #123456; }
.b { color: #654321; } /* ds-ignore */
.c { color: #abcdef; } /* ds-ignore: 品牌卡 */`
  const r = scanText('a.css', css, ctx)
  assert.equal(r.ignored.length, 2)
  assert.deepEqual(r.ignored.map((x) => x.reason).sort(), ['品牌卡', '设计稿指定'])
  assert.ok(r.findings.some((x) => x.rule === 'meta/ignore-no-reason' && x.line === 3))
  assert.ok(r.findings.some((x) => x.rule === 'token/color-literal' && x.line === 3), '没写理由的不能放行')
})

test('整个项目：令牌文件所在目录与测试、node_modules 被跳过；项目级减弱动效提示', () => {
  const dir = tmpProject({
    'design-system/tokens.css': TOKENS, 'design-system/preview.html': '<div style="color:#fff">x</div>',
    'src/a.css': '.a{ transition: opacity 120ms; color: #3b6fe0 }',
    'src/a.test.tsx': 'const s = { fontSize: 99 }', 'node_modules/x/index.css': '.a{color:#000}',
  })
  const r = audit(dir)
  assert.deepEqual([...new Set(r.findings.map((x) => x.file))].sort(), ['(项目)', 'src/a.css'])
  assert.ok(r.findings.some((x) => x.rule === 'ux/reduced-motion-missing'))
  const dir2 = tmpProject({ 'design-system/tokens.css': TOKENS, 'src/a.css': '.a{transition: opacity 120ms} @media (prefers-reduced-motion: reduce){.a{transition:none}}' })
  assert.ok(!audit(dir2).findings.some((x) => x.rule === 'ux/reduced-motion-missing'))
  assert.equal(audit(dir, { includeTests: true }).findings.some((x) => x.file.includes('a.test')), true)
})

test('令牌文件里自带 prefers-reduced-motion 也算处理过', () => {
  const dir = tmpProject({ 'design-system/tokens.css': TOKENS + '\n@media (prefers-reduced-motion: reduce){:root{--dur-fast:0.01ms}}', 'src/a.css': '.a{ transition: opacity var(--dur-fast) }' })
  assert.ok(!audit(dir).findings.some((x) => x.rule === 'ux/reduced-motion-missing'))
})

test('没有令牌：只做通用规则，并说明', () => {
  const dir = tmpProject({ 'a.css': '.a{ color:#fff; padding: 13px; border-radius: 7px }\n.b:focus{outline:none}' })
  const r = audit(dir)
  assert.equal(r.tokenPath, null)
  assert.deepEqual(rulesOf(r.findings), ['a11y/focus-outline-none', 'scale/odd-px', 'scale/odd-px'].sort())
  assert.ok(r.notes[0].includes('没找到令牌文件'))
})

test('令牌文件缺某类令牌：该类规则跳过并说明', () => {
  const dir = tmpProject({ 'design-system/tokens.css': ':root{--fs-md:14px}', 'a.css': '.a{ font-size: 13px; border-radius: 7px; z-index: 999 }' })
  const r = audit(dir)
  assert.deepEqual(rulesOf(r.findings), ['scale/odd-px', 'token/font-size'])
  assert.ok(r.notes.some((n) => n.includes('没有识别到圆角令牌') && n.includes('只做奇数 px')))
  assert.ok(r.notes.some((n) => n.includes('没有识别到z-index令牌') && n.includes('已跳过')))
})

test('基线：只减不增；新增报；变少提示；更新时拒绝抬高', () => {
  const dir = tmpProject({ 'design-system/tokens.css': TOKENS, 'src/a.css': '.a{ color: #123456 }\n.b{ color: #654321 }' })
  const b = path.join(dir, 'base.json')
  assert.equal(cli(['.', '--baseline', b, '--update-baseline'], dir).status, 0)
  assert.equal(cli(['.', '--baseline', b], dir).status, 0)
  fs.appendFileSync(path.join(dir, 'src/a.css'), '\n.c{ color: #abcdef }')
  const up = cli(['.', '--baseline', b], dir)
  assert.equal(up.status, 1); assert.match(up.stdout, /新增\s+src\/a\.css\s+token\/color-literal\s+2 → 3/)
  const refuse = cli(['.', '--baseline', b, '--update-baseline'], dir)
  assert.equal(refuse.status, 1); assert.match(refuse.stderr, /拒绝更新基线/)
  assert.equal(cli(['.', '--baseline', b, '--update-baseline', '--allow-raise'], dir).status, 0)
  fs.writeFileSync(path.join(dir, 'src/a.css'), '.a{ color: var(--color-accent) }')
  const better = cli(['.', '--baseline', b], dir)
  assert.equal(better.status, 0); assert.match(better.stdout, /比基线少/)
  assert.equal(cli(['.', '--baseline', path.join(dir, 'nope.json')], dir).status, 2)
})

test('compareBaseline：新文件里的问题也算新增', () => {
  const base = { counts: { 'a.css': { 'token/radius': 1 } } }
  const f = [{ file: 'a.css', rule: 'token/radius' }, { file: 'b.css', rule: 'token/radius' }]
  assert.deepEqual(compareBaseline(base, f).regress, [{ file: 'b.css', rule: 'token/radius', from: 0, to: 1 }])
  assert.deepEqual(countsOf(f), { 'a.css': { 'token/radius': 1 }, 'b.css': { 'token/radius': 1 } })
})

test('退出码：错误级问题 → 1；只有建议 → 0；--strict 下建议也 → 1；未知参数 → 2；目录不存在 → 2', () => {
  const warnOnly = tmpProject({ 'design-system/tokens.css': TOKENS, 'a.css': '.a{ color: #123456 }' })
  assert.equal(cli(['.'], warnOnly).status, 0)
  assert.equal(cli(['.', '--strict'], warnOnly).status, 1)
  const err = tmpProject({ 'a.html': '<img src="x.png">' })
  assert.equal(cli(['.'], err).status, 1)
  assert.equal(cli(['.', '--nope'], err).status, 2)
  assert.equal(cli(['/不存在的目录'], err).status, 2)
})

test('JSON 输出可解析且字段齐全；--limit 截断文本输出', () => {
  const dir = tmpProject({ 'design-system/tokens.css': TOKENS, 'a.css': Array.from({ length: 8 }, (_, i) => `.a${i}{ color: #12345${i} }`).join('\n') })
  const j = JSON.parse(cli(['.', '--format', 'json'], dir).stdout)
  assert.ok(j.summary && Array.isArray(j.findings) && Array.isArray(j.ignored) && Array.isArray(j.notes))
  assert.equal(j.summary.warn, 8)
  const t = cli(['.', '--limit', '3'], dir).stdout
  assert.match(t, /还有 5 条没列出/)
})

test('formatText：按文件分组、有汇总与按规则统计', () => {
  const dir = tmpProject({ 'design-system/tokens.css': TOKENS, 'a.css': '.a{ color: #123456 }' })
  const out = formatText(audit(dir))
  assert.match(out, /^a\.css\n/m); assert.match(out, /汇总：错误 0 · 建议 1 · 提示 0/); assert.match(out, /按规则：token\/color-literal 1/)
})

test('只读：审计不改任何文件', () => {
  const dir = tmpProject({ 'design-system/tokens.css': TOKENS, 'a.css': '.a{ color: #123456 }' })
  const before = fs.readFileSync(path.join(dir, 'a.css'), 'utf8')
  const mt = fs.statSync(path.join(dir, 'a.css')).mtimeMs
  cli(['.'], dir)
  assert.equal(fs.readFileSync(path.join(dir, 'a.css'), 'utf8'), before)
  assert.equal(fs.statSync(path.join(dir, 'a.css')).mtimeMs, mt)
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.css', 'design-system'])
})
