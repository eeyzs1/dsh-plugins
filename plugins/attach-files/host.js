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

    harness.handle('attachfs/root', async () => {
      const root = (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string')
        ? sandboxPolicy.workspaceRoot
        : ''
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

    harness.handle('attachfs/gather', async (args) => {
      const selections = (args && Array.isArray(args.selections)) ? args.selections : []
      const MAX_FILE = 100000
      const MAX_TOTAL = 400000
      const MAX_ENTRIES = 500
      const MAX_DEPTH = 8
      let entryCount = 0
      let budget = MAX_TOTAL
      const seen = new Set()
      const found = []

      const walk = async (path, depth) => {
        if (entryCount >= MAX_ENTRIES || depth > MAX_DEPTH) return
        let target, info
        try {
          target = await fs.resolve(path)
          info = await fs.stat(target)
        } catch (e) { return }
        if (info === undefined) return
        const canon = fs.processPath(target)
        if (seen.has(canon)) return
        seen.add(canon)
        entryCount++
        if (info.type === 'file') {
          found.push({ path: canon, type: 'file' })
        } else if (info.type === 'directory') {
          found.push({ path: canon, type: 'dir' })
          let entries = []
          try { entries = await fs.listDir(target) } catch (e) { return }
          for (const e of entries) {
            if (entryCount >= MAX_ENTRIES) break
            await walk(fs.processPath(e.target), depth + 1)
          }
        }
      }

      for (const sel of selections) {
        if (!sel || typeof sel.path !== 'string') continue
        await walk(sel.path, 0)
      }

      const files = []
      let skipped = 0
      let exhausted = false
      for (const item of found) {
        if (item.type !== 'file') continue
        if (budget <= 0) { exhausted = true; continue }
        try {
          const target = await fs.resolve(item.path)
          let text = await fs.readText(target)
          let isTrunc = false
          if (text.length > MAX_FILE) { text = text.slice(0, MAX_FILE); isTrunc = true }
          if (text.length > budget) { text = text.slice(0, budget); isTrunc = true; exhausted = true }
          budget -= text.length
          files.push({ path: item.path, content: text, truncated: isTrunc })
        } catch (err) {
          skipped++
        }
      }

      const dirRoots = new Set()
      for (const item of found) {
        if (item.type === 'dir') dirRoots.add(item.path)
      }

      return { ok: true, files: files, dirs: Array.from(dirRoots), skipped: skipped, budgetExhausted: exhausted }
    })
  },
}
