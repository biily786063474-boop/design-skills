#!/usr/bin/env node
// audit.mjs — 设计审计：以项目自己的设计令牌为标准，再加一组通用界面规则。
// 零依赖、只读、不联网。静态行扫描，不解析 AST（局限见 references/rules.md）。
//
//   node audit.mjs [目录] [--tokens design-system/tokens.css] [--baseline 文件] [--update-baseline [--allow-raise]]
//                  [--strict] [--format text|json] [--ignore 路径片段]... [--limit N] [--include-tests]
//
// 退出码：0 通过 · 1 有「错误」级问题 / 相比基线新增 / --strict 下有「建议」· 2 用法有误
// 行内忽略：在问题所在行或上一行写  ds-ignore: 理由  （理由必填，会登记进汇总）

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SEV = { error: '错误', warn: '建议', info: '提示' }

export const RULES = {
  'token/color-literal': { sev: 'warn', title: '写死的颜色，应引用颜色令牌' },
  'token/font-size': { sev: 'warn', title: '字号不在字阶里' },
  'token/radius': { sev: 'warn', title: '圆角不在圆角阶梯里' },
  'token/spacing': { sev: 'warn', title: '内外边距或间隙不在间距阶梯里' },
  'token/z-index': { sev: 'warn', title: 'z-index 不在层级令牌里' },
  'token/duration': { sev: 'warn', title: '动效时长不在时长令牌里' },
  'token/shadow': { sev: 'warn', title: '写死的阴影，应引用阴影令牌' },
  'a11y/focus-outline-none': { sev: 'error', title: '去掉了焦点环却没有替代' },
  'a11y/zoom-disabled': { sev: 'error', title: '禁止了页面缩放' },
  'a11y/img-alt': { sev: 'error', title: '图片缺少 alt' },
  'a11y/click-non-semantic': { sev: 'warn', title: '在非交互元素上绑点击，键盘用不了' },
  'ux/transition-all': { sev: 'warn', title: 'transition: all 会连布局属性一起动画' },
  'ux/font-too-small': { sev: 'info', title: '字号小于 11px，可读性差' },
  'ux/reduced-motion-missing': { sev: 'info', title: '有动效但整个项目没有处理 prefers-reduced-motion' },
  'scale/half-pixel': { sev: 'info', title: '出现半像素值' },
  'scale/odd-px': { sev: 'info', title: '间距或圆角用了奇数 px（没有令牌时的基础检查）' },
  'meta/ignore-no-reason': { sev: 'warn', title: 'ds-ignore 没写理由' },
}

const CSS_EXT = new Set(['.css', '.scss', '.less', '.sass', '.pcss'])
const EMBED_EXT = new Set(['.html', '.htm', '.vue', '.svelte'])
const JS_EXT = new Set(['.jsx', '.tsx', '.js', '.ts', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'vendor', '.worktrees', '.cache', 'target', 'Pods', 'DerivedData'])
const MAX_BYTES = 1_500_000

