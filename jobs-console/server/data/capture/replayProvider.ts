import type { RunSource, RunSourceProvider } from '../runSource';
import { createLiveRunSource, createLiveState } from '../live/liveRunSource';
import { readLimits } from '../live/limits';
import type { DiagNote } from '../live/trace';
import { readCaptureFile, type CaptureFile } from './captureFile';
import type { SessionRecord } from './recorder';
import { createReplayApi } from './replayApi';

export const SWEEP_ROUTE = '/api/diag/sweep';

const calledList = (s: SessionRecord) => s.calls.some((c) => c.method === 'listJobRuns' || c.method === 'listPipelines');

/** JOBS_CONSOLE_REPLAY_SESSION if given; else the newest sweep; else the newest /api/runs session that reached the API (not a cache hit). */
export function pickSession(file: CaptureFile, id?: string): SessionRecord {
  const { sessions } = file;
  if (id) {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`JOBS_CONSOLE_REPLAY_SESSION "${id}" is not in the capture; sessions: ${sessions.map((x) => x.id).join(', ') || 'none'}`);
    return s;
  }
  const newest = (pred: (s: SessionRecord) => boolean) => [...sessions].filter(pred).sort((a, b) => b.startedAt - a.startedAt)[0];
  const s = newest((x) => x.route === SWEEP_ROUTE && calledList(x)) ?? newest((x) => x.route === '/api/runs' && calledList(x)) ?? newest(calledList);
  if (!s) throw new Error('the capture has no session that listed runs; nothing to replay');
  return s;
}

/**
 * The recorded lists a delta session was merged over: the /api/runs sessions of the same user before it, from the
 * last full load on (deltas in between included), oldest first. Empty for a full load or a capture without modes.
 */
export function baseChain(file: CaptureFile, picked: SessionRecord): SessionRecord[] {
  if (picked.refresh?.mode !== 'delta') return [];
  const prior = file.sessions
    .filter((s) => s !== picked && s.route === '/api/runs' && s.refresh && s.startedAt <= picked.startedAt && (s.user ?? '') === (picked.user ?? ''))
    .sort((a, b) => a.startedAt - b.startedAt);
  let i = prior.length - 1;
  while (i >= 0 && prior[i].refresh?.mode !== 'full') i--;
  return i < 0 ? [] : prior.slice(i);
}

const sinceOf = (s: SessionRecord): number | undefined => {
  const raw = s.query.since;
  return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : undefined;
};

export interface ReplayDeps {
  /** The capture itself (tests); default: read JOBS_CONSOLE_REPLAY. */
  file?: CaptureFile;
  warn?: (msg: string) => void;
}

/**
 * JOBS_CONSOLE_DATA=replay: the live source over a ReplayApi, frozen at the replayed session's asOf, with the limits it
 * ran with. Every request acts as the recorded user.
 */
export function createReplayProvider(env: Record<string, string | undefined>, deps: ReplayDeps = {}): RunSourceProvider & { session: SessionRecord; file: CaptureFile } {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let file = deps.file;
  if (!file) {
    if (!env.JOBS_CONSOLE_REPLAY) throw new Error('JOBS_CONSOLE_DATA=replay needs JOBS_CONSOLE_REPLAY=<path to a capture .json.gz>');
    file = readCaptureFile(env.JOBS_CONSOLE_REPLAY);
  }
  const session = pickSession(file, env.JOBS_CONSOLE_REPLAY_SESSION || undefined);
  const note = (n: DiagNote) => warn(`[replay] ${n.level} ${n.code}: ${n.message}`);
  const user = session.user ?? file.workspace.user ?? '';
  const state = createLiveState();
  const f = file;
  // Each recorded list replayed as it ran: its own calls first, frozen at its own asOf, in its own mode.
  const sourceFor = (s: SessionRecord, mode?: 'full' | 'delta') => {
    const now = s.now ?? s.startedAt;
    return createLiveRunSource({
      api: createReplayApi(f.sessions, s, note, f.workspace.host),
      user: () => Promise.resolve(user),
      userKey: 'replay',
      state,
      limits: s.limits ?? readLimits(f.config),
      clock: () => now,
      timer: Date.now,
      warn: (m) => warn(`[replay] ${m}`),
      source: 'replay',
      mode,
    });
  };
  // A delta session is replayed over the base its recorded predecessors built: replay those first (once, lazily).
  const chain = baseChain(file, session);
  if (session.refresh?.mode === 'delta' && !chain.length) warn(`[replay] ${session.id} was a delta but the capture has no full load before it; replaying it as a full load`);
  let primed: Promise<void> | undefined;
  const prime = () =>
    (primed ??= (async () => {
      for (const s of chain) await sourceFor(s, s.refresh?.mode).listRuns(sinceOf(s), undefined, { full: s.refresh?.mode === 'full' }).catch(() => undefined);
    })());
  const inner = sourceFor(session, chain.length ? session.refresh?.mode : undefined);
  const source: RunSource = {
    kind: inner.kind,
    listRuns: (since, tz, opts) => prime().then(() => inner.listRuns(since, tz, opts)),
    getRun: (id, tz) => prime().then(() => inner.getRun(id, tz)),
    taskLog: (id, task, hint) => prime().then(() => inner.taskLog(id, task, hint)),
    listItems: () => prime().then(() => inner.listItems()),
    getItem: (t, id) => prime().then(() => inner.getItem(t, id)),
  };
  const auth = file.config.authMode === 'app' ? 'app' : 'user';
  const now = session.now ?? session.startedAt;
  warn(
    `[replay] ${file.sessions.length} sessions in the capture; replaying ${session.id} (${session.route}, asOf ${new Date(now).toISOString()}, user ${user || 'unknown'}` +
      `${chain.length ? `, a delta over ${chain.map((s) => s.id).join(' -> ')}` : ''})`
  );
  return { kind: 'replay', auth, session, file, forRequest: () => source };
}
