// @eeyzs1/dsh-llm-transport-recovery — Host half (v2: direct connection reset).
//
// What this fixes (evidence from the user's session logs):
//   The DeepSeek adapter issues model requests through Node's global `fetch`
//   (undici keep-alive pool). Intermittently, ALL conversations fail at once
//   with code TRANSPORT ("DeepSeek API request to https://api.deepseek.com
//   failed") in ~30-50ms, every retry fails the same way, "continue" fails too,
//   and only a DSH restart recovers. The built-in retry policy (5 retries,
//   ~15s budget) then kills the turn with "本轮运行失败".
//
// Node 26 does NOT expose undici's global dispatcher for reset
// (Symbol.for('undici.globalDispatcher.1') is decorative; close() is terminal;
// node:undici is not importable). So "reset the connection" is implemented as
// the next best thing, which is strictly stronger:
//
//   1. DIRECT CONNECTION RESET — every request to *.deepseek.com is re-routed
//      through node:https with `agent: false`: a brand-new TCP+TLS connection
//      per request, no shared pool, no stale sockets, no DNS/socket state to
//      poison. What a restart does once, this does on every request.
//      (Requests with FormData/stream bodies — the Files API image upload —
//      are passed through to the original fetch untouched.)
//
//   2. SAFETY-NET RETRY — if a fresh connection still fails (network path
//      genuinely down for a window), take over TRANSPORT/TIMEOUT after the
//      built-in 5-retry budget is exhausted and keep retrying with capped
//      exponential backoff (0.5s → 15s, ±20% jitter) until success, cancel,
//      or a generous safety cap. The turn auto-continues — no restart needed.
//
//   3. DIAGNOSTICS — log the full error chain (which the durable LlmFailure
//      surface strips) to the host console so the exact underlying cause is
//      captured next time.

import https from 'node:https'
import { Readable } from 'node:stream'
import dns from 'node:dns'

export const name = '@eeyzs1/dsh-llm-transport-recovery'
export const inject = ['timer']

const DEEPSEEK_HOSTS = new Set(['api.deepseek.com'])
const WRAP_SYMBOL = Symbol.for('dsh.llmtrc.fetch-wrapped')

/** Render an error with its full `cause` chain (module-scope copy used by the fetch wrapper). */
function renderChainSafe(value) {
  const parts = []
  const seen = new Set()
  let cur = value
  while (cur !== null && cur !== undefined && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    let msg = ''
    if (cur instanceof Error) msg = cur.message
    else if (typeof cur.message === 'string') msg = cur.message
    parts.push(msg || String(cur))
    cur = cur.cause
  }
  return parts.join(' : ')
}

const MAX_ATTEMPTS = 200
const MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours per burst
const INITIAL_DELAY_MS = 500
const MAX_DELAY_MS = 15000
const JITTER = 0.2
const POLICY_KEY = JSON.stringify(['llm-transport-recovery', INITIAL_DELAY_MS, MAX_DELAY_MS, JITTER])

// After a transport failure we stay in "recovery mode" (fresh DNS + fresh
// connection + IP fallback) for this long, then return to the zero-overhead
// fast path (undici keep-alive). Bounds both flapping and overhead.
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000
const fetchState = { mode: 'normal', recoveryUntil: 0, workingIp: null }

/** Fresh DNS resolution (bypasses the process/OS cached entry that "restart" clears). */
function resolveFresh(hostname) {
  return new Promise((resolve) => {
    // Direct resolver first: queries DNS without the OS cache, like a fresh process would.
    dns.resolve4(hostname, (error, ips) => {
      if (!error && ips && ips.length > 0) {
        resolve(ips)
        return
      }
      dns.lookup(hostname, { all: true, verbatim: true }, (error2, addresses) => {
        if (!error2 && addresses && addresses.length > 0) resolve(addresses.map(a => a.address))
        else resolve([])
      })
    })
  })
}

/**
 * Recovery path — used ONLY after a transport failure (and for a short cooldown
 * after it): tries the last known-good IP first, otherwise re-resolves DNS fresh
 * and tries every IP with a brand-new TLS connection until one works.
 */
