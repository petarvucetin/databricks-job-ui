import { describe, it, expect } from 'vitest';
import { listRuns } from './listRuns';
import { createMockRunSource } from '../data/mock/mockRunSource';
import { selectRunSource } from '../data/runSource';
import type { RunsResponse } from '../../shared/domain/types';

const source = createMockRunSource();

describe('GET /api/runs handler', () => {
  it('returns every run when since is missing', async () => {
    const res = await listRuns(source, {});
    expect(res.status).toBe(200);
    const body = res.body as RunsResponse;
    expect(body.source).toBe('mock');
    expect(body.runs.length).toBeGreaterThan(4000);
  });

  it('filters by since (epoch ms)', async () => {
    const all = (await listRuns(source, {})).body as RunsResponse;
    const since = all.asOf - 2 * 86400000;
    const res = await listRuns(source, { since: String(since) });
    const body = res.body as RunsResponse;
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.runs.length).toBeLessThan(all.runs.length);
    for (const r of body.runs) expect(r.startTime).toBeGreaterThanOrEqual(since);
  });

  it('rejects a non-numeric since with 400', async () => {
    for (const bad of ['yesterday', '12abc', '', ['1', '2']]) {
      const res = await listRuns(source, { since: bad });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'since must be epoch milliseconds' });
    }
  });

  it('accepts a valid tzOffset and generates the data set in that zone', async () => {
    const res = await listRuns(source, { tzOffset: '-120' });
    expect(res.status).toBe(200);
    const body = res.body as RunsResponse;
    expect(body.runs.length).toBeGreaterThan(4000);
  });

  it('anchors the mock data to the current minute, so the timeline always ends today', async () => {
    const now = Date.UTC(2026, 8, 26, 14, 37, 21);
    const clocked = createMockRunSource(() => now);
    const base = (await createMockRunSource(() => Date.UTC(2026, 8, 22, 8, 0)).listRuns(undefined, 0));
    const body = await clocked.listRuns(undefined, 0);
    expect(body.asOf).toBe(Date.UTC(2026, 8, 26, 14, 37));
    for (const r of body.runs) expect(r.startTime).toBeLessThanOrEqual(body.asOf);
    // relative timing is unchanged: every run keeps its distance from "now"
    expect(body.asOf - body.runs[0].startTime).toBe(base.asOf - base.runs[0].startTime);
  });

  it('rejects a bad tzOffset with 400', async () => {
    for (const bad of ['banana', '1.5', '900', '-900', '', ['1', '2']]) {
      const res = await listRuns(source, { tzOffset: bad });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tzOffset must be minutes between -840 and 840' });
    }
  });
});

describe('selectRunSource', () => {
  it('defaults to mock', () => {
    expect(selectRunSource({}).kind).toBe('mock');
    expect(selectRunSource({ JOBS_CONSOLE_DATA: 'mock' }).kind).toBe('mock');
  });

  it('refuses live until the live source exists', () => {
    expect(() => selectRunSource({ JOBS_CONSOLE_DATA: 'live' })).toThrow('JOBS_CONSOLE_DATA=live is not available yet');
    expect(() => selectRunSource({ JOBS_CONSOLE_DATA: 'banana' })).toThrow('Unknown JOBS_CONSOLE_DATA "banana"');
  });
});
