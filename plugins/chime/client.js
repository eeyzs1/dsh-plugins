return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 共享内存态音量（0..1）。动态插件是进程本地的，重启后会回到默认值；
    // 不使用持久化设置后端。
    let volume = 0.35

    // 惰性创建的 Web Audio 上下文，随本次运行生命周期，dispose 时关闭。
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
        try { audioCtx.close() } catch (e) {}
        audioCtx = null
      }
    })

    // 现场合成短提示音：'done' 用上行双音，'action' 用下行双音，便于区分。
    const playChime = (kind) => {
      const peak = Math.max(0, Math.min(1, volume))
      if (peak <= 0.0001) return // 静音
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

    // --- 全局通知器：挂在根级常驻槽 shell.overlay，监听「会话列表」而非单个会话 ---
    // 会话列表的 SessionSummary 自带 running / pendingInteraction / completed，
    // 因此无论你正看着哪个对话，任何对话的回合完成或需要输入都能触发。
    const Notifier = (props) => {
      const useSessions = props.useSessions
      const list = useSessions((s) => s)

      // 提前解锁音频，避免浏览器自动播放策略吞掉第一声。
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
          if (!b) continue // 通知器挂载后才出现的会话，首次不响
          if (!b.done && a.done) playChime('done')         // 任一对话回合完成
          if (!b.pending && a.pending) playChime('action') // 任一对话需要选择
        }
        prev.current = cur
      }, [list])

      return null
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'turn-sound', order: 0 },
      (props) => React.createElement(Notifier, { useSessions: props.useSessions }),
    ))

    // --- 设置 > 常规 里的音量行 ---
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

    slots.inject('settings.general.item', () => slots.register(
      { name: 'settings.general.item', id: 'turn-sound-volume', order: 30 },
      () => React.createElement(VolumeRow),
    ))
  },
}
