import { envRecord, parseEnvs, readEnvLabel, type EnvName, type EnvSpec } from './envs';
import { createWorkspaceEnv, type WorkspaceEnv } from './workspaceEnv';

/** Picks the WorkspaceEnv a request reads, from its `?env=` (multi-env), or the one workspace (single). */
export interface EnvRouter {
  /** The configured envs, dev → stg → prod; [] when single. */
  names: EnvName[];
  /** The request's env, or a 400 naming the choices when `?env=` is missing (with more than one configured) or unknown. */
  pick(req: { query: Record<string, unknown> }): WorkspaceEnv | { status: 400; error: string };
  /** For /api/mode, which never fails: a missing or unknown env gives the first. `envs` only with more than one configured. */
  modeFor(req: { query: Record<string, unknown> }): { env: WorkspaceEnv; envs?: EnvName[] };
  /** The envs created so far (for recording process errors). */
  built(): WorkspaceEnv[];
}

/**
 * Multi-env when JOBS_CONSOLE_ENVS is set (throws on a bad value): each env built on first use from `envRecord`, mock
 * envs told their variant. Else one WorkspaceEnv over `base`, built now, labelled by JOBS_CONSOLE_ENV; `?env=` ignored.
 */
export function createEnvRouter(base: Record<string, string | undefined>, make = createWorkspaceEnv): EnvRouter {
  const specs = parseEnvs(base.JOBS_CONSOLE_ENVS, base.JOBS_CONSOLE_WAREHOUSES);
  if (specs.length === 0) {
    const single = make(readEnvLabel(base), base);
    return { names: [], pick: () => single, modeFor: () => ({ env: single }), built: () => [single] };
  }

  const names = specs.map((s) => s.name);
  const mock = (base.JOBS_CONSOLE_DATA ?? 'mock') === 'mock';
  const envs = new Map<EnvName, WorkspaceEnv>();
  const get = (spec: EnvSpec): WorkspaceEnv => {
    let ws = envs.get(spec.name);
    if (!ws) {
      const record = envRecord(base, spec);
      if (mock) record.JOBS_CONSOLE_MOCK_VARIANT = spec.name;
      ws = make(spec.name, record);
      envs.set(spec.name, ws);
    }
    return ws;
  };
  /** The configured spec `?env=` names; undefined when missing or empty; null when anything else (unknown, repeated, not a string). */
  const specOf = (req: { query: Record<string, unknown> }): EnvSpec | undefined | null => {
    const v = req.query.env;
    if (v === undefined || v === '') return undefined;
    return (typeof v === 'string' && specs.find((s) => s.name === v)) || null;
  };

  return {
    names,
    pick(req) {
      const spec = specOf(req);
      if (spec) return get(spec);
      if (spec === undefined) {
        if (specs.length === 1) return get(specs[0]);
        return { status: 400, error: `Pick an environment: ?env=${names.join('|')}` };
      }
      return { status: 400, error: `Unknown environment "${String(req.query.env)}"; configured: ${names.join(', ')}` };
    },
    modeFor(req) {
      const env = get(specOf(req) || specs[0]);
      return names.length > 1 ? { env, envs: [...names] } : { env };
    },
    built: () => [...envs.values()],
  };
}