// ───────────────────────── 令牌 ─────────────────────────
const num = (s) => Number(s)
const hexNorm = (h) => {
  h = h.replace('#', '').toLowerCase()
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  return '#' + h.slice(0, 6)
}
const hexRgb = (h) => { const n = parseInt(hexNorm(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

export function loadTokens(css) {
  const t = { fs: new Map(), radius: new Map(), space: new Map(), dur: new Map(), z: new Map(), shadow: new Map(), color: new Map(), count: 0 }
  const re = /--([\w-]+)\s*:\s*([^;}]+)/g
  let m
  while ((m = re.exec(css))) {
    const [, name, raw] = m
    const v = raw.trim()
    const pxm = /^(-?\d*\.?\d+)(px|rem)$/.exec(v)
    const px = pxm ? [pxm[0], pxm[2] === 'rem' ? num(pxm[1]) * 16 : num(pxm[1])] : null
    const dm = /^(\d*\.?\d+)(ms|s)$/.exec(v)
    const ms = dm ? [dm[0], dm[2] === 's' ? Math.round(num(dm[1]) * 1000) : num(dm[1])] : null
    const put = (map, key) => { if (!map.has(key)) map.set(key, '--' + name) }
    if (/^(fs|font-size|text)-/.test(name) && px) put(t.fs, px[1])
    else if (/^(radius|rounded)-/.test(name) && px) put(t.radius, px[1])
    else if (/^(space|spacing|sp|gap|margin)-/.test(name) && px) put(t.space, px[1])
    else if (/^(dur|duration)-/.test(name) && ms) put(t.dur, ms[1])
    else if (/^(z|zindex|z-index)-/.test(name) && /^-?\d+$/.test(v)) put(t.z, num(v))
    else if (/^(shadow|elevation)-/.test(name)) put(t.shadow, v)
    else if (/^color-/.test(name) && /^#[0-9a-f]{3,8}$/i.test(v)) put(t.color, hexNorm(v))
    t.count++
  }
  return t
}

const nearest = (map, val) => {
  let best = null
  for (const k of map.keys()) if (best === null || Math.abs(k - val) < Math.abs(best - val)) best = k
  return best
}
const nearestColor = (map, hex) => {
  const [r, g, b] = hexRgb(hex)
  let best = null; let bd = Infinity
  for (const k of map.keys()) {
    const [r2, g2, b2] = hexRgb(k)
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2
    if (d < bd) { bd = d; best = k }
  }
  return best
}

// ───────────────────────── 单个声明的检查 ─────────────────────────
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const stripFns = (v) => {
  let out = ''; let depth = 0; let fn = false
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]
    if (ch === '(') {
      if (depth === 0) { const mm = /([a-z-]+)$/i.exec(out); fn = !!mm && /^(var|calc|min|max|clamp|env|attr)$/i.test(mm[1]); if (fn) out = out.slice(0, out.length - mm[1].length) }
      depth++
      if (!fn) out += ch
      continue
    }
    if (ch === ')') { depth--; if (depth === 0) { if (!fn) out += ch; fn = false; out += ' '; continue } if (!fn) out += ch; continue }
    if (depth > 0 && fn) continue
    out += ch
  }
  return out
}
const pxValues = (v) => {
  const out = []
  const re = /(-?\d*\.?\d+)(px|rem)\b/g
  let m
  while ((m = re.exec(v))) out.push({ raw: m[0], px: m[2] === 'rem' ? num(m[1]) * 16 : num(m[1]) })
  return out
}
const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/
const RADIUS_PROP = /^(border(-(top|bottom|start|end)-(left|right|start|end))?-radius)$/
const COLOR_FN = /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/i

export function checkDecl(prop, value, ctx) {
  const out = []
  const p = prop.toLowerCase().trim()
  let v = String(value).replace(/!important/i, '').trim()
  if (!v) return out
  const t = ctx.tokens
  const hasVarOnly = /^var\(/.test(v) && !/[\s,]/.test(v.replace(/var\([^)]*\)/g, ''))
  const rest = stripFns(v)

  // 颜色字面值（令牌文件本身由调用方排除）
  const colorHits = []
  const hexRe = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi
  let m
  while ((m = hexRe.exec(rest))) colorHits.push({ text: m[0], hex: m[0] })
  if (COLOR_FN.test(rest) || COLOR_FN.test(v.replace(/var\([^)]*\)/g, ''))) colorHits.push({ text: (/[a-z]+\([^)]*\)/i.exec(v.replace(/var\([^)]*\)/g, '')) || [''])[0] || 'color()', hex: null })
  if (!/^(content|font-family|src|will-change|grid-template-areas)$/.test(p) && !/^(--)/.test(p)) {
    for (const c of colorHits) {
      let fix = '用 var(--color-…) 引用颜色令牌'
      if (t && t.color.size && c.hex) {
        const h = hexNorm(c.hex)
        if (t.color.has(h)) fix = `等于 ${t.color.get(h)}，请用 var(${t.color.get(h)})`
        else { const n = nearestColor(t.color, h); if (n) fix = `最近的是 ${t.color.get(n)}（${n}），请确认是否该用它` }
      }
      out.push({ rule: 'token/color-literal', text: c.text, msg: `${c.text} 是写死的颜色 → ${fix}`, skip: !(t && t.color.size) })
    }
  }

  // 字号
  if (p === 'font-size') {
    for (const { raw, px } of pxValues(rest)) {
      if (px < 11 && px > 0) out.push({ rule: 'ux/font-too-small', text: raw, msg: `${raw} 小于 11px，小屏和低视力用户读不清` })
      if (t && t.fs.size && !t.fs.has(px)) {
        const n = nearest(t.fs, px)
        out.push({ rule: 'token/font-size', text: raw, msg: `${raw} 不在字阶里 → 最近的是 ${t.fs.get(n)}（${n}px）` })
      } else if (t && t.fs.size && !hasVarOnly) out.push({ rule: 'token/font-size', text: raw, msg: `${raw} 等于 ${t.fs.get(px)}，请用 var(${t.fs.get(px)})`, exact: true })
    }
  }
  // 圆角
  if (RADIUS_PROP.test(p)) {
    for (const { raw, px } of pxValues(rest)) {
      if (px === 0 || px >= 999) continue
      if (t && t.radius.size) {
        if (!t.radius.has(px)) out.push({ rule: 'token/radius', text: raw, msg: `${raw} 不在圆角阶梯里 → 最近的是 ${t.radius.get(nearest(t.radius, px))}（${nearest(t.radius, px)}px）` })
        else out.push({ rule: 'token/radius', text: raw, msg: `${raw} 等于 ${t.radius.get(px)}，请用 var(${t.radius.get(px)})`, exact: true })
      } else if (px % 2 !== 0) out.push({ rule: 'scale/odd-px', text: raw, msg: `圆角 ${raw} 是奇数 px，阶梯里一般只用偶数` })
    }
  }
  // 间距
  if (SPACING_PROP.test(p)) {
    for (const { raw, px } of pxValues(rest)) {
      const a = Math.abs(px)
      if (a === 0) continue
      if (t && t.space.size) {
        if (!t.space.has(a)) out.push({ rule: 'token/spacing', text: raw, msg: `${raw} 不在间距阶梯里 → 最近的是 ${t.space.get(nearest(t.space, a))}（${nearest(t.space, a)}px）` })
        else out.push({ rule: 'token/spacing', text: raw, msg: `${raw} 等于 ${t.space.get(a)}，请用 var(${t.space.get(a)})`, exact: true })
      } else if (a % 2 !== 0) out.push({ rule: 'scale/odd-px', text: raw, msg: `间距 ${raw} 是奇数 px，2px 栅格下一般只用偶数` })
    }
  }
  // z-index
  if (p === 'z-index' && /^-?\d+$/.test(v.trim())) {
    const z = num(v.trim())
    if (t && t.z.size && z !== 0 && !t.z.has(z)) out.push({ rule: 'token/z-index', text: String(z), msg: `z-index ${z} 不在层级令牌里（${[...t.z.values()].join(' / ')}）` })
    else if (t && t.z.size && z !== 0) out.push({ rule: 'token/z-index', text: String(z), msg: `z-index ${z} 等于 ${t.z.get(z)}，请用 var(${t.z.get(z)})`, exact: true })
  }
  // 动效时长 + transition: all
  if (/^(transition|animation|transition-duration|animation-duration)$/.test(p)) {
    if (/^(transition)$/.test(p) && /(^|[\s,])all(\s|,|$)/.test(rest)) out.push({ rule: 'ux/transition-all', text: 'all', msg: 'transition: all 会连宽高、布局属性一起动画 → 只列需要动的属性（颜色、透明度、位移）' })
    const re = /(\d*\.?\d+)(ms|s)\b/g
    while ((m = re.exec(rest))) {
      const ms = m[2] === 's' ? num(m[1]) * 1000 : num(m[1])
      if (ms === 0 || ms < 1) continue
      if (t && t.dur.size) {
        if (!t.dur.has(ms)) out.push({ rule: 'token/duration', text: m[0], msg: `${m[0]} 不在时长令牌里 → 最近的是 ${t.dur.get(nearest(t.dur, ms))}（${nearest(t.dur, ms)}ms）` })
        else out.push({ rule: 'token/duration', text: m[0], msg: `${m[0]} 等于 ${t.dur.get(ms)}，请用 var(${t.dur.get(ms)})`, exact: true })
      }
    }
  }
  // 阴影
  if (p === 'box-shadow' && !/^none$/i.test(v) && !/var\(/.test(v) && t && t.shadow.size) {
    out.push({ rule: 'token/shadow', text: v.slice(0, 24), msg: `写死的阴影 → 用 ${[...new Set(t.shadow.values())].map((n) => `var(${n})`).join(' / ')} 之一` })
  }
  // 半像素（边框、描边的发丝线除外）
  if (/^(font-size|width|height|min-width|min-height|max-width|max-height|padding|margin|gap|row-gap|column-gap|top|left|right|bottom|inset|border-radius|flex-basis)(-|$)/.test(p) && /(^|[^\d])\d*\.5px\b/.test(rest)) {
    out.push({ rule: 'scale/half-pixel', text: '.5px', msg: '出现半像素值，不同屏幕上会糊 → 取偶数 px' })
  }
  return out
}

