import { gzip } from 'node:zlib';
import type { Request, Response } from 'express';

/** Bodies smaller than this go out as they are: gzip would barely shrink them. */
const MIN_BYTES = 1024;

/** Does an Accept-Encoding header allow gzip (gzip or *, with a q-value above 0)? */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  return raw.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (name.trim() !== 'gzip' && name.trim() !== '*') return false;
    const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
    return q === undefined || Number(q) > 0;
  });
}

/**
 * Sends `body` as JSON with `status`, like res.status().json(), gzipped when the request accepts it (finding 4b): a
 * history-sized runs list is megabytes of JSON. Node's own zlib, off the event loop's critical path.
 */
export function sendJson(req: Pick<Request, 'headers'>, res: Response, status: number, body: unknown): void {
  const json = JSON.stringify(body) ?? '';
  res.status(status);
  res.vary('Accept-Encoding');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (Buffer.byteLength(json) < MIN_BYTES || !acceptsGzip(req.headers['accept-encoding'])) {
    res.send(json);
    return;
  }
  gzip(json, (err, zipped) => {
    if (err) {
      res.send(json);
      return;
    }
    res.setHeader('Content-Encoding', 'gzip');
    res.send(zipped);
  });
}
