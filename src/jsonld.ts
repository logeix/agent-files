import type { HTMLElement } from "node-html-parser";

export type JsonLdNode = Record<string, unknown>;

/** Every node from every JSON-LD script on the page, with @graph and arrays flattened. */
export function readJsonLd(root: HTMLElement): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const node = value as JsonLdNode;
    if (Array.isArray(node["@graph"])) {
      (node["@graph"] as unknown[]).forEach(visit);
      return;
    }
    nodes.push(node);
  };
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent));
    } catch {
      // A broken block is the page's problem, not ours. Skip it.
    }
  }
  return nodes;
}

export function typesOf(node: JsonLdNode): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
  return [];
}

const BUSINESS_TYPES = new Set([
  "LocalBusiness",
  "HomeAndConstructionBusiness",
  "Plumber",
  "HVACBusiness",
  "Electrician",
  "RoofingContractor",
  "GeneralContractor",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "ProfessionalService",
]);

/** The page's business node: the one whose @id ends in #business, else the first local-business type. */
export function findBusiness(nodes: JsonLdNode[]): JsonLdNode | undefined {
  return (
    nodes.find((n) => typeof n["@id"] === "string" && (n["@id"] as string).endsWith("#business")) ??
    nodes.find((n) => typesOf(n).some((t) => BUSINESS_TYPES.has(t)))
  );
}

export type PageKind = "post" | "service" | "service-area" | "page";

export function pageKind(nodes: JsonLdNode[]): PageKind {
  if (nodes.some((n) => typesOf(n).some((t) => t === "BlogPosting" || t === "Article" || t === "NewsArticle"))) {
    return "post";
  }
  const service = nodes.find((n) => typesOf(n).includes("Service"));
  if (service) {
    const area = service.areaServed;
    const single = area && !Array.isArray(area);
    return single ? "service-area" : "service";
  }
  return "page";
}

export function articleDates(nodes: JsonLdNode[]): { published?: string; modified?: string } {
  const post = nodes.find((n) => typesOf(n).some((t) => t === "BlogPosting" || t === "Article" || t === "NewsArticle"));
  if (!post) return {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { published: str(post.datePublished), modified: str(post.dateModified) };
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
