import type { Item, ItemDetail, Run } from '../../../shared/domain/types';
import { parseQuartz } from '../../../shared/domain/cron';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const SP = '7c1e9a40-2b3d-4f6e-9a1c-0d5e8b7f2a91';
type Shape = Pick<Item, 'trigger' | 'schedule' | 'periodic' | 'paused'>;
const sched = (cron: string, paused = false): Shape => ({ trigger: 'schedule', schedule: { cron, tz: 'UTC', paused }, paused });
// Weighted like real workspaces: on the hour, nightly, a few every-N and weekly; some paused or trigger-based.
const SHAPES: Shape[] = [
  ...['0 0 2 * * ?', '0 0 0 * * ?', '0 30 0 * * ?', '0 0 6 * * ?', '0 0 6 * * ?', '0 0 7 * * ?', '0 30 7 * * ?', '0 0 12 * * ?', '0 0 18 * * ?', '0 25 16 * * ?'].map((c) => sched(c)),
  ...['0 0 * * * ?', '0 45 * * * ?', '0 5 * * * ?', '0 15 0/6 * * ?', '0 15 1/6 * * ?', '0 15 2/6 * * ?', '0 0 0/4 * * ?', '0 0/15 * * * ?', '0 0 3 ? * SUN', '0 0 1 ? * SAT'].map((c) => sched(c)),
  sched('0 0 4 * * ?', true),
  sched('0 0 12 1 * ?'), // monthly (Quartz "L" is unsupported by shared/domain/cron)
  { trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' }, paused: false },
  { trigger: 'file_arrival', paused: false },
  { trigger: 'table_update', paused: false },
  ...Array.from({ length: 8 }, (): Shape => ({ trigger: 'manual', paused: false })),
];
// The shapes the UI must always see go to the first jobs in sorted-name order; the rest are picked by name hash.
const GUARANTEED: Shape[] = [SHAPES[0], SHAPES[20], SHAPES[22], SHAPES[23], SHAPES[24], SHAPES[25]];

export function mockItems(runs: Run[], _asOf: number): Item[] {
  const seen = new Map<string, Run>();
  for (const r of runs) {
    const k = `${r.type}|${r.name}`;
    const prev = seen.get(k);
    if (!prev || r.startTime > prev.startTime) seen.set(k, r);
  }
  const sorted = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const out: Item[] = [];
  let jobIndex = 0;
  let pipeIndex = 0;
  const used = new Set<string>();
  // Unique id per type: probe past a hash collision to the next free number, in name order (deterministic).
  const free = (type: string, start: number, fmt: (n: number) => string, mod: number): string => {
    let n = start;
    while (used.has(type + fmt(n))) n = (n + 1) % mod;
    used.add(type + fmt(n));
    return fmt(n);
  };
  for (const r of sorted) {
    const h = hash(r.name);
    const dev = /^\[dev ([^\]]+)\] /.exec(r.name);
    const mine = r.mine || h % 9 === 0;
    const runAs = dev ? `${dev[1]}@example.com` : SP;
    const base = {
      name: r.name,
      creator: dev ? `${dev[1]}@example.com` : 'data.platform@example.com',
      runAs,
      deployed: !dev,
      mine,
      tags: { project: r.name.startsWith('finance') ? 'finance' : 'aiges', env: dev ? 'dev' : 'prod' },
      bundle: h % 5 !== 0,
    };
    if (r.type === 'pipeline') {
      const continuous = pipeIndex === 0 || r.continuous || h % 4 === 0;
      pipeIndex++;
      out.push({ type: 'pipeline', id: free('pipeline', h, (n) => `p-${n.toString(16).padStart(8, '0')}`, 2 ** 32), ...base, trigger: continuous ? 'continuous' : 'manual', paused: false });
    } else {
      const shape = jobIndex < GUARANTEED.length ? GUARANTEED[jobIndex] : SHAPES[h % SHAPES.length];
      jobIndex++;
      out.push({ type: 'job', id: free('job', h % 900000, (n) => String(100000 + n), 900000), ...base, ...shape });
    }
  }
  // Credit some triggered pipelines to a scheduled job (name order, name hash), as a pipeline_task would.
  const starters = out.filter((i) => i.type === 'job' && i.trigger === 'schedule' && !i.paused && i.schedule && parseQuartz(i.schedule.cron));
  if (starters.length) {
    let first = true;
    out.forEach((p, n) => {
      if (p.type !== 'pipeline' || p.trigger === 'continuous') return;
      const h = hash(p.name);
      if (!first && h % 2 !== 0) return;
      first = false;
      const j = starters[h % starters.length];
      out[n] = { ...p, startedBy: [{ jobId: j.id, jobName: j.name }] };
    });
  }
  return out;
}

export function mockDetail(item: Item, runs: Run[]): ItemDetail {
  if (item.type === 'pipeline') return { item, pipeline: { kind: hash(item.name) % 3 === 0 ? 'Ingestion' : 'ETL', continuous: item.trigger === 'continuous', target: 'aiges_dev.raw_bronze', serverless: true, channel: 'CURRENT' } };
  const newest = runs.filter((r) => r.name === item.name).sort((a, b) => b.startTime - a.startTime)[0];
  const n = Math.max(1, Math.min(newest?.ntasks ?? 3, 12));
  const keys = ['extract', 'stage_bronze', 'merge_silver', 'refresh_gold', 'validate', 'publish', 'notify', 'archive', 'reconcile', 'export', 'aggregate', 'cleanup'];
  const types = ['Notebook', 'Notebook', 'Python wheel', 'Pipeline', 'SQL', 'Notebook'];
  return { item, tasks: keys.slice(0, n).map((key, i) => ({ key, type: types[i % types.length], dependsOn: i ? [keys[i - 1]] : [] })) };
}
