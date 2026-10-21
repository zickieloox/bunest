import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cpus, loadavg, platform, release, totalmem } from 'node:os'
import { frameworks, help, median, parseOptions, validateResult, type Framework, type OhaResult } from './runner-options.js'
import { cpuInterval, parseCpuTimeMs, summarizeCpu, type ResourcePoint, type ResourceSample } from './resource-metrics.js'

const root = resolve(import.meta.dir, '..')
const url = 'http://127.0.0.1:3000'
const payload = { name: 'benchmark', data: { key: 'value', num: 42, flag: true } }
const body = JSON.stringify(payload)
type Process = ReturnType<typeof Bun.spawn>
type Method = 'GET' | 'POST'
let server: Process | undefined
let load: Process | undefined

async function stop(proc: Process | undefined) {
  if (!proc || proc.exitCode !== null) return
  proc.kill('SIGTERM')
  await Promise.race([proc.exited, Bun.sleep(2000)])
  if (proc.exitCode === null) proc.kill('SIGKILL')
  await proc.exited
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await stop(load)
      await stop(server)
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })()
  })
}

async function command(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ])
  if (code) throw new Error(`${cmd.join(' ')} failed (${code}): ${stderr || stdout}`)
  return stdout.trim()
}

async function assertFreePort() {
  // Reserve briefly to fail before starting or measuring somebody else's server.
  const probe = Bun.serve({ port: 3000, hostname: '0.0.0.0', fetch: () => new Response() })
  await probe.stop(true)
}

