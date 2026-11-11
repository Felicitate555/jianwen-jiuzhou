import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleLifeDirectorRequest } from '../supabase/functions/life-director-text/index.ts';
import { providerConfigured, type ProviderEnvironment } from '../supabase/functions/_shared/providerRouting.ts';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;

export interface LocalAiProxy {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface LocalAiProxyOptions {
  host?: string;
  port?: number;
  env?: ProviderEnvironment;
}

export function loadServerEnvironment(file = resolve(process.cwd(), '.env.server.local')): ProviderEnvironment {
  const fromFile: ProviderEnvironment = {};
  try {
    for (const sourceLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fromFile[key] = value;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
  return { ...fromFile, ...process.env };
}

function writeJson(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startLocalAiProxy(options: LocalAiProxyOptions = {}): Promise<LocalAiProxy> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const env = options.env ?? loadServerEnvironment();
  const server = createServer(async (incoming, outgoing) => {
    const path = new URL(incoming.url ?? '/', `http://${host}`).pathname;
    if (incoming.method === 'GET' && path === '/health') {
      writeJson(outgoing, 200, {
        status: 'ok',
        service: 'jianwen-life-director',
        aiConfigured: providerConfigured(env),
      });
      return;
    }
    if (path !== '/api/life-director-text') {
      writeJson(outgoing, 404, { error: 'not-found' });
      return;
    }
    try {
      const body = incoming.method === 'POST' ? await readBody(incoming) : undefined;
      const request = new Request(`http://${host}:${requestedPort}${path}`, {
        method: incoming.method,
        headers: incoming.headers as HeadersInit,
        body,
      });
      const result = await handleLifeDirectorRequest(request, key => env[key]);
      outgoing.statusCode = result.status;
      result.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      writeJson(outgoing, error instanceof Error && error.message === 'body-too-large' ? 413 : 500, {
        error: error instanceof Error && error.message === 'body-too-large' ? 'payload-too-large' : 'proxy-error',
      });
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  return {
    server,
    host,
    port,
    close: () => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  };
}

async function main(): Promise<void> {
  const env = loadServerEnvironment();
  const host = env.AI_PROXY_HOST?.trim() || DEFAULT_HOST;
  const parsedPort = Number(env.AI_PROXY_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT;
  const proxy = await startLocalAiProxy({ host, port, env });
  console.log(`剑问九州 AI Proxy 已就绪：http://${proxy.host}:${proxy.port}（AI ${providerConfigured(env) ? '已配置' : '未配置，将使用固定导演'}）`);
  const shutdown = () => void proxy.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => {
    console.error(`AI Proxy 启动失败：${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  });
}
