import { tool, Tool } from "ai";
import { z, toJSONSchema } from "zod";
import _ from "lodash";
import { Socket } from "socket.io";

const deriveSchema = z.object({ name: z.string().min(1).max(20), desc: z.string().min(1).max(100) });
const assetSchema = z.object({ assetsId: z.string(), name: z.string(), desc: z.string(), src: z.string(), derive: z.array(deriveSchema).optional() });
const storyboardTableSchema = z.array(
  z.object({
    id: z.number(),
    title: z.string(),
    description: z.string(),
    camera: z.string(),
    duration: z.number(),
    frameMode: z.enum(["firstFrame", "endFrame", "linesSoundEffects"]),
    lines: z.string().nullable(),
    sound: z.string().nullable(),
    associateAssetsIds: z.array(z.number()),
  }),
);
const flowDataSchema = z.object({ script: z.string(), assets: z.array(assetSchema), storyboardTable: storyboardTableSchema });

type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.object({ key: z.enum(["script", "assets", "storyboardTable"]).describe("script=剧本,assets=资产列表,storyboardTable=分镜表") });
const valueSchema = z
  .union([z.string(), z.array(assetSchema), assetSchema, z.array(deriveSchema), z.array(storyboardTableSchema)])
  .describe("路径对应的值");

export default (socket: Socket, toolsNames?: string[]) => {
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: keySchema,
      execute: async ({ key }) => {
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        return flowData[key];
      },
    }),
    get_flowData_schema: tool({
      description: "获取工作区数据的类型结构,在使用set_flowData前应先调用",
      inputSchema: keySchema,
      execute: async ({ key }) => {
        console.log("[tools] get_flowData_schema", key);
        return toJSONSchema(flowDataSchema.shape[key]);
      },
    }),
    set_flowData: tool({
      description: "保存数据到工作区,key为lodash路径,先调用get_flowData_schema了解可用路径和类型",
      inputSchema: z.object({
        key: z.string().describe("lodash路径,如 script、assets[0].derive"),
        value: valueSchema,
      }),
      execute: async ({ key, value }) => {
        console.log("[tools] set_flowData", key, value);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        const backup = _.cloneDeep(_.get(flowData, key));
        _.set(flowData, key, value);
        const r = flowDataSchema.safeParse(flowData);
        if (!r.success) {
          _.set(flowData, key, backup);
          return { error: r.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ") };
        }
        socket.emit("setFlowData", { key, value });
        return true;
      },
    }),
    generate_assets_images: tool({
      description: "生成衍生资产的图片",
      inputSchema: z.object({ ids: z.array(z.string()).describe("需要生成的资产id列表") }),
      execute: async ({ ids }) => {
        console.log("[tools] generated_assets", ids);
        return new Promise((resolve) => socket.emit("generatedAssets", { ids }, (res: any) => resolve(res)));
      },
    }),
    generate_storyboard_images: tool({
      description: "生成分镜图",
      inputSchema: z.object({ script: z.string().describe("剧本文本") }),
      execute: async ({ script }) => {
        console.log("[tools] generate_storyboard_images", script);
        return new Promise((resolve) => socket.emit("generateStoryboardImages", { script }, (res: any) => resolve(res)));
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