// ───────────────────────── CSS 块扫描 ─────────────────────────
export function parseCss(text, { lineComments = false, lineOffset = 0 } = {}) {
  const decls = []
  const blocks = []
  const stack = []
  let buf = ''; let bufLine = 0; let line = 1; let paren = 0
  const commit = () => {
    const s = buf.trim()
    if (s && stack.length) {
      const i = s.indexOf(':')
      if (i > 0) {
        const prop = s.slice(0, i).trim()
        if (/^-{0,2}[a-z][\w-]*$/i.test(prop)) {
          const d = { prop, value: s.slice(i + 1).trim(), line: bufLine + lineOffset, block: stack[stack.length - 1] }
          decls.push(d); stack[stack.length - 1].decls.push(d)
        }
      }
    }
    buf = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; const nx = text[i + 1]
    if (ch === '\n') { line++; buf += ch; continue }
    if (ch === '/' && nx === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2; line += (text.slice(i, end).match(/\n/g) || []).length; i = end - 1; continue }
    if (lineComments && ch === '/' && nx === '/' && text[i - 1] !== ':') { const e = text.indexOf('\n', i); i = (e < 0 ? text.length : e) - 1; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== ch) { if (text[j] === '\\') j++; if (text[j] === '\n') line++; j++ }
      if (!buf.trim()) bufLine = line
      buf += text.slice(i, j + 1); i = j; continue
    }
    if (ch === '(') paren++
    if (ch === ')') paren = Math.max(0, paren - 1)
    if (!buf.trim() && !/\s/.test(ch)) bufLine = line
    if (ch === '{' && paren === 0) {
      const b = { selector: buf.trim().replace(/\s+/g, ' '), line: bufLine + lineOffset, decls: [] }
      stack.push(b); blocks.push(b); buf = ''; continue
    }
    if (ch === ';' && paren === 0) { commit(); continue }
    if (ch === '}' && paren === 0) { commit(); stack.pop(); continue }
    buf += ch
  }
  commit()
  return { decls, blocks }
}

