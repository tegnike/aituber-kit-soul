import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { getNikechan } from './agents';

import { CloudflareDeployer } from "@mastra/deployer-cloudflare";
import type { Context, Next } from 'hono';
import { ensureSession, saveMessage } from './lib/supabase-message-store';

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

/** SSEストリームからtext-deltaを収集してassistantの全文を返す */
async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // 最後の要素は不完全な行の可能性があるのでバッファに残す
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'text-delta' && parsed.payload?.text) {
            result += parsed.payload.text;
          }
        } catch {
          // JSONパース失敗は無視
        }
      }
    }
  } catch (e) {
    console.error('[saveMessages] stream read error:', e);
  } finally {
    reader.releaseLock();
  }

  return result;
}

const saveMessages = async (c: Context, next: Next) => {
  if (
    c.req.method !== 'POST' ||
    !c.req.path.includes('/agents/') ||
    (!c.req.path.endsWith('/generate') && !c.req.path.endsWith('/stream'))
  ) {
    return next();
  }

  let body: Record<string, unknown>;
  let userContent: string | undefined;
  let sessionId: string | undefined;

  try {
    body = await c.req.json();

    // ユーザーメッセージ取得
    const messages = body.messages as Array<{ role: string; content: string }> | undefined;
    if (Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (typeof last.content === 'string') {
        userContent = last.content;
      }
    }

    // セッションID取得
    const memory = body.memory as Record<string, unknown> | undefined;
    if (memory?.thread) {
      if (typeof memory.thread === 'string') {
        sessionId = memory.thread;
      } else if (typeof memory.thread === 'object' && memory.thread !== null && 'id' in memory.thread) {
        sessionId = (memory.thread as { id: string }).id;
      }
    }
    if (!sessionId && typeof body.threadId === 'string') {
      sessionId = body.threadId;
    }

    // bodyを再構築（json()で消費されたため）
    c.req.raw = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: JSON.stringify(body),
    });
  } catch {
    return next();
  }

  if (!sessionId || !userContent) {
    return next();
  }

  const isStream = c.req.path.endsWith('/stream');
  const capturedUserContent = userContent;
  const capturedSessionId = sessionId;

  await next();

  // レスポンス側の処理
  try {
    if (!isStream) {
      // /generate: JSONレスポンスからtextを取得
      const resClone = c.res.clone();
      resClone.json().then(async (data: Record<string, unknown>) => {
        const assistantText = typeof data.text === 'string' ? data.text : '';
        if (!assistantText) return;
        try {
          await ensureSession(capturedSessionId);
          await saveMessage({ sessionId: capturedSessionId, role: 'user', content: capturedUserContent });
          await saveMessage({ sessionId: capturedSessionId, role: 'assistant', content: assistantText });
        } catch (e) {
          console.error('[saveMessages] generate save error:', e);
        }
      }).catch((e: unknown) => {
        console.error('[saveMessages] generate response parse error:', e);
      });
    } else {
      // /stream: SSEストリームを分岐して読み取り
      const originalBody = c.res.body;
      if (!originalBody) return;

      const [clientStream, collectStream] = originalBody.tee();

      // クライアントへのレスポンスを差し替え
      c.res = new Response(clientStream, {
        status: c.res.status,
        headers: c.res.headers,
      });

      // バックグラウンドでストリームを収集・保存
      collectStreamText(collectStream).then(async (assistantText) => {
        if (!assistantText) return;
        try {
          await ensureSession(capturedSessionId);
          await saveMessage({ sessionId: capturedSessionId, role: 'user', content: capturedUserContent });
          await saveMessage({ sessionId: capturedSessionId, role: 'assistant', content: assistantText });
        } catch (e) {
          console.error('[saveMessages] stream save error:', e);
        }
      }).catch((e: unknown) => {
        console.error('[saveMessages] stream collect error:', e);
      });
    }
  } catch (e) {
    console.error('[saveMessages] response processing error:', e);
  }
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
    middleware: [lastMessageOnly, saveMessages, apiKeyAuth],
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
