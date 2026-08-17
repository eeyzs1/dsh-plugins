window.__ModuleLoader__.load({ id: "@eeyzs1/dsh-chime", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// Client half of @eeyzs1/dsh-chime — CJS module body.
// `build.mjs` wraps this file as window.__ModuleLoader__.load({ id, factory }).
// Do not use ESM import/export here; the browser loads the built artifact as a classic script.
const React = require('react')

exports.inject = ['slots']

exports.apply = function apply(ctx) {
  let volume = 0.35

  let audioCtx = null
  const getAudioCtx = () => {
    if (audioCtx === null) {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null
      if (!AC) return null
      audioCtx = new AC()
    }
    if (audioCtx !== null && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  }
  ctx.effect(() => () => {
    if (audioCtx !== null) {
      try { audioCtx.close() } catch {
        // AudioContext.close can throw after the document is already tearing down.
      }
      audioCtx = null
    }
  })

  const playChime = (kind) => {
    const peak = Math.max(0, Math.min(1, volume))
    if (peak <= 0.0001) return
    const ac = getAudioCtx()
    if (ac === null) return
    const notes = kind === 'done'
      ? [{ f: 659.25, at: 0, d: 0.14 }, { f: 880, at: 0.15, d: 0.22 }]
      : [{ f: 880, at: 0, d: 0.10 }, { f: 440, at: 0.12, d: 0.18 }]
    const t0 = ac.currentTime
    notes.forEach((n) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(n.f, t0 + n.at)
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.d)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.d + 0.03)
    })
  }

  const Notifier = (props) => {
    const useSessions = props.useSessions
    const list = useSessions((s) => s)

    React.useEffect(() => { getAudioCtx() }, [])

    const prev = React.useRef(null)
    React.useEffect(() => {
      const byId = (list && list.byId) ? list.byId : {}
      const cur = {}
      for (const id in byId) {
        const s = byId[id]
        if (!s) continue
        cur[id] = {
          done: !s.running || !!s.completed,
          pending: !!s.pendingInteraction,
        }
      }
      if (prev.current === null) { prev.current = cur; return }
      const before = prev.current
      for (const id in cur) {
        const b = before[id]
        const a = cur[id]
        if (!b) continue
        if (!b.done && a.done) playChime('done')
        if (!b.pending && a.pending) playChime('action')
      }
      prev.current = cur
    }, [list])

    return null
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'turn-sound', order: 0 },
    (props) => React.createElement(Notifier, { useSessions: props.useSessions }),
  ))

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '4px 0',
    color: 'inherit',
  }
  const labelStyle = { fontSize: '14px', whiteSpace: 'nowrap' }
  const sliderStyle = { flex: '1', minWidth: '120px' }
  const valueStyle = { width: '3.2em', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '13px' }
  const btnStyle = {
    padding: '4px 10px',
    border: '1px solid currentColor',
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
  }

  const VolumeRow = () => {
    const [pct, setPct] = React.useState(Math.round(volume * 100))
    const onChange = (e) => {
      const v = Number(e.target.value)
      setPct(v)
      volume = v / 100
    }
    const onTest = () => { playChime('done') }
    return React.createElement(
      'div',
      { style: rowStyle },
      React.createElement('span', { style: labelStyle }, '提示音音量'),
      React.createElement('input', {
        type: 'range',
        min: '0',
        max: '100',
        step: '1',
        value: String(pct),
        onChange,
        style: sliderStyle,
        'aria-label': '提示音音量',
      }),
      React.createElement('span', { style: valueStyle }, pct + '%'),
      React.createElement('button', { type: 'button', onClick: onTest, style: btnStyle }, '试听'),
    )
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register(
    { name: 'settings.general.item', id: 'turn-sound-volume', order: 30 },
    () => React.createElement(VolumeRow),
  ))
}

return module.exports;
} });
