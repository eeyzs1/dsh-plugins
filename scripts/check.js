#!/usr/bin/env node
'use strict'

/**
 * dsh-plugins 校验 + 索引生成器。
 * 用法：node scripts/check.js
 *
 * 做三件事：
 *   1. 校验每个 plugins/<id>/manifest.json 的必填字段与 idPrefix 格式；
 *   2. 语法检查 entry 指向的 host.js / client.js（按 DSH 的函数体约定编译）；
 *   3. 重新生成根目录 PLUGINS.md 插件索引。
 * 任一校验失败以非零退出（供 CI 使用）。
 */

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const PLUGINS_DIR = path.join(ROOT, 'plugins')

function fail(msg) {
  console.error('  ✗ ' + msg)
  process.exitCode = 1
}

function md(s) {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/** 按 DSH 的约定（函数体）编译一次，返回错误信息或 null。 */
function syntaxCheck(file, label) {
  let code
  try {
    code = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return `${label}: 无法读取 — ${e.message}`
  }
  try {
    // 与 cordis-host-runner 的 precheck 一致：包成 async IIFE 编译。
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: label })
    return null
  } catch (e) {
    return `${label}: 语法错误 — ${e.message}`
  }
}

function validateManifest(manifest, id) {
  const errors = []
  if (typeof manifest.idPrefix !== 'string' || !/^[a-z]{3,6}$/.test(manifest.idPrefix)) {
    errors.push(`idPrefix 必须是 3–6 个小写英文字母（当前：${JSON.stringify(manifest.idPrefix)}）`)
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    errors.push('name 不能为空')
  }
  if (typeof manifest.purpose !== 'string' || manifest.purpose.trim() === '') {
    errors.push('purpose 不能为空')
  }
  const entry = manifest.entry
  if (typeof entry !== 'object' || entry === null) {
    errors.push('entry 必须是对象，且至少含 host 或 client 之一')
  } else if (entry.host === undefined && entry.client === undefined) {
    errors.push('entry 至少要有 host 或 client 之一')
  }
  return errors
}

function main() {
  const plugins = []
  let errorCount = 0

  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log('（无 plugins 目录）')
    return
  }

  const ids = fs.readdirSync(PLUGINS_DIR).filter((id) => {
    if (id.startsWith('_') || id.startsWith('.')) return false // 跳过模板/隐藏目录
    return fs.statSync(path.join(PLUGINS_DIR, id)).isDirectory()
  }).sort()

  if (ids.length === 0) {
    console.log('plugins 目录为空')
    return
  }

  console.log(`校验 ${ids.length} 个插件…\n`)

  for (const id of ids) {
    const dir = path.join(PLUGINS_DIR, id)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      fail(`plugins/${id}: 缺少 manifest.json`)
      errorCount++
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      fail(`plugins/${id}/manifest.json: JSON 解析失败 — ${e.message}`)
      errorCount++
      continue
    }

    for (const e of validateManifest(manifest, id)) {
      fail(`plugins/${id}: ${e}`)
      errorCount++
    }

    const entry = (typeof manifest.entry === 'object' && manifest.entry !== null) ? manifest.entry : {}
    for (const k of ['host', 'client']) {
      const rel = entry[k]
      if (rel === undefined) continue
      const file = path.join(dir, rel)
      if (!fs.existsSync(file)) {
        fail(`plugins/${id}: entry.${k} 指向的 ${rel} 不存在`)
        errorCount++
        continue
      }
      const syn = syntaxCheck(file, `plugins/${id}/${rel}`)
      if (syn !== null) {
        fail(syn)
        errorCount++
      }
    }

    plugins.push({
      id,
      name: manifest.name,
      purpose: manifest.purpose,
      version: manifest.version || '—',
    })
  }

  if (errorCount === 0) {
    console.log(`✓ ${plugins.length} 个插件全部通过校验`)
  } else {
    console.log(`\n发现 ${errorCount} 个问题`)
  }

  generateIndex(plugins)
}

function generateIndex(plugins) {
  const lines = []
  lines.push('# 插件索引')
  lines.push('')
  lines.push('> 本文件由 `node scripts/check.js` 自动生成，请勿手改。')
  lines.push('')
  lines.push('| 目录 | 名称 | 用途 | 版本 |')
  lines.push('|------|------|------|------|')
  for (const p of plugins) {
    lines.push(`| [${md(p.id)}](plugins/${p.id}/README.md) | ${md(p.name)} | ${md(p.purpose)} | ${md(p.version)} |`)
  }
  lines.push('')
  fs.writeFileSync(path.join(ROOT, 'PLUGINS.md'), lines.join('\n') + '\n')
  console.log('已重新生成 PLUGINS.md')
}

main()
