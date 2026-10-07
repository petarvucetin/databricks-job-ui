import { describe, it, expect, afterEach } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import { acceptsGzip, sendJson } from './gzip';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const BODY = { asOf: 1, source: 'live', runs: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `job_${i % 7}`, kind: 'succeeded' })) };

/** An express app answering GET /x with sendJson, on 127.0.0.1. */
async function serve(status = 200, body: unknown = BODY): Promise<number> {
  const app = express();
  app.get('/x', (req, res) => sendJson(req, res, status, body));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return (server.address() as AddressInfo).port;
}

function get(port: number, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/x', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    })
      .on('error', reject)
      .end();
  });
}

describe('sendJson (finding 4b)', () => {
  it('gzips when the request accepts it; the body decompresses to the same JSON', async () => {
    const port = await serve();
    const res = await get(port, { 'accept-encoding': 'gzip, deflate, br' });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(gunzipSync(res.body).toString('utf8'))).toEqual(BODY);
    expect(res.body.length).toBeLessThan(JSON.stringify(BODY).length / 5);
  });

  it('sends plain JSON, as res.json would, without gzip in Accept-Encoding; the status passes through', async () => {
    const port = await serve(502, { ...BODY, error: 'x' });
    const res = await get(port, {});
    expect(res.status).toBe(502);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers.vary).toMatch(/Accept-Encoding/);
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ ...BODY, error: 'x' });
  });

  it('leaves small bodies alone', async () => {
    const port = await serve(404, { error: 'no run 5' });
    const res = await get(port, { 'accept-encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ error: 'no run 5' });
  });

  it('reads Accept-Encoding with q-values', () => {
    expect(acceptsGzip('gzip')).toBe(true);
    expect(acceptsGzip('deflate, GZIP;q=0.5')).toBe(true);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('gzip;q=0, br')).toBe(false);
    expect(acceptsGzip('br, deflate')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});
