import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import type { ClientErrorRecord, ProcessRecord, SessionRecord } from './recorder';

export const CAPTURE_FORMAT = 'jobs-console-capture';
export const CAPTURE_VERSION = 1;

/** What GET /api/diag/capture downloads (gzipped) and JOBS_CONSOLE_REPLAY reads back. */
export interface CaptureFile {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  createdAt: string;
  app: { version: string; gitSha?: string; node: string };
  /** Every JOBS_CONSOLE_* value, DATABRICKS_HOST / _WAREHOUSE_ID / _WORKSPACE_ID and the auth mode: enough to replay with the same limits. */
  config: Record<string, string>;
  /** `env` / `profile`: the environment and CLI profile the capture was recorded from (multi-env). */
  workspace: { host?: string; user?: string; env?: string; profile?: string };
  /** Oldest first. */
  sessions: SessionRecord[];
  clientErrors: ClientErrorRecord[];
  process: ProcessRecord[];
}

/** Besides JOBS_CONSOLE_*: the host, and the warehouse and workspace the history SQL ran with (replay matches them exactly). */
const CONFIG_KEYS = new Set(['DATABRICKS_HOST', 'DATABRICKS_WAREHOUSE_ID', 'DATABRICKS_WORKSPACE_ID']);

export function captureConfig(env: Record<string, string | undefined>, authMode: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (v !== undefined && (k.startsWith('JOBS_CONSOLE_') || CONFIG_KEYS.has(k))) out[k] = v;
  }
  out.authMode = authMode;
  return out;
}

let appInfoCache: CaptureFile['app'] | undefined;

/** Package version, git sha when a checkout is there (JOBS_CONSOLE_GIT_SHA wins), node version. */
export function appInfo(env: Record<string, string | undefined> = process.env): CaptureFile['app'] {
  if (appInfoCache) return appInfoCache;
  let version = env.npm_package_version ?? '';
  if (!version) {
    try {
      version = (JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string }).version ?? '';
    } catch {
      version = 'unknown';
    }
  }
  let gitSha = env.JOBS_CONSOLE_GIT_SHA;
  if (!gitSha) {
    try {
      gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
    } catch {
      gitSha = undefined;
    }
  }
  appInfoCache = { version, ...(gitSha ? { gitSha } : {}), node: process.version };
  return appInfoCache;
}

export function buildCapture(input: {
  env: Record<string, string | undefined>;
  authMode: string;
  /** Workspace URL; default DATABRICKS_HOST. */
  host?: string;
  user?: string;
  /** The env (dev / stg / prod) and CLI profile recorded from; written to `workspace` when given. */
  envName?: string;
  profile?: string;
  sessions: SessionRecord[];
  clientErrors: ClientErrorRecord[];
  process: ProcessRecord[];
  now?: Date;
  app?: CaptureFile['app'];
}): CaptureFile {
  return {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    app: input.app ?? appInfo(input.env),
    config: captureConfig(input.env, input.authMode),
    workspace: {
      host: input.host ?? input.env.DATABRICKS_HOST,
      user: input.user,
      ...(input.envName ? { env: input.envName } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
    },
    sessions: input.sessions,
    clientErrors: input.clientErrors,
    process: input.process,
  };
}

/** jobs-console-capture-[<env>-]<host>-<yyyymmdd-hhmm>.json.gz, UTC. */
export function captureFileName(host: string | undefined, at: Date = new Date(), env?: string): string {
  const h = (host ?? 'local').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'local';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return `jobs-console-capture-${env ? `${env}-` : ''}${h}-${stamp}.json.gz`;
}

const gzipAsync = promisify(gzip);

export function gzipCapture(file: CaptureFile): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(file)));
}

/** Parses a capture file, gzipped or plain JSON. Throws on anything that is not a version 1 capture. */
export function readCapture(buf: Buffer): CaptureFile {
  const json = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const file = JSON.parse(json) as Partial<CaptureFile>;
  if (file.format !== CAPTURE_FORMAT) throw new Error(`not a ${CAPTURE_FORMAT} file (format ${JSON.stringify(file.format)})`);
  if (file.version !== CAPTURE_VERSION) throw new Error(`unsupported capture version ${JSON.stringify(file.version)}`);
  return { ...file, sessions: file.sessions ?? [], clientErrors: file.clientErrors ?? [], process: file.process ?? [] } as CaptureFile;
}

export function readCaptureFile(filePath: string): CaptureFile {
  return readCapture(readFileSync(filePath));
}
