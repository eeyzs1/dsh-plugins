// Host half of @eeyzs1/dsh-attach-files.
// Exposes the three original attachfs RPCs (root / list / read) over a
// lightweight client-connection RPC channel (/attach). Listing uses Node's
// fs/promises directly with per-entry tolerance, so a permission-protected
// child (e.g. E:\System Volume Information) is skipped instead of aborting the
// whole directory listing — this is what makes full-disk browsing work.
import { readdir, stat, open } from 'node:fs/promises'
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
  // the channel with the fiber. (The channel is authenticated by the
  // connection transport itself — there is no extra authority option.)
  ctx.effect(() => connection.rpc.handle('/attach', handler))

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
    // One stat per entry, batched for concurrency: a plain non-symlink
    // directory needs no probe (dirent already settled it); everything else —
    // files need their size, symlinks need their target type — is probed once.
    // A failed probe (permission, vanished) skips that child only, so one bad
    // entry never aborts the whole listing.
    const BATCH = 32
    for (let i = 0; i < dirents.length; i += BATCH) {
      const batch = dirents.slice(i, i + BATCH)
      const probed = await Promise.all(batch.map(async (d) => {
        const child = join(path, d.name)
        const plainDir = d.isDirectory() && !d.isSymbolicLink()
        if (plainDir) return { name: d.name, path: child, kind: 'directory', size: null }
        try {
          const st = await stat(child) // follows symlinks — a link behaves as its target
          if (st.isDirectory()) return { name: d.name, path: child, kind: 'directory', size: null }
          if (st.isFile()) return { name: d.name, path: child, kind: 'file', size: st.size }
        } catch (e) { /* unreadable child — skip */ }
        return null
      }))
      for (const entry of probed) {
        if (entry === null) continue
        if (entry.kind === 'directory') dirs.push({ name: entry.name, type: 'directory', size: null, path: entry.path })
        else files.push({ name: entry.name, type: 'file', size: entry.size, path: entry.path })
      }
    }
    return { ok: true, path, dirs, files }
  }

  async function readFiles(args) {
    const paths = (args && Array.isArray(args.paths)) ? args.paths.map((p) => String(p)) : []
    const MAX_FILE = 100000 // characters kept
    const MAX_BYTES = MAX_FILE * 4 // UTF-8 worst case — bounds memory per file to ~400KB
    const files = []
    for (const p of paths) {
      try {
        // Read only the head of the file: a multi-GB file selected by mistake
        // must not be buffered whole before truncation.
        const fh = await open(p, 'r')
        let text
        let hitByteCap = false
        try {
          const buf = Buffer.alloc(MAX_BYTES)
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
          hitByteCap = bytesRead === buf.length
          text = buf.toString('utf8', 0, bytesRead)
        } finally {
          await fh.close()
        }
        // A NUL byte in the head means binary (image/archive/PE...) — decoding
        // it as UTF-8 into the draft is useless garbage; refuse with a note.
        if (text.indexOf('\u0000') !== -1) {
          files.push({ path: p, content: null, note: '二进制文件，无法作为文本展开（可改用「添加路径」引用）' })
          continue
        }
        let truncated = hitByteCap
        if (text.length > MAX_FILE) {
          text = text.slice(0, MAX_FILE).replace(/[\uD800-\uDBFF]$/, '') // never end on a lone surrogate
          truncated = true
        }
        files.push({ path: p, content: text, truncated })
      } catch (err) {
        files.push({ path: p, content: null, note: String(err && err.message ? err.message : err) })
      }
    }
    return { ok: true, files }
  }
}
