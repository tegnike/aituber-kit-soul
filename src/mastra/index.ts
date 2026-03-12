import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { getNikechan } from './agents';

import { CloudflareDeployer } from "@mastra/deployer-cloudflare";

const logger = new PinoLogger({
  name: 'Mastra',
  level: 'debug',
});

export const mastra = new Mastra({
  agents: { nikechan: getNikechan() },
  logger,
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
