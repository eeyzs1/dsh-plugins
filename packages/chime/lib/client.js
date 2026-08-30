window.__ModuleLoader__.load({ id: "@eeyzs1/dsh-chime", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
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

  // no flash overlay — the user is away from the screen and relies on audio

  const playChime = (kind) => {
    // Audible at any reasonable setting exactly because the user is usually NOT
    // looking at the screen. A loud-enough floor plus a brighter timbre.
    const raw = Math.pow(Math.max(0, Math.min(1, volume)), 1.2) * 1.9
    const peak = Math.max(0.08, Math.min(1, raw))
    const ac = getAudioCtx()
    if (ac === null) return

    // Each note = sine plus its octave (2x) for a brighter, harder-to-miss
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
      // 659 → 784 → 988 (E5 → G5 → B5), a bit longer so it carries.
      const seq = [[659.25, 0, 0.16], [783.99, 0.17, 0.16], [987.77, 0.34, 0.28]]
      seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.75))
    } else {
      // Repeated descending pair — clearly different and more noticeable.
      const seq = [[880, 0, 0.13], [440, 0.13, 0.18], [880, 0.34, 0.13], [440, 0.47, 0.24]]
      seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.85))
    }
  }

  const Notifier = (props) => {
    const useSessions = props.useSessions
    const list = useSessions((s) => s)
    // Pending interactions now live in a separate root observable
    // (useSessionPendingInteraction) instead of the session summary.
    const usePending = typeof props.useSessionPendingInteraction === 'function'
      ? props.useSessionPendingInteraction
      : null
    const pendingMap = usePending ? usePending((m) => m) : null

    React.useEffect(() => { getAudioCtx() }, [])

    const prev = React.useRef(null)
    React.useEffect(() => {
      const byId = (list && list.byId) ? list.byId : {}
      const cur = {}
      for (const id in byId) {
        const s = byId[id]
        if (!s) continue
        // Goal projection (when under a goal): { goal:{ phase }, roundsStarted, ... }
        // or null/absent when none. Read the phase and the round budget to know
        // whether more autonomous rounds are still expected.
        const gp = (s.projectionValues && s.projectionValues.goal) || null
        const hasGoal = !!gp
        const phase = gp ? (gp.goal && gp.goal.phase) : undefined
        const roundsStarted = gp ? gp.roundsStarted : 0
        const maxRounds = gp && gp.goal ? gp.goal.maxGoalRounds : 0

        // Suppress the per-round 'done' chime ONLY while an active goal still
        // has auto-continuation budget (it is mid-work). In every other state —
        // no goal, goal complete/blocked/paused, or budget exhausted — fall back
        // to the ordinary turn-end chime. A lingering completed goal must NOT
        // silence later normal conversations in the same session.
        const autoGoal = hasGoal && phase === 'active'
          && !(maxRounds > 0 && roundsStarted >= maxRounds)

        cur[id] = {
          done: autoGoal ? false : (!s.running || !!s.completed),
          pending: false,
        }
      }
      // Pending source: any session with a pending interaction.
      if (pendingMap && pendingMap.size > 0) {
        for (const sid of pendingMap.keys()) {
          const sidStr = String(sid)
          if (cur[sidStr]) cur[sidStr].pending = true
          else cur[sidStr] = { done: false, pending: true }
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
    }, [list, pendingMap])

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
