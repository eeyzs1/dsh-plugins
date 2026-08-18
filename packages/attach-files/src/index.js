// Host half of @eeyzs1/dsh-attach-files.
// Exposes the three original attachfs RPCs (root / list / read) over a
// lightweight client-connection RPC channel (/attach). Listing uses Node's
// fs/promises directly with per-entry tolerance, so a permission-protected
// child (e.g. E:\System Volume Information) is skipped instead of aborting the
// whole directory listing — this is what makes full-disk browsing work.
import { readdir, stat, readFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'

export const name = '@eeyzs1/dsh-attach-files'
export const inject = ['connection']

export function apply(ctx) {
  const connection = ctx.connection
  const handler = async (endpoint, payload) => {
    try {
      if (endpoint === 'root') return { ok: true, value: await rootOf(payload) }
      if (endpoint === 'list') return { ok: true, value: await listDir(payload) }
      if (endpoint === 'read') return { ok: true, value: await readFiles(payload) }
      return { ok: false, error: { code: 'internal', message: `unknown endpoint ${endpoint}`, details: {} } }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
      }
    }
  }

  // Register once; the disposer is owned by ctx.effect so stop/update removes
  // the channel with the fiber.
  ctx.effect(() => connection.rpc.handle('/attach', handler, { authority: 'loopback' }))

  async function rootOf(args) {
    let root = ''
    const sid = (args && typeof args.sessionId === 'string') ? args.sessionId : ''
    if (sid) {
      const sessions = ctx.get('sessions')
      if (sessions && typeof sessions.get === 'function') {
        try {
          const s = sessions.get(sid)
          const cwd = s && s.header && typeof s.header.cwd === 'string' ? s.header.cwd : ''
          if (cwd) root = cwd
        } catch (e) { /* ignore */ }
      }
      if (!root) {
        const sp = ctx.get('sessionPersistence')
        if (sp && typeof sp.list === 'function') {
          try {
            const headers = await sp.list()
            const hit = headers.find((h) => h && String(h.id) === sid)
            if (hit && typeof hit.cwd === 'string' && hit.cwd) root = hit.cwd
          } catch (e) { /* ignore */ }
        }
      }
    }
    if (!root) {
      const sandboxPolicy = ctx.get('sandboxPolicy')
      if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') root = sandboxPolicy.workspaceRoot
    }
    return { root }
  }

  async function listDir(args) {
    let path = (args && typeof args.path === 'string') ? args.path : ''

    // Bare drive root ("C:") → trailing slash form so readdir works.
    if (/^[A-Za-z]:$/.test(path)) path = path + '\\'
    if (!isAbsolute(path) || path === '') {
      return { ok: false, error: { code: 'directory-unreadable', message: '不是绝对路径：' + path, details: { path } } }
    }

    let dirents
    try {
      dirents = await readdir(path, { withFileTypes: true })
    } catch (err) {
      return { ok: false, error: { code: 'directory-unreadable', message: String(err && err.message ? err.message : err), details: { path } } }
    }

    const dirs = []
    const files = []
    for (const d of dirents) {
      const child = join(path, d.name)
      let isDir = d.isDirectory()
      let isFile = d.isFile()
      let size = null
      // Symlinks and unknown types need a stat probe; skip if the probe fails
      // (permission, vanished, etc.) so one bad child never aborts the list.
      try {
        if (!isDir && !isFile) {
          const st = await stat(child)
          isDir = st.isDirectory()
          isFile = st.isFile()
        }
        if (isFile) size = (await stat(child)).size
      } catch (e) {
        continue // unreadable child — skip
      }
      if (isDir) dirs.push({ name: d.name, type: 'directory', size: null, path: child })
      else if (isFile) files.push({ name: d.name, type: 'file', size, path: child })
    }
    return { ok: true, path, dirs, files }
  }

  async function readFiles(args) {
    const paths = (args && Array.isArray(args.paths)) ? args.paths.map((p) => String(p)) : []
    const MAX_FILE = 100000
    const files = []
    for (const p of paths) {
      try {
        const buf = await readFile(p)
        let text = buf.toString('utf8')
        let truncated = false
        if (text.length > MAX_FILE) { text = text.slice(0, MAX_FILE); truncated = true }
        files.push({ path: p, content: text, truncated })
      } catch (err) {
        files.push({ path: p, content: null, note: String(err && err.message ? err.message : err) })
      }
    }
    return { ok: true, files }
  }
}
