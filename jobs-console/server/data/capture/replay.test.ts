import { describe, it, expect, vi } from 'vitest';
import type { RunSource } from '../runSource';
import { createLiveRunSource, createLiveState } from '../live/liveRunSource';
import { DEFAULT_LIMITS } from '../live/limits';
import { fakeApi, type FakeData } from '../live/fakeApi';
import type { DiagNote } from '../live/trace';
import { Session, type SessionRecord } from './recorder';
import { buildCapture, gzipCapture, readCapture, type CaptureFile } from './captureFile';
import { canon, createReplayApi } from './replayApi';
import { createReplayProvider, pickSession } from './replayProvider';
import { richWorkspace, NOW } from './fixtures';

const APP = { version: '1.0.0', node: 'v24' };

/** Records one list (and optionally some task logs) against a fake workspace, as the server would. */
async function record(data: FakeData, opts: { route?: string; logs?: [number, string][]; since?: number } = {}) {
  const session = new Session({ id: 's-list', route: opts.route ?? '/api/runs', query: {}, authMode: 'user' }, () => NOW);
  const src = createLiveRunSource({
    api: fakeApi(data), user: () => Promise.resolve('me@x.com'), userKey: 'me', state: createLiveState(), limits: DEFAULT_LIMITS, clock: () => NOW, warn: () => {}, trace: session,
  });
  let original;
  let error: unknown;
  try {
    original = await src.listRuns(opts.since);
  } catch (e) {
    error = e;
  }
  const logs: string[] = [];
  for (const [id, task] of opts.logs ?? []) logs.push(await src.taskLog(id, task));
  const rec = session.finish({ status: error ? 502 : 200, body: original });
  return { original, error, logs, rec };
}

async function roundTrip(sessions: SessionRecord[]): Promise<CaptureFile> {
  const file = buildCapture({ env: { DATABRICKS_HOST: 'https://x.cloud.databricks.us', JOBS_CONSOLE_DATA: 'live' }, authMode: 'user', user: 'me@x.com', sessions, clientErrors: [], process: [], app: APP });
  return readCapture(await gzipCapture(file));
}

