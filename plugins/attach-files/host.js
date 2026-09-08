return {
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const sandboxPolicy = ctx.get('sandboxPolicy')

    const asEntry = (e) => ({
      name: e.name,
      type: e.type,
      size: e.size != null ? e.size : null,
      path: fs.processPath(e.target),
    })

    harness.handle('attachfs/root', async (args) => {
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
      if (!root && sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') {
        root = sandboxPolicy.workspaceRoot
      }
      return { root: root }
    })

    harness.handle('attachfs/list', async (args) => {
      const path = (args && typeof args.path === 'string') ? args.path : ''
      try {
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        if (info === undefined) return { ok: false, error: '路径不存在：' + path }
        if (info.type !== 'directory') return { ok: false, error: '不是目录：' + path }
        const entries = await fs.listDir(target)
        const dirs = []
        const files = []
        for (const e of entries) {
          if (e.type === 'directory') dirs.push(asEntry(e))
          else if (e.type === 'file') files.push(asEntry(e))
        }
        return { ok: true, path: fs.processPath(target), dirs: dirs, files: files }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })

    harness.handle('attachfs/read', async (args) => {
      const paths = (args && Array.isArray(args.paths)) ? args.paths : []
      const MAX_FILE = 100000 // characters kept after decode
      const MAX_BYTES = MAX_FILE * 4 // pre-read size guard (UTF-8 worst case)
      const files = []
      for (const p of paths) {
        try {
          const target = await fs.resolve(String(p))
          // Size guard first: the fs service reads whole files, so a huge file
          // must be rejected before the read instead of buffered whole.
          const info = await fs.stat(target)
          if (info && typeof info.size === 'number' && info.size > MAX_BYTES) {
            files.push({ path: String(p), content: null, note: '文件过大（' + info.size + ' 字节），请改用「添加路径」以 @file: 引用' })
            continue
          }
          // readText rejects binary targets (FS_NOT_TEXT) — that lands in the
          // note branch below, which is exactly the right UX.
          let text = await fs.readText(target)
          let truncated = false
          if (text.length > MAX_FILE) {
            text = text.slice(0, MAX_FILE).replace(/[\uD800-\uDBFF]$/, '') // never end on a lone surrogate
            truncated = true
          }
          files.push({ path: String(p), content: text, truncated: truncated })
        } catch (err) {
          files.push({ path: String(p), content: null, note: String(err && err.message ? err.message : err) })
        }
      }
      return { ok: true, files: files }
    })
  },
}
