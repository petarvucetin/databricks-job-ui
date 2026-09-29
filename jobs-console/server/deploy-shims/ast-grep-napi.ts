// Stand-in for @ast-grep/napi in the deploy bundle. AppKit imports it at load time, but only its dev tooling
// (Vite source-location plugin, serving type generation) calls it, and never in production.
// The real package is a native module per OS, so it can't be bundled into a folder deployed without npm install.
const unavailable = (): never => {
  throw new Error('@ast-grep/napi is not available in the deploy bundle (dev tooling only)');
};

export const Lang = new Proxy({}, { get: (_t, key) => String(key) }) as Record<string, string>;
export const parse = unavailable;
