import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空").optional(),
  assetsId: z.string().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  assetsId: z.string().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  desc: z.string().describe("资产描述"),
  src: z.string().describe("资产资源路径"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
export const storyboardSchema = z.object({
  id: z.number().describe("分镜ID"),
  title: z.string().describe("分镜标题"),
  description: z.string().describe("分镜描述"),
  camera: z.string().describe("镜头信息"),
  duration: z.number().describe("持续时长(秒)"),
  frameMode: z.enum(["firstFrame", "endFrame", "linesSoundEffects"]).describe("帧模式: 首帧/尾帧/台词音效"),
  prompt: z.string().describe("生成提示词"),
  lines: z.string().nullable().describe("台词内容"),
  sound: z.string().nullable().describe("音效内容"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
});
export const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
export const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("衍生资产"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜列表"),
  workbench: workbenchDataSchema.describe("工作台配置"),
  poster: z
    .object({
      items: z.array(posterItemSchema).describe("海报项目列表"),
    })
    .describe("海报配置"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

export default (resTool: ResTool, toolsNames?: string[]) => {
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: z.object({
        key: keySchema.describe("数据key"),
      }),
      execute: async ({ key }) => {
        resTool.systemMessage(`正在阅读 ${flowDataKeyLabels[key]} 数据...`);
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        return flowData[key];
      },
    }),
    set_flowData_script: tool({
      description: "保存剧本内容到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.script }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData script", value);
        resTool.systemMessage("正在保存 剧本 数据");
        socket.emit("setFlowData", { key: "script", value });
        return true;
      },
    }),
    set_flowData_scriptPlan: tool({
      description: "保存拍摄计划到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.scriptPlan }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData scriptPlan", value);
        resTool.systemMessage("正在保存 拍摄计划 数据");
        socket.emit("setFlowData", { key: "scriptPlan", value });
        return true;
      },
    }),
    set_flowData_assets: tool({
      description: "保存衍生资产列表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.assets }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData assets", value);
        resTool.systemMessage("正在保存 衍生资产 数据");
        socket.emit("setFlowData", { key: "assets", value });
        return true;
      },
    }),
    set_flowData_storyboardTable: tool({
      description: "保存分镜表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboardTable }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData storyboardTable", value);
        resTool.systemMessage("正在保存 分镜表 数据...");
        socket.emit("setFlowData", { key: "storyboardTable", value });
        return true;
      },
    }),
    set_flowData_storyboard: tool({
      description: "保存分镜列表到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.storyboard }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData storyboard", value);
        resTool.systemMessage("正在保存 分镜列表 数据...");
        socket.emit("setFlowData", { key: "storyboard", value });
        return true;
      },
    }),
    set_flowData_workbench: tool({
      description: "保存工作台配置数据到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.workbench }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData workbench", value);
        resTool.systemMessage("正在保存 工作台配置 数据...");
        socket.emit("setFlowData", { key: "workbench", value });
        return true;
      },
    }),
    set_flowData_poster: tool({
      description: "保存海报配置到工作区",
      inputSchema: z.object({ value: flowDataSchema.shape.poster }),
      execute: async ({ value }) => {
        console.log("[tools] set_flowData poster", value);
        resTool.systemMessage("正在保存 海报 数据...");
        socket.emit("setFlowData", { key: "poster", value });
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
