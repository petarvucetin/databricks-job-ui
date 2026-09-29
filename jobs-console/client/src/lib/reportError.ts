/** Sends browser errors to /api/diag/client-error for the capture (live mode; elsewhere the POST just 404s). */
export function createErrorReporter(max: number): (error: unknown) => void {
  let sent = 0;
  return (error) => {
    if (sent >= max) return;
    sent++;
    const e = error instanceof Error ? error : undefined;
    const body = {
      message: e ? `${e.name}: ${e.message}` : String(error),
      stack: e?.stack ?? '',
      url: window.location.href,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    };
    try {
      fetch('/api/diag/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    } catch {
      // reporting must never add an error of its own
    }
  };
}

/** At most 20 per page load. */
export const reportClientError = createErrorReporter(20);

export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => reportClientError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportClientError(ev.reason));
}
