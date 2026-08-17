// Host half of @eeyzs1/dsh-attach-files.
// Exposes the three original attachfs RPCs (root / list / read) over a
// lightweight client-connection RPC channel (/attach), as real packages do
// instead of the dynamic-only harness.handle.
export const name = '@eeyzs1/dsh-attach-files'
export const inject = ['connection']

export function apply(ctx) {
  const connection = ctx.connection
  const handler = async (endpoint, payload) => {
    try {
      if (endpoint === 'root') return { ok: true, value: { root: await rootOf(payload) } }
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

  // Register once; the returned disposer is owned by ctx.effect so stop/update
  // removes the channel with the fiber.
  ctx.effect(() => connection.rpc.handle('/attach', handler, { authority: 'loopback' }))

  async function rootOf(args) {
    const fs = ctx.get('fs')
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
    if (!root && fs && fs.workspaceRoot != null) root = fs.workspaceRoot
    else if (!root) {
      const sandboxPolicy = ctx.get('sandboxPolicy')
      if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') root = sandboxPolicy.workspaceRoot
    }
    return { root }
  }

  async function listDir(args) {
    const fs = ctx.get('fs')
    const path = (args && typeof args.path === 'string') ? args.path : ''
    const asEntry = (e) => ({
      name: e.name,
      type: e.type,
      size: e.size != null ? e.size : null,
      path: fs.processPath(e.target),
    })
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (info === undefined) {
      return { ok: false, error: { code: 'directory-unreadable', message: '路径不存在：' + path, details: { path } } }
    }
    if (info.type !== 'directory') {
      return { ok: false, error: { code: 'directory-unreadable', message: '不是目录：' + path, details: { path } } }
    }
    const entries = await fs.listDir(target)
    const dirs = []
    const files = []
    for (const e of entries) {
      if (e.type === 'directory') dirs.push(asEntry(e))
      else if (e.type === 'file') files.push(asEntry(e))
    }
    return { ok: true, path: fs.processPath(target), dirs, files }
  }

  async function readFiles(args) {
    const fs = ctx.get('fs')
    const paths = (args && Array.isArray(args.paths)) ? args.paths.map((p) => String(p)) : []
    const MAX_FILE = 100000
    const files = []
    for (const p of paths) {
      try {
        const target = await fs.resolve(p)
        let text = await fs.readText(target)
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
