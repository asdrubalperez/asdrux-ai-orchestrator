export interface TavilySearchArgs {
  query: string;
  maxResults?: number;
}

export function buildTavilyRequest(args: TavilySearchArgs): Record<string, unknown> {
  const query = args.query.trim();
  if (!query || query.length > 500) throw new Error("INVALID_ARGUMENTS");
  const maxResults = args.maxResults ?? 10;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) throw new Error("INVALID_ARGUMENTS");
  return {
    query,
    search_depth: "basic",
    max_results: maxResults,
    topic: "general",
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    auto_parameters: false,
    safe_search: true,
  };
}

export function normalizeTavilyResponse(value: unknown, maxResults = 10): {
  results: Array<{ url: string; title: string; snippet: string }>;
  truncated: boolean;
} {
  if (!value || typeof value !== "object" || !Array.isArray((value as { results?: unknown }).results)) {
    throw new Error("INTERNAL_ERROR");
  }
  const source = (value as { results: unknown[] }).results;
  let discarded = false;
  const results: Array<{ url: string; title: string; snippet: string }> = [];
  for (const item of source) {
    if (results.length >= maxResults) break;
    if (!item || typeof item !== "object") { discarded = true; continue; }
    const { url, title, content } = item as Record<string, unknown>;
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== "https:" || typeof title !== "string" || !title.trim() ||
          typeof content !== "string" || !content.trim()) throw new Error();
      results.push({ url: parsed.href, title: title.trim(), snippet: content.trim() });
    } catch {
      discarded = true;
    }
  }
  return { results, truncated: source.length >= maxResults || discarded };
}

export class TavilySearchProxy {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("WORKER_UNAVAILABLE");
  }

  async search(args: TavilySearchArgs, signal?: AbortSignal) {
    const request = buildTavilyRequest(args);
    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(response.status === 429 || response.status >= 500 ? "WORKER_UNAVAILABLE" : "INTERNAL_ERROR");
    return normalizeTavilyResponse(await response.json(), request.max_results as number);
  }
}
