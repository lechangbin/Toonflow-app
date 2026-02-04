// @/agents/Storyboard.ts
import u from "@/utils";
import { createAgent } from "langchain";
import { EventEmitter } from "events";
import { openAI } from "@/agents/models";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { DB } from "@/types/database";
import generateImageTool from "./generateImageTool";
import imageSplitting from "./imageSplitting";

// ==================== 类型定义 ====================

type AgentType = "segmentAgent" | "shotAgent";
type RefreshEvent = "storyline" | "outline" | "assets";

// ==================== 常量配置 ====================

// const SYSTEM_PROMPTS: Record<AgentType, string> = {
//   segmentAgent: segmentPrompts,
//   shotAgent: shotPrompts,
//   director: directorPrompts,
// };

// ==================== 类型定义：片段和画面 ====================

interface Segment {
  index: number;
  description: string;
  emotion?: string;
  action?: string;
}

interface Shot {
  id: number; // 分镜独立ID
  segmentId: number; // 所属片段ID
  title: string;
  x: number;
  y: number;
  cells: Array<{ src?: string; prompt?: string; id?: string }>; // 镜头数组，每个cell是一个镜头
}

// ==================== 主类 ====================

export default class Storyboard {
  private readonly projectId: number;
  private readonly scriptId: number;
  readonly emitter = new EventEmitter();
  history: Array<[string, string]> = [];
  novelChapters: DB["t_novel"][] = [];

  // 存储 segmentAgent 生成的片段结果
  private segments: Segment[] = [];
  // 存储 shotAgent 生成的分镜结果
  private shots: Shot[] = [];
  // 分镜ID计数器
  private shotIdCounter: number = 0;
  // 存储正在生成分镜图的分镜ID
  private generatingShots: Set<number> = new Set();

  modelName = "gpt-4.1";
  apiKey = "";
  baseURL = "";

  constructor(projectId: number, scriptId: number) {
    this.projectId = projectId;
    this.scriptId = scriptId;
  }

  // 更新shopts
  public updatePreShots(segmentId: number, cellId: number, cell: { src?: string; prompt?: string; id?: string }) {
    console.log("%c Line:76 🍤 segmentId", "background:#465975", segmentId);
    console.log("%c Line:76 🍷 cellId", "background:#ffdd4d", cellId);
    console.log("%c Line:76 🍢 cell", "background:#ffdd4d", cell);
    const shotIndex = this.shots.findIndex((item) => item.segmentId === segmentId);
    if (shotIndex === -1) {
      return `分镜 ${segmentId} 不存在，请检查分镜ID是否正确`;
    }
    const cellIndex = this.shots[shotIndex].cells.findIndex((item) => item.id === cellId.toString());
    if (cellIndex === -1) {
      return `镜头 ${cellId} 不存在，请检查镜头ID是否正确`;
    }
    this.shots[shotIndex].cells[cellIndex] = { ...this.shots[shotIndex].cells[cellIndex], ...cell };
  }

  // ==================== 公共方法 ====================

  get events() {
    return this.emitter;
  }
  // ==================== 私有工具方法 ====================

  private emit(event: string, data?: any) {
    this.emitter.emit(event, data);
  }

  private refresh(type: RefreshEvent) {
    this.emit("refresh", type);
  }

  private log(action: string, detail?: string) {
    const msg = detail ? `${action}: ${detail}` : action;
    console.log(`\n[${new Date().toLocaleTimeString()}] ${msg}\n`);
  }

  // ==================== 剧本相关操作 ====================

  getScript = tool(
    async () => {
      this.log("获取剧本", `scriptId: ${this.scriptId}`);
      const script = await u.db("t_script").where({ id: this.scriptId, projectId: this.projectId }).first();
      if (!script) throw new Error("剧本不存在");
      return `剧本集：${script.name}\n\n内容：\n\`\`\`${script.content}\`\`\``;
    },
    {
      name: "getScript",
      description: "获取剧本内容",
      schema: z.object({}),
      verboseParsingErrors: true,
    },
  );

  // ==================== 资产相关操作 ====================

