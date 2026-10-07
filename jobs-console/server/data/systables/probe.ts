import type { LiveApi } from '../live/api';
import { apiErrorParts } from '../live/apiError';
import { Deadline, TIMEOUT } from '../live/collect';
import type { HistoryConfig } from './config';
import { runSql } from './sql';

export const PROBE_SQL = 'SELECT 1 AS ok FROM system.lakeflow.job_run_timeline WHERE workspace_id = :ws LIMIT 1';

export type ProbeResult = { ok: true; workspaceId: string } | { ok: false; reason: string };

/** How long one user's answer is kept before the probe runs again (decision H5). */
const TTL_MS = 10 * 60_000;
/** Codes that mean the reading identity cannot read system.lakeflow (no grant, or the tables are not there). */
const NO_ACCESS = new Set(['PERMISSION_DENIED', 'INSUFFICIENT_PERMISSIONS', 'UNAUTHORIZED', 'TABLE_OR_VIEW_NOT_FOUND', 'SCHEMA_NOT_FOUND', 'CATALOG_NOT_FOUND']);

/**
 * The most specific code of a failed probe. The Statement API's own error_code is coarse (BAD_REQUEST, NOT_FOUND), so a
 * known code named in the message ("[INSUFFICIENT_PERMISSIONS] ...") wins; then the error's code; an HTTP 403 is PERMISSION_DENIED.
 */
function failure(e: unknown): { code: string; message: string } {
  const { status, code: sdkCode, message } = apiErrorParts(e);
  const own = (e as { code?: unknown } | null)?.code;
  const named = /\[([A-Z][A-Z0-9_]+)\]/.exec(message)?.[1];
  const code = (named && NO_ACCESS.has(named) ? named : '') || (typeof own === 'string' ? own : '') || sdkCode || (status === 403 ? 'PERMISSION_DENIED' : '');
  return { code, message };
}

/** Why a failed system-table read falls back to the API: no access (with the code), or the warehouse's error. */
export function sqlFailureReason(e: unknown): string {
  return sqlFailure(e).reason;
}

/** A result over the INLINE disposition's limit (25 MiB): the same query fails the same way all day. */
const TOO_LARGE = /INLINE|BYTE_LIMIT|too large|too big|\bsize\b/i;

/**
 * Why a system-table read failed, and whether that lasts (finding 2c): no access, a missing table, or a result too
 * large fail the same way on every retry today; anything else (the warehouse starting, a network error) may not.
 */
export function sqlFailure(e: unknown): { reason: string; lasting: boolean } {
  const { code, message } = failure(e);
  if (NO_ACCESS.has(code)) return { reason: `no access to system.lakeflow (${code})`, lasting: true };
  return { reason: `warehouse error: ${message}`, lasting: TOO_LARGE.test(code) || TOO_LARGE.test(message) };
}

/** Each reading identity's probe answer and when it was asked; `value` once it has answered. */
export type ProbeCache = Map<string, { at: number; result: Promise<ProbeResult>; value?: ProbeResult }>;

/** The answer `cache` already has for `key` (not one still being asked), while it is kept (10 minutes). */
export function knownProbe(cache: ProbeCache, key: string, now: number): ProbeResult | undefined {
  const hit = cache.get(key);
  return hit && now - hit.at < TTL_MS ? hit.value : undefined;
}

/**
 * Can this reading identity read the system tables? Answers ok with the workspace id to filter by, or the reason the
 * app falls back to the API alone. Each user's answer (either way) is kept for 10 minutes, in `cache` when given (so a
 * probe made per request, over that request's API, shares the answers).
 */
export function createHistoryProbe(o: { api: LiveApi; config: HistoryConfig; clock?: () => number; timeoutMs?: number; cache?: ProbeCache }): { check(userKey: string): Promise<ProbeResult> } {
  const clock = o.clock ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 30_000;
  const cache: ProbeCache = o.cache ?? (new Map() as ProbeCache);

  async function probe(): Promise<ProbeResult> {
    const { api, config } = o;
    if (config.off) return { ok: false, reason: 'history off' };
    if (!config.warehouseId) return { ok: false, reason: 'no SQL warehouse configured' };
    // The budget is real time (Date.now), not `clock`, which only ages the cache.
    const dl = new Deadline(Date.now() + timeoutMs);
    let ws = config.workspaceId ?? '';
    if (!ws) {
      const got = await dl.call(() => api.workspaceId()).catch(() => '');
      if (got === TIMEOUT) return { ok: false, reason: 'timed out' };
      ws = got;
    }
    if (!ws) return { ok: false, reason: 'no workspace id' };
    try {
      const rows = await runSql(api, config.warehouseId, PROBE_SQL, { ws }, dl);
      if (rows === TIMEOUT) return { ok: false, reason: 'timed out' };
      return { ok: true, workspaceId: ws };
    } catch (e) {
      return { ok: false, reason: sqlFailureReason(e) };
    }
  }

  return {
    check(userKey) {
      const now = clock();
      const hit = cache.get(userKey);
      if (hit && now - hit.at < TTL_MS) return hit.result;
      const result = probe();
      const entry: { at: number; result: Promise<ProbeResult>; value?: ProbeResult } = { at: now, result };
      void result.then(
        (v) => (entry.value = v),
        () => undefined
      );
      cache.set(userKey, entry);
      return result;
    },
  };
}
