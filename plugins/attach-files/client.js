return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
.dsh-attach-btn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1}
.dsh-attach-btn:hover{background:rgba(128,128,128,.12)}
.dsh-attach-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.dsh-attach-panel{width:min(720px,calc(100vw - 32px));max-height:82vh;display:flex;flex-direction:column;background:#fff;color:#1a1a1a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden}
.dsh-attach-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.1)}
.dsh-attach-title{font-size:14px;font-weight:600}
.dsh-attach-close{border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:inherit;padding:0 4px}
.dsh-attach-pathbar{display:flex;gap:6px;padding:10px 16px;align-items:center}
.dsh-attach-path{flex:1}
.dsh-attach-path input{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid rgba(0,0,0,.2);border-radius:8px;font:inherit;font-size:12px;background:transparent;color:inherit}
.dsh-attach-list{flex:1;overflow:auto;padding:4px 8px 8px;min-height:220px}
.dsh-attach-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer}
.dsh-attach-row:hover{background:rgba(0,0,0,.05)}
.dsh-attach-row input[type=checkbox]{margin:0}
.dsh-attach-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.dsh-attach-size{color:#888;font-size:11px}
.dsh-attach-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid rgba(0,0,0,.1)}
.dsh-attach-actions{display:flex;gap:8px}
.dsh-attach-ghost{border:1px solid rgba(0,0,0,.25);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}
.dsh-attach-primary{border:1px solid transparent;background:#2563eb;color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px}
.dsh-attach-primary:disabled{opacity:.5;cursor:default}
.dsh-attach-section{padding:6px 8px 2px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888}
.dsh-attach-empty{padding:24px;text-align:center;color:#888;font-size:13px}
.dsh-attach-error{padding:8px 16px;color:#b91c1c;font-size:12px}
.dsh-attach-note{padding:0 16px 8px;color:#2563eb;font-size:12px}
@media (prefers-color-scheme: dark){
.dsh-attach-panel{background:#1e1e1e;color:#e5e5e5}
.dsh-attach-head,.dsh-attach-foot{border-color:rgba(255,255,255,.12)}
.dsh-attach-row:hover{background:rgba(255,255,255,.06)}
.dsh-attach-path input{border-color:rgba(255,255,255,.2);background:#2a2a2a;color:#e5e5e5}
.dsh-attach-ghost{border-color:rgba(255,255,255,.3);color:#e5e5e5}
}
`)

    function parentPath(p) {
      if (!p) return ''
      let s = p
      while (s.length > 1 && (s.endsWith('\\') || s.endsWith('/'))) s = s.slice(0, -1)
      if (/^[A-Za-z]:$/.test(s)) return ''
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
      if (i < 0) return ''
      let parent = s.slice(0, i)
      if (/^[A-Za-z]:$/.test(parent)) parent += '\\'
      return parent
    }

    function fmtSize(n) {
      if (n == null) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function formatMessage(res) {
      const files = res.files || []
      const dirs = res.dirs || []
      const skipped = res.skipped || 0
      const exhausted = res.budgetExhausted || false
      const out = []
      out.push('📎 已添加文件/目录到对话（' + files.length + ' 个文件' + (dirs.length ? '，' + dirs.length + ' 个目录' : '') + '）')
      out.push('')
      for (const d of dirs) out.push('📁 目录：' + d)
      if (dirs.length) out.push('')
      for (const f of files) {
        out.push('━━━━ ' + f.path + ' ━━━━')
        if (f.content != null) {
          out.push(f.content)
          if (f.truncated) out.push('\n…[内容过长，已截断]')
        } else {
          out.push('[无法读取文本内容]')
        }
        out.push('')
      }
      if (skipped > 0) out.push('（跳过 ' + skipped + ' 个二进制/不可读文件）')
      if (exhausted) out.push('（部分文件因总量过大未读取）')
      return out.join('\n')
    }

    function AttachControl(props) {
      const [open, setOpen] = React.useState(false)
      const [cwd, setCwd] = React.useState('')
      const [dirs, setDirs] = React.useState([])
      const [files, setFiles] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState({})
      const [busy, setBusy] = React.useState(false)

      const loadDir = async (path) => {
        setLoading(true); setError('')
        try {
          const res = await host.call('attachfs/list', { path: path })
          if (res && res.ok) {
            setCwd(res.path || path)
            setDirs(res.dirs || [])
            setFiles(res.files || [])
          } else {
            setError((res && res.error) || '无法读取目录')
          }
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setLoading(false)
        }
      }

      const openPicker = async () => {
        setOpen(true); setSelected({}); setError('')
        try {
          const r = await host.call('attachfs/root', { sessionId: props.sessionId })
          await loadDir((r && r.root) || '')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }

      const toggle = (entry) => {
        setSelected((prev) => {
          const next = Object.assign({}, prev)
          if (next[entry.path]) delete next[entry.path]
          else next[entry.path] = entry
          return next
        })
      }

      const gotoParent = () => {
        const p = parentPath(cwd)
        if (p && p !== cwd) loadDir(p)
      }

      const addToDraft = async () => {
        const sels = Object.keys(selected).map((k) => selected[k])
        if (sels.length === 0) return
        setBusy(true); setError('')
        try {
          const res = await host.call('attachfs/gather', { selections: sels })
          if (res && res.ok) {
            const text = formatMessage(res)
            const cur = props.input ? props.input.draft : ''
            const draft = cur ? cur + '\n\n' + text : text
            if (props.inputActions) props.inputActions.setDraft(draft)
            setOpen(false)
          } else {
            setError((res && res.error) || '读取失败')
          }
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      const row = (entry, isDir) => {
        const checked = !!selected[entry.path]
        return React.createElement('div', {
          className: 'dsh-attach-row',
          onClick: () => toggle(entry),
          key: entry.path,
        },
          React.createElement('input', { type: 'checkbox', checked: checked, readOnly: true }),
          React.createElement('span', { className: 'dsh-attach-name' },
            (isDir ? '📁 ' : '📄 ') + entry.name),
          isDir
            ? React.createElement('button', {
                className: 'dsh-attach-ghost',
                style: { padding: '2px 8px', fontSize: '11px' },
                onClick: (e) => { e.stopPropagation(); loadDir(entry.path) },
              }, '进入')
            : React.createElement('span', { className: 'dsh-attach-size' }, fmtSize(entry.size)),
        )
      }

      const selCount = Object.keys(selected).length

      const btn = React.createElement('button', {
        className: 'dsh-attach-btn',
        title: '添加文件/目录到对话',
        onClick: openPicker,
      }, '📁 添加文件')

      if (!open) return btn

      const listChildren = []
      if (loading) {
        listChildren.push(React.createElement('div', { className: 'dsh-attach-empty', key: 'loading' }, '加载中…'))
      } else if (dirs.length === 0 && files.length === 0) {
        listChildren.push(React.createElement('div', { className: 'dsh-attach-empty', key: 'empty' }, '（空目录）'))
      } else {
        if (dirs.length > 0) {
          listChildren.push(React.createElement('div', { className: 'dsh-attach-section', key: 's-dir' }, '目录'))
          for (const d of dirs) listChildren.push(row(d, true))
        }
        if (files.length > 0) {
          listChildren.push(React.createElement('div', { className: 'dsh-attach-section', key: 's-file' }, '文件'))
          for (const f of files) listChildren.push(row(f, false))
        }
      }

      const panel = React.createElement('div', {
        className: 'dsh-attach-panel',
        onClick: (e) => e.stopPropagation(),
      },
        React.createElement('div', { className: 'dsh-attach-head' },
          React.createElement('div', { className: 'dsh-attach-title' }, '添加文件 / 目录到对话'),
          React.createElement('button', {
            className: 'dsh-attach-close',
            onClick: () => setOpen(false),
            title: '关闭',
          }, '×'),
        ),
        React.createElement('div', { className: 'dsh-attach-pathbar' },
          React.createElement('button', { className: 'dsh-attach-ghost', onClick: gotoParent }, '⬆ 上级'),
          React.createElement('div', { className: 'dsh-attach-path' },
            React.createElement('input', {
              value: cwd,
              onChange: (e) => setCwd(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') loadDir(cwd) },
              placeholder: '输入绝对路径后回车',
            }),
          ),
          React.createElement('button', { className: 'dsh-attach-ghost', onClick: () => loadDir(cwd) }, '前往'),
        ),
        error ? React.createElement('div', { className: 'dsh-attach-error' }, error) : null,
        React.createElement('div', { className: 'dsh-attach-list' }, listChildren),
        React.createElement('div', { className: 'dsh-attach-foot' },
          React.createElement('div', { className: 'dsh-attach-title' }, '已选 ' + selCount + ' 项'),
          React.createElement('div', { className: 'dsh-attach-actions' },
            React.createElement('button', { className: 'dsh-attach-ghost', onClick: () => setOpen(false) }, '取消'),
            React.createElement('button', {
              className: 'dsh-attach-primary',
              onClick: addToDraft,
              disabled: selCount === 0 || busy,
            }, busy ? '读取中…' : '添加到对话'),
          ),
        ),
      )

      const backdrop = React.createElement('div', {
        className: 'dsh-attach-backdrop',
        onClick: () => { if (!busy) setOpen(false) },
      }, panel)

      return React.createElement(React.Fragment, null, btn, backdrop)
    }

    slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'attach-files', label: '添加文件/目录' },
      (props) => React.createElement(AttachControl, props),
    ))
  },
}
