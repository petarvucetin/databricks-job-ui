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
  const warehouses = new Set<string>();
  for (const [name, id] of pairs(warehousesRaw ?? '')) {
    if (id === undefined || id === '') {
      throw new Error(`JOBS_CONSOLE_WAREHOUSES: "${name}" must be name=id`);
    }
    const spec = isEnvName(name) ? byName.get(name) : undefined;
    if (!spec) throw new Error(`JOBS_CONSOLE_WAREHOUSES: "${name}" is not in JOBS_CONSOLE_ENVS`);
    if (warehouses.has(name)) throw new Error(`JOBS_CONSOLE_WAREHOUSES: env "${name}" is listed twice`);
    warehouses.add(name);
    spec.warehouseId = id;
  }
  return ENV_NAMES.flatMap((n) => byName.get(n) ?? []);
}

/**
 * Process-wide target and credentials each env's own profile replaces: every credential attribute the SDK's Config
 * reads from the environment (it reads them before the profile file, so one there wins over an env's profile), plus
 * the warehouse. Not a DATABRICKS_* prefix: DATABRICKS_CONFIG_PROFILE stays (the SDK never lets it override an explicit
 * profile, and AppKit's startup client, currentUser.me() in createApp, signs in with it), as do DATABRICKS_CONFIG_FILE
 * and the DATABRICKS_APP_* settings.
 */
const AMBIENT = [
  'DATABRICKS_HOST',
  'DATABRICKS_TOKEN',
  'DATABRICKS_WAREHOUSE_ID',
  'DATABRICKS_WORKSPACE_ID',
  'DATABRICKS_AUTH_TYPE',
  'DATABRICKS_CLIENT_ID',
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_ACCOUNT_ID',
  'DATABRICKS_USERNAME',
  'DATABRICKS_PASSWORD',
  'DATABRICKS_AZURE_RESOURCE_ID',
  'DATABRICKS_AZURE_LOGIN_APP_ID',
  'DATABRICKS_GOOGLE_SERVICE_ACCOUNT',
  'GOOGLE_CREDENTIALS',
  'DATABRICKS_METADATA_SERVICE_URL',
  'ARM_CLIENT_ID',
  'ARM_CLIENT_SECRET',
  'ARM_TENANT_ID',
  'ARM_ENVIRONMENT',
  'ARM_USE_MSI',
] as const;

/**
 * A copy of `base` pinned to one env's profile and warehouse (none when the env has none), without the ambient
 * credentials (AMBIENT) or the other envs' config (JOBS_CONSOLE_ENVS / _WAREHOUSES, which captures would record).
 */
export function envRecord(
  base: Record<string, string | undefined>,
  spec: EnvSpec,
): Record<string, string | undefined> {
  const out = { ...base };
  for (const k of AMBIENT) delete out[k];
  delete out.JOBS_CONSOLE_ENVS;
  delete out.JOBS_CONSOLE_WAREHOUSES;
  out.DATABRICKS_CONFIG_PROFILE = spec.profile;
  if (spec.warehouseId) out.DATABRICKS_WAREHOUSE_ID = spec.warehouseId;
  return out;
}

/** Replay serves one captured workspace: JOBS_CONSOLE_ENVS (e.g. from .env) doesn't apply. */
export function isReplay(env: Record<string, string | undefined>): boolean {
  return env.JOBS_CONSOLE_DATA === 'replay';
}

/**
 * Multi-env (JOBS_CONSOLE_ENVS set, not replay): deletes the AMBIENT credentials and warehouse from `env` (process.env:
 * the SDK's Config reads environment variables before the profile file, so a host or token there would win over an
 * env's profile). Returns the names it deleted; [] when single-workspace or replay, which are left alone. Throws on a
 * bad JOBS_CONSOLE_ENVS, as parseEnvs does.
 */
export function dropAmbientCredentials(env: Record<string, string | undefined>): string[] {
  if (isReplay(env) || parseEnvs(env.JOBS_CONSOLE_ENVS, env.JOBS_CONSOLE_WAREHOUSES).length === 0) return [];
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
