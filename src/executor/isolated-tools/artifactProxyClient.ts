import http from "node:http";
import type { ArtifactListFilters, ArtifactListResult, ArtifactReadResult } from "../../db/artifactRepository.js";

export class UnixArtifactProxyClient {
  constructor(private readonly socketPath: string, private readonly token: string) {}

  list(args: ArtifactListFilters, signal?: AbortSignal): Promise<ArtifactListResult> {
    return this.call("/list", args, signal);
  }

  read(args: { artifactId: string }, signal?: AbortSignal): Promise<ArtifactReadResult> {
    return this.call("/read", args, signal);
  }

  private call<T>(path: "/list" | "/read", args: unknown, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(args);
      const request = http.request({
        socketPath: this.socketPath,
        path,
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
            else resolve(payload.result as T);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.once("error", reject);
      request.end(body);
    });
  }
}
