import type { DataMode } from '../shared/domain/types';
import { ENV_NAMES, type EnvName } from './envs';
import { selectRunSource, type RequestLike, type RunSourceProvider } from './data/runSource';
import type { LiveProvider } from './data/live/liveProvider';
import { createSdkApi, resolveDefaultHost } from './data/live/api';
import { CaptureStore, readCaptureLimits } from './data/capture/recorder';
import type { CaptureFile } from './data/capture/captureFile';

/** One Databricks workspace the server reads: its provider, capture store and the facts /api/mode reports for it. */
export interface WorkspaceEnv {
  /** dev / stg / prod; undefined for an unlabelled single workspace. */
  name?: EnvName;
  /** The CLI profile this env reads with (DATABRICKS_CONFIG_PROFILE), when set. */
  profile?: string;
  /** The env record its provider was built from. */
  env: Record<string, string | undefined>;
  provider: RunSourceProvider;
  /** The provider, when live. */
  live?: LiveProvider;
  /** Live only: records every request for GET /api/diag/capture. */
  store?: CaptureStore;
  /** Everything GET /api/mode returns for this env except `envs`. `viewer`: the x-forwarded-email of the request. */
  mode(viewer: string | undefined, req: RequestLike): Promise<DataMode>;
}

export interface WorkspaceEnvDeps {
  select?: typeof selectRunSource;
  /** The SDK default chain's own identity on `profile`. */
  selfName?: (profile?: string) => Promise<string | undefined>;
  /** The workspace origin `profile` resolves to. */
  resolveHost?: (profile?: string) => Promise<string | undefined>;
}

/** People by email (matches the deployed viewer header); service principals by display name (their userName is a GUID). */
function sdkSelfName(profile?: string): Promise<string | undefined> {
  return createSdkApi({ profile })
    .me()
    .then((u) => (u.userName?.includes('@') ? u.userName : u.displayName || u.userName) || undefined);
}

const asEnvName = (v: string | undefined): EnvName | undefined => (ENV_NAMES as readonly (string | undefined)[]).includes(v) ? (v as EnvName) : undefined;

/** Builds one env's provider (and capture store when live) from `env`, with its own workspace and identity memos. */
export function createWorkspaceEnv(name: EnvName | undefined, env: Record<string, string | undefined>, deps: WorkspaceEnvDeps = {}): WorkspaceEnv {
  const provider = (deps.select ?? selectRunSource)(env);
  const live = provider.kind === 'live' ? (provider as LiveProvider) : undefined;
  const store = live ? new CaptureStore(readCaptureLimits(env)) : undefined;
  const profile = env.DATABRICKS_CONFIG_PROFILE || undefined;
  const file = provider.kind === 'replay' ? (provider as { file?: CaptureFile }).file : undefined;
  const lookupSelf = deps.selfName ?? sdkSelfName;
  const resolveHost = deps.resolveHost ?? resolveDefaultHost;

  const base: DataMode = { source: provider.kind, auth: provider.auth, capture: !!store };
  const envOf = file ? asEnvName(file.workspace?.env) ?? name : name;

  /**
   * Which workspace the top bar names. Deployed: DATABRICKS_HOST (set by Databricks Apps, sometimes without a scheme).
   * Local: the CLI profile's host. Replay: the capture's workspace. Cached.
   */
  let workspace: Promise<Pick<DataMode, 'workspace' | 'profile'>> | undefined;
  async function monitoredWorkspace(): Promise<Pick<DataMode, 'workspace' | 'profile'>> {
    if (file) return { workspace: file.workspace?.host || undefined };
    if (!live) return {};
    const host = env.DATABRICKS_HOST;
    if (host) return { workspace: (/^https?:\/\//.test(host) ? new URL(host) : new URL(`https://${host}`)).origin };
    return { workspace: await resolveHost(profile), profile };
  }

  /** The SDK default chain's own identity: the CLI login locally, the app's service principal on Databricks Apps. Cached; retried after a failure. */
  let defaultIdentity: Promise<string | undefined> | undefined;
  function selfName(): Promise<string | undefined> {
    defaultIdentity ??= lookupSelf(profile).catch(() => {
      defaultIdentity = undefined;
      return undefined;
    });
    return defaultIdentity;
  }

  /** Who is looking, and (when different) who the APIs are called as. See DataMode.user / readAs. */
  async function identity(viewer: string | undefined): Promise<Pick<DataMode, 'user' | 'readAs'>> {
    if (file) return { user: file.workspace?.user || undefined };
    if (!live) return {};
    if (!viewer) return { user: await selfName() }; // local: the CLI login is both
    return provider.auth === 'app' ? { user: viewer, readAs: await selfName() } : { user: viewer };
  }

  return {
    name,
    profile,
    env,
    provider,
    live,
    store,
    async mode(viewer, req) {
      if (provider.kind === 'mock') return { source: 'mock', capture: false, env: name };
      // History: live probes as the requester (cached 10 min); replay answers as recorded.
      const history = provider.history ? provider.history(req).catch((): undefined => undefined) : Promise.resolve(undefined);
      const [ws, who, h] = await Promise.all([(workspace ??= monitoredWorkspace()), identity(viewer), history]);
      return { ...base, ...ws, ...who, ...(h ? { history: h } : {}), env: envOf };
    },
  };
}
