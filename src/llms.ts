import { list, text, type JsonLdNode } from "./jsonld.js";
import type { PageKind } from "./jsonld.js";

export interface LlmsPage {
  path: string;
  url: string;
  mdUrl: string;
  label: string;
  description?: string;
  kind: PageKind;
}

export interface LlmsSection {
  title: string;
  /** Path prefix, or a RegExp tested against the page path. */
  match: string | RegExp;
}

export interface LlmsOptions {
  /** Defaults to the business name from the homepage JSON-LD, then the homepage title. */
  title?: string;
  /** Defaults to the homepage meta description. */
  summary?: string;
  /** Extra lines added after the business details. */
  notes?: string[];
  /** Custom sections, checked in order before the defaults. */
  sections?: LlmsSection[];
}

export interface LlmsInput {
  origin: string;
  homeTitle: string;
  homeDescription?: string;
  business?: JsonLdNode;
  pages: LlmsPage[];
  options?: LlmsOptions;
}

const DEFAULT_SECTIONS: Array<{ title: string; kind: PageKind }> = [
  { title: "Main pages", kind: "page" },
  { title: "Services", kind: "service" },
  { title: "Services by area", kind: "service-area" },
  { title: "Blog", kind: "post" },
];

export function buildLlmsTxt(input: LlmsInput): string {
  const { origin, business, options = {} } = input;
  const name = options.title ?? text(business?.name) ?? input.homeTitle;
  const summary = options.summary ?? input.homeDescription;

  const out: string[] = [`# ${name}`, ""];
  if (summary) out.push(`> ${oneLine(summary)}`, "");

  const facts = businessFacts(business);
  if (facts.length) out.push(...facts.map((f) => `- ${f}`), "");
  for (const note of options.notes ?? []) out.push(note, "");

  out.push(
    `Every page on ${new URL(origin).host} is also available as markdown: add \`.md\` to the page path (for example ${input.pages.find((p) => p.path !== "/")?.mdUrl ?? `${origin}/index.md`}). The homepage is ${origin}/index.md. The links below point to the markdown copies.`,
    "",
  );

  const remaining = [...input.pages];
  const take = (predicate: (p: LlmsPage) => boolean) => {
    const picked: LlmsPage[] = [];
    for (let i = 0; i < remaining.length; ) {
      if (predicate(remaining[i])) picked.push(...remaining.splice(i, 1));
      else i++;
    }
    return picked;
  };

  const sections: Array<{ title: string; pages: LlmsPage[] }> = [];
  for (const custom of options.sections ?? []) {
    sections.push({ title: custom.title, pages: take((p) => matches(custom.match, p.path)) });
  }
  for (const def of DEFAULT_SECTIONS) {
    const existing = sections.find((s) => s.title === def.title);
    const pages = take((p) => p.kind === def.kind);
    if (existing) existing.pages.push(...pages);
    else sections.push({ title: def.title, pages });
  }

  for (const section of sections) {
    if (!section.pages.length) continue;
    out.push(`## ${section.title}`, "");
    for (const page of sortPages(section.pages)) {
      const desc = page.description ? `: ${oneLine(page.description)}` : "";
      out.push(`- [${escapeLabel(page.label)}](${page.mdUrl})${desc}`);
    }
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

function matches(match: string | RegExp, path: string): boolean {
  return typeof match === "string" ? path.startsWith(match) : match.test(path);
}

/** Homepage first, then parents before children, alphabetical within a level. */
function sortPages(pages: LlmsPage[]): LlmsPage[] {
  return [...pages].sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.localeCompare(b.path);
  });
}

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function businessFacts(business?: JsonLdNode): string[] {
  if (!business) return [];
  const facts: string[] = [];
  const phone = text(business.telephone);
  if (phone) facts.push(`Phone: ${phone}`);
  const email = text(business.email);
  if (email) facts.push(`Email: ${email}`);

  const address = business.address as JsonLdNode | undefined;
  if (address && typeof address === "object") {
    const street = text(address.streetAddress);
    const locality = [text(address.addressLocality), [text(address.addressRegion), text(address.postalCode)].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    if (street) facts.push(`Address: ${[street, locality].filter(Boolean).join(", ")}`);
    else if (locality) facts.push(`Based in: ${locality}`);
  }

  const hours = list(business.openingHoursSpecification)
    .map((spec) => formatHours(spec as JsonLdNode))
    .filter((h): h is string => Boolean(h));
  if (hours.length) facts.push(`Hours: ${hours.join("; ")}`);

  const areas = list(business.areaServed)
    .map((a) => (typeof a === "string" ? a : text((a as JsonLdNode)?.name)))
    .filter((a): a is string => Boolean(a));
  if (areas.length) facts.push(`Areas served: ${areas.join("; ")}`);

  const founded = text(business.foundingDate);
  if (founded) facts.push(`In business since: ${founded.slice(0, 4)}`);

  const map = text(business.hasMap);
  if (map) facts.push(`Google Maps: ${map}`);
  const profiles = list(business.sameAs).filter((s): s is string => typeof s === "string");
  if (profiles.length) facts.push(`Profiles: ${profiles.join(", ")}`);
  return facts;
}

function formatHours(spec: JsonLdNode | undefined): string | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const days = list(spec.dayOfWeek)
    .map((d) => (typeof d === "string" ? d.replace(/^https?:\/\/schema\.org\//, "") : ""))
    .filter((d) => DAY_ORDER.includes(d))
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const opens = text(spec.opens);
  const closes = text(spec.closes);
  if (!days.length || !opens || !closes) return undefined;
  const allDay = opens.startsWith("00:00") && (closes.startsWith("23:59") || closes.startsWith("00:00") || closes.startsWith("24:00"));
  return `${dayRanges(days)} ${allDay ? "24 hours" : `${opens.slice(0, 5)}–${closes.slice(0, 5)}`}`;
}

function dayRanges(days: string[]): string {
  if (days.length === 7) return "Every day";
  const idx = days.map((d) => DAY_ORDER.indexOf(d));
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= idx.length; i++) {
    if (i === idx.length || idx[i] !== idx[i - 1] + 1) {
      const from = days[start];
      const to = days[i - 1];
      parts.push(i - 1 - start >= 2 ? `${from} to ${to}` : days.slice(start, i).join(", "));
      start = i;
    }
  }
  return parts.join(", ");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeLabel(value: string): string {
  return value.replace(/([\[\]])/g, "\\$1");
}
