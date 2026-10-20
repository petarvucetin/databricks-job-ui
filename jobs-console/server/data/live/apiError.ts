import { SourceError } from '../sourceError';

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
  return { status, code, message: message + causeChain(e) };
}

/**
 * Network failures surface as "fetch failed"; the reason (TLS interception, DNS, proxy) is in `cause`.
 * Appends up to three levels, e.g. " (cause: self-signed certificate in certificate chain [SELF_SIGNED_CERT_IN_CHAIN])".
 */
function causeChain(e: unknown): string {
  const parts: string[] = [];
  let c = (e as { cause?: unknown } | null)?.cause;
  for (let i = 0; i < 3 && c; i++) {
    const x = c as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = typeof x.message === 'string' ? x.message : typeof c === 'string' ? c : JSON.stringify(c);
    parts.push(typeof x.code === 'string' && !msg.includes(x.code) ? `${msg} [${x.code}]` : msg);
    c = x.cause;
  }
  return parts.length ? ` (cause: ${parts.join(' <- ')})` : '';
}

/** SDK credential failures ("default auth: ...", "databricks-cli: cannot get access token") and unreachable workspaces. */
const SIGN_IN_OR_CONNECTION =
  /default auth|cannot configure default credentials|cannot get access token|failed to retrieve token|invalid_grant|refresh token|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i;

/**
 * A sign-in or connection failure (expired or missing CLI login, refused token, unreachable workspace) rather than a
 * fault in one request: 401/403 (as toSourceError keeps them), or an SDK credential or network error by its message.
 */
export function isSignInOrConnectionFailure(status: number | undefined, message: string): boolean {
  return status === 401 || status === 403 || SIGN_IN_OR_CONNECTION.test(message);
}

/** SDK failures as SourceError: auth stays 401/403, the rest is a bad gateway. With `lookup`, a missing or invalid id is 404. */
export function toSourceError(e: unknown, lookup = false): SourceError {
  if (e instanceof SourceError) return e;
  const { status: s, code, message } = apiErrorParts(e);
  if (s === 401) return new SourceError(401, message);
  if (s === 403 || code === 'PERMISSION_DENIED') return new SourceError(403, message);
  if (lookup && (s === 404 || code === 'RESOURCE_DOES_NOT_EXIST' || code === 'INVALID_PARAMETER_VALUE')) return new SourceError(404, message);
  return new SourceError(502, message);
}
