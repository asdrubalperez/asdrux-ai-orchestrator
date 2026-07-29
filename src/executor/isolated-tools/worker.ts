import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertClosedArgs, DEFAULT_MAX_BYTES, IsolatedToolName, IsolatedToolPolicy,
  MAX_CALLS_PER_INVOCATION, MAX_CALL_MS,
} from "./contracts.js";
import { assertPublicHttpsUrl, resolveWorktreePath } from "./security.js";
import type { TavilySearchProxy } from "./tavily.js";
import type { UnixArtifactProxyClient } from "./artifactProxyClient.js";

export interface WorkerOptions {
  worktree: string;
  policy: IsolatedToolPolicy;
  searchProxy?: Pick<TavilySearchProxy, "search">;
  artifactProxy?: Pick<UnixArtifactProxyClient, "list" | "read">;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export class IsolatedToolWorker {
  #calls = 0;
  constructor(private readonly options: WorkerOptions) {
    for (const secret of [
      "ANTHROPIC_API_KEY", "CODEX_API_KEY", "TAVILY_API_KEY", "DATABASE_URL", "DATABASE_URL_DEV",
      "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    ]) {
      if (options.env?.[secret]) throw new Error(`SECRET_IN_WORKER_ENV:${secret}`);
    }
  }

  async call(tool: IsolatedToolName, rawArgs: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.options.policy.tools.includes(tool)) throw new Error("TOOL_NOT_FOUND");
    if (++this.#calls > MAX_CALLS_PER_INVOCATION) throw new Error("CALL_LIMIT_EXCEEDED");
    const args = assertClosedArgs(tool, rawArgs);
    switch (tool) {
      case "fs_read": return this.fsRead(args);
      case "fs_search": return this.fsSearch(args);
      case "fs_glob": return this.fsGlob(args);
      case "fs_write": return this.fsWrite(args);
      case "fs_edit": return this.fsEdit(args);
      case "command_exec": return this.commandExec(args, signal);
      case "web_search":
        if (!this.options.searchProxy) throw new Error("WORKER_UNAVAILABLE");
        return this.options.searchProxy.search(args as unknown as { query: string; maxResults?: number }, signal);
      case "web_fetch": return this.webFetch(args, signal);
      case "artifact_list":
        if (!this.options.artifactProxy) throw new Error("WORKER_UNAVAILABLE");
        return this.options.artifactProxy.list(args, signal);
      case "artifact_read":
        if (!this.options.artifactProxy) throw new Error("WORKER_UNAVAILABLE");
        return this.options.artifactProxy.read(args as unknown as { artifactId: string }, signal);
    }
  }

  private async fsRead(args: Record<string, unknown>) {
    const file = await resolveWorktreePath(this.options.worktree, String(args.path));
    const data = await fs.readFile(file);
    if (data.includes(0)) throw new Error("BINARY_FILE");
    const offset = Number(args.offset ?? 0);
    const limit = Number(args.limitBytes ?? DEFAULT_MAX_BYTES);
    const slice = data.subarray(offset, offset + limit);
    return { content: slice.toString("utf8"), bytesRead: slice.length, truncated: offset + slice.length < data.length };
  }

  private async fsWrite(args: Record<string, unknown>) {
    assertNotProtectedFeaturePath(String(args.path));
    const file = await resolveWorktreePath(this.options.worktree, String(args.path), { allowMissingLeaf: true });
    const content = String(args.content);
    await fs.writeFile(file, content, { encoding: "utf8", flag: args.createOnly ? "wx" : "w" });
    return { bytesWritten: Buffer.byteLength(content) };
  }

  private async fsEdit(args: Record<string, unknown>) {
    assertNotProtectedFeaturePath(String(args.path));
    const file = await resolveWorktreePath(this.options.worktree, String(args.path));
    const original = await fs.readFile(file, "utf8");
    const oldText = String(args.oldText);
    if (!oldText) throw new Error("INVALID_ARGUMENTS");
    const matches = original.split(oldText).length - 1;
    if (matches === 0 || (!args.replaceAll && matches !== 1)) throw new Error("NON_DETERMINISTIC_EDIT");
    const updated = args.replaceAll ? original.split(oldText).join(String(args.newText)) :
      original.replace(oldText, String(args.newText));
    await fs.writeFile(file, updated, "utf8");
    return { replacements: args.replaceAll ? matches : 1, bytesWritten: Buffer.byteLength(updated) };
  }

  private async walk(relativeRoot: string): Promise<string[]> {
    const root = await resolveWorktreePath(this.options.worktree, relativeRoot);
    const worktree = await fs.realpath(this.options.worktree);
    const output: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        const real = await fs.realpath(candidate);
        if (real !== worktree && !real.startsWith(worktree + path.sep)) continue;
        if (entry.isDirectory()) await visit(real);
        else if (entry.isFile()) output.push(path.relative(worktree, real).split(path.sep).join("/"));
      }
    };
    await visit(root);
    return output;
  }