  /**
   * 获取资产列表（供 segmentAgent 和 shotAgent 调用）
   */
  getAssets = tool(
    async () => {
      this.log("获取资产列表", `scriptId: ${this.scriptId}`);
      const scriptData = await u.db("t_script").where({ id: this.scriptId, projectId: this.projectId }).first();
      const row = await u.db("t_outline").where({ id: scriptData?.outlineId!, projectId: this.projectId }).first();
      const outline: any | null = row?.data ? JSON.parse(row.data) : null;

      if (!outline) {
        return "暂无资产数据";
      }

      // 提取资源名称和描述（与generateImageTool保持一致的字段名）
      const resources = outline
        ? (["characters", "props", "scenes"] as const).flatMap(
            (k) => outline[k]?.map((i: any) => ({ name: i.name, description: i.description })) ?? [],
          )
        : [];

      if (resources.length === 0) {
        return "暂无资产数据";
      }

      // 分类提取资源并格式化
      const characters = outline?.characters?.map((item: any) => `- ${item.name}${item.description ? `：${item.description}` : ""}`) ?? [];
      const props = outline?.props?.map((item: any) => `- ${item.name}${item.description ? `：${item.description}` : ""}`) ?? [];
      const scenes = outline?.scenes?.map((item: any) => `- ${item.name}${item.description ? `：${item.description}` : ""}`) ?? [];

      const sections = [
        characters.length ? `【角色】\n${characters.join("\n")}` : "",
        props.length ? `【道具】\n${props.join("\n")}` : "",
        scenes.length ? `【场景】\n${scenes.join("\n")}` : "",
      ].filter(Boolean);

      if (sections.length === 0) {
        return "暂无资产数据";
      }

      return `<资产列表>
${sections.join("\n\n")}
</资产列表>

⚠️ 重要规则：
1. 必须原封不动地使用上述资产名称，禁止使用近义词、缩写或任何变体
2. 禁止在资产名称前后添加修饰词
3. 禁止捏造资产列表中不存在的角色、场景、道具`;
    },
    {
      name: "getAssets",
      description: "获取资产列表（角色、道具、场景），包含名称和详细介绍。生成片段和分镜时必须先调用此工具获取资产信息，确保名称一致性",
      schema: z.object({}),
      verboseParsingErrors: true,
    },
  );

  // ==================== 片段和分镜工具 ====================

  /**
   * 获取当前存储的片段数据（供 shotAgent 调用）
   */
  getSegments = tool(
    async () => {
      this.log("获取片段数据", `共 ${this.segments.length} 个片段`);
      if (this.segments.length === 0) {
        return "暂无片段数据，请先调用 segmentAgent 生成片段";
      }
      return JSON.stringify(this.segments, null, 2);
    },
    {
      name: "getSegments",
      description: "获取当前已生成的片段数据，用于生成分镜",
      schema: z.object({}),
      verboseParsingErrors: true,
    },
  );

  /**
   * 更新/存储片段数据（供 segmentAgent 调用）
   */
  updateSegments = tool(
    async ({ segments }: { segments: Segment[] }) => {
      this.log("更新片段数据", `共 ${segments.length} 个片段`);
      this.segments = segments;
      this.emit("segmentsUpdated", this.segments);
      return `成功存储 ${segments.length} 个片段`;
    },
    {
      name: "updateSegments",
      description: "存储生成的片段数据，segmentAgent 在生成片段后必须调用此工具保存结果",
      schema: z.object({
        segments: z
          .array(
            z.object({
              index: z.number().describe("片段序号"),
              description: z.string().describe("片段描述"),
              emotion: z.string().optional().describe("情绪氛围"),
              action: z.string().optional().describe("主要动作"),
            }),
          )
          .describe("片段数组"),
      }),
      verboseParsingErrors: true,
    },
  );