const INTERACTIVE_SEL = /(^|[\s,>+~])(button|a|input|select|textarea|summary)\b|:focus|\[role=["']?button/i
function blockRules(blocks) {
  const out = []
  for (const b of blocks) {
    const sel = b.selector
    if (!sel || sel.startsWith('@')) continue
    const od = b.decls.find((d) => /^outline(-style)?$/i.test(d.prop) && /^(none|0)(\s|$)/i.test(d.value.trim()) || /^outline$/i.test(d.prop) && /^0(px)?(\s|$)/.test(d.value.trim()))
    if (!od) continue
    if (/:focus:not\(:focus-visible\)/.test(sel) || /\[tabindex=["']?-1["']?\]/.test(sel)) continue
    if (!INTERACTIVE_SEL.test(sel)) continue
    const replaced = b.decls.some((d) => /^(box-shadow|border(-color)?|outline-color|background(-color)?|text-decoration)$/i.test(d.prop) && !/^none$/i.test(d.value.trim()))
    if (!replaced) out.push({ rule: 'a11y/focus-outline-none', line: od.line, text: 'outline: none', msg: `「${sel.slice(0, 40)}」去掉了焦点环，块里没有 box-shadow / border 之类的替代 → 键盘用户看不到焦点在哪；加 :focus-visible 的可见样式` })
  }
  return out
}

// ───────────────────────── 单个文件 ─────────────────────────
const JS_PROP = {
  fontSize: 'font-size', borderRadius: 'border-radius', zIndex: 'z-index', gap: 'gap', rowGap: 'row-gap', columnGap: 'column-gap',
  padding: 'padding', paddingTop: 'padding-top', paddingRight: 'padding-right', paddingBottom: 'padding-bottom', paddingLeft: 'padding-left',
  margin: 'margin', marginTop: 'margin-top', marginRight: 'margin-right', marginBottom: 'margin-bottom', marginLeft: 'margin-left',
  transition: 'transition', transitionDuration: 'transition-duration', animationDuration: 'animation-duration', boxShadow: 'box-shadow',
  color: 'color', background: 'background', backgroundColor: 'background-color', borderColor: 'border-color', border: 'border', outline: 'outline', fill: 'fill', stroke: 'stroke',
}
const NUMERIC_PX = new Set(['fontSize', 'borderRadius', 'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'])
/** 把注释内容换成空格（保留换行），避免注释里写的 <img>、fontSize: 15 被当成代码。ds-ignore 仍读原文 */
export function maskComments(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ')
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/(^|[^:"'`\\])(\/\/[^\n]*)/g, (m, a, b) => a + blank(b))
}
const lineOf = (text, idx) => { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n }

export function scanText(file, text, ctx) {
  const ext = path.extname(file).toLowerCase()
  const lines = text.split('\n')
  const mtext = CSS_EXT.has(ext) ? text : maskComments(text)
  const mlines = mtext.split('\n')
  const found = []
  const push = (f) => found.push({ file, ...f })
  const addDecl = (d, line) => { for (const r of checkDecl(d.prop, d.value, ctx)) if (!r.skip) push({ line, ...r }) }

  if (CSS_EXT.has(ext)) {
    const { decls, blocks } = parseCss(text, { lineComments: ext === '.scss' || ext === '.less' || ext === '.sass' })
    for (const d of decls) addDecl(d, d.line)
    for (const r of blockRules(blocks)) push(r)
  }
  if (EMBED_EXT.has(ext)) {
    const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
    let m
    while ((m = re.exec(mtext))) {
      const startLine = lineOf(mtext, m.index + m[0].indexOf('>') + 1)
      const { decls, blocks } = parseCss(m[1], { lineOffset: startLine - 1 })
      for (const d of decls) addDecl(d, d.line)
      for (const r of blockRules(blocks)) push(r)
    }
    mlines.forEach((l, i) => {
      const sm = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let x
      while ((x = sm.exec(l))) for (const part of (x[1] ?? x[2]).split(';')) { const k = part.indexOf(':'); if (k > 0) addDecl({ prop: part.slice(0, k).trim(), value: part.slice(k + 1).trim() }, i + 1) }
    })
  }
  if (JS_EXT.has(ext) || ext === '.vue' || ext === '.svelte') {
    mlines.forEach((l, i) => {
      const re = /\b([a-z][a-zA-Z]+)\s*:\s*(?:(['"`])([^'"`\n]*)\2|(-?\d+(?:\.\d+)?)(?![\w.%]))/g
      let m
      while ((m = re.exec(l))) {
        const camel = m[1]
        if (!(camel in JS_PROP)) continue
        if (m[4] !== undefined) {
          if (camel === 'zIndex') addDecl({ prop: 'z-index', value: m[4] }, i + 1)
          else if (NUMERIC_PX.has(camel) && num(m[4]) !== 0) addDecl({ prop: JS_PROP[camel], value: `${m[4]}px` }, i + 1)
        } else if (m[3] !== undefined) addDecl({ prop: JS_PROP[camel], value: m[3] }, i + 1)
      }
      // Tailwind 任意值：text-[13px] rounded-[10px] p-[13px] z-[999] bg-[#abc]
      const tw = /\b(text|rounded|p[xytrbl]?|m[xytrbl]?|gap|z|bg|border|shadow)-\[([^\]\s]+)\]/g
      while ((m = tw.exec(l))) {
        const [, pre, val] = m
        const map = { text: /^#|^rgb|^hsl/.test(val) ? 'color' : 'font-size', rounded: 'border-radius', gap: 'gap', z: 'z-index', bg: 'background-color', border: 'border-color', shadow: 'box-shadow' }
        const prop = map[pre] || (pre[0] === 'p' ? 'padding' : 'margin')
        const vv = val.replace(/_/g, ' ')
        if (prop === 'color' || prop === 'background-color' || prop === 'border-color') { if (/^#|^rgb|^hsl/.test(vv)) addDecl({ prop, value: vv }, i + 1) }
        else addDecl({ prop, value: vv }, i + 1)
      }
    })
  }

  // 通用：HTML / JSX 层面
  if (!CSS_EXT.has(ext)) {
    mlines.forEach((l, i) => {
      if (/user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=\s*1(\.0)?\b/i.test(l)) push({ rule: 'a11y/zoom-disabled', line: i + 1, text: 'viewport', msg: 'viewport 禁了缩放（user-scalable=no 或 maximum-scale=1）→ 低视力用户放大不了，去掉' })
      if (/\boutline-none\b/.test(l) && !/focus(-visible|-within)?:(ring|outline|border|shadow)/.test(l)) push({ rule: 'a11y/focus-outline-none', line: i + 1, text: 'outline-none', msg: 'Tailwind 的 outline-none 去掉了焦点环，同一处没有 focus-visible:ring 之类的替代' })
      if (/\boutline\s*:\s*['"]?(none|0)['"]?\s*[,;}]/.test(l) && !/boxShadow|box-shadow/.test(l) && (JS_EXT.has(ext) || /style\s*=/.test(l))) push({ rule: 'a11y/focus-outline-none', line: i + 1, text: 'outline: none', msg: '内联样式去掉了焦点环，且没有替代' })
    })
    const reImg = /<img\b[^>]*?>/gis
    let m
    while ((m = reImg.exec(mtext))) {
      const tag = m[0]
      if (/^<img\s*\/?>$/i.test(tag)) continue // 文档里随手写的 <img>，不是真标签
      if (/\{\s*\.\.\./.test(tag) || /\balt\s*=|\balt\b(?=[\s/>])|:alt\s*=|v-bind:alt/.test(tag)) continue
      push({ rule: 'a11y/img-alt', line: lineOf(mtext, m.index), text: '<img>', msg: '<img> 没有 alt → 有意义的图写描述，纯装饰的写 alt=""' })
    }
    const reClick = /<(div|span|li|p|section|article)\b[^>]*?(\bonClick\s*=|@click\b|v-on:click)[^>]*?>/gis
    while ((m = reClick.exec(mtext))) {
      if (/\brole\s*=|\btabIndex\s*=|\btabindex\s*=/.test(m[0])) continue
      push({ rule: 'a11y/click-non-semantic', line: lineOf(mtext, m.index), text: `<${m[1]}>`, msg: `<${m[1]}> 上绑了点击，键盘和读屏用不了 → 改用 <button>，或补 role="button" 与 tabIndex 与键盘事件` })
    }
  }
  return applyIgnores(found, lines)
}

// ───────────────────────── 忽略登记 ─────────────────────────
const IGN = /ds-ignore(?:\s*[:：]\s*(.*?))?\s*(?:\*\/|-->|\}\}|$)/
function applyIgnores(found, lines) {
  const kept = []; const ignored = []; const meta = []
  const seenMeta = new Set()
  const reasonAt = (ln) => { const m = IGN.exec(lines[ln - 1] || ''); return m ? { has: true, reason: (m[1] || '').trim() } : null }
  for (const f of found) {
    const ig = reasonAt(f.line) || reasonAt(f.line - 1)
    if (ig && ig.reason) { ignored.push({ ...f, reason: ig.reason }); continue }
    if (ig && !ig.reason) {
      const key = `${f.file}:${f.line}`
      if (!seenMeta.has(key)) { seenMeta.add(key); meta.push({ file: f.file, line: f.line, rule: 'meta/ignore-no-reason', text: 'ds-ignore', msg: 'ds-ignore 后面没写理由，不算登记 → 写成「ds-ignore: 理由」' }) }
    }
    kept.push(f)
  }
  return { findings: [...kept, ...meta], ignored }
}

// ───────────────────────── 目录扫描 ─────────────────────────
export function walk(root, { ignore = [], includeTests = false, skipDir = null } = {}) {
  const files = []
  const rec = (dir) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (skipDir && path.resolve(full) === skipDir)) continue
        rec(full)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!(CSS_EXT.has(ext) || EMBED_EXT.has(ext) || JS_EXT.has(ext))) continue
        if (/\.min\./.test(e.name) || /\.d\.ts$/.test(e.name)) continue
        if (!includeTests && /(\.test\.|\.spec\.|\.stories\.|__tests__|__mocks__)/.test(full)) continue
        if (ignore.some((s) => full.includes(s))) continue
        try { if (fs.statSync(full).size > MAX_BYTES) continue } catch { continue }
        files.push(full)
      }
    }
  }
  rec(root)
  return files.sort()
}

export function discoverTokens(root, explicit) {
  const cands = explicit ? [explicit] : ['design-system/tokens.css', 'docs/design-system/tokens.css', 'tokens.css', 'src/styles/tokens.css', 'styles/tokens.css']
  for (const c of cands) { const p = path.resolve(c.startsWith('/') || explicit ? c : path.join(root, c)); if (fs.existsSync(p)) return p }
  return null
}

export function audit(root, opts = {}) {
  root = path.resolve(root)
  const tokenPath = discoverTokens(root, opts.tokens)
  const tokens = tokenPath ? loadTokens(fs.readFileSync(tokenPath, 'utf8')) : null
  const skipDir = tokenPath ? path.dirname(tokenPath) : null
  const files = walk(root, { ignore: opts.ignore || [], includeTests: !!opts.includeTests, skipDir: skipDir && skipDir !== root ? skipDir : null })
  const findings = []; const ignored = []
  let motionDeclared = false
  // 令牌文件本身不被扫描，但 design-system-first 生成的 tokens.css 自带减弱动效覆盖，要算进去
  let reducedHandled = !!tokenPath && /prefers-reduced-motion/.test(fs.readFileSync(tokenPath, 'utf8'))
  for (const f of files) {
    if (tokenPath && path.resolve(f) === tokenPath) continue
    const text = fs.readFileSync(f, 'utf8')
    const rel = path.relative(root, f)
    if (/prefers-reduced-motion/.test(text)) reducedHandled = true
    if (/\b(transition|animation)(-duration)?\s*:/.test(text) || /\b(transition|animation)\w*\s*:\s*['"`]/.test(text)) motionDeclared = true
    const r = scanText(rel, text, { tokens })
    findings.push(...r.findings); ignored.push(...r.ignored)
  }
  if (motionDeclared && !reducedHandled) findings.push({ file: '(项目)', line: 0, rule: 'ux/reduced-motion-missing', text: '', msg: '项目里有 transition / animation，却没有任何文件处理 prefers-reduced-motion → 在全局样式里加一段减弱动效的覆盖' })
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule))
  const notes = []
  if (!tokens) notes.push('没找到令牌文件：只做通用规则（无障碍、半像素、奇数 px 等）。要按项目自己的设计系统审，用 --tokens 指定 tokens.css，或先用 design-system-first 生成。')
  else {
    notes.push(`令牌：${path.relative(root, tokenPath)}（字阶 ${tokens.fs.size} · 圆角 ${tokens.radius.size} · 间距 ${tokens.space.size} · 时长 ${tokens.dur.size} · 层级 ${tokens.z.size} · 阴影 ${tokens.shadow.size} · 颜色 ${tokens.color.size}）`)
    for (const [k, label] of [['fs', '字号'], ['radius', '圆角'], ['space', '间距'], ['dur', '动效时长'], ['z', 'z-index'], ['shadow', '阴影'], ['color', '颜色']]) if (!tokens[k].size) notes.push(`令牌文件里没有识别到${label}令牌（--fs-* / --radius-* / --space-* / --dur-* / --z-* / --shadow-* / --color-*），${k === 'radius' || k === 'space' ? '该类只做奇数 px 的基础检查' : '该类规则已跳过'}。`)
  }
  const summary = { files: files.length, error: 0, warn: 0, info: 0, ignored: ignored.length, byRule: {} }
  for (const f of findings) { const s = RULES[f.rule].sev; summary[s]++; summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1 }
  return { root, tokenPath, findings, ignored, summary, notes }
}

// ───────────────────────── 基线（只减不增）─────────────────────────
export function countsOf(findings) {
  const c = {}
  for (const f of findings) { c[f.file] ??= {}; c[f.file][f.rule] = (c[f.file][f.rule] || 0) + 1 }
  return c
}
export function compareBaseline(base, findings) {
  const now = countsOf(findings)
  const regress = []; const improved = []
  for (const [file, rules] of Object.entries(now)) for (const [rule, n] of Object.entries(rules)) {
    const b = base.counts?.[file]?.[rule] || 0
    if (n > b) regress.push({ file, rule, from: b, to: n })
  }
  for (const [file, rules] of Object.entries(base.counts || {})) for (const [rule, b] of Object.entries(rules)) {
    const n = now[file]?.[rule] || 0
    if (n < b) improved.push({ file, rule, from: b, to: n })
  }
  return { regress, improved }
}

// ───────────────────────── 输出 ─────────────────────────
export function formatText(r, { limit = 300, baseline = null } = {}) {
  const L = []
  let shown = 0
  let cur = null
  for (const f of r.findings) {
    if (shown >= limit) break
    if (f.file !== cur) { cur = f.file; L.push('', f.file) }
    L.push(`  ${String(f.line || '').padStart(4)}  [${SEV[RULES[f.rule].sev]}] ${f.rule}  ${f.msg}`)
    shown++
  }
  if (r.findings.length > shown) L.push('', `（还有 ${r.findings.length - shown} 条没列出，用 --limit 调大，或 --format json 看全部）`)
  L.push('', `汇总：错误 ${r.summary.error} · 建议 ${r.summary.warn} · 提示 ${r.summary.info}　（扫描 ${r.summary.files} 个文件，已登记忽略 ${r.summary.ignored} 处）`)
  const rules = Object.entries(r.summary.byRule).sort((a, b) => b[1] - a[1])
  if (rules.length) L.push('按规则：' + rules.map(([k, n]) => `${k} ${n}`).join(' · '))
  if (r.ignored.length) { L.push('', '已登记的忽略（例外）：'); for (const i of r.ignored.slice(0, 30)) L.push(`  ${i.file}:${i.line}  ${i.rule}  理由：${i.reason}`) }
  for (const n of r.notes) L.push('说明：' + n)
  if (baseline) {
    L.push('', `基线：${baseline.regress.length ? `有 ${baseline.regress.length} 项比基线多` : '没有比基线多的问题'}${baseline.improved.length ? `，${baseline.improved.length} 项比基线少（可以 --update-baseline 把基线压低）` : ''}`)
    for (const x of baseline.regress.slice(0, 40)) L.push(`  新增  ${x.file}  ${x.rule}  ${x.from} → ${x.to}`)
  }
  return L.join('\n').replace(/^\n/, '') + '\n'
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const all = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []))
  const flags = new Set(['--strict', '--update-baseline', '--allow-raise', '--include-tests'])
  const valued = new Set(['--tokens', '--baseline', '--format', '--ignore', '--limit'])
  const pos = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]))
  const unknown = argv.filter((a) => a.startsWith('--') && !flags.has(a) && !valued.has(a))
  if (unknown.length || argv.includes('--help')) { console.error('用法：node audit.mjs [目录] [--tokens tokens.css] [--baseline 文件] [--update-baseline [--allow-raise]] [--strict] [--format text|json] [--ignore 路径片段] [--limit N] [--include-tests]'); process.exit(unknown.length ? 2 : 0) }
  const root = pos[0] || '.'
  if (!fs.existsSync(root)) { console.error(`目录不存在：${root}`); process.exit(2) }
  const fmt = get('--format') || 'text'
  if (!['text', 'json'].includes(fmt)) { console.error('--format 只能是 text 或 json'); process.exit(2) }
  const r = audit(root, { tokens: get('--tokens'), ignore: all('--ignore'), includeTests: argv.includes('--include-tests') })
  let baseline = null
  const bpath = get('--baseline')
  if (bpath) {
    if (argv.includes('--update-baseline')) {
      const exists = fs.existsSync(bpath)
      const cmp = exists ? compareBaseline(JSON.parse(fs.readFileSync(bpath, 'utf8')), r.findings) : { regress: [] }
      if (cmp.regress.length && !argv.includes('--allow-raise')) { console.error(`拒绝更新基线：有 ${cmp.regress.length} 项比基线多（基线只减不增）。先修掉，或明确加 --allow-raise。`); process.exit(1) }
      fs.mkdirSync(path.dirname(path.resolve(bpath)), { recursive: true })
      fs.writeFileSync(bpath, JSON.stringify({ version: 1, generated: new Date().toISOString(), counts: countsOf(r.findings) }, null, 2) + '\n')
      console.error(exists ? `已把基线压到当前水平：${bpath}` : `已把现状记为基线：${bpath}（之后只许减、不许增）`)
    } else if (fs.existsSync(bpath)) baseline = compareBaseline(JSON.parse(fs.readFileSync(bpath, 'utf8')), r.findings)
    else { console.error(`基线文件不存在：${bpath}（先用 --update-baseline 创建）`); process.exit(2) }
  }
  if (fmt === 'json') console.log(JSON.stringify({ root: r.root, tokens: r.tokenPath, summary: r.summary, findings: r.findings, ignored: r.ignored, notes: r.notes, baseline }, null, 2))
  else process.stdout.write(formatText(r, { limit: Number(get('--limit')) || 300, baseline }))
  const strictFail = argv.includes('--strict') && r.summary.warn > 0
  const fail = baseline ? baseline.regress.length > 0 || r.summary.error > 0 : r.summary.error > 0 || strictFail
  process.exit(fail ? 1 : 0)
}

const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href } catch { return false } })()
if (isMain) main(process.argv.slice(2))
