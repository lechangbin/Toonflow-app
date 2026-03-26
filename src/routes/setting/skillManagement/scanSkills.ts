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

  const scannedPaths = new Set<string>();
  const existingRows = await u.db("o_skillList").whereIn("type", ["main", "references"]).select("id", "md5", "type", "path");

  for (const item of scanItems) {
    scannedPaths.add(item.relativePath);

    const existing = existingRows.find((row: any) => row.path === item.relativePath);
    const content = await fs.readFile(item.fullPath, "utf-8");
    const md5 = crypto.createHash("md5").update(content).digest("hex");

    if (!existing) {
      const id = crypto.createHash("md5").update(item.relativePath).digest("hex");
      const name = path.basename(item.entry, ".md");
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
    } else {
      const updateData: Record<string, any> = { md5, updateTime: now };
      if (existing.md5 !== md5) {
        updateData.state = -3;
      }
      await u.db("o_skillList").where("id", existing.id).update(updateData);
      updatedCount++;
    }
  }

  const removedIds = existingRows.filter((row: any) => !scannedPaths.has(row.path)).map((row: any) => row.id);
  if (removedIds.length > 0) {
    await u.db("o_skillList").whereIn("id", removedIds).update({ state: -4, updateTime: now });
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
