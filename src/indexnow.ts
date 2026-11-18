import { createHash } from "node:crypto";

/** Published at /agent-files.json so the next build can tell which pages changed. */
export interface PageManifest {
  version: 1;
  pages: Record<string, string>;
}

export const MANIFEST_PATH = "/agent-files.json";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Paths that are new or changed since `previous`, then paths that are gone. */
export function diffManifests(previous: PageManifest, next: PageManifest): { changed: string[]; removed: string[] } {
  const changed = Object.keys(next.pages).filter((path) => previous.pages[path] !== next.pages[path]);
  const removed = Object.keys(previous.pages).filter((path) => !(path in next.pages));
  return { changed, removed };
}

export function isValidKey(key: string): boolean {
  return /^[a-zA-Z0-9-]{8,128}$/.test(key);
}

export async function fetchManifest(origin: string, fetchImpl: typeof fetch = fetch): Promise<PageManifest | undefined> {
  try {
    const res = await fetchImpl(`${origin}${MANIFEST_PATH}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as PageManifest;
    if (body?.version !== 1 || typeof body.pages !== "object") return undefined;
    return body;
  } catch {
    return undefined;
  }
}

export interface SubmitInput {
  origin: string;
  key: string;
  urls: string[];
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/** Sends URLs to IndexNow in batches of 10,000. Returns one HTTP status per batch (0 for a network error). */
export async function submitIndexNow({ origin, key, urls, endpoint = INDEXNOW_ENDPOINT, fetchImpl = fetch }: SubmitInput): Promise<number[]> {
  const host = new URL(origin).host;
  const statuses: number[] = [];
  for (let i = 0; i < urls.length; i += 10_000) {
    const urlList = urls.slice(i, i + 10_000);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
        signal: AbortSignal.timeout(20_000),
      });
      statuses.push(res.status);
    } catch {
      statuses.push(0);
    }
  }
  return statuses;
}

export function describeStatus(status: number): string {
  switch (status) {
    case 200:
      return "200 accepted";
    case 202:
      return "202 accepted, key check pending";
    case 400:
      return "400 bad request";
    case 403:
      return "403 key not valid (is the key file live?)";
    case 422:
      return "422 URLs don't belong to the host, or the key doesn't match";
    case 429:
      return "429 too many requests";
    case 0:
      return "network error";
    default:
      return String(status);
  }
}
