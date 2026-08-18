// Client half of @eeyzs1/dsh-chime — CJS module body.
// `build.mjs` wraps this file as window.__ModuleLoader__.load({ id, factory }).
// Do not use ESM import/export here; the browser loads the built artifact as a classic script.
const React = require('react')

exports.inject = ['slots']

exports.apply = function apply(ctx) {
  let volume = 0.5

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

  // Shared overlay flash state so the user can distinguish "sound fired but too
  // quiet / muted" from "sound never fired at all": each chime paints a brief
  // dot in the top-right corner.
  const flashListeners = []
  const fireFlash = () => { flashListeners.forEach((fn) => fn()) }

  const playChime = (kind) => {
    // Louder perceptual curve than before, plus a low floor so even small
    // slider values stay audible: amplitude = max(0.06, volume^1.2 * 1.9).
    const raw = Math.pow(Math.max(0, Math.min(1, volume)), 1.2) * 1.9
    const peak = Math.max(0.06, Math.min(1, raw))
    const ac = getAudioCtx()
    if (ac === null) return
    fireFlash()

    // Each note is a sine plus its octave (2x) for a brighter, harder-to-miss
    // timbre; 'action' repeats the pair to grab attention, 'done' plays a
    // short ascending triad.
    const synth = (freq, at, dur, vol) => {
      [freq, freq * 2].forEach((f, i) => {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = i === 0 ? 'sine' : 'triangle'
        osc.frequency.setValueAtTime(f, at)
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(vol * peak, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
        osc.connect(gain)
        gain.connect(ac.destination)
        osc.start(at)
        osc.stop(at + dur + 0.05)
      })
    }

    const t0 = ac.currentTime
    if (kind === 'done') {
      // 659 → 784 → 988 (E5 → G5 → B5), short and bright.
      const seq = [[659.25, 0, 0.13], [783.99, 0.14, 0.13], [987.77, 0.28, 0.22]]
      seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.7))
    } else {
      // Repeated descending pair — clearly different and more noticeable.
      const seq = [[880, 0, 0.12], [440, 0.11, 0.16], [880, 0.28, 0.12], [440, 0.39, 0.2]]
      seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.85))
    }
  }

  // Visual flash dot: a small "ping" painted in the top-right when a chime
  // fires, so the user can tell audio-firing apart from audio-too-quiet/muted.
  function FlashDot() {
    const [visible, setVisible] = React.useState(false)
    React.useEffect(() => {
      if (!visible) return
      const t = setTimeout(() => setVisible(false), 600)
      return () => clearTimeout(t)
    }, [visible])
    React.useEffect(() => {
      const onFlash = () => setVisible(true)
      flashListeners.push(onFlash)
      return () => {
        const i = flashListeners.indexOf(onFlash)
        if (i >= 0) flashListeners.splice(i, 1)
      }
    }, [])
    return visible
      ? React.createElement('div', {
          style: {
            position: 'fixed',
            top: '14px',
            right: '14px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#f59e0b',
            opacity: 0.9,
            zIndex: 2147483647,
            pointerEvents: 'none',
            boxShadow: '0 0 12px 3px rgba(245,158,11,.8)',
          },
        })
      : null
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

    return React.createElement(FlashDot)
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
