import { Knex } from "knex";
import { v4 as uuid } from "uuid";
interface TableSchema {
  name: string;
  builder: (table: Knex.CreateTableBuilder) => void;
  initData?: (knex: Knex) => Promise<void>;
}

export default async (knex: Knex, forceInit: boolean = false): Promise<void> => {
  const tables: TableSchema[] = [
    // 用户表
    {
      name: "o_user",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("password");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {
        await knex("o_user").insert([{ id: 1, name: "admin", password: "admin123" }]);
      },
    },
    //项目表
    {
      name: "o_project",
      builder: (table) => {
        table.integer("id");
        table.string("projectType");
        table.text("name");
        table.text("intro");
        table.text("type");
        table.text("artStyle");
        table.text("videoRatio");
        table.integer("createTime");
        table.integer("userId");
        table.primary(["id"]);
      },
    },
    //风格表
    {
      name: "o_artStyle",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.text("styles");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {},
    },
    //Agent配置表
    {
      name: "o_agentDeploy",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("model");
        table.string("key");
        table.string("modelName");
        table.integer("vendorId");
        table.string("desc");
        table.string("name");
        table.boolean("disabled").defaultTo(false);
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {
        await knex("o_agentDeploy").insert([
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "scriptAgent",
            name: "剧本Agent",
            desc: "根据剧本自动生成分镜描述，将文字转化为画面指令",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "productionAgent",
            name: "生产Agent",
            desc: "从小说原文提取关键情节，生成结构化剧本大纲",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "assetsAi",
            name: "资产Agent",
            desc: "根据角色和场景要素，生成精准的素材提示词",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "polishingAi",
            name: "润色Agent",
            desc: "将大纲扩展为完整剧本脚本，包含对话和场景描写",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "eventExtractAi",
            name: "事件提取Agent",
            desc: "从小说原文中提取事件，生成事件列表和事件关系",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "ttsDubbing",
            name: "TTS配音",
            desc: "根据剧本内容生成角色配音，支持多种声音风格和情绪",
            disabled: true,
          },
        ]);
      },
    },
    //设置表
    {
      name: "o_setting",
      builder: (table) => {
        table.text("key");
        table.text("value");
        table.primary(["key"]);
        table.unique(["key"]);
      },
      initData: async (knex) => {
        await knex("o_setting").insert([
          {
            key: "tokenKey",
            value: uuid().slice(0, 8),
          },
          {
            key: "messagesPerSummary",
            value: 3,
          },
          {
            key: "shortTermLimit",
            value: 5,
          },
          {
            key: "summaryMaxLength",
            value: 500,
          },
          {
            key: "summaryLimit",
            value: 10,
          },
          {
            key: "ragLimit",
            value: 3,
          },
          {
            key: "deepRetrieveSummaryLimit",
            value: 5,
          },
          {
            key: "modelOnnxFile",
            value: '["all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"]',
          },
          {
            key: "modelDtype",
            value: "fp16",
          },
        ]);
      },
    },
    //任务中心表
    {
      name: "o_tasks",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("projectId");
        table.string("taskClass");
        table.string("relatedObjects");
        table.string("model");
        table.text("describe");
        table.string("state");
        table.integer("startTime");
        table.text("reason");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {},
    },
    //小说原文表
    {
      name: "o_novel",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("chapterIndex");
        table.text("reel");
        table.text("chapter");
        table.text("chapterData");
        table.integer("projectId");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //小说事件表
    {
      name: "o_event",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.string("detail");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //事件-章节表
    {
      name: "o_eventChapter",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("eventId").unsigned().references("id").inTable("o_event");
        table.integer("novelId").unsigned().references("id").inTable("o_novel");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //大纲表
    {
      name: "o_outline",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("episode");
        table.text("data");
        table.integer("projectId");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //大纲-原文表
    {
      name: "o_outlineNovel",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("outlineId").unsigned().references("id").inTable("o_outline");
        table.integer("novelId").unsigned().references("id").inTable("o_novel");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //剧本
    {
      name: "o_script",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("content");
        table.integer("projectId");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //资产表
    {
      name: "o_assets",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("prompt");
        table.text("remark");
        table.text("type");
        table.text("describe");
        table.integer("scriptId");//剧本id
        table.integer("imageId").unsigned().references("id").inTable("o_image");
        table.integer("sonId");
        table.integer("projectId");
        table.integer("startTime");
        table.text("state");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {},
    },
    //生成图片表
    {
      name: "o_image",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("filePath");
        table.text("type");
        table.integer("assetsId");
        table.text("model");
        table.text("resolution");
        table.text("state");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //分镜
    {
      name: "o_storyboard",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //flowData-剧本
    {
      name: "o_flowData",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //视频
    {
      name: "o_video",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("resolution");
        table.text("prompt");
        table.text("filePath");
        table.text("firstFrame");
        table.text("storyboardImgs");
        table.text("model");
        table.text("errorReason");
        table.integer("time");
        table.integer("state");
        table.integer("scriptId");
        table.integer("configId"); // 关联的视频配置ID
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //视频配置
    {
      name: "o_videoConfig",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("scriptId"); // 关联的脚本ID
        table.integer("projectId"); // 关联的项目ID
        table.integer("aiConfigId"); //ai配置ID
        table.integer("audioEnabled"); //声音
        table.text("manufacturer"); // 厂商：volcengine/runninghub/openAi
        table.text("mode"); // 模式：startEnd/multi/single
        table.text("startFrame"); // 首帧图片信息 JSON
        table.text("endFrame"); // 尾帧图片信息 JSON
        table.text("images"); // 多图模式的图片列表 JSON
        table.text("resolution"); // 分辨率
        table.integer("duration"); // 时长
        table.text("prompt"); // 提示词
        table.integer("selectedResultId"); // 选中的生成结果ID
        table.integer("createTime"); // 创建时间
        table.integer("updateTime"); // 更新时间
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //供应商配置表
    {
      name: "o_vendorConfig",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("version");
        table.text("icon");
        table.text("inputs"); // 输入项配置 JSON
        table.text("inputValues"); // 输入项值 JSON
        table.text("models"); // 模型配置 JSON
        table.text("code"); // 模型配置 JSON
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //供应商配置表
    {
      name: "o_vendorConfig",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("version");
        table.text("icon");
        table.text("inputs"); // 输入项配置 JSON
        table.text("inputValues"); // 输入项值 JSON
        table.text("models"); // 模型配置 JSON
        table.text("code"); // 模型配置 JSON
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //记忆表（message=原始消息, summary=压缩摘要）
    {
      name: "memories",
      builder: (table) => {
        table.text("id").notNullable();
        table.text("isolationKey").notNullable(); // 记忆隔离键
        table.text("type").notNullable(); // 'message' | 'summary'
        table.text("role"); // 'user' | 'assistant'
        table.text("content").notNullable();
        table.text("embedding"); // 向量嵌入 JSON
        table.text("relatedMessageIds"); // summary关联的message id列表 JSON
        table.integer("summarized").defaultTo(0); // message是否已被总结 0/1
        table.integer("createTime").notNullable();
        table.primary(["id"]);
        table.index(["isolationKey", "type"]);
        table.index(["isolationKey", "summarized"]);
      },
    },
  ];

  for (const t of tables) {
    const tableExists = await knex.schema.hasTable(t.name);
    if (!tableExists || forceInit) {
      if (tableExists && forceInit) {
        await knex.schema.dropTable(t.name);
        console.log("[初始化数据库] 已存在表删除并重建:", t.name);
      } else {
        console.log("[初始化数据库] 创建数据表:", t.name);
      }
      await knex.schema.createTable(t.name, t.builder);
      if (t.initData) {
        await t.initData(knex);
        console.log("[初始化数据库] 表数据初始化:", t.name);
      }
    }
  }
};
