import http from "node:http";
import type { TavilySearchArgs } from "./tavily.js";

export class UnixSearchProxyClient {
  constructor(private readonly socketPath: string, private readonly token: string) {}

  search(args: TavilySearchArgs, signal?: AbortSignal): Promise<{
    results: Array<{ url: string; title: string; snippet: string }>;
    truncated: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(args);
      const request = http.request({
        socketPath: this.socketPath,
        path: "/search",
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        signal,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode !== 200) reject(new Error(payload.error ?? "WORKER_UNAVAILABLE"));
            else resolve(payload.result);
          } catch (error) { reject(error); }
        });
      });
      request.once("error", reject);
      request.end(body);
    });
  }
}
