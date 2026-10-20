export type EnvName = 'dev' | 'stg' | 'prod';
export const ENV_NAMES: readonly EnvName[] = ['dev', 'stg', 'prod'];

export interface EnvSpec {
  name: EnvName;
  profile: string;
  warehouseId?: string;
}

function isEnvName(s: string): s is EnvName {
  return (ENV_NAMES as readonly string[]).includes(s);
}

/** Split "a=b, c=d" into trimmed [key, value] pairs; a bare item has value undefined. */
function pairs(raw: string): [string, string | undefined][] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const i = item.indexOf('=');
      return i < 0 ? [item, undefined] : [item.slice(0, i).trim(), item.slice(i + 1).trim()];
    });
}

/** Parse JOBS_CONSOLE_ENVS ("dev,stg=gov-stg") and JOBS_CONSOLE_WAREHOUSES ("dev=abc") into specs in dev→stg→prod order. */
export function parseEnvs(envsRaw: string | undefined, warehousesRaw: string | undefined): EnvSpec[] {
  if (!envsRaw?.trim()) return [];
  const byName = new Map<EnvName, EnvSpec>();
  for (const [name, profile] of pairs(envsRaw)) {
    if (!isEnvName(name)) {
      throw new Error(`JOBS_CONSOLE_ENVS: unknown env "${name}" (expected one of ${ENV_NAMES.join(', ')})`);
    }
    if (byName.has(name)) throw new Error(`JOBS_CONSOLE_ENVS: env "${name}" is listed twice`);
    if (profile === '') throw new Error(`JOBS_CONSOLE_ENVS: env "${name}" has an empty profile`);
    byName.set(name, { name, profile: profile ?? name });
  }
  for (const [name, id] of pairs(warehousesRaw ?? '')) {
    if (id === undefined || id === '') {
      throw new Error(`JOBS_CONSOLE_WAREHOUSES: "${name}" must be name=id`);
    }
    const spec = isEnvName(name) ? byName.get(name) : undefined;
    if (!spec) throw new Error(`JOBS_CONSOLE_WAREHOUSES: "${name}" is not in JOBS_CONSOLE_ENVS`);
    spec.warehouseId = id;
  }
  return ENV_NAMES.flatMap((n) => byName.get(n) ?? []);
}

/** A copy of `base` pinned to one env's profile and warehouse, with ambient host/token credentials removed. */
export function envRecord(
  base: Record<string, string | undefined>,
  spec: EnvSpec,
): Record<string, string | undefined> {
  const out = { ...base };
  out.DATABRICKS_CONFIG_PROFILE = spec.profile;
  out.DATABRICKS_WAREHOUSE_ID = spec.warehouseId;
  delete out.DATABRICKS_HOST;
  delete out.DATABRICKS_TOKEN;
  delete out.DATABRICKS_WORKSPACE_ID;
  return out;
}

/**
 * Process-wide target and credentials each env's own profile replaces. DATABRICKS_CONFIG_PROFILE stays: the SDK never
 * lets it override an explicit profile, and AppKit's own startup client (currentUser.me() in createApp) signs in with it.
 */
const AMBIENT = ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID'] as const;

/**
 * Multi-env (JOBS_CONSOLE_ENVS set): deletes the ambient DATABRICKS_HOST / _TOKEN / _WAREHOUSE_ID from `env`
 * (process.env: the SDK's Config reads environment variables before the profile file, so a host or token there would
 * win over an env's profile). Returns the names it deleted; [] when single-workspace, which is left alone. Throws on a
 * bad JOBS_CONSOLE_ENVS, as parseEnvs does.
 */
export function dropAmbientCredentials(env: Record<string, string | undefined>): string[] {
  if (parseEnvs(env.JOBS_CONSOLE_ENVS, env.JOBS_CONSOLE_WAREHOUSES).length === 0) return [];
  const dropped = AMBIENT.filter((k) => env[k] !== undefined);
  for (const k of dropped) delete env[k];
  return dropped;
}

/** The deployed env label from JOBS_CONSOLE_ENV; an invalid value warns and yields undefined. */
export function readEnvLabel(env: Record<string, string | undefined>): EnvName | undefined {
  const v = env.JOBS_CONSOLE_ENV?.trim();
  if (!v) return undefined;
  if (isEnvName(v)) return v;
  console.warn(`JOBS_CONSOLE_ENV: ignoring unknown env "${v}" (expected one of ${ENV_NAMES.join(', ')})`);
  return undefined;
}
