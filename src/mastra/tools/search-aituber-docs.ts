import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const LIBRARY_ID = '/tegnike/aituber-kit-docs';
const CONTEXT7_URL = 'https://mcp.context7.com/mcp';

/**
 * Context7 APIに直接HTTPリクエストを送信する
 * MCPクライアント経由だとWorkers環境で不安定なため、直接JSON-RPCを叩く
 */
async function queryContext7Docs(query: string): Promise<string> {
  const response = await fetch(CONTEXT7_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'query-docs',
        arguments: {
          libraryId: LIBRARY_ID,
          query,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Context7 API error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json() as {
    result?: { content?: { text?: string }[] };
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`Context7 API error: ${data.error.message}`);
  }

  return data.result?.content?.[0]?.text || 'ドキュメントが見つかりませんでした';
}

export const searchAituberDocs = createTool({
  id: 'search-aituber-docs',
  description:
    'AITuberKitのドキュメントを検索します。AITuberKitの機能、使い方、設定方法などについて質問された際に使用してください。',
  inputSchema: z.object({
    query: z
      .string()
      .describe('検索したい内容を具体的に記述してください'),
  }),
  execute: async (inputData) => {
    try {
      const result = await queryContext7Docs(inputData.query);
      return { content: result };
    } catch (e) {
      console.error('[search-aituber-docs] Error:', e);
      return { error: `ドキュメント検索に失敗しました: ${e}` };
    }
  },
});
