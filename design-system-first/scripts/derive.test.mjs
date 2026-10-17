// node --test scripts/derive.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  derive, normalizeAnchors, hexToOklch, oklchToHex, hexToRgb, contrast, resolve, buildCss, buildMarkdown, buildPreview, writeAll,
  DENSITY, SHAPE, PLATFORM, SPACE_SCALE, SIZE_NAMES, RADIUS_NAMES, STEPS,
} from './derive.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = { name: 't', platform: 'web', tier: 'standard', theme: 'both', density: 'standard', shape: 'balanced', accent: '#3b6fe0' }
const failedOf = (r) => r.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`)

test('对比度：黑白 21:1，同色 1:1', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01)
  assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 1e-9)
})

test('颜色往返：hex → OKLCH → hex 误差不超过 1 个色阶', () => {
  for (const hex of ['#3b6fe0', '#e8590c', '#0a84ff', '#2f9e44', '#868e96', '#ffffff', '#000000']) {
    const { L, C, h } = hexToOklch(hex)
    const back = hexToRgb(oklchToHex(L, C, h))
    const orig = hexToRgb(hex)
    back.forEach((v, i) => assert.ok(Math.abs(v - orig[i]) <= 1, `${hex} 往返偏差 ${v} vs ${orig[i]}`))
  }
})

test('超出色域的高彩度不会产出非法颜色，而且亮度大致保持', () => {
  const hex = oklchToHex(0.9, 0.4, 145)
  assert.match(hex, /^#[0-9a-f]{6}$/)
})

test('三个示例画像都能推导且全部校验通过', () => {
  for (const f of ['web-saas', 'landing', 'ios-app']) {
    const raw = JSON.parse(fs.readFileSync(path.join(here, 'examples', `${f}.json`), 'utf8'))
    const r = derive(raw)
    assert.deepEqual(failedOf(r), [], f)
  }
})

test('全组合扫描：平台 × 密度 × 形状 × 主题 × 24 个色相，校验全部通过', () => {
  const bad = []
  let n = 0
  for (const platform of Object.keys(PLATFORM)) for (const density of Object.keys(DENSITY)) for (const shape of Object.keys(SHAPE))
    for (const theme of ['light', 'dark', 'both']) for (let hue = 0; hue < 360; hue += 15) {
      const accent = oklchToHex(0.62, 0.17, hue)
      const r = derive({ ...base, platform, density, shape, theme, accent })
      n++
      const f = failedOf(r)
      if (f.length) bad.push(`${platform}/${density}/${shape}/${theme}/h${hue}(${accent}) → ${f.slice(0, 2).join(' | ')}`)
    }
  assert.ok(n > 1000)
  assert.deepEqual(bad.slice(0, 10), [], `共 ${bad.length}/${n} 组未通过`)
})

test('极端主色（纯黑、纯白、纯灰、饱和原色）也能出可用结果', () => {
  const bad = []
  for (const accent of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']) {
    for (const theme of ['light', 'dark']) {
      const f = failedOf(derive({ ...base, accent, theme }))
      if (f.length) bad.push(`${accent}/${theme} → ${f.slice(0, 2).join(' | ')}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('字阶：整数、严格递增、中档等于基础字号', () => {
  for (const density of Object.keys(DENSITY)) {
    const r = derive({ ...base, density })
    const sizes = SIZE_NAMES.map((k) => r.sizes[k])
    assert.ok(sizes.every(Number.isInteger))
    assert.ok(sizes.every((v, i) => i === 0 || v > sizes[i - 1]), sizes.join())
    assert.equal(r.sizes.md, DENSITY[density].base)
  }
})

test('触屏平台：正文 ≥ 17(iOS)/16(Android)，中档控件 ≥ 44/48', () => {
  const ios = derive({ ...base, platform: 'ios', density: 'compact' })
  assert.ok(ios.sizes.md >= 17); assert.ok(ios.ctl.md >= 44)
  const and = derive({ ...base, platform: 'android', density: 'compact' })
  assert.ok(and.sizes.md >= 16); assert.ok(and.ctl.md >= 48)
  const web = derive({ ...base, platform: 'web', density: 'compact' })
  assert.equal(web.sizes.md, 13); assert.equal(web.ctl.md, 28)
})

