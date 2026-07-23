import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node compute-schema-tree-hash.mjs <schema-dir>");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const files = (await walk(root)).sort((a, b) =>
  path.relative(root, a).localeCompare(path.relative(root, b), "en")
);
const tree = createHash("sha256");
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const fileHash = createHash("sha256").update(await readFile(file)).digest("hex");
  tree.update(relative, "utf8");
  tree.update("\0", "utf8");
  tree.update(fileHash, "ascii");
  tree.update("\n", "utf8");
}
console.log(
  JSON.stringify({
    algorithm: "sha256(path-utf8 + NUL + lowercase-file-sha256 + LF), sorted by relative path",
    files: files.length,
    sha256: tree.digest("hex"),
  })
);
