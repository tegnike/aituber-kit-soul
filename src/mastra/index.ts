import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { getNikechan } from './agents';

import { CloudflareDeployer } from "@mastra/deployer-cloudflare";
import type { Context, Next } from 'hono';

const logger = new PinoLogger({
  name: 'Mastra',
  level: 'debug',
});

const lastMessageOnly = async (c: Context, next: Next) => {
  if (
    c.req.method === 'POST' &&
    c.req.path.includes('/agents/') &&
    (c.req.path.endsWith('/generate') || c.req.path.endsWith('/stream'))
  ) {
    try {
      const body = await c.req.json();
      if (Array.isArray(body.messages) && body.messages.length > 1) {
        body.messages = [body.messages[body.messages.length - 1]];
        c.req.raw = new Request(c.req.url, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: JSON.stringify(body),
        });
      }
    } catch {
      // bodyのパースに失敗した場合はそのまま通す
    }
  }
  return next();
};

const apiKeyAuth = async (c: Context, next: Next) => {
  // /health はAPIキー不要
  if (c.req.path.endsWith('/health')) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  const apiKey = process.env.MASTRA_API_KEY;

  if (!apiKey) {
    // APIキーが未設定の場合はすべて許可（開発環境用）
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
};

export const mastra = new Mastra({
  agents: { nikechan: getNikechan() },
  logger,
  server: {
    middleware: [lastMessageOnly, apiKeyAuth],
  },
  deployer: new CloudflareDeployer({
    scope: process.env.CLOUDFLARE_ACCOUNT_ID!,
    projectName: process.env.CLOUDFLARE_PROJECT_NAME!,
    routes: [],
    auth: {
      apiToken: process.env.CLOUDFLARE_API_TOKEN!,
      apiEmail: process.env.CLOUDFLARE_API_EMAIL!,
    },
  }),
});