describe('replay round trip', () => {
  it('serves the recorded RunsResponse byte for byte (source aside)', async () => {
    const { original, rec } = await record(richWorkspace);
    expect(original!.runs.length).toBeGreaterThanOrEqual(8);
    expect(new Set(original!.runs.map((r) => r.kind)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(original!.runs.map((r) => r.type))).toEqual(new Set(['job', 'pipeline']));

    const file = await roundTrip([rec]);
    const provider = createReplayProvider({}, { file, warn: () => {} });
    const replayed = await (provider.forRequest({ headers: {} }) as RunSource).listRuns();
    expect(replayed.source).toBe('replay');
    expect(JSON.stringify({ ...replayed, source: 'live' })).toBe(JSON.stringify(original));
  });

  it('replays real tasks and workspace links', async () => {
    const { rec } = await record(richWorkspace);
    const file = await roundTrip([rec]);
    const runs = (await (createReplayProvider({}, { file, warn: () => {} }).forRequest({ headers: {} }) as RunSource).listRuns()).runs;
    const byId = new Map(runs.map((r) => [r.id, r]));
    expect(byId.get(201)?.tasks).toEqual([
      { key: 'extract', startSec: 0, durSec: 100, state: 'ok', deps: [], attempt: 0 },
      { key: 'load', startSec: 120, durSec: 200, state: 'f', deps: [0], attempt: 0, failIndex: 0 },
    ]);
    expect(byId.get(401)?.tasks).toEqual([{ key: 'pull', startSec: 300, durSec: 900, state: 'r', deps: [], attempt: 1 }]);
    expect(byId.get(201)?.url).toBe('https://x.cloud.databricks.us/jobs/2/runs/201');
    const upd = runs.find((r) => r.type === 'pipeline' && r.failed.length);
    expect(upd?.tasks).toEqual([expect.objectContaining({ key: '[dev ann] raw_bronze', state: 'f', failIndex: 0 })]);
    expect(upd?.url).toBe('https://x.cloud.databricks.us/pipelines/p1/updates/aaaa1111-0000-0000-0000-000000000002');
    expect(runs.every((r) => r.tasks !== undefined)).toBe(true);
  });

  it('replays task logs from any session, job and pipeline', async () => {
    const first = await record(richWorkspace);
    const failedJob = first.original!.runs.find((r) => r.type === 'job' && r.failed.length)!;
    const failedUpd = first.original!.runs.find((r) => r.type === 'pipeline' && r.failed.length)!;
    const withLogs = await record(richWorkspace, { logs: [[failedJob.id, failedJob.failed[0].name], [failedUpd.id, failedUpd.failed[0].name]] });
    const file = await roundTrip([withLogs.rec]);
    const src = createReplayProvider({}, { file, warn: () => {} }).forRequest({ headers: {} }) as RunSource;
    await src.listRuns();
    expect(await src.taskLog(failedJob.id, failedJob.failed[0].name)).toBe(withLogs.logs[0]);
    expect(await src.taskLog(failedUpd.id, failedUpd.failed[0].name)).toBe(withLogs.logs[1]);
  });

  it('replays a recorded error as the same SourceError', async () => {
    const body = '{"error_code":"TEMPORARILY_UNAVAILABLE","message":"The service is busy.","details":[{"@type":"x"}]}';
    const sdkErr = Object.assign(new Error(`Response from server (Service Unavailable) ${body}`), { statusCode: 503, errorCode: 'Service Unavailable' });
    const { error, rec } = await record({ ...richWorkspace, fail: { listJobRuns: sdkErr } });
    expect(error).toMatchObject({ status: 502, message: 'The service is busy.' });
    const file = await roundTrip([rec]);
    const src = createReplayProvider({}, { file, warn: () => {} }).forRequest({ headers: {} }) as RunSource;
    await expect(src.listRuns()).rejects.toMatchObject({ status: 502, message: 'The service is busy.' });
  });
});

describe('replay api matching', () => {
  const call = (seq: number, method: 'listJobRuns' | 'getRun', args: object, result: object) => ({ seq, method, args, startedAt: NOW, ms: 1, ok: true, result });
  const sess = (id: string, calls: ReturnType<typeof call>[]): SessionRecord => ({ id, route: '/api/runs', query: {}, authMode: 'user', startedAt: NOW, ms: 1, calls, diagnostics: [] });

  it('canonicalises args with a stable key order and no undefined', () => {
    expect(canon({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(canon({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });

  it('matches exactly on method and args, preferring the chosen session', async () => {
    const a = sess('a', [call(1, 'getRun', { run_id: 1 }, { run_id: 1, run_name: 'from a' })]);
    const b = sess('b', [call(1, 'getRun', { run_id: 1 }, { run_id: 1, run_name: 'from b' })]);
    const api = createReplayApi([a, b], b, () => {});
    expect((await api.getRun({ run_id: 1 })).run_name).toBe('from b');
  });

  it('falls back to the nearest same-method call and notes it', async () => {
    const notes: DiagNote[] = [];
    const s = sess('a', [
      call(1, 'listJobRuns', { expand_tasks: true, limit: 25, start_time_from: 100 }, { runs: [{ run_id: 1 }], next_page_token: 'p2' }),
      call(2, 'listJobRuns', { expand_tasks: true, limit: 25, start_time_from: 100, page_token: 'p2' }, { runs: [{ run_id: 2 }] }),
    ]);
    const api = createReplayApi([s], s, (n) => notes.push(n));
    const page2 = await api.listJobRuns({ expand_tasks: true, limit: 25, start_time_from: 999, page_token: 'p2' });
    expect(page2.runs?.[0].run_id).toBe(2);
    expect(notes).toEqual([expect.objectContaining({ level: 'warn', code: 'replay-mismatch', message: expect.stringContaining('seq 2') as unknown })]);
  });

  it('answers a call never recorded with a not-found error', async () => {
    const notes: DiagNote[] = [];
    const api = createReplayApi([sess('a', [])], undefined, (n) => notes.push(n));
    await expect(api.getRun({ run_id: 5 })).rejects.toMatchObject({ statusCode: 404, errorCode: 'RESOURCE_DOES_NOT_EXIST' });
    expect(notes[0].code).toBe('replay-miss');
  });
});

describe('choosing the session to replay', () => {
  const s = (id: string, route: string, startedAt: number, withCalls = true): SessionRecord => ({
    id, route, query: {}, authMode: 'user', startedAt, ms: 1, diagnostics: [],
    calls: withCalls ? [{ seq: 1, method: 'listJobRuns', args: {}, startedAt, ms: 1, ok: true, result: {} }] : [],
  });
  const file = (sessions: SessionRecord[]) => ({ sessions }) as CaptureFile;

  it('takes the newest sweep, else the newest /api/runs session that called the API', () => {
    expect(pickSession(file([s('r1', '/api/runs', 1), s('sw', '/api/diag/sweep', 2), s('r2', '/api/runs', 3)])).id).toBe('sw');
    expect(pickSession(file([s('r1', '/api/runs', 1), s('r2', '/api/runs', 3), s('cached', '/api/runs', 4, false)])).id).toBe('r2');
  });

  it('takes JOBS_CONSOLE_REPLAY_SESSION when given, and says which exist when it is not there', () => {
    const f = file([s('r1', '/api/runs', 1), s('r2', '/api/runs', 3)]);
    expect(pickSession(f, 'r1').id).toBe('r1');
    expect(() => pickSession(f, 'nope')).toThrow(/r1, r2/);
  });

  it('logs a warning with the replay diagnostics', async () => {
    const { rec } = await record(richWorkspace);
    const f = await roundTrip([rec]);
    const warn = vi.fn();
    const src = createReplayProvider({}, { file: f, warn }).forRequest({ headers: {} }) as RunSource;
    await src.listRuns(NOW - 1000); // a window the capture never asked for
    expect(warn.mock.calls.some(([m]) => /replay-mismatch/.test(String(m)))).toBe(true);
  });
});
