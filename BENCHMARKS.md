# HTTP benchmarks

Install dependencies with `bun install --frozen-lockfile` and install [oha](https://github.com/hatoo/oha).
Run the local suite from any directory using `run_benchmark.sh`, or use `bun run bench` from the repository root.

```sh
./run_benchmark.sh --list
./run_benchmark.sh --help

# Select just these six frameworks (all run on Bun).
bun run bench --frameworks nestjs-fastify,elysia,elysia-aot,dunx,carno,native-bun \
  --duration 10s --connections 100 --rounds 3

# Fixed request count; repeated selectors and canonical IDs are also supported.
./run_benchmark.sh -f bun-elysia -f bun-elysia-aot -n 50000 -c 100 -r 3
```

`--frameworks` / `-f` accepts comma-separated IDs or repeated options. Duplicates
are removed; unknown IDs/options fail before a server is started. With no selector,
all twelve framework variants run. `nestjs-fastify` maps to `bun-fastify`.
`elysia-aot` maps to `bun-elysia-aot`. `native-bun` maps to `bun-native`.

Other options: `--warmup 2s`, `--cooldown 1s`, `--output results/my-run`.
The default is 50,000 requests, 100 connections, three rounds, with two seconds of
warm-up **per method**. `--duration` replaces the fixed request count and cannot
be combined with `--requests`. Durations support `ms`, `s`, and `m`.

The local runner requires port 3000 to be free. It never kills an unrelated
process. On interruption/failure it stops the server and load generator it started.
Servers run sequentially with `NODE_ENV=production`, each in a fresh process per
round. Framework order rotates by one per round and GET/POST order alternates.
Before load, the runner checks both response bodies; after load, it rejects
transport errors and non-2xx statuses (NestJS POST returns 201 by default).
Timed runs use oha's `-w` to finish in-flight requests instead of counting deadline
cancellations as errors. Measured request bodies are not individually validated;
response equivalence is checked before each server's load begins.

Each run gets its own directory, with raw oha JSON, stderr/server logs, sampled
server resources, `metadata.json` (machine, runtime, installed versions and
configuration), `passes.json`, `summary.json`, and `benchmark_report.md`.
A directory already containing `metadata.json` is rejected. Summaries only use
passes from the current invocation. Throughput/latency/RSS summaries are medians
across rounds; p99 is the median of per-round p99s, not a pooled percentile.
RSS is sampled every 300ms. CPU uses the difference in cumulative user+system CPU
time from `ps -o time`, divided by monotonic elapsed time. 100% means one fully
occupied core; a multithreaded process can exceed 100%. macOS CPU time is quantized
to 10ms, so interval values are approximate. CPU median/peak use full sampling
windows (at least 80% of the configured interval) when available, excluding a tiny
trailing boundary that could inflate the peak. Very short fixed-count loads fall
back to their actual available intervals. CPU mean is weighted by interval length,
including all boundaries. The sampled window brackets the oha process, including
its initialization and drain; it excludes server startup and warm-up. The report
includes the median of round CPU medians/means, the maximum sampled peak across
all rounds, and the median of round peaks. Lower CPU alone does not imply greater
efficiency at unrestricted load; compare throughput and CPU time per request too.
The client and server share the host; this is a two-route HTTP microbenchmark,
not a test of database, application logic, or full-stack performance.

## Cold start and CPU

```sh
# Ten independent process starts per framework AND per method, then HTTP load.
bun run bench -f nestjs-fastify,elysia,elysia-aot,dunx,carno,native-bun \
  --cold-starts 10 --sample-interval 300ms -z 10s -c 100 -r 3

# Cold starts only (skip HTTP load).
bun run bench -f elysia,elysia-aot --cold-starts 10 --cold-only
```

`--cold-starts` defaults to 0. Cold-start time means **process spawn to completion
of the first valid HTTP response**, including imports, framework startup, TCP,
first-route JIT, handler and body transfer. GET and POST each use their own fresh
process: no health check or warm-up request runs beforehand. Connection refusals
are retried every 5ms; a handler error or timeout invalidates the trial instead of
silently warming a route with a retry. The successful request also records its
own duration. AOT is built once before trials and build time is excluded.

This is process-cold startup: OS/filesystem caches and Bun's on-disk transpiler
cache are not flushed. Probe scheduling and host load affect timing; differences
of a few milliseconds need caution. Framework order rotates between trials, and
the GET/POST order alternates. `cold-starts.json` contains individual trials;
`cold-summary.json` reports median and min–max for each framework/method.

`--sample-interval` defaults to 300ms and changes CPU/RSS sampling during HTTP
load only. CPU peaks are interval averages, not instantaneous hardware peaks.

## Elysia 2 RC and AOT

The root dependency is pinned to `elysia@2.0.0-rc.0`. Both variants use
`benchmarks/bun-elysia/index.ts` and its exported `app`:

- `elysia` executes the source, using Elysia's normal runtime compilation.
- `elysia-aot` builds the same source with `elysia/plugin/aot/bun`, then executes
  `benchmarks/bun-elysia/dist/index.js`. Build time is outside the measured load.
  The plugin uses `target: 'bun', strip: true`, requiring a precompiled handler
  manifest and removing the handler JIT, so a plain bundle cannot masquerade as AOT.

To build/start AOT manually:

```sh
bun run build:elysia-aot
bun run http:elysia-aot
```

The runner builds AOT automatically whenever it is selected. No schema validation
is added; both variants perform the same work as the other benchmark routes.
See the [official AOT documentation](https://next.elysiajs.com/patterns/aot/).
Nestelia 1.11.2 still requires Elysia 1.x; it has its own workspace dependency on
1.4.30 to preserve that existing benchmark independently of the Elysia 2 upgrade.

Run runner validation with `bun run bench:test`. `run_docker_benchmark.sh` remains
the separate legacy Docker suite; the options above apply to the local runner.
