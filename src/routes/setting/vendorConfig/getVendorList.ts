import express from "express";
import { success } from "@/lib/responseFormat";
import { getDatabaseRuntime } from "@/database";
import { getDefaultConfiguredVendor } from "@/vendor";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const data = await getDatabaseRuntime().work((db) => db("o_vendorConfig").select("*"));

  const vendorModule = getDefaultConfiguredVendor();
  const list = (
    await Promise.all(
      data.map(async (item) => {
        let vendor;
        try {
          vendor = await vendorModule.inspectVendor(item.id!);
        } catch {
          // 源文件缺失或失效的配置行：沿用历史自愈行为，清掉无效行
          await getDatabaseRuntime().work((db) => db("o_vendorConfig").where("id", item.id).delete());
          return null;
        }
        return {
          ...item,
          inputValues: JSON.parse(item.inputValues ?? "{}"),
          models: vendor.models,
          description: vendor.description ?? "",
          inputs: vendor.inputs,
          author: vendor.author,
          name: vendor.name,
          version: vendor.version ?? "1.0",
        };
      }),
    )
  ).filter((i) => Boolean(i));

  list.sort((a, b) => (a!.id === "toonflow" ? -1 : b!.id === "toonflow" ? 1 : 0));
  res.status(200).send(success(list));
});
