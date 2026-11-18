type JsonLdNode = Record<string, unknown>;
type PageKind = "post" | "service" | "service-area" | "page";

interface PageMeta {
    title: string;
    heading: string;
    description?: string;
    canonical?: string;
    robots?: string;
    lang?: string;
    kind: PageKind;
    published?: string;
    modified?: string;
    jsonld: JsonLdNode[];
}

interface LlmsSection {
    title: string;
    /** Path prefix, or a RegExp tested against the page path. */
    match: string | RegExp;
}
interface LlmsOptions {
    /** Defaults to the business name from the homepage JSON-LD, then the homepage title. */
    title?: string;
    /** Defaults to the homepage meta description. */
    summary?: string;
    /** Extra lines added after the business details. */
    notes?: string[];
    /** Custom sections, checked in order before the defaults. */
    sections?: LlmsSection[];
}

interface AgentFilesOptions {
    /** CSS selectors tried in order for the page's main content. Default: main, [role=main], body. */
    content?: string | string[];
    /** Extra CSS selectors removed from the content before conversion. */
    remove?: string[];
    /**
     * Paths to leave out, as path prefixes or RegExps. Pages with a noindex robots tag, a canonical
     * pointing elsewhere, or no sitemap entry are left out already.
     */
    exclude?: Array<string | RegExp>;
    /** llms.txt settings, or false to skip the file. */
    llms?: LlmsOptions | false;
    /** Add <link rel="alternate" type="text/markdown"> to each page's head. Default true. */
    alternateLink?: boolean;
    /** IndexNow pings for changed pages on production Cloudflare Pages builds. */
    indexNow?: IndexNowOptions | false;
}
interface IndexNowOptions {
    /** 8 to 128 characters: letters, digits and dashes. Published at /<key>.txt. */
    key: string;
    /** Cloudflare Pages branches that count as production. Default: master, main. */
    branches?: string[];
    endpoint?: string;
}
interface Logger {
    info(message: string): void;
    warn(message: string): void;
}
interface GenerateInput {
    distDir: string;
    site: string;
    options?: AgentFilesOptions;
    logger?: Logger;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
}
interface GenerateResult {
    pages: Array<{
        path: string;
        mdPath: string;
        meta: PageMeta;
    }>;
    skipped: Array<{
        path: string;
        reason: string;
    }>;
    indexNow: string;
}
declare function generate({ distDir, site, options, logger, env, fetchImpl, }: GenerateInput): Promise<GenerateResult>;

/** Structurally compatible with Astro's AstroIntegration, without depending on astro's types. */
interface AgentFilesIntegration {
    name: string;
    hooks: {
        "astro:config:done": (args: {
            config: {
                site?: string;
            };
        }) => void;
        "astro:build:done": (args: {
            dir: URL;
            logger: Logger;
        }) => Promise<void>;
    };
}
/**
 * Writes a markdown copy of every indexable page, /llms.txt, the headers for both,
 * and (on production Cloudflare Pages builds) pings IndexNow with the pages that changed.
 * Add it after sitemap() in astro.config integrations.
 */
declare function agentFiles(options?: AgentFilesOptions): AgentFilesIntegration;

export { type AgentFilesIntegration, type AgentFilesOptions, type IndexNowOptions, type LlmsOptions, type LlmsSection, agentFiles as default, generate };
