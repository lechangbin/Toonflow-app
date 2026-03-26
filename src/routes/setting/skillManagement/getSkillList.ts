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
        builder
          .where("name", "like", searchPattern)
          .orWhere("path", "like", searchPattern)
          .orWhere("description", "like", searchPattern);
      };
      query = query.where(whereBuilder);
      countQuery = countQuery.where(whereBuilder);
    }

    // type 筛选条件
    if (type) {
      query = query.where("type", type);
      countQuery = countQuery.where("type", type);
    }

    // attributions 筛选条件
    if (attributions && attributions.length > 0) {
      const attributionSubQuery = function (this: any) {
        this.select("skillId")
          .from("o_skillAttribution")
          .whereIn("attribution", attributions);
      };
      query = query.whereIn("id", attributionSubQuery);
      countQuery = countQuery.whereIn("id", attributionSubQuery);
    }

    // 查询总数（在所有筛选条件应用后）
    const [{ count }]: any = await countQuery.count("* as count");

    // 查询列表
    const list = await query
      .select("*")
      .orderByRaw(
        `
        CASE type WHEN 'main' THEN 1 ELSE 0 END ASC,
        CASE WHEN id NOT IN (SELECT skillId FROM o_skillAttribution) THEN 0 ELSE 1 END ASC,
        CASE WHEN state = 1 THEN 1 ELSE 0 END ASC,
        updateTime DESC
      `
      )
      .limit(limit)
      .offset(offset);

    // 查询每个技能的归属
    const skillIds = list.map((item: any) => item.id);
    const attributionsList = await u
      .db("o_skillAttribution")
      .whereIn("skillId", skillIds)
      .select("skillId", "attribution");

    // 将归属信息合并到列表中
    const attributionMap = new Map<string, string[]>();
    for (const attr of attributionsList) {
      if (!attributionMap.has(attr.skillId!)) {
        attributionMap.set(attr.skillId!, []);
      }
      attributionMap.get(attr.skillId!)!.push(attr.attribution!);
    }

    // 记录需要更新state的技能id
    const missingFileIds: string[] = [];

    const listWithAttributions = list.map((item: any) => {
      const normalizedPath = (item.path || "").replace(/\\/g, "/");
      const isPrefixedReferencePath = normalizedPath.startsWith("references/");
      const skillFilePath =
        item.type === "references" && !isPrefixedReferencePath
          ? path.join(u.getPath(["skills", "references"]), item.path!)
          : path.join(u.getPath("skills"), item.path!);

      let content = "";
      let state = item.state;

      // 检查文件是否存在
      if (fs.existsSync(skillFilePath)) {
        content = fs.readFileSync(skillFilePath, "utf-8");
      } else {
        state = -1;
        if (item.state !== -1) {
          missingFileIds.push(item.id);
        }
      }

      return {
        ...item,
        state,
        attributions: attributionMap.get(item.id) || [],
        content,
        embedding: item.embedding ? true : false,
      };
    });

    // 批量更新文件不存在的技能状态
    if (missingFileIds.length > 0) {
      await u
        .db("o_skillList")
        .whereIn("id", missingFileIds)
        .update({ state: -1 });
    }

    res.status(200).send(
      success({
        list: listWithAttributions,
        total: Number(count),
      })
    );
  }
);