async function ready(proc: Process, log: string) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`Server exited (${proc.exitCode}); see ${log}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    }
    catch { /* server is still starting */ }
    await Bun.sleep(100)
  }
  throw new Error(`Server did not become ready; see ${log}`)
}

async function checkResponses() {
  const get = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (get.status !== 200 || JSON.stringify(await get.json()) !== JSON.stringify({ msg: 'Hello, world!' })) {
    throw new Error('GET / failed response equivalence check')
  }
  const post = await fetch(`${url}/echo`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
    signal: AbortSignal.timeout(5000),
  })
  const value = await post.json() as { msg: string; echo: unknown; timestamp: number }
  if (!post.ok || value.msg !== 'Hello, benchmark!' || JSON.stringify(value.echo) !== JSON.stringify(payload.data)
    || typeof value.timestamp !== 'number' || Math.abs(Date.now() - value.timestamp) > 10000) {
    throw new Error('POST /echo failed response equivalence check')
  }
}

interface Pass {
  server: Framework; method: Method; round: number; rps: number
  p50Ms: number; p95Ms: number; p99Ms: number; avgMs: number
  peakRssMb: number; avgCpuPct: number; medianCpuPct: number; peakCpuPct: number; requests: number
  cpuSampleCount: number; cpuFullSampleCount: number; cpuSampledMs: number
}

async function readResources(pid: number): Promise<ResourcePoint> {
  const before = performance.now()
  const output = await command(['ps', '-p', String(pid), '-o', 'time=,rss='])
  const [time, rss] = output.split(/\s+/)
  if (!time || !rss || !Number.isFinite(Number(rss))) throw new Error(`Invalid ps sample: ${output}`)
  return { ts: Date.now(), elapsedMs: (before + performance.now()) / 2, cpuTimeMs: parseCpuTimeMs(time), rssMb: Number(rss) / 1024 }
}

async function measureResources(pid: number, points: ResourcePoint[], intervalMs: number, isDone: () => boolean) {
  while (!isDone()) {
    await Bun.sleep(intervalMs)
    if (!isDone()) points.push(await readResources(pid))
  }
}

function spawnServer(name: Framework, log: string) {
  const entry = name === 'bun-elysia-aot' ? 'benchmarks/bun-elysia/dist/index.js'
    : name === 'node-express' ? 'benchmarks/node-express/dist/index.cjs' : `benchmarks/${name}/index.ts`
  return Bun.spawn([name === 'node-express' ? 'node' : process.execPath, resolve(root, entry)], {
    cwd: name === 'bun-dunx' ? resolve(root, 'benchmarks/bun-dunx') : root,
    env: { ...process.env, NODE_ENV: 'production' }, stdout: Bun.file(log), stderr: Bun.file(`${log}.stderr`),
  })
}

interface ColdStart {
  server: Framework; method: Method; round: number; spawnToFirstResponseMs: number
  firstRequestMs: number; refusedAttempts: number
}

function connectionRefused(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: string; cause?: unknown }
  return value.code === 'ConnectionRefused' || value.code === 'ECONNREFUSED'
    || (value.cause !== undefined && connectionRefused(value.cause))
}

async function coldResponse(proc: Process, method: Method, started: number, log: string) {
  let refusedAttempts = 0
  while (performance.now() - started < 20000) {
    if (proc.exitCode !== null) throw new Error(`Cold-start process exited; see ${log}`)
    const requestStarted = performance.now()
    let response: Response
    try {
      response = await fetch(method === 'GET' ? url : `${url}/echo`, {
        method, signal: AbortSignal.timeout(5000),
        headers: { connection: 'close', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body } : {}),
      })
    }
    catch (error) {
      // Retry only a connection refusal: a timeout or handler failure may have
      // executed a route already, which would invalidate a first-request trial.
      if (!connectionRefused(error)) throw error
      refusedAttempts++
      await Bun.sleep(5)
      continue
    }
    const value = await response.json() as { msg: string; echo?: unknown; timestamp?: number }
    const completed = performance.now()
    const valid = method === 'GET' ? response.status === 200 && value.msg === 'Hello, world!'
      : response.ok && value.msg === 'Hello, benchmark!' && JSON.stringify(value.echo) === JSON.stringify(payload.data)
        && typeof value.timestamp === 'number' && Math.abs(Date.now() - value.timestamp) < 10000
    if (!valid) throw new Error(`Invalid first ${method} response in cold-start trial; see ${log}`)
    return { spawnToFirstResponseMs: completed - started, firstRequestMs: completed - requestStarted, refusedAttempts }
  }
  throw new Error(`Cold start timed out; see ${log}`)
}

async function main() {
  const options = parseOptions(Bun.argv.slice(2))
  if (options.help) { console.log(help); return }
  if (options.list) { console.log(frameworks.join('\n')); return }
  for (const executable of options.coldOnly ? [] : ['oha', 'ps']) {
    if (!Bun.which(executable)) throw new Error(`Required executable missing: ${executable}`)
  }
  const out = resolve(root, options.output ?? `results/${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(out, { recursive: true })
  // Never mix old summary files or overwrite a previous run.
  if (await Bun.file(`${out}/metadata.json`).exists()) throw new Error(`Output directory already contains a run: ${out}`)
  const metadata = {
    date: new Date().toISOString(), options,
    machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGb: totalmem() / 2 ** 30, loadAverage: loadavg() },
    bun: Bun.version, bunBuild: await command([process.execPath, '--revision']), bunRevision: Bun.revision,
    oha: options.coldOnly ? undefined : await command(['oha', '--version']),
    versions: Object.fromEntries(await Promise.all([
      'elysia', 'exact-mirror', '@nestjs/core', '@nestjs/platform-fastify', '@dunx/core', '@dunx/http', '@carno.js/core',
    ].map(async name => [name, (await Bun.file(resolve(root, 'node_modules', name, 'package.json')).json()).version]))),
    gitHead: await command(['git', 'rev-parse', 'HEAD']),
    resourceNote: `Server PID only; CPU = delta(user+system CPU time)/delta(monotonic wall time)*100; 100% is one core, may exceed 100%. ps TIME has 10ms resolution on macOS. Median/peak CPU across ~${options.sampleIntervalMs}ms intervals (full windows when available), mean is duration-weighted over the oha process lifetime, including initialization/drain. Peak is sampled, not instantaneous. Load generator shares the host.`,
    coldStartNote: 'Spawn to completion of first valid response, including imports/startup, TCP, first-route compilation and handler. GET/POST use independent fresh processes; retry only connection refusals every 5ms. OS/filesystem caches are NOT flushed; AOT build is excluded. firstRequestMs is the successful HTTP request duration including response body, not pure handler time.',
  }
  await Bun.write(`${out}/metadata.json`, JSON.stringify(metadata, null, 2))
  console.log(`Results: ${out}`)
  await assertFreePort()
  if (options.servers.includes('bun-elysia-aot')) {
    console.log('Building Elysia AOT (excluded from measured load)...')
    console.log(await command([process.execPath, 'benchmarks/bun-elysia/build.ts']))
  }
  if (options.servers.includes('node-express')) {
    await command([process.execPath, 'benchmarks/node-express/http.build.ts'])
  }
  const coldStarts: ColdStart[] = []
  for (let round = 1; round <= options.coldStarts; round++) {
    const shift = (round - 1) % options.servers.length
    const order = [...options.servers.slice(shift), ...options.servers.slice(0, shift)]
    for (const name of order) {
      for (const method of (round % 2 ? ['GET', 'POST'] : ['POST', 'GET']) as Method[]) {
        await assertFreePort()
        const log = `${out}/${name}_cold_${method.toLowerCase()}_r${round}.log`
        const started = performance.now()
        server = spawnServer(name, log)
        try {
          const measured = await coldResponse(server, method, started, log)
          coldStarts.push({ server: name, method, round, ...measured })
          await Bun.write(`${out}/cold-starts.json`, JSON.stringify(coldStarts, null, 2))
          console.log(`Cold [${round}/${options.coldStarts}] ${name} ${method}: ${measured.spawnToFirstResponseMs.toFixed(2)} ms (first request ${measured.firstRequestMs.toFixed(2)} ms)`)
        }
        finally { await stop(server); server = undefined }
        await Bun.sleep(100)
      }
    }
  }
  const coldSummary = options.coldStarts ? options.servers.flatMap(name => (['GET', 'POST'] as const).map(method => {
    const rows = coldStarts.filter(p => p.server === name && p.method === method)
    return {
      server: name, method, trials: rows.length,
      medianMs: median(rows.map(p => p.spawnToFirstResponseMs)),
      minMs: Math.min(...rows.map(p => p.spawnToFirstResponseMs)), maxMs: Math.max(...rows.map(p => p.spawnToFirstResponseMs)),
      medianFirstRequestMs: median(rows.map(p => p.firstRequestMs)),
    }
  })) : []
  if (coldSummary.length) await Bun.write(`${out}/cold-summary.json`, JSON.stringify(coldSummary, null, 2))
  const passes: Pass[] = []
  for (let round = 1; !options.coldOnly && round <= options.rounds; round++) {
    const shift = (round - 1) % options.servers.length
    const order = [...options.servers.slice(shift), ...options.servers.slice(0, shift)]
    for (const name of order) {
      await assertFreePort()
      const log = `${out}/${name}_r${round}.log`
      console.log(`[${round}/${options.rounds}] ${name}`)
      server = spawnServer(name, log)
      try {
        await ready(server, log)
        await checkResponses()
        // Reverse method order on alternating rounds to reduce order bias.
        const methods: Method[] = round % 2 ? ['GET', 'POST'] : ['POST', 'GET']
        for (const method of methods) {
          const target = method === 'GET' ? url : `${url}/echo`
          const common = ['oha', '-c', String(options.connections), '--no-tui', '--output-format', 'json', '-t', '10s', '-m', method]
          if (method === 'POST') common.push('-d', body, '-T', 'application/json')
          const warm = Bun.spawn([...common, '-z', `${options.warmupMs}ms`, '-w', target], { stdout: 'ignore', stderr: 'inherit' })
          load = warm
          if (await warm.exited) throw new Error('Warm-up failed')
          const tag = `${name}_${method.toLowerCase()}_r${round}`
          const points: ResourcePoint[] = [await readResources(server.pid)]
          let samples: ResourceSample[] = []
          let done = false
          const monitor = measureResources(server.pid, points, options.sampleIntervalMs, () => done)
          // Attach a rejection handler immediately while the load is running.
          const monitored = monitor.then(() => undefined, error => error as Error)
          let result: OhaResult
          try {
            const limits = options.duration ? ['-z', options.duration, '-w'] : ['-n', String(options.requests)]
            const proc = Bun.spawn([...common, ...limits, target], {
              stdout: Bun.file(`${out}/${tag}.json`), stderr: Bun.file(`${out}/${tag}.stderr.log`),
            })
            load = proc
            if (await proc.exited) throw new Error(`oha failed: ${tag}; inspect stderr log`)
            result = await Bun.file(`${out}/${tag}.json`).json() as OhaResult
            validateResult(result)
          }
          finally {
            done = true
            const ending = await readResources(server.pid)
            const error = await monitored
            const ordered = [...points.filter(p => p.elapsedMs < ending.elapsedMs), ending].sort((a, b) => a.elapsedMs - b.elapsedMs)
            samples = ordered.slice(1).map((p, i) => cpuInterval(ordered[i]!, p))
            await Bun.write(`${out}/${tag}_resources.json`, JSON.stringify(samples))
            if (error) throw error
          }
          const pass: Pass = {
            server: name, method, round, rps: result.summary.requestsPerSec,
            avgMs: result.summary.average * 1000, p50Ms: result.latencyPercentiles.p50 * 1000,
            p95Ms: result.latencyPercentiles.p95 * 1000, p99Ms: result.latencyPercentiles.p99 * 1000,
            peakRssMb: Math.max(...samples.map(s => s.rssMb)),
            ...summarizeCpu(samples, options.sampleIntervalMs),
            requests: Object.values(result.statusCodeDistribution).reduce((s, x) => s + x, 0),
          }
          passes.push(pass)
          await Bun.write(`${out}/passes.json`, JSON.stringify(passes, null, 2))
          console.log(`  ${method}: ${Math.round(pass.rps)} req/s | CPU median ${pass.medianCpuPct.toFixed(1)}% mean ${pass.avgCpuPct.toFixed(1)}% peak ${pass.peakCpuPct.toFixed(1)}% | RSS ${pass.peakRssMb.toFixed(1)} MiB`)
        }
      }
      finally {
        await stop(load)
        await stop(server)
        server = undefined
      }
      await Bun.sleep(options.cooldownMs)
    }
  }
  const summary = options.coldOnly ? [] : options.servers.flatMap(name => (['GET', 'POST'] as const).map(method => {
    const rows = passes.filter(p => p.server === name && p.method === method)
    const metric = (key: keyof Pick<Pass, 'rps' | 'p50Ms' | 'p95Ms' | 'p99Ms' | 'avgMs' | 'peakRssMb' | 'avgCpuPct' | 'medianCpuPct' | 'peakCpuPct'>) => median(rows.map(p => p[key]))
    return {
      server: name, method, rps: metric('rps'), minRps: Math.min(...rows.map(p => p.rps)), maxRps: Math.max(...rows.map(p => p.rps)),
      p50Ms: metric('p50Ms'), p95Ms: metric('p95Ms'), p99Ms: metric('p99Ms'), avgMs: metric('avgMs'),
      peakRssMb: metric('peakRssMb'), avgCpuPct: metric('avgCpuPct'),
      medianCpuPct: metric('medianCpuPct'), medianPeakCpuPct: metric('peakCpuPct'),
      peakCpuPct: Math.max(...rows.map(p => p.peakCpuPct)),
      cpuMsPerRequest: median(rows.map(p => p.avgCpuPct / 100 * p.cpuSampledMs / p.requests)),
      totalRequests: rows.reduce((s, x) => s + x.requests, 0),
    }
  }))
  await Bun.write(`${out}/summary.json`, JSON.stringify(summary, null, 2))
  const report = [
    options.coldOnly ? '# Cold-start benchmark' : '# HTTP and resource benchmark', '', `Date: ${metadata.date}`, '',
    `Bun ${metadata.bun} (${metadata.bunRevision}); ${metadata.machine.cpu}.`,
    'Fresh processes; rotated framework order; alternating method order; NODE_ENV=production. AOT build excluded.',
    ...(summary.length ? [
      `${metadata.oha}; ${options.connections} connections; ${options.rounds} rounds.`,
      `Load: ${options.duration ?? `${options.requests} requests`} per method per round; warm-up ${options.warmupMs}ms per method.`,
      'GET / returns JSON; POST /echo parses JSON and returns msg, echo, timestamp. See each framework entry for any schema validation.',
      'Median of per-round metrics; p99 is the median of per-round p99s, not a pooled percentile. Every measured response was 2xx; no transport errors.',
      metadata.resourceNote, '',
    ] : []),
    ...(coldSummary.length ? ['## Cold start', '', metadata.coldStartNote, '',
      ...coldSummary.map(s => `${s.server} ${s.method}: median ${s.medianMs.toFixed(2)} ms (min–max ${s.minMs.toFixed(2)}–${s.maxMs.toFixed(2)}), ${s.trials} trials; successful first request median ${s.medianFirstRequestMs.toFixed(2)} ms.`), ''] : []),
    ...(summary.length ? (['GET', 'POST'] as const).flatMap(method => [
      `## ${method}`, '',
      ...summary.filter(s => s.method === method).sort((a, b) => b.rps - a.rps).map((s, i) =>
        `${i + 1}. ${s.server}: **${Math.round(s.rps).toLocaleString('en-US')} req/s** (range ${Math.round(s.minRps)}–${Math.round(s.maxRps)}); p50/p95/p99 ${s.p50Ms.toFixed(2)}/${s.p95Ms.toFixed(2)}/${s.p99Ms.toFixed(2)} ms; RSS ${s.peakRssMb.toFixed(1)} MiB; CPU median ${s.medianCpuPct.toFixed(1)}%, mean ${s.avgCpuPct.toFixed(1)}%, max sampled peak ${s.peakCpuPct.toFixed(1)}% (median round peak ${s.medianPeakCpuPct.toFixed(1)}%).`), '',
    ]) : []),
    '## Limits', '',
    'A local two-route microbenchmark, with client and server sharing hardware. It does not measure database access, business logic, DI at scale, OS-cache-cold startup or build time. CPU/RSS peaks are sampled. Small differences within run variation do not establish a performance advantage.', '',
  ].join('\n')
  await Bun.write(`${out}/benchmark_report.md`, report)
  console.log(`Complete: ${out}/benchmark_report.md`)
}

main().catch(async error => {
  console.error(error)
  await stop(load)
  await stop(server)
  process.exitCode = 1
})