  /**
   * 添加分镜（供 shotAgent 调用）
   */
  addShots = tool(
    async ({ shots }: { shots: Array<{ segmentIndex: number; prompts: string[] }> }) => {
      const added: { id: number; segmentIndex: number }[] = [];
      const skipped: number[] = [];

      for (const item of shots) {
        const exists = this.shots.some((f) => f.segmentId === item.segmentIndex);
        if (exists) {
          skipped.push(item.segmentIndex);
          continue;
        }
        // 分配独立的分镜ID
        this.shotIdCounter++;
        const shotId = this.shotIdCounter;
        this.shots.push({
          id: shotId,
          segmentId: item.segmentIndex,
          title: `分镜 ${shotId}`,
          x: 0,
          y: 0,
          cells: item.prompts.map((prompt) => ({ id: u.uuid(), prompt })),
        });
        added.push({ id: shotId, segmentIndex: item.segmentIndex });
      }

      const addedInfo = added.map((a) => `分镜${a.id}(片段${a.segmentIndex})`).join(", ");
      this.log("添加分镜", `新增: [${addedInfo}], 跳过片段: [${skipped.join(", ")}]`);
      this.emit("shotsUpdated", this.shots);

      if (skipped.length) {
        return `已添加${addedInfo}；片段 ${skipped.join(", ")} 已存在分镜被跳过。当前共 ${this.shots.length} 个分镜`;
      }
      return `已添加${addedInfo}。当前共 ${this.shots.length} 个分镜`;
    },
    {
      name: "addShots",
      description: "添加新的分镜。每个分镜有独立ID，包含多个镜头（每个镜头对应一个提示词）。如果片段已存在分镜会跳过",
      schema: z.object({
        shots: z
          .array(
            z.object({
              segmentIndex: z.number().describe("对应的片段序号"),
              prompts: z.array(z.string()).describe("镜头提示词数组，每个提示词对应一个镜头（中文）"),
            }),
          )
          .describe("要添加的分镜数组"),
      }),
      verboseParsingErrors: true,
    },
  );

  /**
   * 更新指定分镜（供 shotAgent 调用）
   * 保留原有 cells 的 id 和 src 字段，只更新 prompt
   */
  updateShots = tool(
    async ({ shotId, prompts }: { shotId: number; prompts: string[] }) => {
      const existingIndex = this.shots.findIndex((item) => item.id === shotId);

      if (existingIndex === -1) {
        return `分镜 ${shotId} 不存在，请检查分镜ID是否正确`;
      }

      const existingCells = this.shots[existingIndex].cells;

      // 更新 cells，保留原有的 id 和 src 字段
      this.shots[existingIndex].cells = prompts.map((prompt, i) => {
        const existingCell = existingCells[i];
        if (existingCell) {
          // 保留原有 cell 的 id 和 src，只更新 prompt
          return { ...existingCell, prompt };
        } else {
          // 新增的 cell
          return { id: u.uuid(), prompt };
        }
      });

      this.log("更新分镜", `分镜 ${shotId}`);
      this.emit("shotsUpdated", this.shots);

      return `已更新分镜 ${shotId}`;
    },
    {
      name: "updateShots",
      description: "更新指定分镜的镜头提示词。通过分镜ID指定要修改的分镜",
      schema: z.object({
        shotId: z.number().describe("要更新的分镜ID"),
        prompts: z.array(z.string()).describe("新的镜头提示词数组，每个提示词对应一个镜头"),
      }),
      verboseParsingErrors: true,
    },
  );

  /**
   * 删除指定分镜（供 shotAgent 调用）
   */
  deleteShots = tool(
    async ({ shotIds }: { shotIds: number[] }) => {
      const deleted: number[] = [];
      const notFound: number[] = [];

      for (const shotId of shotIds) {
        const idx = this.shots.findIndex((item) => item.id === shotId);
        if (idx === -1) {
          notFound.push(shotId);
        } else {
          this.shots.splice(idx, 1);
          deleted.push(shotId);
        }
      }

      this.log("删除分镜", `删除: [分镜${deleted.join(", 分镜")}], 未找到: [分镜${notFound.join(", 分镜")}]`);
      this.emit("shotsUpdated", this.shots);

      if (notFound.length) {
        return `已删除分镜 ${deleted.join(", ")}；分镜 ${notFound.join(", ")} 不存在。当前共 ${this.shots.length} 个分镜`;
      }
      return `已删除分镜 ${deleted.join(", ")}。当前共 ${this.shots.length} 个分镜`;
    },
    {
      name: "deleteShots",
      description: "删除指定的分镜。通过分镜ID指定要删除的分镜",
      schema: z.object({
        shotIds: z.array(z.number()).describe("要删除的分镜ID数组"),
      }),
      verboseParsingErrors: true,
    },
  );

