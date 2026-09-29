import { describe, it, expect } from 'vitest';
import { CaptureStore, Session, readCaptureLimits } from './recorder';
import { fakeApi } from '../live/fakeApi';

const NOW = 1_800_000_000_000;

const session = (id: string, over: Partial<ConstructorParameters<typeof Session>[0]> = {}) =>
  new Session({ id, route: '/api/runs', query: {}, authMode: 'user', ...over }, () => NOW);

describe('recording calls', () => {
  it('records each call in order with args, timing and result', async () => {
    const s = session('s1');
    const api = s.wrap(fakeApi({ user: 'ann@x.com', runs: [{ run_id: 1, start_time: NOW }] }));
    await api.me();
    await api.listJobRuns({ start_time_from: 5, limit: 25, page_token: undefined });
    const rec = s.finish({ status: 200 });
    expect(rec.calls.map((c) => [c.seq, c.method, c.ok])).toEqual([[1, 'me', true], [2, 'listJobRuns', true]]);
    expect(rec.calls[1].args).toEqual({ start_time_from: 5, limit: 25 });
    expect(rec.calls[1].result).toMatchObject({ runs: [{ run_id: 1 }] });
    expect(rec.calls[0]).toMatchObject({ startedAt: NOW, ms: 0 });
  });

  it('records an error with the code and message recovered from a body the SDK could not parse', async () => {
    const body = '{"error_code":"INVALID_PARAMETER_VALUE","message":"Run 9 does not exist.","details":[{"@type":"x"}]}';
    const err = Object.assign(new Error(`Response from server (Bad Request) ${body}`), { name: 'ApiError', statusCode: 400, errorCode: 'Bad Request' });
    const s = session('s1');
    const api = s.wrap(fakeApi({ fail: { getRun: err } }));
    await expect(api.getRun({ run_id: 9 })).rejects.toBe(err);
    const [call] = s.finish({ status: 404 }).calls;
    expect(call.ok).toBe(false);
    expect(call.result).toBeUndefined();
    expect(call.error).toMatchObject({ name: 'ApiError', statusCode: 400, errorCode: 'INVALID_PARAMETER_VALUE', message: 'Run 9 does not exist.', raw: err.message });
    expect(call.error?.stack).toContain('Error');
  });

  it('marks calls still in flight when the request finished as cut off', async () => {
    const s = session('s1');
    const api = s.wrap(fakeApi({ delay: 20 }));
    const pending = api.listPipelines({});
    const rec = s.finish({ status: 200 });
    await pending;
    expect(rec.calls[0]).toMatchObject({ method: 'listPipelines', cutOff: true, ok: true });
  });

  it('never records tokens or request headers', async () => {
    const s = session('s1', { query: { since: '1' }, user: 'ann@x.com' });
    const api = s.wrap(fakeApi({}));
    await api.listPipelines({ max_results: 100 });
    const json = JSON.stringify(s.finish({ status: 200 }));
    expect(json).not.toMatch(/token|authorization|x-forwarded/i);
    expect(Object.keys(JSON.parse(json) as object).sort()).toEqual(
      ['authMode', 'calls', 'diagnostics', 'id', 'ms', 'query', 'responseSummary', 'route', 'startedAt', 'user'].sort()
    );
  });

  it('keeps diagnostics, the asOf and the response summary', () => {
    const s = session('s1');
    s.diag({ level: 'warn', code: 'cap-hit', message: 'cap' });
    s.note({ now: NOW - 5, user: 'ann@x.com' });
    const rec = s.finish({ status: 200, body: { asOf: 1, source: 'live', runs: [{ kind: 'failed', type: 'job' }, { kind: 'failed', type: 'pipeline' }, { kind: 'running', type: 'job' }] } });
    expect(rec).toMatchObject({ now: NOW - 5, user: 'ann@x.com', diagnostics: [{ code: 'cap-hit' }] });
    expect(rec.responseSummary).toEqual({ status: 200, runCount: 3, byKind: { failed: 2, running: 1 }, byType: { job: 2, pipeline: 1 } });
  });
});

describe('capture store', () => {
  const finished = (id: string, pad = 0) => {
    const s = session(id);
    if (pad) s.diag({ level: 'info', code: 'pad', message: 'x'.repeat(pad) });
    return s.finish({ status: 200 });
  };

  it('keeps the newest N sessions', () => {
    const store = new CaptureStore({ maxSessions: 3, maxBytes: 1e9 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.add(finished(id));
    expect(store.sessions().map((s) => s.id)).toEqual(['c', 'd', 'e']);
  });

  it('drops the oldest sessions past the byte budget, but always keeps the newest', () => {
    const store = new CaptureStore({ maxSessions: 100, maxBytes: 5000 });
    for (const id of ['a', 'b', 'c']) store.add(finished(id, 2000));
    expect(store.sessions().map((s) => s.id)).toEqual(['b', 'c']);
    expect(store.bytes).toBeLessThanOrEqual(5000);
    store.add(finished('huge', 20000));
    expect(store.sessions().map((s) => s.id)).toEqual(['huge']);
  });

  it('bounds client errors and process notes', () => {
    const store = new CaptureStore({ maxSessions: 1, maxBytes: 1e9 });
    for (let i = 0; i < 250; i++) {
      store.addClientError({ message: `m${i}`, stack: '', url: '', userAgent: '', at: '' });
      store.addProcess({ kind: 'unhandledRejection', message: `p${i}` });
    }
    expect(store.clientErrors()).toHaveLength(200);
    expect(store.clientErrors()[0].message).toBe('m50');
    expect(store.process()).toHaveLength(200);
  });

  it('reads its limits from env', () => {
    expect(readCaptureLimits({})).toEqual({ maxSessions: 20, maxBytes: 200 * 1024 * 1024 });
    expect(readCaptureLimits({ JOBS_CONSOLE_CAPTURE_SESSIONS: '5', JOBS_CONSOLE_CAPTURE_MB: '1' })).toEqual({ maxSessions: 5, maxBytes: 1024 * 1024 });
    expect(() => readCaptureLimits({ JOBS_CONSOLE_CAPTURE_MB: 'big' })).toThrow('JOBS_CONSOLE_CAPTURE_MB');
  });
});
