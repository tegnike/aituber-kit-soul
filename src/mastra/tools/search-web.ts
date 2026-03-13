import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tavily MCP ServerにJSON-RPCでリクエストを送信する
 */
async function tavilySearch(query: string): Promise<string> {
  const mcpUrl = process.env.TAVILY_MCP_SERVER_URL;
  if (!mcpUrl) {
    throw new Error('TAVILY_MCP_SERVER_URL is not set');
  }

  const response = await fetch(mcpUrl, {
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
        name: 'tavily_search',
        arguments: {
          query,
          max_results: 5,
          search_depth: 'basic',
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error (${response.status}): ${await response.text()}`);
  }

  // SSE形式のレスポンスをパースする
  const text = await response.text();
  const dataLine = text.split('\n').find(line => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error('Tavily API: no data in response');
  }

  const data = JSON.parse(dataLine.slice(6)) as {
    result?: { content?: { text?: string }[] };
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`Tavily API error: ${data.error.message}`);
  }

  return data.result?.content?.[0]?.text || '検索結果が見つかりませんでした';
}

export const searchWeb = createTool({
  id: 'search-web',
  description:
    'インターネットで最新情報を検索します。ニュース、事実、データなど、あなたの知識にない情報を調べる際に使用してください。',
  inputSchema: z.object({
    query: z
      .string()
      .describe('検索したい内容を具体的に記述してください'),
  }),
  execute: async (inputData) => {
    try {
      const result = await tavilySearch(inputData.query);
      return { content: result };
    } catch (e) {
      console.error('[search-web] Error:', e);
      return { error: `Web検索に失敗しました: ${e}` };
    }
  },
});
