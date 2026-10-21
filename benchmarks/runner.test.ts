import { describe, expect, test } from 'bun:test'
import { durationMs, median, parseOptions, validateResult, type OhaResult } from './runner-options.js'
import { cpuInterval, parseCpuTimeMs, summarizeCpu } from './resource-metrics.js'

describe('benchmark CLI', () => {
  test('selects only requested frameworks, normalizes aliases and removes duplicates', () => {
    expect(parseOptions(['-f', 'nestjs-fastify,elysia', '--frameworks=elysia-aot,native-bun,elysia']).servers)
      .toEqual(['bun-fastify', 'bun-elysia', 'bun-elysia-aot', 'bun-native'])
  })
  test('rejects typos, empty selectors, unknown flags and invalid load parameters', () => {
    for (const args of [
      ['-f', 'elysai'], ['-f', ''], ['--unknown'], ['-n', '0'], ['-r', '-1'],
      ['-c', '1.5'], ['-z', 'bad'], ['-z', '1s', '-n', '100'], ['--warmup', '0s'],
      ['--cold-starts', '-1'], ['--cold-starts', '1.2'], ['--cold-only'], ['--sample-interval', '0ms'],
    ]) expect(() => parseOptions(args)).toThrow()
  })
  test('supports cold-only trials and configurable CPU windows', () => {
    const options = parseOptions(['--cold-starts', '10', '--cold-only', '--sample-interval', '500ms'])
    expect(options.coldStarts).toBe(10)
    expect(options.coldOnly).toBe(true)
    expect(options.sampleIntervalMs).toBe(500)
  })
  test('parses timing and fixed request modes', () => {
    expect(parseOptions(['-n', '1000', '-c', '10', '-r', '2']).requests).toBe(1000)
    expect(parseOptions(['-z', '10s']).duration).toBe('10s')
    expect(durationMs('0.5s')).toBe(500)
    expect(durationMs('1m')).toBe(60000)
  })
})

describe('interval CPU metrics', () => {
  test('parses macOS and Linux cumulative CPU time formats', () => {
    expect(parseCpuTimeMs('0:01.23')).toBe(1230)
    expect(parseCpuTimeMs('01:02:03')).toBe(3723000)
    expect(parseCpuTimeMs('2-01:02:03')).toBe(176523000)
    expect(() => parseCpuTimeMs('bad')).toThrow()
  })
  test('100% means one fully occupied CPU core and supports multiple cores', () => {
    const previous = { ts: 0, elapsedMs: 0, cpuTimeMs: 20, rssMb: 10 }
    expect(cpuInterval(previous, { ...previous, elapsedMs: 300, cpuTimeMs: 320 }).cpuPct).toBe(100)
    expect(cpuInterval(previous, { ...previous, elapsedMs: 300, cpuTimeMs: 620 }).cpuPct).toBe(200)
    expect(() => cpuInterval(previous, previous)).toThrow()
  })
  test('time-weighted mean includes boundary CPU; short tail cannot create a false peak', () => {
    const base = { ts: 0, elapsedMs: 0, cpuTimeMs: 0, rssMb: 10 }
    const samples = [
      { ...base, intervalMs: 300, cpuPct: 50 },
      { ...base, intervalMs: 300, cpuPct: 100 },
      { ...base, intervalMs: 10, cpuPct: 500 },
    ]
    const result = summarizeCpu(samples, 300)
    expect(result.medianCpuPct).toBe(75)
    expect(result.peakCpuPct).toBe(100)
    expect(result.avgCpuPct).toBeCloseTo((150 + 300 + 50) / 610 * 100, 6)
    expect(result.cpuFullSampleCount).toBe(2)
    expect(() => summarizeCpu([])).toThrow()
  })
})

describe('results integrity', () => {
  const valid: OhaResult = {
    summary: { successRate: 1, requestsPerSec: 100, average: 0.01, total: 1 },
    latencyPercentiles: { p50: 0.01, p95: 0.02, p99: 0.03 },
    statusCodeDistribution: { 200: 100 }, errorDistribution: {},
  }
  test('accepts NestJS POST 201 as well as POST 200', () => {
    expect(() => validateResult({ ...valid, statusCodeDistribution: { 201: 100 } })).not.toThrow()
  })
  test('rejects HTTP failures even when oha reports transport success', () => {
    expect(() => validateResult({ ...valid, statusCodeDistribution: { 500: 100 } })).toThrow()
    expect(() => validateResult({ ...valid, errorDistribution: { timeout: 1 } })).toThrow()
    expect(() => validateResult({ ...valid, statusCodeDistribution: {} })).toThrow()
  })
  test('summarizes rounds with a median, not the best run', () => {
    expect(median([200, 100, 900])).toBe(200)
    expect(median([100, 200])).toBe(150)
    expect(() => median([])).toThrow()
  })
})
