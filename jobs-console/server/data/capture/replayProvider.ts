import type { RunSourceProvider } from '../runSource';
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
  const api = createReplayApi(file.sessions, session, note, file.workspace.host);
  const now = session.now ?? session.startedAt;
  const user = session.user ?? file.workspace.user ?? '';
  const source = createLiveRunSource({
    api,
    user: () => Promise.resolve(user),
    userKey: 'replay',
    state: createLiveState(),
    limits: session.limits ?? readLimits(file.config),
    clock: () => now,
    timer: Date.now,
    warn: (m) => warn(`[replay] ${m}`),
    source: 'replay',
  });
  const auth = file.config.authMode === 'app' ? 'app' : 'user';
  warn(`[replay] ${file.sessions.length} sessions in the capture; replaying ${session.id} (${session.route}, asOf ${new Date(now).toISOString()}, user ${user || 'unknown'})`);
  return { kind: 'replay', auth, session, file, forRequest: () => source };
}