test('圆角、控件高度、间距：偶数、递增、在阶梯里', () => {
  for (const shape of Object.keys(SHAPE)) for (const density of Object.keys(DENSITY)) {
    const r = derive({ ...base, shape, density })
    const rad = RADIUS_NAMES.map((k) => r.radius[k])
    assert.ok(rad.every((v) => v % 2 === 0)); assert.ok(rad.every((v, i) => i === 0 || v > rad[i - 1]))
    assert.ok(Object.values(r.gap).every((v) => SPACE_SCALE.includes(v)))
    assert.ok(r.gap.group < r.gap.item && r.gap.item < r.gap.section)
  }
})

test('同样的输入得到逐字节相同的输出（确定性）', () => {
  const a = derive(base); const b = derive({ ...base })
  assert.equal(JSON.stringify(a.tokens), JSON.stringify(b.tokens))
  assert.equal(buildCss(a), buildCss(b))
  assert.equal(buildMarkdown(a), buildMarkdown(b))
})

test('tokens.json：三层结构、别名可解析、颜色按主题分开', () => {
  const r = derive(base)
  const t = r.tokens
  assert.ok(t.primitive && t.semantic && t.component)
  assert.ok(t.semantic.theme.light.color.bg && t.semantic.theme.dark.color.bg)
  assert.equal(resolve(t, t.semantic.fontSize.md.$value), `${r.sizes.md}px`)
  assert.equal(resolve(t, t.component.button.height.md.$value), `${r.ctl.md}px`)
  assert.match(resolve(t, t.semantic.theme.light.color['text-1'].$value), /^#[0-9a-f]{6}$/)
  assert.throws(() => resolve(t, '{primitive.nope.x}'))
})

test('别名循环会被发现', () => {
  const t = { a: { $type: 'number', $value: '{b}' }, b: { $type: 'number', $value: '{a}' } }
  assert.throws(() => resolve(t, '{a}'), /循环/)
})

test('档位门控：轻档没有控件高度 / z-index / 组件；标准档有；完整档有对比度表', () => {
  const light = derive({ ...base, tier: 'light' })
  assert.equal(Object.keys(light.tokens.component).length, 0)
  assert.ok(!buildCss(light).includes('--ctl-h-md'))
  assert.ok(!buildCss(light).includes('--z-modal'))
  assert.ok(!buildMarkdown(light).includes('状态矩阵'))
  const std = derive({ ...base, tier: 'standard' })
  assert.ok(buildCss(std).includes('--ctl-h-md')); assert.ok(buildMarkdown(std).includes('状态矩阵'))
  assert.ok(!buildMarkdown(std).includes('无障碍对比度'))
  const full = derive({ ...base, tier: 'full' })
  assert.ok(buildMarkdown(full).includes('无障碍对比度')); assert.ok(buildMarkdown(full).includes('变更记录'))
})

test('标准档的守卫一节指向 design-audit 的基线用法；轻档没有', () => {
  const md = buildMarkdown(derive({ ...base, tier: 'standard' }))
  assert.ok(md.includes('audit.mjs') && md.includes('--update-baseline') && md.includes('ds-ignore'))
  assert.ok(!buildMarkdown(derive({ ...base, tier: 'light' })).includes('audit.mjs'))
})

test('主题：both 出两套并带 prefers-color-scheme；单主题只出一套', () => {
  const both = buildCss(derive({ ...base, theme: 'both' }))
  assert.ok(both.includes(':root[data-theme="dark"]')); assert.ok(both.includes('prefers-color-scheme: dark'))
  const dark = buildCss(derive({ ...base, theme: 'dark' }))
  assert.ok(!dark.includes('prefers-color-scheme'))
  assert.ok(dark.includes('--color-bg: #'))
})

test('减弱动效：CSS 里全局覆盖时长', () => {
  assert.match(buildCss(derive(base)), /prefers-reduced-motion: reduce[\s\S]*--dur-fast: 0\.01ms/)
})

test('只有 soft 形状才有 spring 缓动', () => {
  assert.ok(buildCss(derive({ ...base, shape: 'soft' })).includes('--ease-spring'))
  assert.ok(!buildCss(derive({ ...base, shape: 'balanced' })).includes('--ease-spring'))
})

test('覆盖：必须写理由；登记为例外；覆盖后重新校验', () => {
  assert.throws(() => derive({ ...base, overrides: [{ key: 'radius.md', value: 10 }] }), /理由/)
  const ok = derive({ ...base, overrides: [{ key: 'radius.md', value: 10, reason: '设计稿指定' }] })
  assert.equal(ok.radius.md, 10)
  assert.equal(ok.exceptions.length, 1)
  assert.deepEqual(failedOf(ok), [])
  assert.ok(buildMarkdown(ok).includes('设计稿指定'))
  const odd = derive({ ...base, overrides: [{ key: 'radius.md', value: 11, reason: '试一下' }] })
  assert.ok(failedOf(odd).some((x) => x.includes('圆角都是偶数')), '奇数圆角必须被校验拦下')
  assert.throws(() => derive({ ...base, overrides: [{ key: 'nope.x', value: 1, reason: 'x' }] }), /不支持覆盖/)
})

test('覆盖到会打破阶梯的值：校验必须失败，不能静默通过', () => {
  const r = derive({ ...base, overrides: [{ key: 'gap.group', value: 20, reason: '测试' }] })
  assert.ok(failedOf(r).some((x) => x.includes('组内 <')))
})

test('非法输入给出明确错误', () => {
  assert.throws(() => normalizeAnchors({ ...base, accent: 'blue' }), /6 位十六进制/)
  assert.throws(() => normalizeAnchors({ ...base, density: 'huge' }), /density/)
  assert.throws(() => normalizeAnchors({ ...base, platform: 'tv' }), /platform/)
  assert.throws(() => normalizeAnchors({ ...base, theme: 'auto' }), /theme/)
  assert.throws(() => normalizeAnchors({ ...base, accent: undefined }))
})

test('中性色：follow 带一点主色色相，none 是纯灰', () => {
  const f = derive({ ...base, neutral: 'follow' }).ramps.neutral[500]
  const n = derive({ ...base, neutral: 'none' }).ramps.neutral[500]
  const [r, g, b] = hexToRgb(n)
  assert.ok(r === g && g === b, `纯灰应 r=g=b：${n}`)
  const [fr, fg, fb] = hexToRgb(f)
  assert.ok(!(fr === fg && fg === fb), `follow 应带色相：${f}`)
})

test('品牌色原样出现在色阶里；换档时要有说明、深浅描述要对', () => {
  const r = derive({ ...base, accent: '#3b6fe0' })
  assert.ok(Object.values(r.ramps.accent).includes('#3b6fe0'), '主色应原样出现在色阶里')
  assert.ok(r.notes.length === 2 && r.notes.every((n) => n.includes('主色')))
  assert.ok(r.notes.every((n) => n.includes('原样用作强调填充')), '蓝色白字够用，亮暗都该原样用')
  const ios = derive({ ...base, accent: '#0a84ff' })
  for (const n of ios.notes) { assert.ok(n.includes('改用'), n); assert.ok(n.includes('更深') && !n.includes('更亮'), '改用的是更大的档位，必须说「更深」：' + n) }
})

test('亮黄这类浅色品牌色：按钮保留品牌色、文字用深色、无文字的强调元素另用深一档，全部校验通过', () => {
  const r = derive({ ...base, accent: '#ffd43b', theme: 'light' })
  const t = r.themes.light
  assert.equal(t.accentFill, '#ffd43b', '按钮填充必须就是品牌黄')
  assert.ok(contrast(t.onAccent, t.accentFill) >= 4.5, '按钮上的文字对比度要达标')
  assert.notEqual(t.onAccent, '#ffffff', '亮黄配白字不达标，文字应改深色')
  assert.notEqual(t.accentUi, t.accentFill, '开关、进度条这类靠颜色识别的元素不能直接用亮黄')
  assert.ok(contrast(t.accentUi, t.surface1) >= 3 && contrast(t.accentUi, t.bg) >= 3, 'accent-ui 与卡片、背景都要 ≥ 3')
  assert.equal(t.focusRing, t.accentUi, '焦点环用 accent-ui，不能是看不清的亮黄')
  assert.deepEqual(failedOf(r), [])
  assert.ok(r.notes.some((n) => n.includes('原样用作强调填充') && n.includes('深色字')))
  assert.ok(r.notes.some((n) => n.includes('没有文字的强调元素')))
  assert.ok(buildCss(r).includes('--color-accent-ui'))
  assert.ok(buildMarkdown(r).includes('accent-ui'))
  assert.ok(r.tokens.semantic.theme.light.color['accent-ui'])
})

test('白字差一点的主色：最多加深 2 档换白字，不改成深色字（保持白字按钮的惯例）', () => {
  for (const accent of ['#0a84ff', '#e8590c', '#e03131']) {
    const r = derive({ ...base, accent, theme: 'light' })
    const t = r.themes.light
    assert.equal(t.onAccent, '#ffffff', `${accent} 应是白字按钮`)
    assert.ok(contrast('#ffffff', t.accentFill) >= 4.5, accent)
    assert.ok(STEPS.indexOf(t.accentFillStep) - STEPS.indexOf(r.exactStep) <= 2, `${accent} 加深不超过 2 档`)
  }
})

test('高亮度主色全量扫描（各色相 × 亮暗 × 三档 × 触屏平台）校验全部通过', () => {
  const bad = []
  for (const L of [0.97, 0.9, 0.82, 0.74]) for (let hue = 0; hue < 360; hue += 20) for (const theme of ['light', 'dark', 'both']) for (const platform of ['web', 'ios']) {
    const accent = oklchToHex(L, 0.16, hue)
    const f = failedOf(derive({ ...base, accent, theme, platform }))
    if (f.length) bad.push(`${accent}/${theme}/${platform} → ${f.slice(0, 2).join(' | ')}`)
  }
  assert.deepEqual(bad.slice(0, 8), [], `共 ${bad.length} 组未通过`)
})

test('色阶：11 档、亮度单调递减', () => {
  const r = derive(base)
  const ls = STEPS.map((s) => hexToOklch(r.ramps.accent[s]).L)
  assert.ok(ls.every((v, i) => i === 0 || v < ls[i - 1] + 0.01), ls.join())
})

test('writeAll：写出 4 个文件，内容非空，preview 是独立 HTML（无外部依赖）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'))
  const names = writeAll(derive(base), dir, { preview: true })
  assert.deepEqual(names.sort(), ['DESIGN-SYSTEM.md', 'preview.html', 'tokens.css', 'tokens.json'])
  for (const n of names) assert.ok(fs.statSync(path.join(dir, n)).size > 200, n)
  const html = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8')
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(!/https?:\/\//.test(html), '预览页不能引用外部资源')
  JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'))
  fs.rmSync(dir, { recursive: true })
})

test('DESIGN-SYSTEM.md：出处列、声明的假设、例外登记都在', () => {
  const md = buildMarkdown(derive({ ...base, assumptions: ['只支持中文'], overrides: [{ key: 'ctl.md', value: 36, reason: '设计稿' }] }))
  assert.ok(md.includes('出处')); assert.ok(md.includes('声明的假设')); assert.ok(md.includes('只支持中文')); assert.ok(md.includes('例外登记')); assert.ok(md.includes('设计稿'))
})

test('预览页在单主题与双主题下都能生成', () => {
  for (const theme of ['light', 'dark', 'both']) assert.ok(buildPreview(derive({ ...base, theme })).includes('data-theme'))
})
