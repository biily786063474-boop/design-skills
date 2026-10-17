#!/usr/bin/env node
// derive.mjs — 由「锚点」推导完整设计系统。零依赖、不联网，只写 --out 指定的目录。
//
//   node derive.mjs --in anchors.json --out design-system/ [--preview] [--check]
//
// 输入锚点（anchors.json）：
//   name        项目名
//   platform    web | desktop | ios | android
//   tier        light | standard | full
//   theme       light | dark | both
//   density     compact | standard | comfortable
//   shape       sharp | balanced | soft          （同时决定圆角、阴影、动效性格）
//   accent      主色，6 位十六进制
//   neutral     follow（中性色带一点主色色相，默认）| none（纯灰）
//   fonts       { sans, mono }（可省，默认系统字体栈）
//   assumptions 声明的假设（字符串数组，原样写进 DESIGN-SYSTEM.md）
//   overrides   终确认时对单个推导值的覆盖：[{ key, value, reason }]，reason 必填，会登记为例外
//
// 输出：tokens.json（DTCG 三层）、tokens.css、DESIGN-SYSTEM.md、preview.html（--preview）
// 任何校验失败 → 打印失败项并以退出码 1 结束，不静默放行。

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VERSION = '1'

// ───────────────────────── 颜色（OKLCH ⇄ sRGB）─────────────────────────
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const fromLin = (c) => {
  c = clamp(c, 0, 1)
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(clamp(v, 0, 1) * 255)
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex))
  if (!m) throw new Error(`颜色必须是 6 位十六进制，例如 #3b6fe0：收到 ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  const C = Math.hypot(a, bb)
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { L, C, h }
}

function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

/** 超出 sRGB 色域时逐步降低彩度，亮度与色相保持不变 */
export function oklchToHex(L, C, h) {
  let c = C
  for (let i = 0; i < 60; i++) {
    const lin = oklchToLinear(L, c, h)
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(fromLin))
    c *= 0.94
  }
  return rgbToHex(oklchToLinear(L, 0, h).map(fromLin))
}

export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(toLin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a, b) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const withAlpha = (hex, alpha) => hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0')

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const ACCENT_L = [0.97, 0.93, 0.87, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32, 0.24]
const ACCENT_C = [0.18, 0.35, 0.6, 0.8, 0.95, 1, 0.95, 0.85, 0.7, 0.55, 0.4]
const NEUTRAL_L = [0.985, 0.967, 0.922, 0.87, 0.708, 0.556, 0.439, 0.371, 0.269, 0.205, 0.145]
const SEMANTIC_HUE = { success: 150, warning: 85, danger: 25, info: 245 }

function ramp(hue, chroma, ls, cmul) {
  const out = {}
  STEPS.forEach((s, i) => { out[s] = oklchToHex(ls[i], chroma * cmul[i], hue) })
  return out
}

/** 从候选档位里取第一个对比度达标的；都不达标则返回对比度最高的并标记失败 */
function pickStep(rampObj, candidates, bg, min) {
  let best = null
  for (const s of candidates) {
    const c = contrast(rampObj[s], bg)
    if (c >= min) return { step: s, ok: true, ratio: c }
    if (!best || c > best.ratio) best = { step: s, ok: false, ratio: c }
  }
  return best
}

// ───────────────────────── 锚点 → 数值表 ─────────────────────────
export const DENSITY = {
  compact: { label: '紧凑', base: 13, step: 1.1, floor: 10, lineBody: 1.5, ctl: [24, 28, 32],
    gap: { group: 4, item: 8, section: 16, cardPad: 12, cardGap: 8 }, margin: { narrow: 12, dialog: 20, full: 24 } },
  standard: { label: '标准', base: 14, step: 1.125, floor: 10, lineBody: 1.55, ctl: [28, 32, 40],
    gap: { group: 6, item: 12, section: 20, cardPad: 16, cardGap: 12 }, margin: { narrow: 16, dialog: 24, full: 32 } },
  comfortable: { label: '舒展', base: 16, step: 1.15, floor: 11, lineBody: 1.6, ctl: [32, 40, 48],
    gap: { group: 8, item: 16, section: 24, cardPad: 20, cardGap: 16 }, margin: { narrow: 20, dialog: 32, full: 40 } },
}

export const SHAPE = {
  sharp: { label: '锐利利落', r0: 4, dur: [100, 160, 240, 360], spring: false, shadowA: [0.1, 0.14, 0.18] },
  balanced: { label: '适中克制', r0: 8, dur: [120, 200, 300, 450], spring: false, shadowA: [0.08, 0.12, 0.16] },
  soft: { label: '圆润柔和', r0: 12, dur: [150, 240, 350, 500], spring: true, shadowA: [0.06, 0.1, 0.14] },
}

// touchMin：触控目标下限；bodyMin：正文字号下限；floor：最小字号（Apple HIG 正文 17pt、最小 11pt；Material 正文 16sp、最小 12sp）
export const PLATFORM = {
  web: { touchMin: 0, bodyMin: 0, floor: 0 },
  desktop: { touchMin: 0, bodyMin: 0, floor: 0 },
  ios: { touchMin: 44, bodyMin: 17, floor: 11 },
  android: { touchMin: 48, bodyMin: 16, floor: 12 },
}

export const SPACE_SCALE = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]
export const SIZE_NAMES = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']
export const RADIUS_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']
export const Z = { base: 0, raised: 10, sticky: 20, dropdown: 30, modal: 40, toast: 50, tooltip: 60 }
export const TIERS = ['light', 'standard', 'full']
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const even = (n) => Math.round(n / 2) * 2

export function normalizeAnchors(raw) {
  const a = { name: 'design-system', platform: 'web', tier: 'standard', theme: 'both', density: 'standard',
    shape: 'balanced', neutral: 'follow', assumptions: [], overrides: [], ...raw }
  const oneOf = (k, list) => { if (!list.includes(a[k])) throw new Error(`${k} 必须是 ${list.join(' | ')}，收到 ${a[k]}`) }
  oneOf('platform', Object.keys(PLATFORM)); oneOf('tier', TIERS); oneOf('theme', ['light', 'dark', 'both'])
  oneOf('density', Object.keys(DENSITY)); oneOf('shape', Object.keys(SHAPE)); oneOf('neutral', ['follow', 'none'])
  hexToRgb(a.accent)
  a.fonts = { sans: SANS, mono: MONO, ...(raw.fonts || {}) }
  for (const o of a.overrides) {
    if (!o || !o.key || o.value === undefined) throw new Error('overrides 每项需要 key 与 value')
    if (!o.reason) throw new Error(`覆盖 ${o.key} 必须写理由（会登记为例外）`)
  }
  return a
}

// ───────────────────────── 推导 ─────────────────────────
export function derive(rawAnchors) {
  const a = normalizeAnchors(rawAnchors)
  const d = DENSITY[a.density]
  const sh = SHAPE[a.shape]
  const plat = PLATFORM[a.platform]
  const touchMin = plat.touchMin
  const base = Math.max(d.base, plat.bodyMin)
  const floor = Math.max(d.floor, plat.floor)
  const baseNote = base > d.base ? `触屏平台：正文不低于 ${plat.bodyMin}（${a.platform === 'ios' ? 'Apple HIG 正文 17pt' : 'Material 正文 16sp'}），高于密度的 ${d.base}` : `密度=${d.label}：基础 ${d.base}px`
  const sources = {} // 语义键 → 出处说明

  // 字阶：base × step^k，k = -3..3，取整；保持严格递增
  const sizes = {}
  let prev = -Infinity
  SIZE_NAMES.forEach((n, i) => {
    const k = i - 3
    let v = Math.round(base * Math.pow(d.step, k))
    if (i === 0) v = Math.max(v, floor)
    v = Math.max(v, prev + 1)
    prev = v
    sizes[n] = v
    sources[`fontSize.${n}`] = `${baseNote} × ${d.step}^${k}，取整`
  })

  // 控件高度
  const mdH = Math.max(d.ctl[1], touchMin)
  const ctl = touchMin
    ? { sm: mdH - 8, md: mdH, lg: mdH + 8 }
    : { sm: d.ctl[0], md: d.ctl[1], lg: d.ctl[2] }
  for (const k of ['sm', 'md', 'lg']) {
    sources[`ctl.${k}`] = touchMin ? `触屏平台：中档不低于 ${touchMin}（Apple 44pt / Material 48dp），小档 −8、大档 +8` : `密度=${d.label}的控件高度三档`
  }

  // 圆角
  const radius = {}
  const mult = [0.5, 1, 1.5, 2, 3, 4]
  RADIUS_NAMES.forEach((n, i) => {
    radius[n] = even(sh.r0 * mult[i])
    sources[`radius.${n}`] = `形状=${sh.label}：基准 ${sh.r0}px × ${mult[i]}，取偶数`
  })

  // 间距（语义档）
  const gap = { ...d.gap }
  for (const k of Object.keys(gap)) sources[`gap.${k}`] = `密度=${d.label}的版式间距`
  const margin = { ...d.margin }
  for (const k of Object.keys(margin)) sources[`margin.${k}`] = `密度=${d.label}的页边距（${k === 'narrow' ? '窄面板 ≤480' : k === 'dialog' ? '弹窗·设置页 ≥700' : '全幅视图'}）`

  // 动效
  const dur = { fast: sh.dur[0], base: sh.dur[1], slow: sh.dur[2], slower: sh.dur[3] }
  for (const k of Object.keys(dur)) sources[`dur.${k}`] = `形状=${sh.label}的动效节奏`

  // 终确认时的覆盖（必须有理由，登记为例外）
  const exceptions = []
  const groups = { fontSize: sizes, ctl, radius, gap, margin, dur }
  for (const o of a.overrides) {
    const [g, k] = String(o.key).split('.')
    if (!groups[g] || groups[g][k] === undefined) throw new Error(`不支持覆盖 ${o.key}（可覆盖：fontSize / ctl / radius / gap / margin / dur 下已有的键）`)
    exceptions.push({ key: o.key, from: groups[g][k], to: Number(o.value), reason: o.reason })
    groups[g][k] = Number(o.value)
    sources[o.key] = `覆盖：${o.reason}（原推导值 ${exceptions[exceptions.length - 1].from}）`
  }

  // 颜色
  const ac = hexToOklch(a.accent)
  const accentC = clamp(ac.C, 0.04, 0.2)
  const neutralC = a.neutral === 'follow' ? 0.012 : 0
  const R = {
    neutral: ramp(ac.h, neutralC, NEUTRAL_L, NEUTRAL_L.map(() => 1)),
    accent: ramp(ac.h, accentC, ACCENT_L, ACCENT_C),
  }
  for (const [k, h] of Object.entries(SEMANTIC_HUE)) R[k] = ramp(h, 0.14, ACCENT_L, ACCENT_C)
  // 用户选的主色原样放进离它亮度最近的那一档，保证品牌色本身出现在色阶里
  const exactIdx = ACCENT_L.reduce((best, l, i) => (Math.abs(l - ac.L) < Math.abs(ACCENT_L[best] - ac.L) ? i : best), 0)
  const exactStep = STEPS[exactIdx]
  R.accent[exactStep] = a.accent.toLowerCase()
  const notes = []
  const WHITE = '#ffffff'
  const BLACK = '#000000'

  const themes = {}
  const colorChecks = []
  const buildTheme = (mode) => {
    const n = R.neutral
    const t = {}
    if (mode === 'light') {
      Object.assign(t, { bg: n[50], surface1: WHITE, surface2: n[100], surface3: n[200], border: n[200], borderStrong: n[300],
        text1: n[900], text2: n[700], text3: n[600] })
    } else {
      Object.assign(t, { bg: n[950], surface1: n[900], surface2: n[800], surface3: n[700], border: n[800], borderStrong: n[700],
        text1: n[50], text2: n[300], text3: n[400] })
    }
    const surf = t.surface1
    const darkText = n[950]
    const labelContrast = (hex) => Math.max(contrast(WHITE, hex), contrast(darkText, hex))
    // 按钮填充：你的主色优先；文字用白色（惯例）或深色，对比度都要 ≥ 4.5。
    // 暗色下填充还要与卡片拉开 ≥ 3（亮色填充在深底上才看得见）；亮色下填充靠文字标识，不要求与白卡片拉开（亮黄按钮是常见做法）。
    // 选法：① 主色本身白字够用 → 用它；② 白字差一点：把填充加深（最多 2 档）换白字，保持「白字按钮」的惯例；
    //       ③ 离得远（比如亮黄）：保留主色，文字改深色；④ 都不行再取对比度最高的。
    const fillOrder = [exactStep, ...(mode === 'light' ? [500, 600, 700, 800, 900] : [400, 300, 500, 600]).filter((x) => x !== exactStep)]
    const whiteOk = (st) => contrast(WHITE, R.accent[st]) >= 4.5
    const valid = (st) => labelContrast(R.accent[st]) >= 4.5 && (mode === 'light' || contrast(R.accent[st], surf) >= 3)
    const exactIdx = STEPS.indexOf(exactStep)
    let fillPick = null
    if (valid(exactStep) && whiteOk(exactStep)) fillPick = { step: exactStep, ok: true }
    if (!fillPick) {
      const darker = STEPS.slice(exactIdx + 1, exactIdx + 3).find((st) => whiteOk(st) && valid(st))
      if (darker !== undefined) fillPick = { step: darker, ok: true }
    }
    if (!fillPick && valid(exactStep)) fillPick = { step: exactStep, ok: true }
    if (!fillPick) {
      const st = fillOrder.find(valid)
      fillPick = st !== undefined ? { step: st, ok: true } : { step: fillOrder.reduce((b, x) => (labelContrast(R.accent[x]) > labelContrast(R.accent[b]) ? x : b), exactStep), ok: false }
    }
    t.accentFill = R.accent[fillPick.step]
    t.accentFillStep = fillPick.step
    // 文字颜色：白色够用就用白色（惯例），白色不够再用深色
    t.onAccent = contrast(WHITE, t.accentFill) >= 4.5 ? WHITE : contrast(darkText, t.accentFill) >= 4.5 ? darkText : (contrast(WHITE, t.accentFill) >= contrast(darkText, t.accentFill) ? WHITE : darkText)
    const modeName = mode === 'light' ? '亮色' : '暗色'
    const labelWord = t.onAccent === WHITE ? '白字' : '深色字'
    notes.push(fillPick.step === exactStep
      ? `${modeName}：你选的主色 ${a.accent} 原样用作强调填充（第 ${exactStep} 档），按钮上的文字用${labelWord}。`
      : `${modeName}：你选的主色落在第 ${exactStep} 档，但为了按钮文字${mode === 'dark' ? '与卡片' : ''}的对比度，强调填充改用第 ${fillPick.step} 档（${t.accentFill}），比你选的${fillPick.step > exactStep ? '更深' : '更亮'}，按钮上的文字用${labelWord}。`)
    const hoverStep = STEPS[Math.min(STEPS.indexOf(fillPick.step) + (mode === 'light' ? 1 : -1), STEPS.length - 1)]
    t.accentHover = R.accent[hoverStep]
    const txt = pickStep(R.accent, mode === 'light' ? [500, 600, 700, 800, 900] : [300, 400, 200], surf, 4.5)
    t.accentText = R.accent[txt.step]
    t.accentSoft = mode === 'light' ? R.accent[100] : R.accent[950]
    for (const k of Object.keys(SEMANTIC_HUE)) {
      const p = pickStep(R[k], mode === 'light' ? [500, 600, 700, 800, 900] : [300, 400, 200], surf, 4.5)
      t[k] = R[k][p.step]
      t[`${k}Soft`] = mode === 'light' ? R[k][100] : R[k][950]
      t[`${k}Step`] = p.step
    }
    // 没有文字的强调元素（开关、进度条、复选框、焦点环）靠颜色本身被看见：要与卡片和背景都拉开 ≥ 3
    const uiOrder = [fillPick.step, ...(mode === 'light' ? [500, 600, 700, 800, 900] : [400, 300, 500, 600]).filter((x) => x !== fillPick.step)]
    const uiContrast = (hex) => Math.min(contrast(hex, t.surface1), contrast(hex, t.bg))
    let uiStep = uiOrder.find((st) => uiContrast(R.accent[st]) >= 3)
    if (uiStep === undefined) uiStep = uiOrder.reduce((b, st) => (uiContrast(R.accent[st]) > uiContrast(R.accent[b]) ? st : b), uiOrder[0])
    t.accentUi = R.accent[uiStep]
    if (uiStep !== fillPick.step) notes.push(`${modeName}：按钮填充保留了你的主色；开关、进度条、焦点环这类没有文字的强调元素改用第 ${uiStep} 档（${t.accentUi}），因为主色与卡片的对比度不到 3:1，单靠颜色看不清。`)
    t.focusRing = t.accentUi
    const pairs = [
      ['正文 text-1 / 背景', t.text1, t.bg, 7],
      ['次要 text-2 / 背景', t.text2, t.bg, 4.5],
      ['说明 text-3 / 背景', t.text3, t.bg, 4.5],
      ['正文 text-1 / 卡片', t.text1, t.surface1, 7],
      ['说明 text-3 / 卡片', t.text3, t.surface1, 4.5],
      ['按钮文字 / 强调填充', t.onAccent, t.accentFill, 4.5],
      ['强调文字色 / 卡片', t.accentText, t.surface1, 4.5],
      ['强调界面元素色（开关、进度条）/ 卡片', t.accentUi, t.surface1, 3],
      ['焦点环 / 背景（界面元素）', t.focusRing, t.bg, 3],
      ['成功 / 卡片', t.success, t.surface1, 4.5],
      ['警告 / 卡片', t.warning, t.surface1, 4.5],
      ['危险 / 卡片', t.danger, t.surface1, 4.5],
      ['信息 / 卡片', t.info, t.surface1, 4.5],
    ]
    for (const [label, fg, bg, min] of pairs) {
      const ratio = contrast(fg, bg)
      colorChecks.push({ mode, label, fg, bg, min, ratio, ok: ratio >= min })
    }
    return t
  }
  const modes = a.theme === 'both' ? ['light', 'dark'] : [a.theme]
  for (const m of modes) themes[m] = buildTheme(m)

  // 阴影
  const shadowOffsets = [[1, 2], [4, 12], [12, 32]]
  const shadow = { light: {}, dark: {} }
  ;['sm', 'md', 'lg'].forEach((k, i) => {
    shadow.light[k] = { offsetY: shadowOffsets[i][0], blur: shadowOffsets[i][1], alpha: sh.shadowA[i] }
    shadow.dark[k] = { offsetY: shadowOffsets[i][0], blur: shadowOffsets[i][1], alpha: Math.min(0.6, sh.shadowA[i] * 3.5) }
  })

  const lineHeight = { body: d.lineBody, heading: 1.25 }
  const weights = { regular: 400, medium: 500, semibold: 600 }
  const breakpoints = a.platform === 'web' || a.platform === 'desktop' ? { sm: 640, md: 1024, lg: 1440 } : null
  const opacity = { disabled: 0.4, muted: 0.6, hover: 0.06, active: 0.1 }
  const focus = { width: 2, offset: 2 }
  const ease = { out: [0.2, 0.8, 0.2, 1], inOut: [0.4, 0, 0.2, 1], ...(sh.spring ? { spring: [0.34, 1.56, 0.64, 1] } : {}) }

  const result = { anchors: a, density: d, shape: sh, touchMin, base, floor, sizes: groups.fontSize, ctl: groups.ctl, radius: groups.radius,
    gap: groups.gap, margin: groups.margin, dur: groups.dur, ramps: R, notes, exactStep, themes, shadow, lineHeight, weights, breakpoints,
    opacity, focus, ease, z: Z, space: SPACE_SCALE, sources, exceptions, colorChecks, version: VERSION }
  result.checks = validate(result)
  result.tokens = buildTokens(result)
  result.checks.push(...aliasChecks(result.tokens))
  return result
}

// ───────────────────────── 校验 ─────────────────────────
function validate(r) {
  const out = []
  const add = (id, label, ok, detail = '') => out.push({ id, label, ok, detail })
  const sizes = SIZE_NAMES.map((n) => r.sizes[n])
  add('font-int', '字号都是整数 px', sizes.every(Number.isInteger), sizes.join(' / '))
  add('font-mono', '字阶严格递增、相邻档不重合', sizes.every((v, i) => i === 0 || v > sizes[i - 1]), sizes.join(' / '))
  add('font-base', '基础字号落在字阶中档', r.sizes.md === r.base || r.exceptions.some((e) => e.key === 'fontSize.md'), `md=${r.sizes.md}，基础=${r.base}`)
  add('font-floor', `最小字号 ≥ ${r.floor}px`, sizes[0] >= r.floor || r.exceptions.some((e) => e.key.startsWith('fontSize.')), `${sizes[0]}px`)
  if (PLATFORM[r.anchors.platform].bodyMin) add('font-body-min', `触屏平台正文 ≥ ${PLATFORM[r.anchors.platform].bodyMin}`, r.sizes.md >= PLATFORM[r.anchors.platform].bodyMin, `md=${r.sizes.md}`)
  const ctl = ['sm', 'md', 'lg'].map((k) => r.ctl[k])
  add('ctl-even', '控件高度都是偶数 px', ctl.every((v) => v % 2 === 0), ctl.join(' / '))
  add('ctl-mono', '控件高度三档递增', ctl[0] < ctl[1] && ctl[1] < ctl[2], ctl.join(' / '))
  if (r.touchMin) add('ctl-touch', `触屏平台中档控件 ≥ ${r.touchMin}`, r.ctl.md >= r.touchMin, `md=${r.ctl.md}`)
  const rad = RADIUS_NAMES.map((n) => r.radius[n])
  add('radius-even', '圆角都是偶数 px', rad.every((v) => v % 2 === 0), rad.join(' / '))
  add('radius-mono', '圆角各档严格递增', rad.every((v, i) => i === 0 || v > rad[i - 1]), rad.join(' / '))
  const gaps = Object.entries({ ...r.gap, ...r.margin })
  add('gap-scale', '版式间距都在间距阶梯里', gaps.every(([k, v]) => SPACE_SCALE.includes(v) || r.exceptions.some((e) => e.key.endsWith('.' + k))), gaps.map(([k, v]) => `${k}=${v}`).join(' '))
  add('gap-order', '组内 < 同组条目 < 区块之间', r.gap.group < r.gap.item && r.gap.item < r.gap.section, `${r.gap.group} < ${r.gap.item} < ${r.gap.section}`)
  add('gap-card', '卡片间距 ≤ 区块间距', r.gap.cardGap <= r.gap.section, `${r.gap.cardGap} ≤ ${r.gap.section}`)
  add('margin-order', '页边距由窄到宽递增', r.margin.narrow <= r.margin.dialog && r.margin.dialog <= r.margin.full, `${r.margin.narrow} ≤ ${r.margin.dialog} ≤ ${r.margin.full}`)
  const zs = Object.values(r.z)
  add('z-order', 'z-index 7 层递增、间隔 10', zs.length === 7 && zs.every((v, i) => i === 0 || v - zs[i - 1] === 10), zs.join(' / '))
  const durs = ['fast', 'base', 'slow', 'slower'].map((k) => r.dur[k])
  add('dur-mono', '动效时长 4 档递增', durs.every((v, i) => i === 0 || v > durs[i - 1]), durs.join(' / '))
  for (const c of r.colorChecks) add(`contrast-${c.mode}`, `[${c.mode === 'light' ? '亮' : '暗'}] ${c.label} ≥ ${c.min}:1`, c.ok, `${c.ratio.toFixed(2)}:1`)
  return out
}

function aliasChecks(tokens) {
  const out = []
  const bad = []
  const walk = (node, p) => {
    if (node && typeof node === 'object') {
      if ('$value' in node) {
        const vals = [node.$value]
        for (const v of vals) if (typeof v === 'string' && /^\{.+\}$/.test(v)) {
          try { resolve(tokens, v) } catch (e) { bad.push(`${p.join('.')} → ${v}（${e.message}）`) }
        }
        return
      }
      for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...p, k])
    }
  }
  walk(tokens, [])
  out.push({ id: 'alias', label: 'tokens.json 里的别名都能解析、无循环', ok: bad.length === 0, detail: bad.slice(0, 3).join('；') })
  return out
}

export function resolve(tokens, ref, seen = new Set()) {
  const m = /^\{(.+)\}$/.exec(ref)
  if (!m) return ref
  if (seen.has(ref)) throw new Error('别名循环')
  seen.add(ref)
  let node = tokens
  for (const part of m[1].split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) throw new Error(`找不到 ${m[1]}`)
    node = node[part]
  }
  if (!node || !('$value' in node)) throw new Error(`${m[1]} 不是令牌`)
  return typeof node.$value === 'string' && /^\{.+\}$/.test(node.$value) ? resolve(tokens, node.$value, seen) : node.$value
}

// ───────────────────────── DTCG tokens.json ─────────────────────────
const px = (n) => ({ $type: 'dimension', $value: `${n}px` })
const ms = (n) => ({ $type: 'duration', $value: `${n}ms` })

function buildTokens(r) {
  const P = { color: {}, space: {}, fontSize: {}, radius: {}, duration: {}, z: {} }
  P.color.white = { $type: 'color', $value: '#ffffff' }
  for (const [name, rp] of Object.entries(r.ramps)) {
    P.color[name] = {}
    for (const s of STEPS) P.color[name][s] = { $type: 'color', $value: rp[s] }
  }
  for (const s of SPACE_SCALE) P.space[s] = px(s)
  const sizeVals = new Set(Object.values(r.sizes)); for (const v of sizeVals) P.fontSize[v] = px(v)
  const radVals = new Set(Object.values(r.radius)); for (const v of radVals) P.radius[v] = px(v)
  for (const v of new Set(Object.values(r.dur))) P.duration[v] = ms(v)
  for (const [k, v] of Object.entries(r.z)) P.z[k] = { $type: 'number', $value: v }
  const ref = (path) => `{primitive.${path}}`
  const spaceRef = (v) => (SPACE_SCALE.includes(v) ? ref(`space.${v}`) : null)
  const semantic = { fontSize: {}, lineHeight: {}, fontWeight: {}, radius: {}, space: {}, ctl: {}, duration: {}, ease: {}, opacity: {}, focus: {}, z: {} }
  for (const n of SIZE_NAMES) {
    if (!P.fontSize[r.sizes[n]]) P.fontSize[r.sizes[n]] = px(r.sizes[n])
    semantic.fontSize[n] = { $type: 'dimension', $value: ref(`fontSize.${r.sizes[n]}`) }
  }
  semantic.lineHeight.body = { $type: 'number', $value: r.lineHeight.body }
  semantic.lineHeight.heading = { $type: 'number', $value: r.lineHeight.heading }
  for (const [k, v] of Object.entries(r.weights)) semantic.fontWeight[k] = { $type: 'fontWeight', $value: v }
  for (const n of RADIUS_NAMES) {
    if (!P.radius[r.radius[n]]) P.radius[r.radius[n]] = px(r.radius[n])
    semantic.radius[n] = { $type: 'dimension', $value: ref(`radius.${r.radius[n]}`) }
  }
  semantic.radius.pill = { $type: 'dimension', $value: '9999px' }
  for (const [k, v] of Object.entries({ ...r.gap, ...Object.fromEntries(Object.entries(r.margin).map(([m, x]) => [`margin-${m}`, x])) })) {
    const sr = spaceRef(v)
    if (!sr && !P.space[v]) P.space[v] = px(v)
    semantic.space[k] = { $type: 'dimension', $value: sr || ref(`space.${v}`) }
  }
  for (const k of ['sm', 'md', 'lg']) semantic.ctl[k] = px(r.ctl[k])
  if (r.touchMin) semantic.ctl.touchMin = px(r.touchMin)
  for (const [k, v] of Object.entries(r.dur)) {
    if (!P.duration[v]) P.duration[v] = ms(v)
    semantic.duration[k] = { $type: 'duration', $value: `{primitive.duration.${v}}` }
  }
  for (const [k, v] of Object.entries(r.ease)) semantic.ease[k] = { $type: 'cubicBezier', $value: v }
  for (const [k, v] of Object.entries(r.opacity)) semantic.opacity[k] = { $type: 'number', $value: v }
  semantic.focus.width = px(r.focus.width)
  semantic.focus.offset = px(r.focus.offset)
  for (const k of Object.keys(r.z)) semantic.z[k] = { $type: 'number', $value: `{primitive.z.${k}}` }

  const theme = {}
  for (const [mode, t] of Object.entries(r.themes)) {
    const pick = (name, hex, aliasPath) => ({ $type: 'color', $value: aliasPath || hex })
    const c = {}
    const nref = (step) => ref(`color.neutral.${step}`)
    const findStep = (rampName, hex) => STEPS.find((s) => r.ramps[rampName][s] === hex)
    const alias = (rampName, hex) => {
      if (hex === '#ffffff') return ref('color.white')
      const s = findStep(rampName, hex)
      return s ? ref(`color.${rampName}.${s}`) : hex
    }
    c.bg = pick('bg', t.bg, alias('neutral', t.bg))
    c['surface-1'] = pick('s1', t.surface1, alias('neutral', t.surface1))
    c['surface-2'] = pick('s2', t.surface2, alias('neutral', t.surface2))
    c['surface-3'] = pick('s3', t.surface3, alias('neutral', t.surface3))
    c.border = pick('b', t.border, alias('neutral', t.border))
    c['border-strong'] = pick('bs', t.borderStrong, alias('neutral', t.borderStrong))
    c['text-1'] = pick('t1', t.text1, alias('neutral', t.text1))
    c['text-2'] = pick('t2', t.text2, alias('neutral', t.text2))
    c['text-3'] = pick('t3', t.text3, alias('neutral', t.text3))
    c.accent = pick('a', t.accentFill, alias('accent', t.accentFill))
    c['accent-hover'] = pick('ah', t.accentHover, alias('accent', t.accentHover))
    c['accent-ui'] = pick('au', t.accentUi, alias('accent', t.accentUi))
    c['accent-text'] = pick('at', t.accentText, alias('accent', t.accentText))
    c['accent-soft'] = pick('as', t.accentSoft, alias('accent', t.accentSoft))
    c['on-accent'] = pick('oa', t.onAccent, t.onAccent === '#ffffff' ? ref('color.white') : alias('neutral', t.onAccent))
    for (const k of Object.keys(SEMANTIC_HUE)) {
      c[k] = pick(k, t[k], alias(k, t[k]))
      c[`${k}-soft`] = pick(k, t[`${k}Soft`], alias(k, t[`${k}Soft`]))
    }
    c['focus-ring'] = pick('f', t.focusRing, alias('accent', t.focusRing))
    theme[mode] = { color: c, shadow: {} }
    for (const k of ['sm', 'md', 'lg']) {
      const s = r.shadow[mode][k]
      theme[mode].shadow[k] = { $type: 'shadow', $value: { color: withAlpha('#000000', s.alpha), offsetX: '0px', offsetY: `${s.offsetY}px`, blur: `${s.blur}px`, spread: '0px' } }
    }
  }

  const component = {}
  if (r.anchors.tier !== 'light') {
    const padX = { sm: 8, md: 12, lg: 16 }
    for (const k of Object.keys(padX)) if (!P.space[padX[k]]) P.space[padX[k]] = px(padX[k])
    component.button = {
      height: { sm: { $type: 'dimension', $value: '{semantic.ctl.sm}' }, md: { $type: 'dimension', $value: '{semantic.ctl.md}' }, lg: { $type: 'dimension', $value: '{semantic.ctl.lg}' } },
      radius: { $type: 'dimension', $value: '{semantic.radius.sm}' },
      paddingX: { sm: { $type: 'dimension', $value: '{primitive.space.8}' }, md: { $type: 'dimension', $value: '{primitive.space.12}' }, lg: { $type: 'dimension', $value: '{primitive.space.16}' } },
      fontSize: { $type: 'dimension', $value: '{semantic.fontSize.md}' },
      fontWeight: { $type: 'fontWeight', $value: '{semantic.fontWeight.medium}' },
    }
    component.input = { height: { $type: 'dimension', $value: '{semantic.ctl.md}' }, radius: { $type: 'dimension', $value: '{semantic.radius.sm}' }, fontSize: { $type: 'dimension', $value: '{semantic.fontSize.md}' } }
    component.card = { radius: { $type: 'dimension', $value: '{semantic.radius.lg}' }, padding: { $type: 'dimension', $value: '{semantic.space.cardPad}' }, gap: { $type: 'dimension', $value: '{semantic.space.cardGap}' } }
    component.popover = { radius: { $type: 'dimension', $value: '{semantic.radius.md}' } }
    component.dialog = { radius: { $type: 'dimension', $value: '{semantic.radius.xl}' } }
    component.chip = { radius: { $type: 'dimension', $value: '{semantic.radius.pill}' }, height: { $type: 'dimension', $value: '{semantic.ctl.sm}' }, fontSize: { $type: 'dimension', $value: '{semantic.fontSize.sm}' } }
  }
  const tokens = { $description: `由 design-system-first/derive.mjs 推导（版本 ${VERSION}）。三层：primitive → semantic → component；颜色按主题分在 semantic.theme.*。`,
    primitive: P, semantic: { ...semantic, theme }, component }
  return tokens
}

// ───────────────────────── tokens.css ─────────────────────────
const f = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))))

function commonVars(r) {
  const v = {}
  for (const n of SIZE_NAMES) v[`--fs-${n}`] = `${r.sizes[n]}px`
  v['--lh-body'] = f(r.lineHeight.body); v['--lh-heading'] = f(r.lineHeight.heading)
  for (const [k, x] of Object.entries(r.weights)) v[`--fw-${k}`] = String(x)
  for (const n of RADIUS_NAMES) v[`--radius-${n}`] = `${r.radius[n]}px`
  v['--radius-pill'] = '9999px'
  for (const s of SPACE_SCALE) v[`--space-${s}`] = `${s}px`
  for (const [k, x] of Object.entries(r.gap)) v[`--gap-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`] = `${x}px`
  for (const [k, x] of Object.entries(r.margin)) v[`--margin-${k}`] = `${x}px`
  for (const k of ['sm', 'md', 'lg']) v[`--ctl-h-${k}`] = `${r.ctl[k]}px`
  if (r.touchMin) v['--touch-min'] = `${r.touchMin}px`
  for (const [k, x] of Object.entries(r.dur)) v[`--dur-${k}`] = `${x}ms`
  for (const [k, x] of Object.entries(r.ease)) v[`--ease-${k}`] = `cubic-bezier(${x.join(', ')})`
  for (const [k, x] of Object.entries(r.opacity)) v[`--opacity-${k}`] = f(x)
  v['--focus-width'] = `${r.focus.width}px`; v['--focus-offset'] = `${r.focus.offset}px`
  for (const [k, x] of Object.entries(r.z)) v[`--z-${k}`] = String(x)
  if (r.breakpoints) for (const [k, x] of Object.entries(r.breakpoints)) v[`--bp-${k}`] = `${x}px`
  v['--font-sans'] = r.anchors.fonts.sans; v['--font-mono'] = r.anchors.fonts.mono
  return v
}

function themeVars(r, mode) {
  const t = r.themes[mode]
  const v = {
    '--color-bg': t.bg, '--color-surface-1': t.surface1, '--color-surface-2': t.surface2, '--color-surface-3': t.surface3,
    '--color-border': t.border, '--color-border-strong': t.borderStrong,
    '--color-text-1': t.text1, '--color-text-2': t.text2, '--color-text-3': t.text3,
    '--color-accent': t.accentFill, '--color-accent-hover': t.accentHover, '--color-accent-ui': t.accentUi, '--color-accent-text': t.accentText,
    '--color-accent-soft': t.accentSoft, '--color-on-accent': t.onAccent, '--color-focus-ring': t.focusRing,
  }
  for (const k of Object.keys(SEMANTIC_HUE)) { v[`--color-${k}`] = t[k]; v[`--color-${k}-soft`] = t[`${k}Soft`] }
  for (const k of ['sm', 'md', 'lg']) {
    const s = r.shadow[mode][k]
    v[`--shadow-${k}`] = `0 ${s.offsetY}px ${s.blur}px ${withAlpha('#000000', s.alpha)}`
  }
  return v
}
const block = (sel, vars, indent = '') => `${indent}${sel} {\n${Object.entries(vars).map(([k, x]) => `${indent}  ${k}: ${x};`).join('\n')}\n${indent}}`

export function buildCss(r) {
  const parts = [`/* 由 design-system-first/derive.mjs 生成（版本 ${VERSION}），不要手改；改锚点后重新生成。*/`]
  const modes = Object.keys(r.themes)
  const common = commonVars(r)
  if (r.anchors.tier === 'light') for (const k of ['--ctl-h-sm', '--ctl-h-md', '--ctl-h-lg', '--touch-min', '--focus-width', '--focus-offset', '--opacity-disabled', '--opacity-muted', '--opacity-hover', '--opacity-active', ...Object.keys(r.z).map((z) => `--z-${z}`)]) delete common[k]
  if (modes.length === 1) {
    parts.push(block(':root', { ...common, ...themeVars(r, modes[0]) }))
  } else {
    parts.push(block(':root', { ...common, ...themeVars(r, 'light') }))
    parts.push(block(':root[data-theme="dark"]', themeVars(r, 'dark')))
    parts.push('@media (prefers-color-scheme: dark) {\n' + block(':root:not([data-theme="light"])', themeVars(r, 'dark'), '  ') + '\n}')
  }
  parts.push(`@media (prefers-reduced-motion: reduce) {\n  :root {\n${Object.keys(r.dur).map((k) => `    --dur-${k}: 0.01ms;`).join('\n')}\n  }\n}`)
  return parts.join('\n\n') + '\n'
}

// ───────────────────────── DESIGN-SYSTEM.md ─────────────────────────
const TIER_LABEL = { light: '轻', standard: '标准', full: '完整' }
const PLAT_LABEL = { web: 'Web', desktop: '桌面应用', ios: 'iOS', android: 'Android' }

export function buildMarkdown(r) {
  const a = r.anchors
  const L = []
  const src = (k) => r.sources[k] || ''
  L.push(`# ${a.name} 设计系统`, '')
  L.push(`> 由 design-system-first 推导生成（版本 ${VERSION}）。令牌源文件 \`tokens.json\`（DTCG 三层），\`tokens.css\` 由它生成，不要手改。`, '')
  L.push('## 锚点与档位', '', '| 锚点 | 取值 |', '| --- | --- |',
    `| 平台 | ${PLAT_LABEL[a.platform]} |`, `| 档位 | ${TIER_LABEL[a.tier]} |`, `| 主题 | ${a.theme === 'both' ? '亮暗两套' : a.theme === 'dark' ? '仅暗色' : '仅亮色'} |`,
    `| 密度 | ${r.density.label} |`, `| 形状与动效 | ${r.shape.label} |`, `| 主色 | \`${a.accent}\` |`, '')
  L.push('### 主色说明', '', ...r.notes.map((x) => `- ${x}`), '')
  if (a.assumptions.length) { L.push('### 声明的假设（没问过用户、按默认定的）', '', ...a.assumptions.map((x) => `- ${x}`), '') }
  L.push('## 字阶', '', '| 令牌 | 值 | 用途 | 出处 |', '| --- | --- | --- | --- |')
  const roles = { '2xs': '角标、极小说明', xs: '说明小字、表头', sm: '次要正文、标签', md: '正文、按钮、输入框', lg: '小标题、强调正文', xl: '标题', '2xl': '页面大标题' }
  for (const n of SIZE_NAMES) L.push(`| \`--fs-${n}\` | ${r.sizes[n]}px | ${roles[n]} | ${src(`fontSize.${n}`)} |`)
  L.push('', `字重：400 / 500 / 600；行高：正文 ${r.lineHeight.body}，标题 ${r.lineHeight.heading}。`, '')
  L.push('## 间距', '', `阶梯（2px 栅格、只许偶数）：${SPACE_SCALE.join(' / ')}。`, '')
  L.push('## 圆角', '', '| 令牌 | 值 | 出处 |', '| --- | --- | --- |', ...RADIUS_NAMES.map((n) => `| \`--radius-${n}\` | ${r.radius[n]}px | ${src(`radius.${n}`)} |`), '| `--radius-pill` | 9999px | 胶囊 |', '')
  L.push('嵌套规则：内层圆角 = 外层圆角 − 内边距，下限 4px。', '')
  L.push('## 颜色', '', `主色 \`${a.accent}\`（OKLCH 色相 ${hexToOklch(a.accent).h.toFixed(0)}°），生成 11 档（50–950）；中性色${a.neutral === 'follow' ? '带主色色相' : '为纯灰'}；成功 / 警告 / 危险 / 信息色相固定、亮度与主色阶梯对齐。语义一旦分配不换。`, '')
  for (const [mode, t] of Object.entries(r.themes)) {
    L.push(`### ${mode === 'light' ? '亮色' : '暗色'}`, '', '| 令牌 | 值 |', '| --- | --- |',
      ...[['bg', t.bg], ['surface-1', t.surface1], ['surface-2', t.surface2], ['surface-3', t.surface3], ['border', t.border], ['text-1', t.text1], ['text-2', t.text2], ['text-3', t.text3],
        ['accent', t.accentFill], ['accent-ui', t.accentUi], ['accent-text', t.accentText], ['on-accent', t.onAccent], ['success', t.success], ['warning', t.warning], ['danger', t.danger], ['info', t.info]]
        .map(([k, v]) => `| \`--color-${k}\` | \`${v}\` |`), '')
  }
  L.push('## 阴影与层级', '', '亮色靠投影分层；暗色主要靠表面明度分层，投影只辅助。', '', '| 令牌 | 亮色 | 暗色 |', '| --- | --- | --- |',
    ...['sm', 'md', 'lg'].map((k) => `| \`--shadow-${k}\` | 0 ${r.shadow.light[k].offsetY}px ${r.shadow.light[k].blur}px α${r.shadow.light[k].alpha} | 0 ${r.shadow.dark[k].offsetY}px ${r.shadow.dark[k].blur}px α${f(r.shadow.dark[k].alpha)} |`), '')
  L.push('## 动效', '', '| 令牌 | 时长 | 用途 |', '| --- | --- | --- |',
    `| \`--dur-fast\` | ${r.dur.fast}ms | 悬停、按下反馈 |`, `| \`--dur-base\` | ${r.dur.base}ms | 展开、切换 |`, `| \`--dur-slow\` | ${r.dur.slow}ms | 面板、弹层进场 |`, `| \`--dur-slower\` | ${r.dur.slower}ms | 整页转场 |`, '',
    `缓动：\`--ease-out\`（进场与反馈）、\`--ease-inOut\`（位移）${r.ease.spring ? '、`--ease-spring`（只给小控件）' : ''}。跟手类交互（拖拽，小于 100ms）不进阶梯。\`prefers-reduced-motion\` 已在 tokens.css 里全局覆盖。`, '')
  if (r.breakpoints) L.push('## 断点', '', `sm ${r.breakpoints.sm} / md ${r.breakpoints.md} / lg ${r.breakpoints.lg}。`, '')
  if (a.tier !== 'light') {
    L.push('## 控件与交互', '', '| 令牌 | 值 | 出处 |', '| --- | --- | --- |', ...['sm', 'md', 'lg'].map((k) => `| \`--ctl-h-${k}\` | ${r.ctl[k]}px | ${src(`ctl.${k}`)} |`))
    if (r.touchMin) L.push(`| \`--touch-min\` | ${r.touchMin}px | 触控目标下限；视觉小于它的控件要把点击热区扩到它 |`)
    L.push('', `焦点环：${r.focus.width}px 实线、主色、偏移 ${r.focus.offset}px。透明度：禁用 ${r.opacity.disabled} / 弱化 ${r.opacity.muted} / 悬停叠层 ${r.opacity.hover} / 按下叠层 ${r.opacity.active}。`, '')
    L.push('z-index：' + Object.entries(r.z).map(([k, v]) => `${k}=${v}`).join(' / ') + '。', '')
    L.push('## 功能区标准', '', '| 功能区 | 字号 · 字重 | 高 | 圆角 | 内边距 |', '| --- | --- | --- | --- | --- |',
      `| 按钮 sm / md / lg | \`fs-md\` · 500 | ${r.ctl.sm} / ${r.ctl.md} / ${r.ctl.lg} | \`radius-sm\` | 8 / 12 / 16 |`,
      `| 输入框 | \`fs-md\` · 400 | ${r.ctl.md} | \`radius-sm\` | 12 |`,
      `| 芯片 / 标签 | \`fs-sm\` · 500 | ${r.ctl.sm} | pill | 8 |`,
      `| 卡片 | — | — | \`radius-lg\` | ${r.gap.cardPad} |`,
      `| 菜单 / 浮层 | \`fs-md\` | — | \`radius-md\` | 6–8 |`,
      `| 弹窗 | — | — | \`radius-xl\` | ${r.gap.cardPad + 4} |`,
      '| 标题 | `fs-xl` / `fs-2xl` · 600 | — | — | — |',
      '| 说明小字 | `fs-xs` · 400 · `text-3` | — | — | — |', '')
    L.push('## 状态矩阵', '', '每格是确定写法，引用上面的令牌。', '',
      '| 功能区 | hover | active | focus | disabled | loading | error | selected |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 主按钮 | `accent-hover` | 再叠 `opacity-active` 暗层 | 焦点环 | `opacity-disabled` | 禁用 + 转圈，宽度不变 | — | — |',
      '| 次按钮 | `surface-2` | `surface-3` | 焦点环 | `opacity-disabled` | 同主按钮 | — | — |',
      '| 输入框 | `border-strong` | — | 焦点环 + `accent` 边框 | `opacity-disabled` | — | `danger` 边框 + 下方一行原因 | — |',
      '| 导航 / 菜单项 | 叠 `opacity-hover` | 叠 `opacity-active` | 焦点环 | `opacity-disabled` | — | — | `accent-soft` 底 + `accent-text` |',
      '| 可点击卡片 | `shadow-md` 或 `border-strong` | `shadow-sm` | 焦点环 | `opacity-disabled` | 骨架占位 | `danger` 边框 | `accent` 边框 |',
      '| 芯片 | 叠 `opacity-hover` | 叠 `opacity-active` | 焦点环 | `opacity-disabled` | — | — | `accent-soft` 底 |', '')
    L.push('## 页面版式模板', '', '组内永远小于组间。', '', '| 页面类别 | 页边距 | 区块之间 | 同组条目之间 | 组内 | 卡片内边距 | 卡片之间 |', '| --- | --- | --- | --- | --- | --- | --- |',
      ...[['窄面板 ≤480', r.margin.narrow], ['弹窗·设置页 ≥700', r.margin.dialog], ['全幅视图', r.margin.full]].map(([n, m]) => `| ${n} | ${m} | ${r.gap.section} | ${r.gap.item} | ${r.gap.group} | ${r.gap.cardPad} | ${r.gap.cardGap} |`), '')
    L.push('## 守卫（标准档起）', '', '- 新文件里样式的字面值（颜色、字号、圆角、间距、阴影、z-index、动效时长）为零，一律引用令牌。', '- 旧文件按基线只减不增：把 `design-audit` 的 `audit.mjs`（单文件、零依赖）拷进项目，例如 `scripts/design-audit.mjs`，守卫就跑在项目自己的检查命令里，不依赖任何外部安装路径：', '', '  ```bash', '  # 第一次：把现状记为基线', '  node scripts/design-audit.mjs . --tokens design-system/tokens.css --baseline design-system/.audit-baseline.json --update-baseline', '  # 之后每次检查（接进项目的检查命令或 CI）：比基线多了就退出码 1', '  node scripts/design-audit.mjs . --tokens design-system/tokens.css --baseline design-system/.audit-baseline.json', '  ```', '', '- 例外单一来源登记：在问题所在行写 `ds-ignore: 理由`，理由必填；没登记的例外就是违规。', '')
  }
  if (a.tier === 'full') {
    L.push('## 无障碍对比度（完整档）', '', '| 主题 | 配对 | 对比度 | 要求 | 结果 |', '| --- | --- | --- | --- | --- |',
      ...r.colorChecks.map((c) => `| ${c.mode === 'light' ? '亮' : '暗'} | ${c.label} | ${c.ratio.toFixed(2)}:1 | ≥ ${c.min}:1 | ${c.ok ? '通过' : '未通过'} |`), '')
    L.push('## 多语言与长度（完整档）', '', '- 英文通常比中文长 30%–50%，按钮、标签、表头要留余量，不用固定宽度。', '- 术语走统一词典，同一概念只有一个叫法。', '')
    L.push('## 变更记录', '', '| 日期 | 改了什么 | 为什么 | 迁移了多少处 |', '| --- | --- | --- | --- |', '| | 初版（推导生成） | | |', '')
  }
  L.push('## 例外登记', '')
  if (r.exceptions.length) L.push('| 键 | 推导值 | 覆盖为 | 理由 |', '| --- | --- | --- | --- |', ...r.exceptions.map((e) => `| \`${e.key}\` | ${e.from} | ${e.to} | ${e.reason} |`), '')
  else L.push('暂无。', '')
  L.push('## 推导校验', '', '| 检查 | 结果 | 详情 |', '| --- | --- | --- |', ...r.checks.map((c) => `| ${c.label} | ${c.ok ? '通过' : '**未通过**'} | ${c.detail} |`), '')
  return L.join('\n')
}

