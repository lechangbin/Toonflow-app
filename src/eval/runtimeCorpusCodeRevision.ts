import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Hash source bytes and paths, including newly added files, not only a Git commit label. */
export async function hashRuntimeSourceSet(repositoryRoot: string,
  sourcePaths: readonly string[]): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("T11 source closure contains a symbolic link");
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(absolute)) await walk(path.join(relative, name));
    } else if (stat.isFile()) files.push(relative);
    else throw new Error("T11 source closure contains a non-file entry");
  }
  for (const entry of sourcePaths) {
    if (!entry || path.isAbsolute(entry) || entry.split(/[\\/]/u).includes("..")) {
      throw new TypeError("T11 source path is outside the repository");
    }
    await walk(entry);
  }
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const bytes = await fs.readFile(path.join(root, file));
    const normalized = file.replace(/\\/gu, "/");
    hash.update(`${Buffer.byteLength(normalized)}:${normalized}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/** Conservative code closure for every executable seam used by the T11 study. */
export async function createRuntimeCorpusCodeRevisions(repositoryRoot: string) {
  const [app, schema, runtime, tool, context, memory, vendor] = await Promise.all([
    hashRuntimeSourceSet(repositoryRoot, ["src", "scripts/agnesRuntimeCorpusStudy.ts",
      "package.json", "yarn.lock"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/lib/initDB.ts", "src/lib/fixDB.ts",
      "src/types/database.d.ts"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/agentRuntime",
      "src/agents/scriptAgent/harnessPreparation.ts",
      "src/agents/productionAgent/harnessPreparation.ts"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/controlledTools", "src/skillRuntime"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/context"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/memory"]),
    hashRuntimeSourceSet(repositoryRoot, ["src/vendor", "data/vendor/agnes.ts",
      "src/lib/vendor.json"]),
  ]);
  return { app, schema, runtime, tool, context, memory, vendor };
}
