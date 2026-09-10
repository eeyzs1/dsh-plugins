return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 共享内存态音量（0..1）。动态插件是进程本地的，重启后会回到默认值；
    // 不使用持久化设置后端。
    let volume = 0.5

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

    // Safari unlock: unlike Chrome, WebKit only lets AudioContext.resume()
    // succeed when called INSIDE a real user gesture. The context is created at
    // mount (no gesture), so programmatic resume() from playChime is silently
    // rejected and chimes stay mute. Hook the first pointerdown/keydown/touchend
    // and resume there; detach once running.
    const unlockEvents = ['pointerdown', 'keydown', 'touchend']
    const detachUnlock = () => {
      unlockEvents.forEach((e) => window.removeEventListener(e, onGesture, true))
    }
    const onGesture = () => {
      if (audioCtx === null) return
      if (audioCtx.state !== 'suspended') { detachUnlock(); return }
      audioCtx.resume().then(() => {
        if (audioCtx !== null && audioCtx.state === 'running') detachUnlock()
      }, () => {})
    }
    unlockEvents.forEach((e) => window.addEventListener(e, onGesture, { capture: true, passive: true }))

    ctx.effect(() => () => {
      detachUnlock()
      if (audioCtx !== null) {
        try { audioCtx.close() } catch (e) {}
        audioCtx = null
      }
    })

    // 现场合成短提示音：'done' 上行三音，'action' 重复下行双音，便于区分。
    const playChime = (kind) => {
      // 音量 0 = 静音；非零时滑杆线性映射到感知响度（sones ∝ A^0.6，Stevens
      // 幂律），故振幅 = (0.05 + 0.95·v)^(5/3)：每格等响度步进、全程 ~28 dB、
      // 无死区。旧 v^1.2·1.9 曲线 ≥60% 全部钳到 1.0（顶部 40% 无效）、
      // 0-7% 贴 0.08 地板。
      if (volume <= 0.0001) return
      const v = Math.max(0, Math.min(1, volume))
      const peak = Math.pow(0.05 + 0.95 * v, 5 / 3)
      const ac = getAudioCtx()
      // 上下文仍挂起时（Safari 未解锁 / 自动播放策略）直接跳过：冻结时钟上
      // 排下的音符会在解锁瞬间一齐炸响。
      if (ac === null || ac.state !== 'running') return

      // 每个音符 = 正弦 + 两个八度（更亮、更难忽略）；'done' 上行三音，
      // 'action' 重复下行双音。
      const synth = (freq, at, dur, vol) => {
        ;[freq, freq * 2].forEach((f, i) => {
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
        const seq = [[659.25, 0, 0.16], [783.99, 0.17, 0.16], [987.77, 0.34, 0.28]]
        seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.75))
      } else {
        const seq = [[880, 0, 0.13], [440, 0.13, 0.18], [880, 0.34, 0.13], [440, 0.47, 0.24]]
        seq.forEach(([f, at, d]) => synth(f, t0 + at, d, 0.85))
      }
    }

    // Fallback hook：让 Notifier 内的 hook 调用无条件执行（Rules of Hooks），
    // 而不是按 prop 是否存在分支。
    const EMPTY_PENDING = new Map()
    const useNoPending = () => EMPTY_PENDING

    // --- 全局通知器：挂在根级常驻槽 shell.overlay，监听「会话列表」+ 待互动映射 ---
    const Notifier = (props) => {
      const useSessions = props.useSessions
      const list = useSessions((s) => s)
      // 待互动状态位于独立根 observable（useSessionPendingInteraction），
      // 不在会话摘要里。这里一次性解析，下面的 hook 调用保持无条件。
      const usePending = props.useSessionPendingInteraction || useNoPending
      const pendingMap = usePending((m) => m)

      React.useEffect(() => { getAudioCtx() }, [])

      const prev = React.useRef(null)
      React.useEffect(() => {
        const byId = (list && list.byId) ? list.byId : {}
        const cur = {}
        for (const id in byId) {
          const s = byId[id]
          if (!s) continue
          // Goal projection: { goal: { phase }, roundsStarted, ... } or null.
          const gp = (s.projectionValues && s.projectionValues.goal) || null
          const hasGoal = !!gp
          const phase = gp ? (gp.goal && gp.goal.phase) : undefined
          const roundsStarted = gp ? gp.roundsStarted : 0
          const maxRounds = gp && gp.goal ? gp.goal.maxGoalRounds : 0

          // 仅在 goal 仍处于 active 且自动续轮预算未尽时抑制逐轮 'done'：
          // 其余状态（无 goal、complete/blocked/paused、预算耗尽）回落到普通
          // 回合结束提示音。
          const autoGoal = hasGoal && phase === 'active'
            && !(maxRounds > 0 && roundsStarted >= maxRounds)

          // 子代理会话不响 'done'（其生命周期是内部工作，父会话的回合结束音
          // 才是用户可感知的信号）。待互动提示音刻意不过滤 —— 被卡住的子代理
          // 仍需要用户注意。
          const isSubagent = s.origin === 'subagent'

          cur[id] = {
            done: autoGoal || isSubagent ? false : (!s.running || !!s.completed),
            pending: false,
          }
        }
        // 待互动来源：任何有待互动的会话。
        if (pendingMap.size > 0) {
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
          if (!b) continue // 通知器挂载后才出现的会话，首次不响
          if (!b.done && a.done) playChime('done')         // 任一对话回合完成
          if (!b.pending && a.pending) playChime('action') // 任一对话需要用户输入
        }
        prev.current = cur
      }, [list, pendingMap])

      return null
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'turn-sound', order: 0 },
      // 两个标准 prop 都必须转发：useSessionPendingInteraction 是 shell.overlay
      // 的根级标准源，漏传会静默禁用待互动提示音。
      (props) => React.createElement(Notifier, {
        useSessions: props.useSessions,
        useSessionPendingInteraction: props.useSessionPendingInteraction,
      }),
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