function recoveryFetch(input, init) {
  const u = new URL(typeof input === 'string' ? input : input.url)
  const method = (init?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers || {})
  const body = init?.body
  if (typeof body === 'string' && !headers.has('content-length')) {
    headers.set('content-length', String(Buffer.byteLength(body)))
  }
  headers.set('connection', 'close')
  if (!headers.has('host')) headers.set('host', u.hostname)
  const signal = init?.signal
  const port = u.port || 443
  const path = u.pathname + u.search

  function attempt(ip) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: ip, // connect directly to this resolved IP
        port,
        path,
        method,
        headers: Object.fromEntries(headers.entries()),
        servername: u.hostname, // SNI must carry the real hostname for TLS
        agent: false, // fresh connection per request — no pool, no stale sockets
        signal,
      }, (res) => {
        // Response headers arrived: this IP works — keep this connection for streaming.
        clearTimeout(idle)
        const resHeaders = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) { for (const item of v) resHeaders.append(k, item) }
          else if (v !== undefined) resHeaders.set(k, String(v))
        }
        resolve(new Response(Readable.toWeb(res), {
          status: res.statusCode ?? 200,
          statusText: res.statusMessage ?? '',
          headers: resHeaders,
        }))
      })
      // Bound the connect+TLS+headers phase per IP so a dead/slow IP does not
      // block the fallback; once 'response' fires the stream owns its lifetime.
      const idle = setTimeout(() => {
        req.destroy(new Error('connect timeout to ' + ip))
      }, 6000)
      req.on('error', (error) => { clearTimeout(idle); reject(error) })
      if (typeof body === 'string') req.write(body)
      req.end()
    })
  }

  return (async () => {
    const tried = new Set()
    // 1) Last known-good IP first: usually the fastest correct choice.
    if (fetchState.workingIp) {
      tried.add(fetchState.workingIp)
      try {
        const ok = await attempt(fetchState.workingIp)
        return ok
      } catch (error) {
        if (signal?.aborted) throw error
        console.error('[llm-transport-recovery] known-good IP ' + fetchState.workingIp +
          ' failed: ' + renderChainSafe(error))
      }
    }
    // 2) Fresh DNS (bypasses caches, like a restart would) + every IP until one works.
    const ips = await resolveFresh(u.hostname)
    if (ips.length === 0) {
      throw new Error('DNS resolution failed for ' + u.hostname)
    }
    let lastError = null
    for (const ip of ips) {
      if (tried.has(ip)) continue
      if (signal?.aborted) {
        const err = new Error('request aborted')
        err.name = 'AbortError'
        throw err
      }
      try {
        const ok = await attempt(ip)
        fetchState.workingIp = ip
        return ok
      } catch (error) {
        lastError = error
        if (signal?.aborted) throw error
        console.error('[llm-transport-recovery] IP ' + ip + ' failed: ' + renderChainSafe(error))
      }
    }
    console.error('[llm-transport-recovery] all IPs failed for ' + u.hostname +
      ' | IPs=' + ips.join(',') + ' | ' + renderChainSafe(lastError))
    throw lastError
  })()
}

/**
 * Install the resilient fetch wrapper ONCE.
 *
 * Fast path (zero overhead): deepseek requests go through the ORIGINAL undici
 * fetch — keep-alive, cached resolution — exactly the normal behavior.
 *
 * On a network-level failure (fetch rejects = TRANSPORT-class), the wrapper
 * switches to recovery mode: re-resolves DNS fresh, tries the last known-good
 * IP first then every resolved IP with a brand-new TLS connection, and returns
 * the recovered response. Recovery mode lasts RECOVERY_COOLDOWN_MS, then the
 * fast path resumes. If recovery also fails, the original error propagates and
 * the agent/request-error safety-net backoff takes over.
 */
function installResilientFetch() {
  const originalFetch = globalThis.fetch
  if (typeof originalFetch !== 'function' || globalThis[WRAP_SYMBOL] === true) return
  globalThis[WRAP_SYMBOL] = true
  globalThis.fetch = async function (...args) {
    let input = null
    let init = null
    try {
      input = args[0]
      init = args[1]
      let host = ''
      if (typeof input === 'string') {
        try { host = new URL(input).host } catch { /* keep empty */ }
      } else if (input instanceof URL) {
        host = input.host
      } else if (input && typeof input === 'object' && typeof input.url === 'string') {
        try { host = new URL(input.url).host } catch { /* keep empty */ }
      }
      const isDeepseek = DEEPSEEK_HOSTS.has(host) || host.endsWith('.deepseek.com')
      // FormData/stream bodies (Files upload) stay on the original fetch — the
      // recovery path only handles plain-string bodies (chat completions etc.).
      const body = init?.body
      const plainBody = body === undefined || body === null || typeof body === 'string'
      if (!isDeepseek || !plainBody) return originalFetch.apply(this, args)

      if (fetchState.mode === 'recovering' && Date.now() > fetchState.recoveryUntil) {
        fetchState.mode = 'normal'
      }
      if (fetchState.mode === 'normal') {
        try {
          return await originalFetch.apply(this, args)
        } catch (error) {
          // Network-level failure (fetch only rejects on transport errors):
          // engage recovery immediately — one bad IP should cost one attempt,
          // not 122 like undici's cached resolution did.
          fetchState.mode = 'recovering'
          fetchState.recoveryUntil = Date.now() + RECOVERY_COOLDOWN_MS
          console.error('[llm-transport-recovery] transport failure → recovery mode: ' + renderChainSafe(error))
          return recoveryFetch(input, init)
        }
      }
      // Recovery mode: fresh DNS + IP fallback + fresh connection.
      try {
        return await recoveryFetch(input, init)
      } catch (error) {
        if (Date.now() > fetchState.recoveryUntil) fetchState.mode = 'normal'
        throw error
      }
    } catch (error) {
      console.error('[llm-transport-recovery] fetch wrapper error:', String(error))
      return originalFetch.apply(this, args)
    }
  }
}

