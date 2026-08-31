import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { createDefaultConfiguredVendor } from "@/vendor";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getDatabaseRuntime } from "@/database";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
  }),
  async (req, res) => {
    const { key } = req.body;
    const vendorConfigData = await getDatabaseRuntime().work((db) => db("o_vendorConfig").where("id", "toonflow").first());
    if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
    if (!vendorConfigData.inputValues) return res.status(500).send(error("未找到模型配置数据"));
    const inputValue = JSON.parse(vendorConfigData.inputValues!);
    inputValue.apiKey = key;
    await u
      .db("o_vendorConfig")
      .where("id", "toonflow")
      .update({
        inputValues: JSON.stringify(inputValue),
      });
    try {
      const resText = await createDefaultConfiguredVendor().invokeText({
        target: { kind: "direct", vendorId: "toonflow", modelId: "claude-haiku-4-5-20251001" },
        input: {
          prompt: "1+1等于几？,请直接回答2，不要解释",
        },
      });
      if (resText.text) {
        await getDatabaseRuntime().work((db) => db("o_agentDeploy").where("key", "scriptAgent").update({
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        }));
        await getDatabaseRuntime().work((db) => db("o_agentDeploy").where("key", "productionAgent").update({
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        }));
        await getDatabaseRuntime().work((db) => db("o_agentDeploy").where("key", "universalAi").update({
          model: "claude-haiku-4-5",
          modelName: "toonflow:claude-haiku-4-5-20251001",
          vendorId: "toonflow",
        }));
        res.status(200).send(success("一键填入成功"));
      }
    } catch (err) {
      console.error(err);
      inputValue.apiKey = "";
      await u
        .db("o_vendorConfig")
        .where("id", "toonflow")
        .update({ inputValues: JSON.stringify(inputValue) });
      res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);
