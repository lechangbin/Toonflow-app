import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
    "/",
    async (req, res) => {
        const dataList = await u.db("o_vendorConfig").select("id").where("enable", 1);
        if (!dataList || dataList.length === 0) {
            return res.status(404).send({ error: "模型未找到" });
        }
        const types = ['image', 'video'];
        const modelList = await Promise.all(dataList.map((i) => u.vendor.getModelList(i.id!)));
        const result = await Promise.all(
            dataList.map(async (data, index) => {
                const vendorData = await u.vendor.getVendor(data.id!);
                console.log("%c Line:20 🌶 vendorData", "background:#42b983", vendorData);
                const models = modelList[index];
                const filtered =
                    models.filter((item: { type: string }) => types.includes(item.type));
                console.log("%c Line:30 🍺 vendorData.mode", "background:#42b983", vendorData.mode);

                return filtered.map((item: { name: string; modelName: string; type: string }) => ({
                    id: data.id,
                    label: item.name,
                    value: item.modelName,
                    type: item.type,
                    name: vendorData.name,
                    mode: item.mode
                }));
            }),
        );
        res.status(200).send(success(result.flat()));
    },
);