  private globRegex(pattern: string): RegExp {
    let escaped = "";
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];
      if (char === "*" && pattern[index + 1] === "*") { escaped += ".*"; index++; }
      else if (char === "*") escaped += "[^/]*";
      else if (char === "?") escaped += "[^/]";
      else escaped += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
    return new RegExp("^" + escaped + "$");
  }

  private async fsGlob(args: Record<string, unknown>) {
    const maxResults = Number(args.maxResults ?? 1_000);
    const matches = (await this.walk(String(args.path ?? ".")))
      .filter((entry) => this.globRegex(String(args.pattern)).test(entry));
    return { paths: matches.slice(0, maxResults), truncated: matches.length > maxResults };
  }

  private async fsSearch(args: Record<string, unknown>) {
    const maxMatches = Number(args.maxMatches ?? 1_000);
    const matcher = args.glob ? this.globRegex(String(args.glob)) : undefined;
    const pattern = String(args.pattern);
    if (!pattern) throw new Error("INVALID_ARGUMENTS");
    const matches: Array<{ path: string; line: number; column: number; text: string }> = [];
    let truncated = false;
    for (const relative of await this.walk(String(args.path ?? "."))) {
      if (matcher && !matcher.test(relative)) continue;
      const data = await fs.readFile(await resolveWorktreePath(this.options.worktree, relative));
      if (data.includes(0)) continue;
      for (const [index, line] of data.toString("utf8").split(/\r?\n/).entries()) {
        const column = line.indexOf(pattern);
        if (column === -1) continue;
        if (matches.length === maxMatches) { truncated = true; break; }
        matches.push({ path: relative, line: index + 1, column: column + 1, text: line });
      }
      if (truncated) break;
    }
    return { matches, truncated };
  }

  private async commandExec(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const cwd = await resolveWorktreePath(this.options.worktree, String(args.cwd ?? "."));
    const timeoutMs = Math.min(Number(args.timeoutMs ?? MAX_CALL_MS), MAX_CALL_MS);
    return new Promise((resolve, reject) => {
      const child = spawn(String(args.program), (args.args as string[] | undefined) ?? [], {
        cwd, shell: false, env: this.options.env ?? {}, signal,
      });
      let stdout = ""; let stderr = ""; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        const max = DEFAULT_MAX_BYTES;
        const truncated = Buffer.byteLength(stdout) > max || Buffer.byteLength(stderr) > max;
        resolve({ exitCode, stdout: stdout.slice(0, max), stderr: stderr.slice(0, max), timedOut, truncated });
      });
    });
  }

  private async webFetch(args: Record<string, unknown>, signal?: AbortSignal) {
    let url = await assertPublicHttpsUrl(String(args.url));
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const maxBytes = Number(args.maxBytes ?? DEFAULT_MAX_BYTES);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetchImpl(url, {
        method: String(args.method ?? "GET"), redirect: "manual", signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 5) throw new Error("INVALID_REDIRECT");
        url = await assertPublicHttpsUrl(new URL(location, url).href);
        continue;
      }
      const raw = Buffer.from(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      for (const key of ["content-type", "content-length", "last-modified", "etag"]) {
        const value = response.headers.get(key);
        if (value) headers[key] = value;
      }
      return {
        finalUrl: url.href, status: response.status, headers,
        contentType: response.headers.get("content-type") ?? "",
        body: raw.subarray(0, maxBytes).toString("utf8"), truncated: raw.length > maxBytes,
      };
    }
    throw new Error("INVALID_REDIRECT");
  }
}

function assertNotProtectedFeaturePath(value: string): void {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();
  if (normalized === "docs/features" || normalized.startsWith("docs/features/")) {
    throw new Error("PROTECTED_FEATURE_DOCUMENT_PATH");
  }
}
