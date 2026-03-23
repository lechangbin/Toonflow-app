import { tool, Tool } from "ai";
import { z, toJSONSchema } from "zod";
import _ from "lodash";
import { Socket } from "socket.io";

const deriveSchema = z.object({ name: z.string().min(1).max(20), desc: z.string().min(1).max(100) });
const assetSchema = z.object({ assetsId: z.string(), name: z.string(), desc: z.string(), src: z.string(), derive: z.array(deriveSchema).optional() });
const storyboardTableSchema = z.string().describe("分镜表的markdown文本");
const flowDataSchema = z.object({ script: z.string(), scriptPlan: z.string(), assets: z.array(assetSchema), storyboardTable: storyboardTableSchema });

type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.object({
  key: z
    .enum(["script", "scriptPlan", "assets", "storyboardTable"])
    .describe("script=剧本,scriptPlan=拍摄计划,assets=资产列表,storyboardTable=分镜表"),
});
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

    generate_storyboard_images: tool({
      description: `生成一组图片任务，支持图片间的依赖关系（以图生图）。

参数说明：
- images: 图片任务数组
  - id: 图片唯一标识符
  - prompt: 图片生成提示词
  - referenceIds: 依赖的参考图id数组，无依赖填空数组[]
  - assetIds: 参考的资产图id数组（可选）

依赖规则：
1. referenceIds中的id必须存在于images数组中
2. 禁止循环依赖（如A依赖B，B依赖A）
3. 被依赖的图片会先生成，其结果作为参考图传入

示例：生成猫图，再以猫图为参考生成狗图
images: [
  {id: "cat", prompt: "一只橘猫", referenceIds: [], assetIds: []},
  {id: "dog", prompt: "风格相同的金毛犬", referenceIds: ["cat"], assetIds: []}
]`,
      inputSchema: z.object({
        images: z.array(
          z.object({
            id: z.string().describe("图片唯一标识符"),
            prompt: z.string().describe("图片生成提示词"),
            referenceIds: z.array(z.string()).describe("依赖的参考图id数组，无依赖填空数组[]"),
            assetIds: z.array(z.number()).optional().describe("参考的资产图"),
          }),
        ),
      }),
      execute: async ({ images }) => {
        console.log("[tools] generated_assets", images);
        return new Promise((resolve) => socket.emit("generatedAssets", { images }, (res: any) => resolve(res)));
      },
    }),
    generate_assets_images: tool({
      description: "生成分镜图",
      inputSchema: z.object({ images: z.array(z.object({ assetId: z.number(), prompt: z.string() })) }),
      execute: async ({ images }) => {
        console.log("[tools] generate_assets_images", images);
        return new Promise((resolve) => socket.emit("generateAssetsImages", { images }, (res: any) => resolve(res)));
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
