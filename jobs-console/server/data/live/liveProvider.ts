import { createHash } from 'node:crypto';
import type { RequestLike, RunSourceProvider } from '../runSource';
import { createSdkApi, type LiveApi } from './api';
import { readLimits } from './limits';
import { createLiveRunSource, createLiveState } from './liveRunSource';

export interface LiveProviderDeps {
  makeApi: (opts: { host?: string; token?: string }) => LiveApi;
  clock?: () => number;
}

const header = (req: RequestLike, name: string): string | undefined => {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : undefined;
};

const userNameOf = (api: LiveApi) => () => api.me().then((u) => u.userName ?? '');

/**
 * Deployed: each request acts as its user, with the token Databricks Apps forwards in x-forwarded-access-token.
 * Local dev without that header: the SDK default auth chain (DATABRICKS_CONFIG_PROFILE), user name from currentUser.me(), cached.
 * Production without a token: 401.
 */
export function createLiveProvider(env: Record<string, string | undefined>, deps: LiveProviderDeps = { makeApi: createSdkApi }): RunSourceProvider {
  const limits = readLimits(env);
  const state = createLiveState();
  const common = { state, limits, clock: deps.clock };
  let dev: { api: LiveApi; user?: Promise<string> } | undefined;

  return {
    kind: 'live',
    forRequest(req) {
      const token = header(req, 'x-forwarded-access-token');
      if (token) {
        const api = deps.makeApi({ host: env.DATABRICKS_HOST, token });
        const email = header(req, 'x-forwarded-email');
        const userKey = email ?? header(req, 'x-forwarded-user') ?? 'token:' + createHash('sha256').update(token).digest('hex').slice(0, 16);
        const user = email ? () => Promise.resolve(email) : userNameOf(api);
        return createLiveRunSource({ ...common, api, user, userKey });
      }
      if (env.NODE_ENV === 'development') {
        const d = (dev ??= { api: deps.makeApi({}) });
        const user = () => {
          d.user ??= userNameOf(d.api)().catch((e: unknown) => {
            d.user = undefined;
            throw e;
          });
          return d.user;
        };
        return createLiveRunSource({ ...common, api: d.api, user, userKey: 'dev' });
      }
      return { status: 401, error: 'Not signed in: the request has no forwarded user access token' };
    },
  };
}
