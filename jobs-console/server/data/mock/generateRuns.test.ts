import { describe, it, expect } from 'vitest';
import { generateRuns, minuteToMs, NOW_MIN } from './generateRuns';

const data = generateRuns();
const onDay = (ms: number, month: number, day: number) => {
  const d = new Date(ms);
  return d.getMonth() === month && d.getDate() === day;
};

describe('generateRuns', () => {
  it('is deterministic', () => {
    expect(generateRuns()).toEqual(data);
  });

  it('pins "now" to 22 Sep 2026 08:00 local', () => {
    expect(data.asOf).toBe(new Date(2026, 8, 22, 8, 0).getTime());
    expect(minuteToMs(NOW_MIN)).toBe(data.asOf);
    expect(data.source).toBe('mock');
  });

  it('never starts a run after now, and covers 91 days back to 24 Jun', () => {
    for (const r of data.runs) expect(r.startTime).toBeLessThanOrEqual(data.asOf);
    const oldest = Math.min(...data.runs.map((r) => r.startTime));
    expect(oldest).toBeGreaterThanOrEqual(new Date(2026, 5, 24).getTime());
    expect(oldest).toBeLessThan(new Date(2026, 5, 25).getTime());
  });

  it('keeps 10-15 Sep and 21 Sep all succeeded', () => {
    const quiet = data.runs.filter((r) => [10, 11, 12, 13, 14, 15, 21].some((d) => onDay(r.startTime, 8, d)));
    expect(quiet.length).toBeGreaterThan(300);
    for (const r of quiet) expect(r.kind).toBe('succeeded');
  });

  it('has 26 on-track running runs and only in-progress kinds are live', () => {
    expect(data.runs.filter((r) => r.kind === 'running')).toHaveLength(26);
    for (const r of data.runs.filter((x) => x.live)) expect(['running', 'retrying', 'slow']).toContain(r.kind);
    for (const r of data.runs.filter((x) => x.continuous)) expect(r.live).toBe(true);
  });

  it('gives every job still going at now at least one finished run earlier today, ending before it started', () => {
    const today = new Date(2026, 8, 22).getTime();
    for (const r of data.runs.filter((x) => x.live)) {
      const earlier = data.runs.filter((x) => x.name === r.name && x.result !== null && x.startTime >= today && x.startTime + x.durationSec * 1000 <= r.startTime);
      expect(earlier.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has both jobs and pipelines among the slow runs still going at now', () => {
    const slowLive = data.runs.filter((r) => r.kind === 'slow' && r.live);
    expect(slowLive.filter((r) => r.type === 'job').length).toBeGreaterThanOrEqual(3);
    expect(slowLive.filter((r) => r.type === 'pipeline').length).toBeGreaterThanOrEqual(3);
    for (const r of slowLive) expect(r.durationSec).toBeGreaterThan(r.usualSec);
  });

  it('gives pipelines update ids and full names', () => {
    const pipes = data.runs.filter((r) => r.type === 'pipeline');
    expect(pipes.length).toBeGreaterThan(0);
    for (const r of pipes) {
      expect(r.runId).toMatch(/^upd [0-9a-f]{1,8}$/);
      expect(r.name).toMatch(/^(\[dev [^\]]+\] )?raw_bronze_sap_sap_erp1_edw_core_tables_/);
      expect(r.name.endsWith('_dev')).toBe(true);
    }
  });

  it('prefixes only dev deployments, each job keeping one prefix across its runs', () => {
    expect(data.runs.some((r) => r.name.startsWith('[prod]'))).toBe(false);
    const dev = data.runs.filter((r) => r.name.startsWith('[dev '));
    expect(dev.length).toBeGreaterThan(data.runs.length * 0.1);
    expect(dev.length).toBeLessThan(data.runs.length * 0.5);
    expect(new Set(dev.map((r) => /^\[[^\]]+\]/.exec(r.name)![0])).size).toBeGreaterThanOrEqual(3);
    const bare = new Set(data.runs.filter((r) => !r.name.startsWith('[')).map((r) => r.name));
    for (const r of dev) expect(bare.has(r.name.replace(/^\[[^\]]+\] /, ''))).toBe(false);
  });

  it('sorts newest first with unique ids', () => {
    for (let i = 1; i < data.runs.length; i++) expect(data.runs[i - 1].startTime).toBeGreaterThanOrEqual(data.runs[i].startTime);
    expect(new Set(data.runs.map((r) => r.id)).size).toBe(data.runs.length);
  });

  it('gives failed runs at least one failed task', () => {
    for (const r of data.runs.filter((x) => x.kind === 'failed')) expect(r.failed.length).toBeGreaterThan(0);
  });

  it('gives every finished run a result and unfinished runs none', () => {
    for (const r of data.runs) {
      const unfinished = r.live || r.kind === 'queued' || r.kind === 'running' || r.kind === 'retrying';
      if (unfinished) expect(r.result).toBeNull();
      else expect(['succeeded', 'failed', 'cancelled', 'partial']).toContain(r.result);
      if (r.kind === 'failed') expect(r.result).toBe('failed');
    }
    const seen = new Set(data.runs.map((r) => r.result));
    for (const v of ['succeeded', 'failed', 'cancelled', 'partial']) expect(seen.has(v as never)).toBe(true);
  });
});

describe('generateRuns with an explicit time zone offset (UTC+2)', () => {
  const data2 = generateRuns(-120);

  it('pins "now" to 08:00 in the caller\'s zone, not the server\'s', () => {
    expect(data2.asOf).toBe(Date.UTC(2026, 8, 22, 6, 0));
  });

  it('keeps the quiet days quiet by the caller\'s calendar day', () => {
    const quietDays = [10, 11, 12, 13, 14, 15, 21];
    for (const r of data2.runs) {
      const shifted = new Date(r.startTime + 120 * 60000);
      if (shifted.getUTCMonth() === 8 && quietDays.includes(shifted.getUTCDate())) {
        expect(r.kind).toBe('succeeded');
      }
    }
  });
});

describe('generateRuns task names', () => {
  it("names a job's failed tasks only from the tasks that job has", () => {
    const pool = ['setup', 'extract_bkpf', 'extract_bseg', 'extract_gl', 'transform', 'dq_checks', 'load_gl', 'load_gl_history', 'load_cost_centers', 'load_profit_centers', 'load_vendors', 'publish', 'notify'];
    for (const r of data.runs.filter((x) => x.type === 'job' && x.failed.length && x.failed.length < x.ntasks - 1)) {
      const own = pool.slice(1, Math.min(r.ntasks, pool.length));
      for (const f of r.failed) expect(own).toContain(f.name);
      expect(new Set(r.failed.map((f) => f.name)).size).toBe(r.failed.length);
    }
  });
});
