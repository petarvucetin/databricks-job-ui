import { describe, it, expect } from 'vitest';
import { parseQuartz, startsBetween, scheduleOf, triggerPill } from './cron';
import type { Item } from './types';

const T = (iso: string) => Date.parse(iso);
const item = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'j', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });

describe('parseQuartz', () => {
  it('parses the common shapes', () => {
    expect(parseQuartz('0 0 2 * * ?')).not.toBeNull();
    expect(parseQuartz('0 15 */6 * * ?')).not.toBeNull();
    expect(parseQuartz('0 0/15 * * * ?')).not.toBeNull();
    expect(parseQuartz('0 0 3 ? * SUN')).not.toBeNull();
    expect(parseQuartz('0 30 9 ? * MON-FRI 2026')).not.toBeNull();
    expect(parseQuartz('0 0 0 1,15 JAN-MAR ?')).not.toBeNull();
  });
  it('rejects what it does not support', () => {
    for (const e of ['0 0 12 L * ?', '0 15 10 ? * 6#3', '0 0 12 15W * ?', '0 0 12 * *', 'nonsense', '0 61 * * * ?', '']) expect(parseQuartz(e)).toBeNull();
  });
});

describe('startsBetween', () => {
  it('daily 02:00 UTC over two days', () => {
    const s = parseQuartz('0 0 2 * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-08T00:00:00Z'))).toEqual([T('2026-10-06T02:00:00Z'), T('2026-10-07T02:00:00Z')]);
  });
  it('every 15 minutes gives 96 a day', () => {
    const s = parseQuartz('0 0/15 * * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-07T00:00:00Z'))).toHaveLength(96);
  });
  it('every 6 hours from 04:15', () => {
    const s = parseQuartz('0 15 4/6 * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-07T00:00:00Z'))).toEqual(['04:15', '10:15', '16:15', '22:15'].map((h) => T(`2026-10-06T${h}:00Z`)));
  });
  it('day of week (Quartz SUN = 1) in a time zone', () => {
    const s = parseQuartz('0 0 3 ? * SUN')!;
    // Sunday 2026-10-11 03:00 in Los Angeles (PDT, UTC-7) = 10:00Z
    expect(startsBetween(s, 'America/Los_Angeles', T('2026-10-05T00:00:00Z'), T('2026-10-13T00:00:00Z'))).toEqual([T('2026-10-11T10:00:00Z')]);
  });
  it('fall-back day in Los Angeles: a daily 02:30 fires once', () => {
    const s = parseQuartz('0 30 2 * * ?')!;
    const out = startsBetween(s, 'America/Los_Angeles', T('2026-10-31T12:00:00Z'), T('2026-11-03T12:00:00Z'));
    expect(out).toEqual([T('2026-11-01T10:30:00Z'), T('2026-11-02T10:30:00Z'), T('2026-11-03T10:30:00Z')]);
  });
  it('spring-forward day: no duplicate, other days intact', () => {
    const s = parseQuartz('0 30 2 * * ?')!;
    const out = startsBetween(s, 'America/Los_Angeles', T('2026-03-07T00:00:00Z'), T('2026-03-10T00:00:00Z'));
    expect(new Set(out).size).toBe(out.length);
    expect(out).toContain(T('2026-03-07T10:30:00Z'));
    expect(out).toContain(T('2026-03-09T09:30:00Z'));
  });
  it('spring-forward day east of UTC+2: Sydney 01:30 is still AEST (+10)', () => {
    const s = parseQuartz('0 30 1 * * ?')!;
    expect(startsBetween(s, 'Australia/Sydney', T('2026-10-03T12:00:00Z'), T('2026-10-04T00:00:00Z'))).toEqual([T('2026-10-03T15:30:00Z')]);
  });
  it('spring-forward day east of UTC+2: Auckland 00:30 is still NZST (+12)', () => {
    const s = parseQuartz('0 30 0 * * ?')!;
    expect(startsBetween(s, 'Pacific/Auckland', T('2026-09-26T06:00:00Z'), T('2026-09-26T18:00:00Z'))).toEqual([T('2026-09-26T12:30:00Z')]);
  });
  it('year field limits', () => {
    const s = parseQuartz('0 0 1 * * ? 2025')!;
    expect(startsBetween(s, 'UTC', T('2026-01-01T00:00:00Z'), T('2026-01-05T00:00:00Z'))).toEqual([]);
  });
});

