#!/usr/bin/env node
// Snapshots the Prometheus /metrics of the platform and the white-label to
// results/, so the SERVER'S own RED view (request rate, latency histograms,
// error counts, event-loop lag, memory) sits next to k6's client-side numbers.
//
// Take one before the run and one after; diff the counters to see what the
// server actually did under load.
//
//   node scripts/loadtest/snapshot-metrics.mjs before
//   node scripts/loadtest/snapshot-metrics.mjs after
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLATFORM = process.env.PLATFORM_URL ?? 'http://localhost:4100'
const WL = process.env.WL_URL ?? 'http://localhost:4200'
const label = (process.argv[2] ?? 'snapshot').replace(/[^a-z0-9_-]/gi, '_')

const __dir = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(__dir, 'results')

async function grab(name, base) {
  const out = join(RESULTS, `metrics-${label}-${name}.txt`)
  try {
    const res = await fetch(`${base}/metrics`, { headers: { Accept: 'text/plain' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    writeFileSync(out, `# ${name} ${base}/metrics @ ${new Date().toISOString()}\n${body}`)
    console.log(`  ${name}: ${body.length} bytes → ${out}`)
  } catch (err) {
    console.error(`  ${name}: ${base}/metrics failed — ${err.message}`)
    writeFileSync(out, `# ${name} ${base}/metrics FAILED @ ${new Date().toISOString()}\n# ${err.message}\n`)
  }
}

async function main() {
  mkdirSync(RESULTS, { recursive: true })
  console.log(`Metrics snapshot "${label}"`)
  await Promise.all([grab('platform', PLATFORM), grab('whitelabel', WL)])
}

main()