// ───────────────────────── preview.html ─────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function buildPreview(r) {
  const modes = Object.keys(r.themes)
  const common = commonVars(r)
  const scoped = modes.map((m) => block(`.pv[data-theme="${m}"]`, { ...common, ...themeVars(r, m) })).join('\n')
  const panel = (m) => {
    const t = r.themes[m]
    const sw = (rampName) => `<div class="sw">${STEPS.map((s) => `<i style="background:${r.ramps[rampName][s]}" title="${rampName} ${s} ${r.ramps[rampName][s]}"></i>`).join('')}</div>`
    return `<div class="pv" data-theme="${m}">
<h2>${m === 'light' ? '亮色' : '暗色'} · ${esc(r.anchors.name)}</h2>
<p class="cap">主色 ${r.anchors.accent} · 密度 ${r.density.label} · 形状 ${r.shape.label}</p>
<div class="row"><b>色板</b>${sw('accent')}${sw('neutral')}</div>
<div class="row"><b>语义</b><span class="dot" style="background:var(--color-success)"></span>成功<span class="dot" style="background:var(--color-warning)"></span>警告<span class="dot" style="background:var(--color-danger)"></span>危险<span class="dot" style="background:var(--color-info)"></span>信息</div>
<div class="type">${SIZE_NAMES.slice().reverse().map((n) => `<div style="font-size:var(--fs-${n});line-height:var(--lh-heading)">${n} · ${r.sizes[n]}px　设计系统 Design System 0123</div>`).join('')}</div>
<div class="row"><b>控件</b><button class="btn pri" style="height:var(--ctl-h-sm)">小</button><button class="btn pri" style="height:var(--ctl-h-md)">主按钮</button><button class="btn" style="height:var(--ctl-h-md)">次按钮</button><button class="btn pri" style="height:var(--ctl-h-lg)">大</button><button class="btn pri" disabled style="height:var(--ctl-h-md);opacity:var(--opacity-disabled)">禁用</button></div>
<div class="row"><b>输入</b><input placeholder="输入框" style="height:var(--ctl-h-md)"><span class="chip">芯片</span><span class="chip sel">选中</span></div>
<div class="row"><b>圆角</b>${RADIUS_NAMES.map((n) => `<span class="rd" style="border-radius:var(--radius-${n})">${r.radius[n]}</span>`).join('')}</div>
<div class="row"><b>阴影</b>${['sm', 'md', 'lg'].map((k) => `<span class="sh" style="box-shadow:var(--shadow-${k})">${k}</span>`).join('')}</div>
<div class="card" style="padding:var(--gap-card-pad)"><b style="font-size:var(--fs-lg)">卡片标题</b><p style="margin:var(--gap-group) 0 var(--gap-item);color:var(--color-text-2);font-size:var(--fs-md)">正文 text-2，说明 <span style="color:var(--color-text-3)">text-3</span>，<span style="color:var(--color-accent-text)">强调文字</span>。</p><button class="btn pri" style="height:var(--ctl-h-md)">继续</button></div>
<div class="row"><b>间距</b>${SPACE_SCALE.filter((s) => s).map((s) => `<span class="bar" style="width:${s}px" title="${s}"></span>`).join('')}</div>
<table class="ct"><tr><th>配对</th><th>对比度</th><th></th></tr>${r.colorChecks.filter((c) => c.mode === m).map((c) => `<tr><td>${esc(c.label)}</td><td>${c.ratio.toFixed(2)}:1</td><td class="${c.ok ? 'ok' : 'no'}">${c.ok ? '通过' : '未通过'}</td></tr>`).join('')}</table>
</div>`
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.anchors.name)} · 设计系统预览</title>
<style>
${scoped}
body{margin:0;background:#808080;font-family:var(--font-sans,sans-serif)}
.wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}
.pv{background:var(--color-bg);color:var(--color-text-1);padding:var(--margin-full);font-family:var(--font-sans);font-size:var(--fs-md);line-height:var(--lh-body)}
.pv h2{font-size:var(--fs-xl);margin:0 0 4px}.cap{color:var(--color-text-3);font-size:var(--fs-xs);margin:0 0 var(--gap-section)}
.row{display:flex;align-items:center;gap:var(--gap-item);flex-wrap:wrap;margin:var(--gap-item) 0}.row>b{width:48px;font-size:var(--fs-xs);color:var(--color-text-3);font-weight:var(--fw-medium)}
.sw{display:flex}.sw i{width:20px;height:20px}.sw i:first-child{border-radius:var(--radius-sm) 0 0 var(--radius-sm)}.sw i:last-child{border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:-4px}
.btn{border:1px solid var(--color-border-strong);background:var(--color-surface-2);color:var(--color-text-1);border-radius:var(--radius-sm);padding:0 12px;font:var(--fw-medium) var(--fs-md) var(--font-sans);cursor:pointer;transition:background-color var(--dur-fast) var(--ease-out)}
.btn.pri{background:var(--color-accent);border-color:var(--color-accent);color:var(--color-on-accent)}.btn.pri:hover{background:var(--color-accent-hover)}
input{border:1px solid var(--color-border-strong);background:var(--color-surface-1);color:var(--color-text-1);border-radius:var(--radius-sm);padding:0 12px;font:var(--fs-md) var(--font-sans)}input:focus{outline:var(--focus-width) solid var(--color-focus-ring);outline-offset:var(--focus-offset)}
.chip{border-radius:var(--radius-pill);padding:2px 10px;background:var(--color-surface-2);font-size:var(--fs-sm)}.chip.sel{background:var(--color-accent-soft);color:var(--color-accent-text)}
.rd{width:36px;height:36px;border:1px solid var(--color-border-strong);display:inline-flex;align-items:center;justify-content:center;font-size:var(--fs-2xs);color:var(--color-text-3)}
.sh{width:56px;height:36px;background:var(--color-surface-1);border-radius:var(--radius-md);display:inline-flex;align-items:center;justify-content:center;font-size:var(--fs-xs)}
.card{background:var(--color-surface-1);border:1px solid var(--color-border);border-radius:var(--radius-lg);margin:var(--gap-section) 0;box-shadow:var(--shadow-sm)}
.bar{height:8px;background:var(--color-accent);display:inline-block;border-radius:2px}
.type>div{margin:2px 0;color:var(--color-text-1)}
.ct{width:100%;border-collapse:collapse;font-size:var(--fs-xs);margin-top:var(--gap-section)}.ct th,.ct td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--color-border)}.ok{color:var(--color-success)}.no{color:var(--color-danger);font-weight:600}
</style></head><body><div class="wrap">${modes.map(panel).join('')}</div></body></html>
`
}

// ───────────────────────── CLI ─────────────────────────
export function writeAll(r, outDir, { preview = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const files = { 'tokens.json': JSON.stringify(r.tokens, null, 2) + '\n', 'tokens.css': buildCss(r), 'DESIGN-SYSTEM.md': buildMarkdown(r) }
  if (preview) files['preview.html'] = buildPreview(r)
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), body)
  return Object.keys(files)
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const inFile = get('--in')
  if (!inFile) { console.error('用法：node derive.mjs --in anchors.json --out design-system/ [--preview] [--check]'); process.exit(2) }
  let r
  try { r = derive(JSON.parse(fs.readFileSync(inFile, 'utf8'))) } catch (e) { console.error(`输入有问题：${e.message}`); process.exit(2) }
  const failed = r.checks.filter((c) => !c.ok)
  for (const c of r.checks) console.log(`${c.ok ? '通过' : '未通过'}  ${c.label}${c.detail ? `  ${c.detail}` : ''}`)
  for (const n of r.notes) console.log(`说明  ${n}`)
  if (!argv.includes('--check')) {
    const out = get('--out') || 'design-system'
    const names = writeAll(r, out, { preview: argv.includes('--preview') })
    console.log(`\n已写入 ${out}/：${names.join('、')}`)
  }
  if (failed.length) { console.error(`\n有 ${failed.length} 项未通过，不要把这套值当终稿。`); process.exit(1) }
}

const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href } catch { return false } })()
if (isMain) main(process.argv.slice(2))
