// scripts/check-lockfile.mjs — package.json 与 package-lock.json 一致性预检
//
// 背景：PR#8 双引擎审查实证的「依赖/lockfile 不同步」问题（计划表 §2 问题图谱：
// 改了 package.json 忘了重新生成 lock，或 mirror 同步时旧 lock 覆盖新 lock）。
// CI 的 npm ci 只在远端兜底；本脚本把这道闸提前到 push 之前。
//
// 规则（对应 npm lockfile v2+ 的不变量）：
//   1. lock 存在且有 packages 段（lockfileVersion >= 2）
//   2. lock.packages[""] 的 dependencies/devDependencies 与 package.json 完全一致（同名同范围）
//   3. package.json 每个直接依赖在 lock.packages["node_modules/<name>"] 有落点
//
// 退出码：0 一致；1 不同步（逐条列出）；2 输入异常
// 零依赖：node scripts/check-lockfile.mjs（也挂在 npm run check:lockfile 与 .githooks/pre-push）

import { readFileSync } from 'node:fs'

// npm 的 read-json 容忍 BOM（Windows 工具常写），这里对齐：读入即剥
function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8').replace(/^\uFEFF/, ''))
}

let pkg, lock
try {
  pkg = readJson(new URL('../package.json', import.meta.url))
  lock = readJson(new URL('../package-lock.json', import.meta.url))
} catch (err) {
  console.error(`[lockfile] 读取/解析失败: ${err.message}`)
  process.exit(2)
}

if (!lock.packages || typeof lock.packages !== 'object') {
  console.error(`[lockfile] lockfileVersion=${lock.lockfileVersion ?? '?'} 缺 packages 段（需要 v2+）`)
  process.exit(2)
}

const problems = []
const root = lock.packages[''] || {}

for (const kind of ['dependencies', 'devDependencies']) {
  const pj = pkg[kind] || {}
  const lk = root[kind] || {}
  const names = new Set([...Object.keys(pj), ...Object.keys(lk)])
  for (const name of names) {
    if (!(name in pj)) problems.push(`${kind}.${name}: lock 有而 package.json 无（残留依赖）`)
    else if (!(name in lk)) problems.push(`${kind}.${name}: package.json 有而 lock 无（改完依赖未 npm install）`)
    else if (pj[name] !== lk[name]) problems.push(`${kind}.${name}: 范围不一致 package.json=${pj[name]} lock=${lk[name]}`)
    if (name in pj && !lock.packages[`node_modules/${name}`]) {
      problems.push(`${kind}.${name}: lock.packages 缺 node_modules/${name} 条目`)
    }
  }
}

if (problems.length > 0) {
  console.error(`[lockfile] package.json 与 package-lock.json 不同步（${problems.length} 处）：`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('修复：npm install（以 package.json 为准重生成 lock）后重新提交')
  process.exit(1)
}

const depCount = Object.keys(pkg.dependencies || {}).length
const devCount = Object.keys(pkg.devDependencies || {}).length
console.log(`[lockfile] OK：直接依赖 ${depCount} + dev ${devCount} 与 lock 完全一致`)
