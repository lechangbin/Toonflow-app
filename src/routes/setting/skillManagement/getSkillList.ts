import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs";
import path from "path";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
    search: z.string().optional().default(""),
    type: z.enum(["main", "references"]).optional(),
    attributions: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { page, limit, search, type, attributions } = req.body;
    const offset = (page - 1) * limit;

    let query = u.db("o_skillList");
    let countQuery = u.db("o_skillList");

    // 搜索条件
    if (search) {
      const searchPattern = `%${search}%`;
      const whereBuilder = (builder: any) => {
        builder.where("name", "like", searchPattern).orWhere("path", "like", searchPattern).orWhere("description", "like", searchPattern);
      };
      query = query.where(whereBuilder);
      countQuery = countQuery.where(whereBuilder);
    }

    // 查询总数
    const [{ count }]: any = await countQuery.count("* as count");

    // 查询列表
    if (type) {
      query = query.where("type", type);
      countQuery = countQuery.where("type", type);
    }
    if (attributions && attributions.length > 0) {
      query = query.whereIn("id", function () {
        this.select("skillId").from("o_skillAttribution").whereIn("attribution", attributions);
      });
      countQuery = countQuery.whereIn("id", function () {
        this.select("skillId").from("o_skillAttribution").whereIn("attribution", attributions);
      });
    }

    const list = await query.select("*").orderBy("updateTime", "desc").orderBy("type", "desc").limit(limit).offset(offset);

    // 查询每个技能的归属
    const skillIds = list.map((item: any) => item.id);
    const attributionsList = await u.db("o_skillAttribution").whereIn("skillId", skillIds).select("skillId", "attribution");

    // 将归属信息合并到列表中
    const attributionMap = new Map<string, string[]>();
    for (const attr of attributionsList) {
      if (!attributionMap.has(attr.skillId!)) {
        attributionMap.set(attr.skillId!, []);
      }
      attributionMap.get(attr.skillId!)!.push(attr.attribution!);
    }

    const listWithAttributions = list.map((item: any) => {
      const normalizedPath = (item.path || "").replace(/\\/g, "/");
      const isPrefixedReferencePath = normalizedPath.startsWith("references/");
      const skillFilePath =
        item.type === "references" && !isPrefixedReferencePath
          ? path.join(u.getPath(["skills", "references"]), item.path!)
          : path.join(u.getPath("skills"), item.path!);

      return {
        ...item,
        attributions: attributionMap.get(item.id) || [],
        content: fs.readFileSync(skillFilePath, "utf-8"),
        embedding: item.embedding ? true : false,
      };
    });

    res.status(200).send(
      success({
        list: listWithAttributions,
        total: Number(count),
      }),
    );
  },
);
