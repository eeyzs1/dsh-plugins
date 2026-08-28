// Host half of @eeyzs1/dsh-image-gen — image generation capability plugin.
// Registers ONE tool the agent decides when to use:
//   - generate_image: text-to-image via Zhipu CogView, saved to the workspace.
// Vision-understanding (reading images) is deliberately NOT included here:
// the main model (e.g. deepseek-v4-flash-vision-exp) already reads images
// natively via read_image, so a separate see_image tool is unnecessary.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '@eeyzs1/dsh-image-gen'
// Hard dependencies: declare them so Cordis waits for every service to be
// registered before apply runs.
export const inject = ['tools', 'shell', 'credentials']

const DEFAULT_IMAGE_MODEL = 'cogview-3-flash'
const DEFAULT_IMAGE_SIZE = '1024x1024'
const IMAGE_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/images/generations'

function q(s) {
  return String(s).replace(/'/g, "''")
}

export function apply(ctx) {
  const missing = ['tools', 'shell', 'credentials'].filter((n) => ctx.get(n) === undefined)
  if (missing.length > 0) {
    console.error('[image-gen] missing services at apply time: ' + missing.join(', '))
    return
  }
  const tools = ctx.get('tools')
  const shell = ctx.get('shell')
  const credentials = ctx.get('credentials')

  const disposers = []

  disposers.push(tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image from a text prompt and save it to a PNG/JPEG file in the workspace. Uses Zhipu CogView (default model: cogview-3-flash, fast and cheap, fine for icons/flat assets). For higher-quality or more detailed art, pass model="cogview-3". Returns the output file path; use the read_image tool to inspect the result.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image generation prompt (Chinese or English).' },
      output_path: { type: 'string', description: 'Output image path; defaults to a timestamped file in the workspace root.' },
      model: { type: 'string', description: 'Image model override. Options: cogview-3-flash (default), cogview-3.' },
      size: { type: 'string', description: 'Output size, e.g. "1024x1024" (default).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output_path: { type: 'string', required: true },
          model: { type: 'string', required: true },
          size: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: 'Generated image saved to: ' + value.output_path }],
    },
    async execute(args, exec) {
      const prompt = String(args.prompt || '').trim()
      if (prompt.length === 0) throw new Error('prompt must be a non-empty string')

      let model = DEFAULT_IMAGE_MODEL
      let size = DEFAULT_IMAGE_SIZE
      if (typeof args.model === 'string' && args.model.trim()) model = args.model.trim()
      if (typeof args.size === 'string' && args.size.trim()) size = args.size.trim()

      let outputPath = (typeof args.output_path === 'string' && args.output_path.trim()) ? args.output_path.trim() : ''
      if (outputPath.length === 0) {
        const sp = ctx.get('sandboxPolicy')
        const root = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot : ''
        const stem = 'generated_' + Date.now()
        outputPath = root ? root.replace(/[\\/]+$/, '') + '\\' + stem + '.png' : stem + '.png'
      }

      const cred = await credentials.resolve('ZHIPU_API_KEY')
      if (cred === undefined) {
        throw new Error('ZHIPU_API_KEY is not configured; set it in .credentials.yaml')
      }
      const key = cred.value

      const sp = ctx.get('sandboxPolicy')
      const policy = (sp && exec.agent) ? sp.resolve({ session: exec.agent.session }) : undefined

      const ps = [
        "$ErrorActionPreference='Stop'",
        "$key='" + q(key) + "'",
        "$headers=@{Authorization=('Bearer '+$key)}",
        "$body=@{model='" + q(model) + "';prompt='" + q(prompt) + "';size='" + q(size) + "'}|ConvertTo-Json -Compress",
        "$bytes=[System.Text.Encoding]::UTF8.GetBytes($body)",
        "$r=Invoke-RestMethod -Uri '" + IMAGE_ENDPOINT + "' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 120",
        "$url=$r.data[0].url",
        "$out='" + q(outputPath) + "'",
        "Invoke-WebRequest -Uri $url -OutFile $out -TimeoutSec 180",
        "$b=[System.IO.File]::ReadAllBytes($out)",
        "$ext='.jpg'",
        "if ($b.Length -ge 8 -and $b[0] -eq 137 -and $b[1] -eq 80 -and $b[2] -eq 78 -and $b[3] -eq 71) { $ext='.png' }",
        "if ($b.Length -ge 4 -and $b[0] -eq 71 -and $b[1] -eq 73 -and $b[2] -eq 70) { $ext='.gif' }",
        "if ($b.Length -ge 12 -and $b[0] -eq 82 -and $b[1] -eq 73 -and $b[2] -eq 70 -and $b[3] -eq 70 -and $b[8] -eq 87 -and $b[9] -eq 69 -and $b[10] -eq 66 -and $b[11] -eq 80) { $ext='.webp' }",
        "$final=$out",
        "if (-not $out.EndsWith($ext)) { $final=[System.IO.Path]::ChangeExtension($out, $ext.Substring(1)); Move-Item -Force $out $final }",
        "Write-Output ('SAVED:'+$final)",
      ].join('; ')

      const spec = shell.resolve({
        command: ps,
        timeoutMs: 240000,
        stdoutMaxBytes: 65536,
        signal: exec.signal,
        ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
      })
      const result = await shell.run(spec)
      if (result.exitCode !== 0) {
        const errText = (result.stderr && result.stderr.text ? result.stderr.text : (result.stdout && result.stdout.text ? result.stdout.text : '')).trim()
        throw new Error('image generation failed (exit ' + result.exitCode + '): ' + errText)
      }
      const stdoutText = result.stdout && result.stdout.text ? result.stdout.text : ''
      const m = /SAVED:(.+?)\s*$/.exec(stdoutText)
      const finalPath = m ? m[1].trim() : outputPath
      return { output_path: finalPath, model, size }
    },
  })))

  return () => { for (const dispose of disposers) dispose() }
}
