import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const qrdinaryData = await u.db("o_agentDeploy").where("type", "普通").leftJoin("o_vendorConfig", "o_vendorConfig.id", "o_agentDeploy.vendorId").select("o_agentDeploy.*");
  const advancedData = await u.db("o_agentDeploy").where("type", "高级").leftJoin("o_vendorConfig", "o_vendorConfig.id", "o_agentDeploy.vendorId").select("o_agentDeploy.*");
  res.status(200).send(success({ qrdinaryData, advancedData }));
});
