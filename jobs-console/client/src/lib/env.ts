/** The environment the page was opened for (`?env=`), if any. */
export function currentEnv(search = window.location.search): string | undefined {
  return new URLSearchParams(search).get('env') || undefined;
}

/** An /api path carrying the current env; unchanged when the page has none. */
export function apiUrl(path: string, search = window.location.search): string {
  const env = currentEnv(search);
  if (!env) return path;
  return `${path}${path.includes('?') ? '&' : '?'}env=${encodeURIComponent(env)}`;
}

/** A page query string (`?a=b`) for replaceState/pushState/window.open, with the current env kept last. */
export function pageQuery(params: Record<string, string>, search = window.location.search): string {
  const q = new URLSearchParams(params);
  q.delete('env');
  const env = currentEnv(search);
  if (env) q.set('env', env);
  // Commas stay readable (?compare=1,2); they are valid in a query.
  return `?${q.toString().replace(/%2C/g, ',')}`;
}

/** The URL that switches to an environment, optionally on a tab. */
export function envUrl(env: string, tab?: string): string {
  return `?env=${encodeURIComponent(env)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`;
}

/** A tab title naming the env (`PROD · Jobs console`); unchanged without one. */
export function pageTitle(base: string, env?: string): string {
  return env ? `${env.toUpperCase()} · ${base}` : base;
}
