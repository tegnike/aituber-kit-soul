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
      // パース済みbodyを後続ミドルウェアで共有
      c.set('parsedBody', body);
      if (Array.isArray(body.messages) && body.messages.length > 1) {
        body.messages = [body.messages[body.messages.length - 1]];
      }
      // threadIdをMastraのmemory形式に変換
      if (typeof body.threadId === 'string' && !body.memory) {
        body.memory = { thread: body.threadId, resource: 'aituberkit-user' };
      }
      // 常にbodyを再構築（Workers環境ではjson()後にbodyが消費されるため）
      c.req.raw = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: JSON.stringify(body),
      });
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

  // lastMessageOnlyでパース済みのbodyを取得
  const body = c.get('parsedBody') as Record<string, unknown> | undefined;
  if (!body) {
    console.log('[saveMessages] no parsedBody, skipping');
    return next();
  }

  let userContent: string | undefined;
  let sessionId: string | undefined;

  // ユーザーメッセージ取得
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (typeof last.content === 'string') {
      userContent = last.content;
    }
  }

  // セッションID取得（memory.thread > threadId > 自動生成）
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
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  if (!userContent) {
    console.log('[saveMessages] no userContent, skipping');
    return next();
  }

  console.log('[saveMessages] will save for session:', sessionId);
  const isStream = c.req.path.endsWith('/stream');
  const capturedUserContent = userContent;
  const capturedSessionId = sessionId;

  await next();

  // Supabaseへの保存処理（Cloudflare Workers対応: waitUntilでバックグラウンド実行）
  const saveToSupabase = async (assistantText: string) => {
    if (!assistantText) return;
    try {
      await ensureSession(capturedSessionId);
      await saveMessage({ sessionId: capturedSessionId, role: 'user', content: capturedUserContent });
      await saveMessage({ sessionId: capturedSessionId, role: 'assistant', content: assistantText });
    } catch (e) {
      console.error('[saveMessages] save error:', e);
    }
  };

  // waitUntilが使えればバックグラウンドで実行（Cloudflare Workers）
  const waitUntil = (promise: Promise<unknown>) => {
    try {
      const ctx = c.executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(promise);
        return;
      }
    } catch {
      // executionCtxが存在しない環境（ローカル開発等）
    }
    // fallback: fire-and-forget
    promise.catch((e: unknown) => console.error('[saveMessages] background error:', e));
  };

  try {
    if (!isStream) {
      // /generate: JSONレスポンスからtextを取得
      const resClone = c.res.clone();
      waitUntil(
        resClone.json().then(async (data: Record<string, unknown>) => {
          const assistantText = typeof data.text === 'string' ? data.text : '';
          await saveToSupabase(assistantText);
        }).catch((e: unknown) => {
          console.error('[saveMessages] generate response parse error:', e);
        })
      );
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
      waitUntil(
        collectStreamText(collectStream).then(async (assistantText) => {
          await saveToSupabase(assistantText);
        }).catch((e: unknown) => {
          console.error('[saveMessages] stream collect error:', e);
        })
      );
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