export function apply(ctx) {
  installResilientFetch()

  const chains = new Map()
  let seq = 0

  function renderChain(value) {
    const parts = []
    const seen = new Set()
    let cur = value
    while (cur !== null && cur !== undefined && typeof cur === 'object' && !seen.has(cur)) {
      seen.add(cur)
      let msg = ''
      if (cur instanceof Error) msg = cur.message
      else if (typeof cur.message === 'string') msg = cur.message
      parts.push(msg || String(cur))
      cur = cur.cause
    }
    return parts.join(' : ')
  }

  function newRetryId() {
    seq += 1
    return 'llmtrc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + seq
  }

  function cancellableSleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal.aborted) { resolve(false); return }
      let disposer = null
      const onAbort = () => {
        if (disposer) disposer()
        resolve(false)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        disposer = ctx.timeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        }, ms)
      } catch (error) {
        signal.removeEventListener('abort', onAbort)
        console.error('[llm-transport-recovery] timer failed:', String(error))
        resolve(false)
      }
    })
  }

  const disposers = []

  // 1) Safety-net retry: prepended so TRANSPORT/TIMEOUT is handled IMMEDIATELY
  //    (fresh-connection retry is meaningful right away), instead of waiting for
  //    the built-in 5-retry budget to exhaust. Other codes delegate via next().
  disposers.push(ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
    try {
      const code = failure.code
      if (code !== 'TRANSPORT' && code !== 'TIMEOUT') return next()

      const key = agent.id + '|' + turn + '|' + step + '|' + provider
      let chain = chains.get(key)
      if (chain === undefined) {
        chain = { retryId: newRetryId(), count: 0, since: Date.now() }
        chains.set(key, chain)
      }
      chain.count += 1
      const ageMs = Date.now() - chain.since
      if (chain.count > MAX_ATTEMPTS || ageMs > MAX_AGE_MS) {
        console.error('[llm-transport-recovery] giving up on ' + provider + ' ' + code +
          ' after ' + chain.count + ' attempts (' + Math.round(ageMs / 60000) + ' min)')
        chains.delete(key)
        return next()
      }
      if (chains.size > 512) {
        for (const [k, v] of chains) if (Date.now() - v.since > MAX_AGE_MS) chains.delete(k)
      }

      const exponent = Math.min(chain.count - 1, 6)
      const base = Math.min(INITIAL_DELAY_MS * Math.pow(2, exponent), MAX_DELAY_MS)
      const delay = Math.min(base * (1 - JITTER + 2 * JITTER * Math.random()), MAX_DELAY_MS)

      // Durable, GUI-visible record (always-style chain under our own policy key).
      try {
        agent.session.append('llm/retry', {
          retryId: chain.retryId,
          turn, step, provider,
          mode: 'always',
          policyKey: POLICY_KEY,
          retry: chain.count,
          delayMs: delay,
          failure: { message: failure.message, code: failure.code },
        })
      } catch (error) {
        console.error('[llm-transport-recovery] append llm/retry failed:', String(error))
      }

      console.error('[llm-transport-recovery] ' + code + ' attempt ' + chain.count + ' for ' + provider +
        ' (' + agent.id + ' turn ' + turn + ' step ' + step + '): ' + failure.message +
        ' — fresh-connection retry in ' + Math.round(delay) + 'ms')

      const waited = await cancellableSleep(delay, signal)
      if (!waited) return undefined
      try {
        agent.session.append('llm/retry-started', { retryId: chain.retryId, turn, step, retry: chain.count })
      } catch (error) {
        console.error('[llm-transport-recovery] append llm/retry-started failed:', String(error))
      }
      return { kind: 'retry' }
    } catch (error) {
      console.error('[llm-transport-recovery] listener error:', String(error))
      return next()
    }
  }, { prepend: true }))

  // 2) Diagnosis: capture the full error chain of every failed stream (the LlmFailure
  //    surface strips `cause`, so this wrapper is the only place that sees it live).
  disposers.push(ctx.on('llm/stream', (options, next) => {
    let inner
    try {
      inner = next()
    } catch (error) {
      console.error('[llm-transport-recovery] llm/stream next failed:', renderChain(error))
      throw error
    }
    return (async function* () {
      try {
        for await (const chunk of inner) yield chunk
      } catch (error) {
        const msg = renderChain(error)
        if (/(failed|TRANSPORT|TIMEOUT|ECONNRESET|ETIMEDOUT|fetch|terminated|socket)/i.test(msg)) {
          console.error('[llm-transport-recovery] stream error cause: ' + msg)
        }
        throw error
      }
    })()
  }))

  // 3) Diagnosis at turn death (only reachable when recovery gives up or the
  //    failure class is not recoverable).
  disposers.push(ctx.on('agent/error', ({ agent, turn, step, error }) => {
    try {
      console.error('[llm-transport-recovery] agent ' + agent.id + ' turn ' + turn + ' step ' + step +
        ' final: ' + renderChain(error))
    } catch (error) {
      console.error('[llm-transport-recovery] agent/error logging failed:', String(error))
    }
  }))

  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch (error) { /* ignore */ }
    }
    chains.clear()
  }
}