  /**
   * 生成分镜图（异步执行，使用 nanoBanana）
   */
  generateShotImage = tool(
    async ({ shotIds }: { shotIds: number[] }) => {
      const toGenerate: number[] = [];
      const alreadyGenerating: number[] = [];
      const notFound: number[] = [];

      for (const shotId of shotIds) {
        const shot = this.shots.find((f) => f.id === shotId);
        if (!shot) {
          notFound.push(shotId);
          continue;
        }
        if (this.generatingShots.has(shotId)) {
          alreadyGenerating.push(shotId);
          continue;
        }
        toGenerate.push(shotId);
      }

      if (toGenerate.length === 0) {
        if (notFound.length) {
          return `分镜 ${notFound.join(", ")} 不存在，请检查分镜ID是否正确`;
        }
        if (alreadyGenerating.length) {
          return `分镜 ${alreadyGenerating.join(", ")} 正在生成中，请稍候`;
        }
        return "没有需要生成的分镜";
      }

      // 标记为正在生成
      for (const id of toGenerate) {
        this.generatingShots.add(id);
      }

      // 通知前端开始生成
      this.emit("shotImageGenerateStart", { shotIds: toGenerate });
      this.log("开始生成分镜图", `分镜: [${toGenerate.join(", ")}]`);

      // 异步执行图片生成（不阻塞 Agent 流程）
      this.executeShotImageGeneration(toGenerate).catch((err) => {
        this.log("分镜图生成错误", err.message);
        this.emit("shotImageGenerateError", { shotIds: toGenerate, error: err.message });
      });

      let result = `已开始为分镜 ${toGenerate.join(", ")} 生成分镜图，生成过程在后台进行`;
      if (alreadyGenerating.length) {
        result += `；分镜 ${alreadyGenerating.join(", ")} 正在生成中`;
      }
      if (notFound.length) {
        result += `；分镜 ${notFound.join(", ")} 不存在`;
      }
      return result;
    },
    {
      name: "generateShotImage",
      description:
        "为指定分镜生成分镜图。每个分镜会根据其所有提示词生成一张完整宫格图，然后自动分割为单格图片。通过分镜ID指定，不需要指定具体格子，整个分镜是一个完整的生成单元",
      schema: z.object({
        shotIds: z.array(z.number()).describe("要生成分镜图的分镜ID数组"),
      }),
      verboseParsingErrors: true,
    },
  );

  /**
   * 执行分镜图生成的具体逻辑（异步并发）
   * 每个分镜包含多个镜头，所有镜头的提示词合并生成一张宫格图，再分割为单张镜头图片
   */
  async executeShotImageGeneration(shotIds: number[]): Promise<void> {
    await Promise.all(shotIds.map((shotId) => this.generateSingleShotImage(shotId)));
  }

  /**
   * 生成单个分镜的图片
   */
  private async generateSingleShotImage(shotId: number): Promise<void> {
    try {
      const shot = this.shots.find((f) => f.id === shotId);
      if (!shot) return;

      // 提取所有镜头的有效提示词
      const prompts: string[] = shot.cells.map((c) => c.prompt).filter((p): p is string => Boolean(p));

      if (prompts.length === 0) {
        this.log("跳过分镜图生成", `分镜 ${shotId} 没有有效的镜头提示词`);
        this.generatingShots.delete(shotId);
        return;
      }

      // 通知前端正在生成该分镜
      this.emit("shotImageGenerateProgress", { shotId, status: "generating", message: "正在调用 AI 生成宫格图片" });

      // 根据所有镜头提示词生成宫格图片
      const gridImage = await generateImageTool(
        prompts.map((p) => ({ prompt: p })),
        this.scriptId,
        this.projectId,
      );

      // 通知前端正在分割图片
      this.emit("shotImageGenerateProgress", { shotId, status: "splitting", message: "正在分割宫格图片为单张镜头图" });

      // 分割宫格图片为单张镜头图片
      const imageBuffers = await imageSplitting(gridImage, prompts.length);

      // 通知前端正在保存图片
      this.emit("shotImageGenerateProgress", { shotId, status: "saving", message: `正在保存 ${imageBuffers.length} 张镜头图片` });

      // 保存分割后的镜头图片到 OSS，并获取文件路径
      const timestamp = Date.now();
      const imagePaths: string[] = [];

      for (let i = 0; i < imageBuffers.length; i++) {
        const fileName = `${this.projectId}/chat/${this.scriptId}/storyboard/shot_${shotId}_take_${i}_${timestamp}.png`;
        await u.oss.writeFile(fileName, imageBuffers[i]);
        const imageUrl = await u.oss.getFileUrl(fileName);
        imagePaths.push(imageUrl);

        // 每保存一张镜头图片通知进度
        this.emit("shotImageGenerateProgress", {
          shotId,
          status: "saving",
          message: `已保存 ${i + 1}/${imageBuffers.length} 张镜头图片`,
          progress: Math.round(((i + 1) / imageBuffers.length) * 100),
        });
      }

      // 更新每个镜头的 src 字段
      shot.cells = shot.cells.map((cell, i) => ({
        id: u.uuid(),
        ...cell,
        src: imagePaths[i] || cell.src,
      }));

      // 生成完成后更新状态
      this.generatingShots.delete(shotId);
      this.emit("shotImageGenerateComplete", { shotId, shot, imagePaths });
      this.emit("shotsUpdated", this.shots);
      this.log("分镜图生成完成", `分镜 ${shotId}，共 ${imagePaths.length} 张镜头图片`);
    } catch (err: any) {
      this.generatingShots.delete(shotId);
      this.emit("shotImageGenerateError", { shotId, error: err.message });
      this.log("分镜图生成失败", `分镜 ${shotId}: ${err.message}`);
    }
  }

