import { createTool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { z } from 'zod';

const LIBRARY_ID = '/tegnike/aituber-kit-docs';

// Context7 MCPクライアント（AITuberKitドキュメント検索専用）
const context7 = new MCPClient({
  servers: {
    context7: {
      url: new URL("https://mcp.context7.com/mcp"),
    },
  },
});

// Context7ツールを取得（モジュール初期化時）
const context7Tools = await context7.listTools();
const queryDocsToolName = Object.keys(context7Tools).find(
  name => name.includes('query') && name.includes('doc')
);

if (!queryDocsToolName) {
  console.warn(
    '[search-aituber-docs] Context7 query-docs tool not found. Available:',
    Object.keys(context7Tools),
  );
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
    if (!queryDocsToolName) {
      return { error: 'Context7 query-docs tool is not available' };
    }

    const tool = context7Tools[queryDocsToolName];
    const result = await tool.execute?.({
      libraryId: LIBRARY_ID,
      query: inputData.query,
    }, {});

    return result;
  },
});
