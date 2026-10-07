import { describe, it, expect } from 'vitest';
import { generateRuns } from './generateRuns';
import { mockItems } from './mockItems';
import { parseQuartz } from '../../../shared/domain/cron';

describe('mockItems', () => {
  const { runs, asOf } = generateRuns(0);
  const items = mockItems(runs, asOf);
  it('one item per distinct job and pipeline name, stable ids', () => {
    const names = new Set(runs.map((r) => `${r.type}|${r.name}`));
    expect(items).toHaveLength(names.size);
    expect(new Set(items.map((i) => i.type + i.id)).size).toBe(items.length);
    expect(mockItems(runs, asOf).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  it('has the spread the UI needs', () => {
    const jobs = items.filter((i) => i.type === 'job');
    expect(jobs.some((i) => i.trigger === 'schedule' && !i.paused)).toBe(true);
    expect(jobs.some((i) => i.paused)).toBe(true);
    expect(jobs.some((i) => i.trigger === 'periodic')).toBe(true);
    expect(jobs.some((i) => i.trigger === 'file_arrival')).toBe(true);
    expect(jobs.some((i) => i.trigger === 'manual')).toBe(true);
    expect(items.some((i) => i.type === 'pipeline' && i.trigger === 'continuous')).toBe(true);
    expect(items.filter((i) => i.type === 'pipeline').every((i) => i.trigger !== 'schedule')).toBe(true);
    for (const i of jobs) if (i.schedule) expect(parseQuartz(i.schedule.cron)).not.toBeNull();
  });
  it('credits some triggered pipelines to scheduled jobs, deterministically', () => {
    const credited = items.filter((i) => i.startedBy);
    expect(credited.length).toBeGreaterThan(0);
    for (const p of credited) {
      expect(p.type).toBe('pipeline');
      expect(p.trigger).not.toBe('continuous');
      for (const s of p.startedBy!) {
        const j = items.find((x) => x.type === 'job' && x.id === s.jobId);
        expect(j?.name).toBe(s.jobName);
        expect(j?.trigger).toBe('schedule');
        expect(j?.paused).toBe(false);
        expect(parseQuartz(j!.schedule!.cron)).not.toBeNull();
      }
    }
    expect(mockItems(runs, asOf).map((i) => i.startedBy)).toEqual(items.map((i) => i.startedBy));
  });
});
