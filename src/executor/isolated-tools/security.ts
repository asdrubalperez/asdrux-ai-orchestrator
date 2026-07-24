import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export async function resolveWorktreePath(
  worktree: string,
  requested: string,
  options: { allowMissingLeaf?: boolean } = {},
): Promise<string> {
  if (!requested || path.isAbsolute(requested) || requested.split(/[\\/]/).includes("..")) {
    throw new Error("PATH_OUTSIDE_WORKTREE");
  }
  const root = await fs.realpath(worktree);
  const joined = path.resolve(root, requested);
  if (joined !== root && !joined.startsWith(root + path.sep)) throw new Error("PATH_OUTSIDE_WORKTREE");

  let resolved: string;
  if (options.allowMissingLeaf) {
    const parent = await fs.realpath(path.dirname(joined));
    resolved = path.join(parent, path.basename(joined));
  } else {
    resolved = await fs.realpath(joined);
  }
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("PATH_OUTSIDE_WORKTREE");
  return resolved;
}

function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export async function assertPublicHttpsUrl(
  raw: string,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("URL_NOT_PUBLIC_HTTPS");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("URL_NOT_PUBLIC_HTTPS");
  }
  return url;
}
