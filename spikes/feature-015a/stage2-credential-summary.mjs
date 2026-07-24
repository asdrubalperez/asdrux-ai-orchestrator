import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const credentialFile = process.argv[2];
const label = process.argv[3] ?? "credential";
if (!credentialFile) throw new Error("usage: node stage2-credential-summary.mjs <file> [label]");

const raw = await readFile(credentialFile);
const document = JSON.parse(raw);

function findEntry(value, target) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === target) return { owner: value, key, value: child };
    const nested = findEntry(child, target);
    if (nested) return nested;
  }
  return undefined;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

const access = findEntry(document, "accessToken");
const refresh = findEntry(document, "refreshToken");
const expires = findEntry(document, "expiresAt");
if (!access || !refresh || !expires) throw new Error("expected OAuth fields were not found");

console.log(
  JSON.stringify({
    label,
    fileSha256: createHash("sha256").update(raw).digest("hex"),
    accessToken: { length: String(access.value).length, sha256Prefix: hash(access.value) },
    refreshToken: { length: String(refresh.value).length, sha256Prefix: hash(refresh.value) },
    expiresAt: expires.value,
  })
);
