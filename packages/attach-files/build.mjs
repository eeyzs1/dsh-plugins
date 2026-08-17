/**
 * Wrap src/client.js as the DSH web client artifact expected by
 * ClientModuleSystem: a classic-script handoff through
 * window.__ModuleLoader__.load({ id, factory }).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const id = '@eeyzs1/dsh-attach-files'
const body = readFileSync(join(root, 'src', 'client.js'), 'utf8')

const artifact = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  body,
  'return module.exports;',
  '} });',
  '',
].join('\n')

const outDir = join(root, 'lib')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'client.js'), artifact)
console.log(`wrote lib/client.js (${artifact.length} bytes)`)
