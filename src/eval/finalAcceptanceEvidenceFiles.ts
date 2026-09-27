import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { finalAcceptanceEvidenceRefSchema } from "./finalAcceptanceIndex";

/** Hash only local evidence bytes; this does not execute commands or validate their meaning. */
export async function computeFinalAcceptanceEvidenceHash(
  root: string, refs: readonly string[],
): Promise<string> {
  if (refs.length === 0) throw new TypeError("Evidence needs at least one file");
  const rootPath = await realpath(root);
  const checked = refs.map((ref) => finalAcceptanceEvidenceRefSchema.parse(ref));
  if (new Set(checked).size !== checked.length) {
    throw new TypeError("Evidence refs contain a duplicate path");
  }

  const entries: Array<readonly [string, string]> = [];
  for (const ref of checked.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const filePath = await realpath(resolve(rootPath, ...ref.split("/")));
    const localPath = relative(rootPath, filePath);
    if (!localPath || localPath === ".." || localPath.startsWith(`..${sep}`)
      || isAbsolute(localPath)) throw new TypeError("Evidence file escapes the root");
    if (!(await stat(filePath)).isFile()) throw new TypeError("Evidence must be a regular file");
    const fileDigest = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) fileDigest.update(chunk);
    entries.push([ref, fileDigest.digest("hex")]);
  }
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
