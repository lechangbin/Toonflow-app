import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeFinalAcceptanceEvidenceHash } from "../src/eval/finalAcceptanceEvidenceFiles";

test("T21 evidence files hash in canonical path order and detect changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "toonflow-acceptance-evidence-"));
  try {
    await mkdir(join(root, "docs", "reports"), { recursive: true });
    await writeFile(join(root, "docs", "reports", "a.txt"), "alpha", "utf8");
    await writeFile(join(root, "docs", "reports", "b.txt"), "beta", "utf8");
    const refs = ["docs/reports/b.txt", "docs/reports/a.txt"];
    const actual = await computeFinalAcceptanceEvidenceHash(root, refs);
    const fileHash = (value: string) => createHash("sha256").update(value).digest("hex");
    const expected = createHash("sha256").update(JSON.stringify([
      ["docs/reports/a.txt", fileHash("alpha")],
      ["docs/reports/b.txt", fileHash("beta")],
    ])).digest("hex");
    assert.equal(actual, expected);
    assert.equal(await computeFinalAcceptanceEvidenceHash(root, [...refs].reverse()), actual);
    await writeFile(join(root, "docs", "reports", "b.txt"), "tampered", "utf8");
    assert.notEqual(await computeFinalAcceptanceEvidenceHash(root, refs), actual);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T21 evidence hashing rejects missing, duplicate, unsafe, and directory refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "toonflow-acceptance-evidence-"));
  try {
    await mkdir(join(root, "docs", "reports"), { recursive: true });
    await writeFile(join(root, "docs", "reports", "a.txt"), "alpha", "utf8");
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root, []), /at least one/);
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root,
      ["docs/reports/a.txt", "docs/reports/a.txt"]), /duplicate/);
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root,
      ["docs/../secrets.txt"]));
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root,
      ["docs/reports/missing.txt"]));
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root,
      ["docs/reports"]), /regular file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T21 evidence hashing does not follow a ref symlink outside its root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "toonflow-acceptance-evidence-"));
  const outside = await mkdtemp(join(tmpdir(), "toonflow-acceptance-outside-"));
  try {
    await mkdir(join(root, "docs", "reports"), { recursive: true });
    const target = join(outside, "private.txt");
    await writeFile(target, "private", "utf8");
    try {
      await symlink(target, join(root, "docs", "reports", "linked.txt"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("symlink creation is unavailable on this Windows host");
        return;
      }
      throw error;
    }
    await assert.rejects(computeFinalAcceptanceEvidenceHash(root,
      ["docs/reports/linked.txt"]), /escapes the root/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
