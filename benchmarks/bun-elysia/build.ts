import { aot } from 'elysia/plugin/aot/bun'

// Build the exact same application as the JIT benchmark. The plugin captures
// the exported app and emits precompiled handlers, rather than just bundling it.
const entry = 'benchmarks/bun-elysia/index.ts'
const result = await Bun.build({
  entrypoints: [entry],
  outdir: 'benchmarks/bun-elysia/dist',
  target: 'bun',
  plugins: [aot(entry, { target: 'bun', strip: true })],
})

if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}

console.log(`Elysia AOT built: ${result.outputs[0]?.path}`)
// AOT imports the app during capture; do not keep a captured listener alive.
process.exit(0)
