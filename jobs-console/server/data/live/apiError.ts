/**
 * Status, error code and message of an SDK ApiError. When the SDK can't parse an error body (0.17.0 fails on
 * `details` entries without `metadata`, e.g. RequestInfo) it reports "Response from server (Bad Request) {json}";
 * the code and message are recovered from that JSON.
 */
export function apiErrorParts(e: unknown): { status?: number; code: string; message: string } {
  const x = e as { statusCode?: unknown; errorCode?: unknown };
  const status = typeof x?.statusCode === 'number' ? x.statusCode : undefined;
  let code = typeof x?.errorCode === 'string' ? x.errorCode : '';
  let message = e instanceof Error ? e.message : String(e);
  const raw = /^Response from server \([^)]*\) (\{.*\})$/s.exec(message)?.[1];
  if (raw) {
    try {
      const body = JSON.parse(raw) as { error_code?: unknown; message?: unknown };
      if (typeof body.error_code === 'string') code = body.error_code;
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // not JSON after all: keep the SDK's message
    }
  }
  return { status, code, message };
}
