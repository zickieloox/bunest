import { parseArgs } from 'node:util'

export const frameworks = [
  'bun-native', 'bun-dunx', 'bun-elysia', 'bun-elysia-aot', 'bun-nestelia',
  'bun-onebun', 'bun-carno', 'bun-fastify', 'bun-bun', 'bun-hono',
  'bun-express', 'node-express',
] as const
export type Framework = typeof frameworks[number]
const aliases: Record<string, Framework> = {
  native: 'bun-native', 'native-bun': 'bun-native', dunx: 'bun-dunx',
  elysia: 'bun-elysia', 'elysia-aot': 'bun-elysia-aot', carno: 'bun-carno',
  'nestjs-fastify': 'bun-fastify', fastify: 'bun-fastify', nestelia: 'bun-nestelia',
}

export const help = `Usage: ./run_benchmark.sh [options]
  -f, --frameworks LIST   Comma-separated framework IDs or aliases; repeatable
                         Default: all frameworks (including Elysia AOT)
  -n, --requests N        Requests per method per round (default: 50000)
  -c, --connections N     Concurrent connections (default: 100)
  -z, --duration TIME     Timed load, e.g. 10s or 1m; replaces --requests
  -r, --rounds N          Repetitions, rotating framework order (default: 3)
      --warmup TIME       Warm-up per method, e.g. 2s (default: 2s)
      --cooldown TIME     Pause between servers, e.g. 1s (default: 1s)
      --sample-interval TIME  CPU/RSS sampling interval (default: 300ms)
      --cold-starts N     Fresh processes per method/framework (default: 0)
      --cold-only        Measure cold starts without the HTTP load suite
      --output DIR        New output directory (default: results/<timestamp>)
      --list             List framework IDs
  -h, --help             Show help

Aliases: nestjs-fastify, elysia, elysia-aot, dunx, carno, native-bun
Example: bun run bench -f nestjs-fastify,elysia,elysia-aot,dunx,carno,native-bun -z 10s -r 3
Local HTTP benchmark only; run_docker_benchmark.sh is the separate legacy runner.`

function positiveInteger(value: string, name: string) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`)
  return n
}

export function durationMs(value: string) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(value)
  if (!match || Number(match[1]) <= 0) throw new Error(`Invalid duration: ${value}; use 500ms, 2s or 1m`)
  return Number(match[1]) * ({ ms: 1, s: 1000, m: 60000 }[match[2]!]!)
}

export function parseOptions(args: string[]) {
  const { values } = parseArgs({ args, strict: true, options: {
    frameworks: { type: 'string', short: 'f', multiple: true },
    requests: { type: 'string', short: 'n' },
    connections: { type: 'string', short: 'c', default: '100' },
    duration: { type: 'string', short: 'z' },
    rounds: { type: 'string', short: 'r', default: '3' },
    warmup: { type: 'string', default: '2s' },
    cooldown: { type: 'string', default: '1s' },
    'sample-interval': { type: 'string', default: '300ms' },
    'cold-starts': { type: 'string', default: '0' },
    'cold-only': { type: 'boolean' },
    output: { type: 'string' }, list: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.duration && values.requests) throw new Error('Choose --duration or --requests, not both')
  const selected = values.frameworks?.flatMap(s => s.split(',').map(x => x.trim())) ?? [...frameworks]
  const servers = [...new Set(selected.map(name => {
    const id = aliases[name] ?? name
    if (!(frameworks as readonly string[]).includes(id)) throw new Error(`Unknown framework: ${name}. Use --list`)
    return id as Framework
  }))]
  if (values.duration) durationMs(values.duration)
  const coldStarts = Number(values['cold-starts'])
  if (!Number.isSafeInteger(coldStarts) || coldStarts < 0) throw new Error('cold-starts must be a non-negative integer')
  if (values['cold-only'] && !coldStarts) throw new Error('--cold-only requires --cold-starts > 0')
  return {
    servers, requests: positiveInteger(values.requests ?? '50000', 'requests'),
    connections: positiveInteger(values.connections!, 'connections'),
    rounds: positiveInteger(values.rounds!, 'rounds'), duration: values.duration,
    warmupMs: durationMs(values.warmup!), cooldownMs: durationMs(values.cooldown!),
    sampleIntervalMs: durationMs(values['sample-interval']!), coldStarts, coldOnly: values['cold-only'] ?? false,
    output: values.output, help: values.help, list: values.list,
  }
}

export function median(values: number[]) {
  if (!values.length) throw new Error('Cannot summarize empty results')
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export interface OhaResult {
  summary: { successRate: number; requestsPerSec: number; average: number; total: number }
  latencyPercentiles: { p50: number; p95: number; p99: number }
  statusCodeDistribution: Record<string, number>
  errorDistribution: Record<string, number>
}

export function validateResult(result: OhaResult) {
  const statuses = Object.entries(result.statusCodeDistribution)
  if (result.summary.successRate !== 1 || Object.keys(result.errorDistribution).length
    || !statuses.length || statuses.some(([code]) => !/^2\d\d$/.test(code))
    || !Number.isFinite(result.summary.requestsPerSec) || result.summary.requestsPerSec <= 0
    || ![result.latencyPercentiles.p50, result.latencyPercentiles.p95, result.latencyPercentiles.p99]
      .every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Invalid benchmark: request errors, non-2xx responses or missing metrics; inspect raw JSON')
  }
}
