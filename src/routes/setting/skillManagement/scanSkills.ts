import express from "express";
import u from "@/utils";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { success } from "@/lib/responseFormat";
import fg from "fast-glob";
import getPath from "@/utils/getPath";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const skillsRoot = getPath(["skills"]);
  const referencesRoot = path.join(skillsRoot, "references");

  const [mainEntries, referenceEntries] = await Promise.all([
    fg("*.md", {
      cwd: skillsRoot.replace(/\\/g, "/"),
      onlyFiles: true,
    }),
    fg("**/*.md", {
      cwd: referencesRoot.replace(/\\/g, "/"),
      onlyFiles: true,
    }),
  ]);

  const scanItems = [
    ...mainEntries.map((entry) => ({
      entry,
      relativePath: entry,
      fullPath: path.join(skillsRoot, entry),
      type: "main",
    })),
    ...referenceEntries.map((entry) => ({
      entry,
      relativePath: path.posix.join("references", entry.replace(/\\/g, "/")),
      fullPath: path.join(referencesRoot, entry),
      type: "references",
    })),
  ];

  const now = Date.now();
  let insertedCount = 0;
  let updatedCount = 0;
  let removedCount = 0;

  const scannedIds = new Set<string>();
  const existingRows = await u.db("o_skillList").whereIn("type", ["main", "references"]).select("id", "md5", "type", "path");

  for (const item of scanItems) {
    const id = crypto.createHash("md5").update(item.relativePath).digest("hex");
    const name = path.basename(item.entry, ".md");
    const content = await fs.readFile(item.fullPath, "utf-8");
    const md5 = crypto.createHash("md5").update(content).digest("hex");
    const existing = existingRows.find((row: any) => row.id === id);

    scannedIds.add(id);

    if (!existing) {
      await u.db("o_skillList").insert({
        id,
        path: item.relativePath,
        name,
        description: "",
        embedding: null,
        type: item.type,
        createTime: now,
        updateTime: now,
        md5,
        state: -1,
      });
      insertedCount++;
      continue;
    }

    if (existing.md5 !== md5 || existing.path !== item.relativePath || existing.type !== item.type) {
      await u.db("o_skillList").where("id", id).update({
        path: item.relativePath,
        name,
        md5,
        type: item.type,
        updateTime: now,
        state: -3,
      });
      updatedCount++;
    }
  }

  const removedIds = existingRows.map((row: any) => row.id).filter((id: string) => !scannedIds.has(id));
  if (removedIds.length > 0) {
    await u.db("o_skillList").whereIn("id", removedIds).delete();
    removedCount = removedIds.length;
  }

  const [{ noDescriptionSkillCount }]: any = await u
    .db("o_skillList")
    .where("type", "references")
    .andWhere((builder: any) => {
      builder.whereNull("description").orWhere("description", "");
    })
    .count({ noDescriptionSkillCount: "*" });

  const [{ noAttributionSkillCount }]: any = await u
    .db("o_skillList as sl")
    .leftJoin("o_skillAttribution as sa", "sl.id", "sa.skillId")
    .where("sl.type", "references")
    .whereNull("sa.skillId")
    .countDistinct({ noAttributionSkillCount: "sl.id" });

  res.status(200).send(
    success({
      message: "更新技能文档成功",
      insertedCount,
      updatedCount,
      removedCount,
      totalFiles: scanItems.length,
      noDescriptionSkillCount: Number(noDescriptionSkillCount),
      noAttributionSkillCount: Number(noAttributionSkillCount),
    }),
  );
});