describe('scheduleOf', () => {
  it('unparsed for L/W/# and for an unknown zone', () => {
    expect(scheduleOf({ cron: '0 0 12 L * ?', tz: 'UTC', paused: false }).kind).toBe('unparsed');
    expect(scheduleOf({ cron: '0 0 2 * * ?', tz: 'Mars/Olympus', paused: false }).kind).toBe('unparsed');
    expect(scheduleOf({ cron: '0 0 2 * * ?', tz: 'UTC', paused: false }).kind).toBe('ok');
  });
});

describe('triggerPill', () => {
  const now = T('2026-10-06T16:16:00Z');
  const sched = (cron: string, paused = false) => item({ trigger: 'schedule', schedule: { cron, tz: 'UTC', paused }, paused });
  it('describes schedule shapes in local time (TZ=UTC in tests)', () => {
    expect(triggerPill(sched('0 0 2 * * ?'), now).text).toBe('daily 02:00');
    expect(triggerPill(sched('0 45 * * * ?'), now).text).toBe('hourly · :45');
    expect(triggerPill(sched('0 15 4/6 * * ?'), now).text).toBe('every 6h · 04:15');
    expect(triggerPill(sched('0 0/15 * * * ?'), now).text).toBe('every 15m');
    expect(triggerPill(sched('0 0 3 ? * SUN'), now).text).toBe('Sun 03:00');
    expect(triggerPill(sched('0 0 12 L * ?'), now).text).toBe('cron 0 0 12 L * ?');
    expect(triggerPill(sched('0 0 2 * * ?', true), now)).toMatchObject({ text: 'paused', cls: 'paused' });
  });
  it('other triggers', () => {
    expect(triggerPill(item({ trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } }), now).text).toBe('every 4h (periodic)');
    expect(triggerPill(item({ trigger: 'file_arrival' }), now).text).toBe('file arrival');
    expect(triggerPill(item({ trigger: 'table_update' }), now).text).toBe('table update');
    expect(triggerPill(item({ trigger: 'continuous' }), now)).toMatchObject({ text: 'continuous', cls: 'cont' });
    expect(triggerPill(item({ trigger: 'manual' }), now)).toMatchObject({ text: 'manual', cls: 'none' });
    expect(triggerPill(item({ type: 'pipeline', trigger: 'manual' }), now).text).toBe('triggered');
  });
  it('a paused continuous job shows paused, not continuous', () => {
    expect(triggerPill(item({ trigger: 'continuous', paused: true }), now)).toEqual({ text: 'paused', cls: 'paused', title: 'Continuous, paused' });
  });
  it('a pipeline credited to the jobs that start it: the first job\'s pill and "· by job"', () => {
    const p = item({ type: 'pipeline', id: 'p1', name: 'raw_bronze' });
    const a = { ...sched('0 0 2 * * ?'), id: '7', name: 'nightly_load' };
    const b = { ...sched('0 45 * * * ?'), id: '8', name: 'hourly_sync' };
    expect(triggerPill(p, now, [a])).toEqual({ text: 'daily 02:00 · by job', cls: 'sched', title: 'Started by the pipeline task of nightly_load' });
    expect(triggerPill(p, now, [b, a])).toEqual({ text: 'hourly · :45 · by job', cls: 'sched', title: 'Started by the pipeline task of hourly_sync, nightly_load' });
    expect(triggerPill(p, now, []).text).toBe('triggered');
  });
  it('a continuous pipeline, or one with its own schedule, keeps its own pill even when credited', () => {
    const a = { ...sched('0 0 2 * * ?'), id: '7', name: 'nightly_load' };
    const cont = item({ type: 'pipeline', id: 'p1', name: 'raw_bronze', trigger: 'continuous' });
    expect(triggerPill(cont, now, [a])).toEqual(triggerPill(cont, now));
    expect(triggerPill(cont, now, [a]).text).toBe('continuous');
    expect(triggerPill({ ...cont, paused: true }, now, [a]).text).toBe('paused');
    const own = { ...sched('0 45 * * * ?'), type: 'pipeline' as const, id: 'p2', name: 'silver' };
    expect(triggerPill(own, now, [a])).toEqual(triggerPill(own, now));
    expect(triggerPill(own, now, [a]).text).toBe('hourly · :45');
  });
});
