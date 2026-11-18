import { fileURLToPath } from "node:url";
import { generate, type AgentFilesOptions, type Logger } from "./generate.js";

export type { AgentFilesOptions, IndexNowOptions } from "./generate.js";
export type { LlmsOptions, LlmsSection } from "./llms.js";
export { generate } from "./generate.js";

/** Structurally compatible with Astro's AstroIntegration, without depending on astro's types. */
export interface AgentFilesIntegration {
  name: string;
  hooks: {
    "astro:config:done": (args: { config: { site?: string } }) => void;
    "astro:build:done": (args: { dir: URL; logger: Logger }) => Promise<void>;
  };
}

/**
 * Writes a markdown copy of every indexable page, /llms.txt, the headers for both,
 * and (on production Cloudflare Pages builds) pings IndexNow with the pages that changed.
 * Add it after sitemap() in astro.config integrations.
 */
export default function agentFiles(options: AgentFilesOptions = {}): AgentFilesIntegration {
  let site: string | undefined;
  return {
    name: "@logeix/agent-files",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = config.site;
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!site) {
          logger.warn("No `site` set in astro.config, so no agent files were written.");
          return;
        }
        await generate({ distDir: fileURLToPath(dir), site, options, logger });
      },
    },
  };
}