  // ==================== 公共访问器 ====================

  /**
   * 获取当前片段数据
   */
  getSegmentsData(): Segment[] {
    return this.segments;
  }

  /**
   * 获取当前分镜数据
   */
  getShotsData(): Shot[] {
    return this.shots;
  }

  // ==================== 上下文构建 ====================

  private async buildEnvironmentContext(): Promise<string> {
    const projectInfo = await u.db("t_project").where({ id: this.projectId }).first();

    const row = await u.db("t_outline").where({ id: this.scriptId, projectId: this.projectId }).first();
    const outline: any | null = row?.data ? JSON.parse(row.data) : null;

    // 分类提取资源名称
    const characters = outline?.characters?.map((i: any) => i.name) ?? [];
    const props = outline?.props?.map((i: any) => i.name) ?? [];
    const scenes = outline?.scenes?.map((i: any) => i.name) ?? [];

    const assetList =
      [
        characters.length ? `【角色】${characters.join("、")}` : "",
        props.length ? `【道具】${props.join("、")}` : "",
        scenes.length ? `【场景】${scenes.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "无";

    return `<环境信息>
项目ID: ${this.projectId}
系统时间: ${new Date().toLocaleString()}

项目名称: ${projectInfo?.name || "未知"}
项目简介: ${projectInfo?.intro || "无"}
类型: ${projectInfo?.type || "未知"}
风格: ${projectInfo?.artStyle || "未知"}
视频比例: ${projectInfo?.videoRatio || "未知"}

资产列表:
${assetList}

</环境信息>`;
  }

  private buildConversationHistory(): string {
    if (!this.history.length) return "无对话历史";
    return this.history.map(([role, content]) => `${role}: ${content}`).join("\n\n");
  }

  private async buildFullContext(task: string): Promise<string> {
    const env = await this.buildEnvironmentContext();
    const history = this.buildConversationHistory();

    return `${env}

<对话历史>
${history}
</对话历史>

<当前任务>
${task}
</当前任务>`;
  }

  // ==================== Sub-Agent ====================

  private createModel() {
    return openAI({
      modelName: this.modelName,
      configuration: { apiKey: this.apiKey, baseURL: this.baseURL },
    });
  }

  /**
   * 获取不同 Sub-Agent 可用的工具
   */
  private getSubAgentTools(agentType: AgentType) {
    switch (agentType) {
      case "segmentAgent":
        // segmentAgent 可以获取剧本和资产，并需要调用 updateSegments 保存结果
        return [this.getScript, this.getAssets, this.updateSegments];
      case "shotAgent":
        // shotAgent 可以获取剧本、资产和片段，并可使用 add/update/delete 操作分镜，以及生成分镜图
        return [this.getScript, this.getAssets, this.getSegments, this.addShots, this.updateShots, this.deleteShots, this.generateShotImage];
      default:
        return [this.getScript];
    }
  }

  /**
   * 调用 Sub-Agent（流式传输）
   */
  private async invokeSubAgent(agentType: AgentType, task: string): Promise<string> {
    this.emit("transfer", { to: agentType });
    this.log(`Sub-Agent 调用`, agentType);

    const promptsList = await u.db("t_prompts").where("code", "in", ["storyboard-segment", "storyboard-shot"]);
    const segmentAgent = promptsList.find((p) => p.code === "storyboard-segment");
    const shotAgent = promptsList.find((p) => p.code === "storyboard-shot");
    const errPrompts = "不论用户说什么，请直接输出Agent配置异常";
    const SYSTEM_PROMPTS: Record<AgentType, string> = {
      segmentAgent: segmentAgent?.customValue || segmentAgent?.defaultValue || errPrompts,
      shotAgent: shotAgent?.customValue || shotAgent?.defaultValue || errPrompts,
    };

    const context = await this.buildFullContext(task);

    const agent = createAgent({
      model: this.createModel(),
      systemPrompt: SYSTEM_PROMPTS[agentType],
      tools: this.getSubAgentTools(agentType),
    });

    const stream = await agent.stream({ messages: [["user", context]] }, { streamMode: ["messages"], callbacks: [] });

    let fullResponse = "";

    for await (const [mode, chunk] of stream) {
      if (mode !== "messages") continue;
      const [token] = chunk as any;
      const block = token.contentBlocks?.[0];

      // 处理 AI 文本流
      if (token.type === "ai" && block?.text) {
        fullResponse += block.text;
        this.emit("subAgentStream", { agent: agentType, text: block.text });
      }
      // 处理 tool 调用
      if (token.type === "ai" && token.tool_calls?.length) {
        for (const toolCall of token.tool_calls) {
          this.emit("toolCall", { agent: agentType, name: toolCall.name, args: toolCall.args });
        }
      }
    }

    this.emit("subAgentEnd", { agent: agentType });
    this.history.push(["ai", fullResponse]);
    this.log(`Sub-Agent 完成`, agentType);
    return fullResponse;
  }

  private createSubAgentTool(agentType: AgentType, description: string) {
    return tool(async ({ taskDescription }) => this.invokeSubAgent(agentType, taskDescription), {
      name: agentType,
      description,
      schema: z.object({
        taskDescription: z.string().describe("具体的任务描述，包含章节范围、修改要求等详细信息"),
      }),
    });
  }

  // ==================== 主入口 ====================

  private getAllTools() {
    return [
      this.createSubAgentTool(
        "segmentAgent",
        "调用片段师。负责根据剧本生成片段，会自行调用 getScript 获取剧本内容，并调用 updateSegments 保存片段结果。",
      ),
      this.createSubAgentTool(
        "shotAgent",
        "调用分镜师。负责根据片段生成分镜提示词，会自行调用 getSegments 获取片段数据，并调用 addShots/updateShots 保存分镜结果。",
      ),
      // this.createSubAgentTool("director", "调用导演。负责审核故事线和大纲，会自行调用 updateOutline 或 saveStoryline 进行修改。"),
      this.getScript,
      this.getSegments,
      this.generateShotImage,
      ...this.getSubAgentTools("segmentAgent"),
      ...this.getSubAgentTools("shotAgent"),
    ];
  }

  async call(msg: string): Promise<string> {
    console.log("模型名称:", this.modelName);
    this.history.push(["user", msg]);

    const envContext = await this.buildEnvironmentContext();

    const prompts = await u.db("t_prompts").where("code", "storyboard-main").first();

    const mainPrompts = prompts?.customValue || prompts?.defaultValue || "不论用户说什么，请直接输出Agent配置异常";

    const mainAgent = createAgent({
      model: this.createModel(),
      tools: this.getAllTools(),
      systemPrompt: `${envContext}\n${mainPrompts}`,
    });
    const stream = await mainAgent.stream({ messages: this.history }, { streamMode: ["messages"], callbacks: [] });

    let fullResponse = "";

    for await (const [mode, chunk] of stream) {
      if (mode !== "messages") continue;
      const [token] = chunk as any;
      const block = token.contentBlocks?.[0];
      // 处理 AI 文本流
      if (token.type === "ai" && block?.text) {
        fullResponse += block.text;
        this.emit("data", block.text);
      }

      // 处理 tool 调用
      if (token.type === "ai" && token.tool_calls?.length) {
        for (const toolCall of token.tool_calls) {
          this.emit("toolCall", { agent: "main", name: toolCall.name, args: toolCall.args });
        }
      }
    }

    this.history.push(["assistant", fullResponse]);
    this.emit("response", fullResponse);

    return fullResponse;
  }
}
