import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { MCPClient } from "@mastra/mcp";

const mcp = new MCPClient({
  servers: {
    supabase: {
      "command": "/Users/user/.volta/bin/npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        process.env.SUPABASE_ACCESS_TOKEN || "",
        "--project-ref",
        process.env.SUPABASE_PROJECT_REF || "",
        "--read-only"
      ]
    },
  },
});

const allTools = await mcp.listTools();
const toolsToExclude = ['supabase_execute_sql'];
const filteredTools = Object.fromEntries(
  Object.entries(allTools).filter(([toolName]) => !toolsToExclude.includes(toolName))
);

export const nikechan = new Agent({
  id: 'test-agent',
  name: 'Your Agent',
  instructions: `You are a helpful assistant.`,
  model: openai("gpt-4.1-mini"),
  tools: filteredTools,
});
