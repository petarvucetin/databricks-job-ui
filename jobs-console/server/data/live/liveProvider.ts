import { createHash } from 'node:crypto';
import type { RequestLike, RunSourceProvider } from '../runSource';
import { createSdkApi, type LiveApi } from './api';
import { readLimits, readRefresh, type LiveLimits, type RefreshSettings } from './limits';
import { createLiveRunSource, createLiveState, historyInfoOf, probeHistory, type HistoryEntry, type LiveState } from './liveRunSource';
import type { HistoryInfo } from '../../../shared/domain/types';
import { readHistoryConfig, type HistoryConfig } from '../systables/config';
import { knownProbe } from '../systables/probe';

export interface LiveProviderDeps {
  makeApi: (opts: { host?: string; token?: string; profile?: string }) => LiveApi;
  clock?: () => number;
}

export type AuthMode = 'user' | 'app';

/** Who a request acts as, and the API that reads as them. */
export interface LiveIdentity {
  api: LiveApi;
  /** User name (email) of the requester, compared with runAs for `mine`. */
  user: () => Promise<string>;
  /** Identifies the requester in the cache; 'dev' for the local default auth chain. */
  userKey: string;
  /** Identifies who the APIs read as (history and probe caches): 'app' in app mode, where every viewer reads as the app; else userKey. */
  readKey: string;
}

export interface LiveProvider extends RunSourceProvider {
  readonly kind: 'live';
  readonly auth: AuthMode;
  readonly limits: LiveLimits;
  readonly refresh: RefreshSettings;
  readonly state: LiveState;
  /** DATABRICKS_WAREHOUSE_ID, DATABRICKS_WORKSPACE_ID, JOBS_CONSOLE_HISTORY. */
  readonly historyConfig: HistoryConfig;
  identify(req: RequestLike): LiveIdentity | { status: number; error: string };
  /**
   * Where this requester's run history comes from, as far as is known without waiting (finding 11): the cached probe
   * answer (and today's history read, for capped), or, with no warehouse, why not. Undefined when nothing is known yet
   * (the header then fills in from the first runs list) or they are not signed in.
   */
  history(req: RequestLike): Promise<HistoryInfo | undefined>;
}

const header = (req: RequestLike, name: string): string | undefined => {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : undefined;
};

const userNameOf = (api: LiveApi) => () => api.me().then((u) => u.userName ?? '');

/** me() once per process; a failure is not cached. */
function cachedUser(api: LiveApi): () => Promise<string> {
  let user: Promise<string> | undefined;
  return () => {
    user ??= userNameOf(api)().catch((e: unknown) => {
      user = undefined;
      throw e;
    });
    return user;
  };
}

export function readAuthMode(env: Record<string, string | undefined>): AuthMode {
  const raw = env.JOBS_CONSOLE_AUTH || 'user';
  if (raw !== 'user' && raw !== 'app') throw new Error(`JOBS_CONSOLE_AUTH must be user or app, got "${raw}"`);
  return raw;
}

/**
 * JOBS_CONSOLE_AUTH=user (default). Deployed: each request acts as its user, with the token Databricks Apps forwards in
 * x-forwarded-access-token. Local dev without that header: the SDK default auth chain (DATABRICKS_CONFIG_PROFILE), user
 * name from currentUser.me(), cached. Production without a token: 401.
 * JOBS_CONSOLE_AUTH=app: every request reads as the app's service principal (SDK default chain; on Databricks Apps
 * DATABRICKS_CLIENT_ID/SECRET), so users see what the SP was granted. x-forwarded-email still names the user for `mine`.
 */
export function createLiveProvider(env: Record<string, string | undefined>, deps: LiveProviderDeps = { makeApi: createSdkApi }): LiveProvider {
  const limits = readLimits(env);
  const refresh = readRefresh(env);
  const auth = readAuthMode(env);
  const historyConfig = readHistoryConfig(env);
  const state = createLiveState();
  let shared: { api: LiveApi; user: () => Promise<string> } | undefined;
  const defaultChain = () => {
    if (!shared) {
      const api = deps.makeApi(env.DATABRICKS_CONFIG_PROFILE ? { profile: env.DATABRICKS_CONFIG_PROFILE } : {});
      shared = { api, user: cachedUser(api) };
    }
    return shared;
  };

  function identify(req: RequestLike): LiveIdentity | { status: number; error: string } {
    const token = header(req, 'x-forwarded-access-token');
    const email = header(req, 'x-forwarded-email');
    if (auth === 'app') {
      const d = defaultChain();
      return { api: d.api, user: email ? () => Promise.resolve(email) : d.user, userKey: email ?? 'app', readKey: 'app' };
    }
    if (token) {
      const api = deps.makeApi({ host: env.DATABRICKS_HOST, token });
      const userKey = email ?? header(req, 'x-forwarded-user') ?? 'token:' + createHash('sha256').update(token).digest('hex').slice(0, 16);
      return { api, user: email ? () => Promise.resolve(email) : userNameOf(api), userKey, readKey: userKey };
    }
    if (env.NODE_ENV === 'development') {
      const d = defaultChain();
      return { api: d.api, user: d.user, userKey: 'dev', readKey: 'dev' };
    }
    return { status: 401, error: 'Not signed in: the request has no forwarded user access token' };
  }

  return {
    kind: 'live',
    auth,
    limits,
    refresh,
    state,
    historyConfig,
    identify,
    async history(req) {
      const id = identify(req);
      if ('error' in id) return undefined;
      // No warehouse, or off: known without a call.
      if (!historyConfig.enabled) return historyInfoOf(await probeHistory({ api: id.api, userKey: id.readKey, state, config: historyConfig, clock: deps.clock }), limits);
      const known = knownProbe(state.probes, id.readKey, (deps.clock ?? Date.now)());
      if (!known) return undefined;
      let hist: HistoryEntry | undefined;
      for (const [k, e] of state.history) if (k.startsWith(`${id.readKey}|`) && (!hist || e.at > hist.at)) hist = e;
      return historyInfoOf(known, limits, hist);
    },
    forRequest(req, trace) {
      const id = identify(req);
      if ('error' in id) return id;
      return createLiveRunSource({ ...id, state, limits, refresh, clock: deps.clock, trace, history: historyConfig });
    },
  };
}
