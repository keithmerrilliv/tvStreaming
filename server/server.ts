/**
 * HTTP wiring (node:http, zero dependencies)
 * ──────────────────────────────────────────
 * The thinnest possible adapter from HTTP to the framework-agnostic handlers
 * in service.ts. Stateless. LAN-bound by default so the C9 bench device
 * (192.168.50.223) can hit zooshly (192.168.50.101) directly.
 *
 *   POST /probe-plan   ProbePlanRequest        → ProbePlan
 *   POST /resolve      { profile, context? }   → Verdict
 *   GET  /health       → { ok: true }
 *
 * Run: `npm run serve`  (PORT and HOST env override the defaults)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { CapabilityProfile, ProbePlanRequest } from '../shared/handshake';
import type { ResolveContext } from './resolver';
import { handleProbePlan, handleResolve } from './service';

const PORT = Number(process.env.PORT ?? 8088);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createServer((req, res) => {
  void route(req, res).catch((err) => {
    // The service layer already degrades resolution failures to a Baseline
    // verdict; this only catches transport-level problems (bad JSON, etc).
    sendJson(res, 400, { error: 'bad-request', detail: String(err) });
  });
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';

  if (req.method === 'GET' && url === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/probe-plan') {
    const body = await readJson<ProbePlanRequest>(req);
    return sendJson(res, 200, handleProbePlan(body));
  }

  if (req.method === 'POST' && url === '/resolve') {
    const body = await readJson<{ profile: CapabilityProfile; context?: ResolveContext }>(req);
    return sendJson(res, 200, handleResolve(body.profile, body.context ?? {}));
  }

  sendJson(res, 404, { error: 'not-found' });
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

server.listen(PORT, HOST, () => {
  console.log(`resolver service listening on http://${HOST}:${PORT}`);
});
