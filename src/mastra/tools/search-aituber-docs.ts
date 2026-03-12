import { createTool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { z } from 'zod';

const LIBRARY_ID = '/tegnike/aituber-kit-docs';

let context7Tools: Awaited<ReturnType<MCPClient['listTools']>> | undefined;
let queryDocsToolName: string | undefined;

async function getQueryDocsTool() {
  if (!context7Tools) {
    const context7 = new MCPClient({
      servers: {
        context7: {
          url: new URL("https://mcp.context7.com/mcp"),
        },
      },
    });
    context7Tools = await context7.listTools();
    queryDocsToolName = Object.keys(context7Tools).find(
      name => name.includes('query') && name.includes('doc')
    );
    if (!queryDocsToolName) {
      console.warn(
        '[search-aituber-docs] Context7 query-docs tool not found. Available:',
        Object.keys(context7Tools),
      );
    }
  }
  return queryDocsToolName ? context7Tools[queryDocsToolName] : undefined;
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
    const tool = await getQueryDocsTool();
    if (!tool) {
      return { error: 'Context7 query-docs tool is not available' };
    }

    const result = await tool.execute?.({
      libraryId: LIBRARY_ID,
      query: inputData.query,
    }, {});

    return result;
  },
});
