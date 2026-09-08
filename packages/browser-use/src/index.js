// @eeyzs1/dsh-browser-use — Host half.
//
// Self-contained browser-use MCP integration:
//  - mounts the browser-use MCP server (via @deepseek-ai/dsh-mcp-client) with
//    BROWSER_USE_HEADLESS=true by default;
//  - registers browser_set_mode / browser_get_mode so the model can switch to
//    headed mode (visible window) when it hits login pages / human interaction;
//  - switching mode disposes the old mcp-client instance and remounts it with
//    the flipped env (the only way to change headless-ness for a stdio server).
//
// This replaces the old profile-side `mcp-browser` + `browser-mode8.cjs` setup:
// the mcp-client instance is owned HERE, so the profile only needs this one row.

import { defineTool } from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'

export const name = '@eeyzs1/dsh-browser-use'
export const inject = ['tools']

const BROWSER_USE_ARGS = ['tool', 'run', 'browser-use', '--mcp']

function browserServerConfig(mode) {
  return {
    transport: 'stdio',
    serverName: 'browser',
    command: 'uv',
    args: BROWSER_USE_ARGS,
    env: {
      ANONYMIZED_TELEMETRY: 'false',
      BROWSER_USE_HEADLESS: mode === 'headed' ? 'false' : 'true',
      SKIP_LLM_API_KEY_VERIFICATION: 'true',
      BROWSER_USE_DISABLE_EXTENSIONS: 'true',
    },
    failOnStartupError: false,
  }
}

export function apply(ctx) {
  const tools = ctx.tools // hard dependency declared via inject
  const disposers = []
  let mode = 'headless' // last SUCCESSFULLY mounted mode (what get_mode reports)
  let requestedMode = 'headless'
  let browserFiber = null
  let browserMounted = false
  // Serializes mounts: two concurrent switch requests (or a switch racing the
  // initial mount) would otherwise both spawn an mcp-client fiber and the
  // first one — a live stdio server — would leak with no reference left.
  let mountQueue = Promise.resolve()

  async function doMount(nextMode) {
    if (browserFiber) {
      try { await browserFiber.dispose() } catch (error) {
        console.error('[browser-use] dispose old server failed:', String(error))
      }
      browserFiber = null
    }
    browserMounted = false
    try {
      browserFiber = await ctx.plugin(mcpClient, browserServerConfig(nextMode))
      browserMounted = true
      mode = nextMode // report only what actually mounted
    } catch (error) {
      console.error('[browser-use] mount server failed in ' + nextMode + ' mode:', String(error))
      browserFiber = null
    }
  }

  function mountBrowser(nextMode) {
    requestedMode = nextMode
    mountQueue = mountQueue.then(() => doMount(nextMode), () => doMount(nextMode))
    return mountQueue
  }

  disposers.push(tools.register(defineTool({
    name: 'browser_set_mode',
    description: 'Switch the browser between headless (background) and headed (visible window) mode and reconnect the browser. Use headed mode when a page requires login, a CAPTCHA, a human confirmation, or any interaction that a headless browser cannot complete — the window will appear for the user. Use headless mode to get back to quiet background automation.',
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['headless', 'headed'],
        description: 'headless = no visible window (default); headed = visible browser window for the user.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          reconnected: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: 'Browser switched to ' + value.mode + ' mode' + (value.reconnected ? '' : ' (reconnect pending)'),
      }],
    },
    async execute(args) {
      const next = args.mode === 'headed' ? 'headed' : 'headless'
      await mountBrowser(next)
      // mode is the last SUCCESSFULLY mounted mode; if the remount failed the
      // tool says so via reconnected:false instead of claiming the new mode.
      return { mode, reconnected: browserMounted && mode === next }
    },
  })))

  disposers.push(tools.register(defineTool({
    name: 'browser_get_mode',
    description: 'Report whether the browser is currently in headless or headed mode.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          mounted: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: 'Browser mode: ' + value.mode + (value.mounted ? '' : ' (server not mounted)') }],
    },
    async execute() {
      return { mode, mounted: browserMounted }
    },
  })))

  // Initial mount: headless background automation by default.
  void mountBrowser('headless')

  return async () => {
    for (const dispose of disposers) {
      try { dispose() } catch (error) { /* ignore */ }
    }
    // Wait for any mount still in flight FIRST, then take whatever fiber the
    // queue left — capturing earlier would miss a fiber the queued mount sets.
    try {
      await mountQueue
    } catch { /* queued mount already reported its own failure */ }
    const fiber = browserFiber
    browserFiber = null
    if (fiber) {
      try { await fiber.dispose() } catch (error) { /* ignore */ }
    }
  }
}
