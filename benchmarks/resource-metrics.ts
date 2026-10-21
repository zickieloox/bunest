import { median } from './runner-options.js'

// ps TIME is cumulative user+system CPU time, unlike its OS-smoothed %cpu.
// macOS prints M:SS.cc; Linux also supports HH:MM:SS and D-HH:MM:SS.
export function parseCpuTimeMs(value: string) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value)
  if (!match) throw new Error(`Unrecognized ps CPU time: ${value}`)
  const [, days = '0', hours = '0', minutes, seconds] = match
  return (Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
}

export interface ResourcePoint { ts: number; elapsedMs: number; cpuTimeMs: number; rssMb: number }
export interface ResourceSample extends ResourcePoint { intervalMs: number; cpuPct: number }

export function cpuInterval(previous: ResourcePoint, current: ResourcePoint): ResourceSample {
  const intervalMs = current.elapsedMs - previous.elapsedMs
  const deltaCpuMs = current.cpuTimeMs - previous.cpuTimeMs
  if (intervalMs <= 0 || deltaCpuMs < 0) throw new Error('Invalid CPU time sample interval')
  return { ...current, intervalMs, cpuPct: deltaCpuMs / intervalMs * 100 }
}

export function summarizeCpu(samples: ResourceSample[], nominalIntervalMs = 0) {
  if (!samples.length) throw new Error('No CPU samples recorded')
  const elapsed = samples.reduce((sum, s) => sum + s.intervalMs, 0)
  // A tiny final boundary interval plus ps's 10ms time quantization can create
  // a misleading spike. Use full windows for median/peak; retain all CPU time
  // in the weighted mean. Very short fixed-count runs fall back to actual windows.
  const full = samples.filter(s => s.intervalMs >= nominalIntervalMs * 0.8)
  const windows = full.length ? full : samples
  return {
    avgCpuPct: samples.reduce((sum, s) => sum + s.cpuPct * s.intervalMs, 0) / elapsed,
    medianCpuPct: median(windows.map(s => s.cpuPct)),
    peakCpuPct: Math.max(...windows.map(s => s.cpuPct)),
    cpuSampleCount: samples.length,
    cpuFullSampleCount: full.length,
    cpuSampledMs: elapsed,
  }
}
