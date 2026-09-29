import { describe, it, expect } from 'vitest';
import type { RunSource } from '../runSource';
import { fakeApi } from '../live/fakeApi';
import { Session } from './recorder';
import { buildCapture, gzipCapture, readCapture } from './captureFile';
import { createReplayProvider } from './replayProvider';
import { parseSweepDays, readSweepLimits, runSweep } from './sweep';
import { NOW, richWorkspace } from './fixtures';

const sweepSession = () => new Session({ id: 'sweep', route: '/api/diag/sweep', query: { days: '90' }, authMode: 'user' }, () => NOW);

function sweep(over: Partial<Parameters<typeof runSweep>[0]> = {}) {
  const session = sweepSession();
  const api = fakeApi(richWorkspace);
  const run = runSweep({ api, user: () => Promise.resolve('me@x.com'), session, days: 90, timeoutMs: 240000, maxOutputs: 300, concurrency: 4, clock: () => NOW, ...over });
  return { session, api, run };
}

describe('sweep', () => {
  it('lists the whole window without a run cap, then reads the output of every failed task', async () => {
    const { session, api, run } = sweep();
    const res = await run;
    expect(res.runs.length).toBe(12);
    const rec = session.finish({ status: 200, body: res });
    expect(rec.limits).toMatchObject({ windowDays: 90, maxRuns: Number.MAX_SAFE_INTEGER, timeoutMs: 240000 });
    expect(api.calls.filter((c) => c === 'getRun')).toHaveLength(1);
    expect(api.calls.filter((c) => c === 'getRunOutput')).toHaveLength(1);
    expect(rec.calls.filter((c) => c.method === 'listPipelineEvents').length).toBeGreaterThanOrEqual(2); // list + the failed update's log
    expect(rec.diagnostics).toContainEqual(expect.objectContaining({ code: 'sweep-outputs', message: expect.stringContaining('2 of 2') as unknown }));
  });

  it('stops reading outputs at maxOutputs and says so', async () => {
    const { session, run } = sweep({ maxOutputs: 1 });
    await run;
    expect(session.finish({ status: 200 }).diagnostics).toContainEqual(expect.objectContaining({ code: 'outputs-capped', level: 'warn' }));
  });

  it('returns what it has with a diagnostic when the timeout hits', async () => {
    let t = NOW;
    const session = sweepSession();
    const api = fakeApi(richWorkspace);
    const listJobRuns = api.listJobRuns;
    api.listJobRuns = (req) => listJobRuns(req).then((r) => ((t += 200_000), r));
    const res = await runSweep({ api, user: () => Promise.resolve('me@x.com'), session, days: 90, timeoutMs: 240000, maxOutputs: 300, concurrency: 1, clock: () => NOW, timer: () => t });
    expect(res.runs.length).toBeLessThan(12);
    const codes = session.finish({ status: 200 }).diagnostics.map((d) => d.code);
    expect(codes).toContain('timeout-hit');
    expect(codes).toContain('sweep-timeout');
  });

  it('replays: the sweep is the session replay picks, and serves the same runs and logs', async () => {
    const { session, run } = sweep();
    const res = await run;
    const rec = session.finish({ status: 200, body: res });
    const file = readCapture(await gzipCapture(buildCapture({ env: {}, authMode: 'user', user: 'me@x.com', sessions: [rec], clientErrors: [], process: [], app: { version: '1', node: 'v' } })));
    const src = createReplayProvider({}, { file, warn: () => {} }).forRequest({ headers: {} }) as RunSource;
    const replayed = await src.listRuns();
    expect(JSON.stringify({ ...replayed, source: 'live' })).toBe(JSON.stringify(res));
    const failed = res.runs.find((r) => r.type === 'job' && r.failed.length)!;
    expect(await src.taskLog(failed.id, failed.failed[0].name)).toContain('TABLE_OR_VIEW_NOT_FOUND');
  });
});

describe('sweep settings', () => {
  it('days defaults to 90, max 180', () => {
    expect(parseSweepDays(undefined)).toBe(90);
    expect(parseSweepDays('30')).toBe(30);
    expect(parseSweepDays('181')).toBeUndefined();
    expect(parseSweepDays('0')).toBeUndefined();
    expect(parseSweepDays('ten')).toBeUndefined();
  });

  it('reads the timeout and output cap from env', () => {
    expect(readSweepLimits({})).toEqual({ timeoutMs: 240000, maxOutputs: 300 });
    expect(readSweepLimits({ JOBS_CONSOLE_SWEEP_TIMEOUT_MS: '1000', JOBS_CONSOLE_SWEEP_MAX_OUTPUTS: '5' })).toEqual({ timeoutMs: 1000, maxOutputs: 5 });
    expect(() => readSweepLimits({ JOBS_CONSOLE_SWEEP_MAX_OUTPUTS: '-1' })).toThrow('JOBS_CONSOLE_SWEEP_MAX_OUTPUTS');
  });
});
