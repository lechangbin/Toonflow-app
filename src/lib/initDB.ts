import { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { getEmbedding } from "@/utils/agent/embedding";

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
        table.string("imageModel");
        table.string("imageQuality");
        table.string("videoModel");
        table.text("name");
        table.text("intro");
        table.text("type");
        table.text("artStyle");
        table.text("directorManual");
        table.text("mode");
        table.text("videoRatio");
        table.integer("createTime");
        table.integer("userId");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //风格表
    {
      name: "o_artStyle",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.text("fileUrl");
        table.text("label");
        table.text("prompt");
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
        table.text("vendorId");
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
            desc: "用于读取原文生成故事骨架、改编策略，建议使用具备强大文本理解和生成能力的模型",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "productionAgent",
            name: "生产Agent",
            desc: "对工作流进行调度和管理，建议使用具备较强的逻辑推理和任务管理能力的模型",
            disabled: false,
          },
          {
            model: "",
            modelName: "",
            vendorId: null,
            key: "universalAi",
            name: "通用AI",
            desc: "用于小说事件提取、资产提示词生成、台词提取等边缘功能，建议使用具备较强文本处理能力的模型",
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
            value: 10,
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
          {
            key: "switchAiDevTool",
            value: "0",
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
    //提示词表
    {
      name: "o_prompt",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.string("type");
        table.text("data");
        table.text("useData");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {
        await knex("o_prompt").insert([
          {
            name: "事件提取",
            type: "eventExtraction",
            data: `# 事件提取指令\n\n你是小说文本分析助手。用户每次提供一个章节的原文，你提取该章的结构化事件信息。\n\n## ⚠️ 输出约束（最高优先级，违反任何一条即为失败）\n\n1. 你的**完整回复**只有一行，以 \`|\` 开头、以 \`|\` 结尾，恰好 7 个字段\n2. 回复的**第一个字符**必须是 \`|\`，**最后一个字符**必须是 \`|\`\n3. \`|\` 之前不许有任何字符——没有引导语、没有解释、没有"根据……"、没有"以下是……"\n4. \`|\` 之后不许有任何字符——没有总结、没有提取说明、没有改编建议\n5. 不输出表头行、分隔线、Markdown 标题、emoji、代码块标记\n\n## 输出格式\n\n\`\`\`\n| 第X章 {章节标题} | {涉及角色} | {核心事件} | {主线关系} | {信息密度} | {预估集长} | {情绪强度} |\n\`\`\`\n\n### 字段规范\n\n| 字段 | 格式要求 | 示例 |\n|------|----------|------|\n| 章节 | \`第X章 {章节标题}\` | \`第1章 职业危机与许愿\` |\n| 涉及角色 | 有实际戏份的角色，顿号分隔 | \`林逸、白有容\` |\n| 核心事件 | 30-60字，必须含动作+结果 | \`林逸因解密风潮事业崩塌，颓废中许愿触发魔法系统绑定\` |\n| 主线关系 | **必须**为 \`强/中/弱（3-8字理由）\` | \`强（动机建立+系统激活）\` |\n| 信息密度 | \`高\` / \`中\` / \`低\` | \`高\` |\n| 预估集长 | **必须**为 \`X秒\`，禁止用分钟 | \`50秒\` |\n| 情绪强度 | 文字标签，\`+\` 连接，禁止星级/数字 | \`转折+悬疑\` |\n\n**主线关系判定**：强＝直接推动主角弧线；中＝补充世界观/人物关系/伏笔；弱＝过渡/气氛。\n\n**预估集长参考**：高密度+高情绪→45-60秒；中→35-45秒；低→25-35秒。\n\n**可用情绪标签**：\`冲突\`、\`恐怖\`、\`情感\`、\`转折\`、\`高潮\`、\`平铺\`、\`喜剧\`、\`悬疑\`、\`情感崩溃\`。\n\n## 输出示例\n\n以下两个示例展示的是**完整回复**——除这一行外没有任何其他内容：\n\n\`\`\`\n| 第1章 职业危机与许愿 | 林逸 | 职业魔术师林逸因解密打假风潮导致事业崩塌，颓废中感慨"如果会魔法就好了"，意外触发神奇魔法系统绑定 | 强（主角动机建立+系统激活） | 高 | 50秒 | 转折+悬疑 |\n\`\`\`\n\`\`\`\n| 第12章 山间小憩 | 凌玄、苏晚卿 | 凌玄与苏晚卿在山间歇脚，苏晚卿回忆幼时往事，两人关系略有缓和但未实质推进 | 弱（气氛过渡） | 低 | 25秒 | 平铺+情感 |\n\`\`\`\n\n## 提取规则\n\n- 忠于原文，不推测、不脑补、不加入原文未出现的情节\n- 角色使用文中主要称呼，保持一致\n- 多条平行事件线时，选对主角影响最大的一条，其余简要带过\n- 对话密集章节，关注对话推动了什么结果，而非复述对话内容`,
          },
          {
            name: "剧本资产提取",
            type: "scriptAssetExtraction",
            data: `---\nname: universal_agent\ndescription: 专注于从剧本内容中提取所使用的资产（角色、场景、道具）并生成结构化资产列表的助手。\n---\n\n# Script Assets Extract\n\n你是一个专业的剧本内容分析助手，专注于从剧本文本中识别和提取所有涉及的资产（角色、场景、道具），并为每项资产生成可供下游制作流程使用的结构化描述和提示词。\n\n## 何时使用\n\n用户提供剧本内容，你需要逐段阅读并提取其中涉及的所有资产（人物角色、场景地点、道具物件），输出为结构化的资产列表。产出的资产描述将用于后续 AI 图片生成和制作流程。\n\n## 与系统的对应关系\n\n- 资产类型：\n  - \`role\` — 角色（对应 \`o_assets.type = "role"\`）\n  - \`scene\` — 场景（对应 \`o_assets.type = "scene"\`）\n  - \`tool\` — 道具（对应 \`o_assets.type = "tool"\`）\n- 下游用途：资产提示词生成 → AI 资产图生成 → 分镜制作\n\n## 输出要求\n\n**必须通过调用 \`resultTool\` 工具返回结果**，禁止以纯文本、Markdown 表格或 JSON 代码块等形式直接输出资产列表。\n\`resultTool\` 的 schema 会对字段类型和枚举值做强校验，调用时请严格按照下方字段定义填写，确保数据结构正确、字段完整、类型匹配。\n\n每个资产对象包含以下字段：\n\n| 字段 | 类型 | 必填 | 说明 |\n| ---- | ---- | ---- | ---- |\n| \`name\` | string | 是 | 资产名称，使用剧本中的原始称呼,不做其他多余描述 |\n| \`desc\` | string | 是 | 资产描述，30-80 字的视觉化描述 |\n| \`prompt\` | string | 是 | 生成提示词，英文，用于 AI 图片生成 |\n| \`type\` | enum | 是 | 资产类型：\`role\` / \`scene\` / \`tool\`  |\n\n## 提取规则\n\n### 角色（role）\n\n- 提取剧本中出现的所有有名字的角色\n- \`desc\`：包含外貌特征、服饰风格、体态气质等视觉要素\n- \`prompt\`：英文提示词，描述角色的外观特征，适用于 AI 角色图生成\n- 同一角色有多个称呼时，取最常用的作为 \`name\`\n- 无名龙套（如"路人甲"、"士兵"）可跳过，除非其造型对剧情有重要视觉意义\n\n### 场景（scene）\n\n- 提取剧本中出现的所有场景/地点\n- \`desc\`：包含空间结构、光照氛围、关键陈设、色调基调等视觉要素\n- \`prompt\`：英文提示词，描述场景的整体视觉风格，适用于 AI 场景图生成\n- 同一场景的不同状态（如白天/夜晚）不重复提取，在 \`desc\` 中注明即可\n\n### 道具（tool）\n\n- 提取剧本中出现的重要道具/物品\n- \`desc\`：包含外观形状、颜色材质、尺寸参考、特殊效果等视觉要素\n- \`prompt\`：英文提示词，描述道具的外观细节，适用于 AI 道具图生成\n- 仅提取有独立视觉意义或剧情功能的道具，通用物品可跳过\n\n\n## 提示词（prompt）生成规范\n\n- 采用逗号分隔的关键词/短语格式\n- 优先描述**视觉特征**，避免抽象概念\n- 包含风格关键词（如 anime style, manga style 等，根据项目风格决定）\n- 角色 prompt 示例：\`a young man, sharp eyebrows, black hair, pale skin, wearing a gray Taoist robe, slender build, cold expression\`\n- 场景 prompt 示例：\`dark cave interior, glowing crystals on walls, misty atmosphere, dim blue lighting, stone altar in center\`\n- 道具 prompt 示例：\`ancient jade pendant, oval shape, translucent green, carved dragon pattern, glowing faintly\`\n\n## 提取流程\n\n1. 通读剧本全文，识别所有出现的角色、场景、道具\n2. 对每个资产生成结构化的 \`name\`、\`desc\`、\`prompt\`、\`type\`\n3. 去重：同一资产不重复提取\n4. **必须通过调用 \`resultTool\` 工具输出完整资产列表**，不要分多次调用，一次性将所有资产放入 \`assetsList\` 数组中提交\n\n## 提取原则\n\n1. **忠于剧本**：所有提取基于剧本中的实际内容，不臆造未出现的资产\n2. **视觉优先**：描述和提示词聚焦视觉特征，便于 AI 图片生成\n3. **精简实用**：只提取对制作有实际意义的资产，避免过度提取\n4. **分类准确**：严格按照 role/scene/tool 分类，不混淆\n5. **提示词质量**：英文提示词应具体、可执行，能直接用于 AI 图片生成\n\n## 注意事项\n\n- 资产列表中**不要包含剧本内容本身**，仅提取所使用到的资产\n- 角色的随身物品如果有独立剧情功能，应单独作为道具提取\n- 场景中的固定陈设不需要单独提取为道具，除非该物件有独立剧情作用`,
          },
          {
            name: "视频提示词生成",
            type: "videoPromptGeneration",
            data: `# 视频提示词生成 Skill\n\n你是**视频提示词生成 Agent**，专门负责根据指定的 AI 视频模型，读取分镜信息并输出该模型对应格式的视频提示词。\n\n---\n\n## 输入格式\n\n### 1. 模型与模式（必选）\n\n\n#### 模式路由规则\n\n| 条件 | 匹配模式 | 说明 |\n|------|----------|------|\n| 模型名为 \`Seedance2.0\` / \`seedance 2.0\` / \`即梦2.0\` | **Seedance 2.0** | 固定模式，无论多参标志如何 |\n| 模型名为 \`Wan2.6\` / \`wan 2.6\` / \`万象2.6\` | **Wan 2.6** | 固定模式，单图（首帧）+ 叙事文本，无尾帧 |\n| 其他任何模型 + \`多参:是\` | **通用多参模式** | 支持角色/场景/分镜图多参引用 |\n| 其他任何模型 + \`多参:否\` | **通用首尾帧模式** | 首帧/首尾帧 + 纯文本描述 |\n\n> 模型名仅用于记录，实际提示词格式由匹配到的模式决定。Seedance 2.0 和 Wan 2.6 是指定模型名即确定模式的特例。\n\n### 2. 资产信息\n\n\`\`\`\n资产信息[id, type, name], [id, type, name], ...\n\`\`\`\n\n- \`id\`：资产唯一标识（如 \`A001\`）\n- \`type\`：资产类型，取值 \`character\`（角色）/ \`scene\`（场景）/ \`prop\`（道具）\n- \`name\`：资产名称（如 \`沈辞\`、\`城楼\`、\`长剑\`）\n\n### 3. 分镜信息\n\n分镜以 \`<storyboardItem>\` XML 标签列表的形式传入，每条分镜结构如下：\n\n\`\`\`xml\n<storyboardItem\n  videoDesc='（画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID）'\n  prompt='待生成'\n  track='分组'\n  duration='视频推荐时间'\n  associateAssetsIds="[该分镜所需的资产ID列表]"\n  shouldGenerateImage="true"\n></storyboardItem>\n\`\`\`\n\n#### 输入字段说明\n\n| 属性 | 说明 | 来源 |\n|------|------|------|\n| \`videoDesc\` | **核心输入**：分镜的结构化画面描述，包含画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID | 用户/上游系统填写 |\n| \`prompt\` | **已有字段**：上游生成的分镜图提示词，作为辅助参考上下文，**不修改** | 上游系统已填写 |\n| \`track\` | 分镜分组标识 | 用户/上游系统填写 |\n| \`duration\` | 视频推荐时长（秒） | 用户/上游系统填写 |\n| \`associateAssetsIds\` | 该分镜关联的资产ID列表 | 用户/上游系统填写 |\n| \`shouldGenerateImage\` | 是否需要生成分镜图片，默认 \`true\` | 用户/上游系统填写 |\n\n---\n\n## 任务目标\n\n读取所有 \`<storyboardItem>\` 的属性，结合资产信息，根据指定模型的提示词格式，将全部分镜整合为一个完整的视频提示词。\n\n---\n\n## 输出格式\n\n将所有分镜整合为**一个完整的视频提示词**输出（非逐条独立）：\n\n| 模式 | 整合方式 |\n|------|----------|\n| **通用多参模式** | \`[References]\` 汇总所有 \`@图N \` 引用；\`[Instruction]\` 按时间顺序描述完整叙事 |\n| **通用首尾帧模式** | 纯文本五维度（Visual / Motion / Camera / Audio / Narrative），不使用任何 \`@图N \` 引用，按时间轴连续编排（\`[Motion]\` 0s → 总时长，每段最低 1 秒），全程单一连贯镜头，不切镜 |\n| **Seedance 2.0** | \`生成一个由以下 N 个分镜组成的视频\`，每条对应 \`分镜N<duration-ms>\` 段落 |\n| **Wan 2.6** | 单图首帧模式，每次仅输入一条分镜，输出一段叙事式英文提示词（三段式：风格基调 → 主体动作+场景环境+光线氛围 → 镜头收尾），不使用 \`@图N \` 引用 |\n\n- 仅输出视频提示词文本，不输出 XML 标签，不附加解释\n\n---\n\n## videoDesc 解析规则\n\n从 \`videoDesc\` 括号内按顿号分隔提取以下结构化字段：\n\n\`\`\`\n（{画面描述}、{场景}、{关联资产名称}、{时长}、{景别}、{运镜}、{角色动作}、{情绪}、{光影氛围}、{台词}、{音效}、{关联资产ID}）\n\`\`\`\n\n| 序号 | 字段 | 用途 | 示例 |\n|------|------|------|------|\n| 1 | 画面描述 | prompt 的叙事主干 | 沈辞独立城楼远眺苍茫大地 |\n| 2 | 场景 | 匹配场景资产 | 城楼 |\n| 3 | 关联资产名称 | 匹配角色/道具资产 | 沈辞/城楼 |\n| 4 | 时长 | 控制时长参数 | 4s |\n| 5 | 景别 | 控制镜头景别 | 全景 |\n| 6 | 运镜 | 控制运镜方式 | 静止 |\n| 7 | 角色动作 | prompt 动作描写 | 负手而立衣袂随风飘扬 |\n| 8 | 情绪 | prompt 情绪氛围 | 坚定决绝 |\n| 9 | 光影氛围 | prompt 光影描写 | 黄昏冷调侧逆光 |\n| 10 | 台词 | prompt 台词/音频段 | 无台词 / 具体台词内容 |\n| 11 | 音效 | prompt 音效描写 | 风声衣袂声 |\n| 12 | 关联资产ID | 用于资产ID↔角色标签映射 | A001/A002 |\n\n---\n\n## 资产引用编号规则\n\n所有模型统一使用 \`@图N \` 格式引用资产和分镜图，编号按输入顺序连续递增：\n\n1. **资产**：按资产信息中 \`[id, type, name]\` 的出现顺序，从 \`@图1 \` 开始编号（不区分 character / scene / prop）\n2. **分镜图**：每条 \`<storyboardItem>\` 对应一张分镜图，编号接续资产之后\n3. **跳过无分镜图的条目**：当 \`shouldGenerateImage="false"\` 时，该分镜未生成图片，**不分配**分镜图编号，后续编号顺延\n\n#### 示例\n\n输入 3 个资产 + 2 条分镜：\n\`\`\`\n资产信息[A001, character, 沈辞], [A002, character, 苏锦], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem ...>  <!-- 分镜1 -->\n<storyboardItem ...>  <!-- 分镜2 -->\n\`\`\`\n\n编号结果：\n\n| 输入项 | 引用标签 | 说明 |\n|--------|----------|------|\n| [A001, character, 沈辞] | \`@图1 \` | 角色·沈辞 参考图 |\n| [A002, character, 苏锦] | \`@图2 \` | 角色·苏锦 参考图 |\n| [A003, scene, 城楼] | \`@图3 \` | 场景·城楼 参考图 |\n| storyboardItem 第1条 | \`@图4 \` | 分镜图1 |\n| storyboardItem 第2条 | \`@图5 \` | 分镜图2 |\n\n---\n\n## 模型提示词生成规则\n\n### 一、通用多参模式\n\n#### 核心原则\n- MVL 多模态融合：自然语言 + 图像引用在同一语义空间\n- 分镜图序列负责动作/时间轴/构图，场景参考图负责环境一致性\n- 所有资产和分镜图统一用 \`@图N \` 引用\n- **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段生成，不编造额外内容\n- **台词不可缺失**：videoDesc 中有台词的分镜，必须在 Instruction 中体现台词相关描述\n- **台词类型标注**：区分普通对白（dialogue）、内心独白（inner monologue OS）、画外音（voiceover VO），在 Instruction 中用括号标注\n\n#### prompt 生成模板\n\n\`\`\`\n[References]\n@图1 : [{角色A名}参考图]\n@图2 : [{角色B名}参考图]\n@图3 : [{场景名}参考图]\n@图4 : [分镜图1]\n\n[Instruction]\nBased on the storyboard @图4 :\n@图1 {动作/状态描述（英文）},\n@图2 {动作/状态描述（英文）},\nset in the {场景描述（英文）} of @图3 ,\n{镜头/运镜描述（英文）},\n{情感基调（英文）},\n{台词描述（英文，含 dialogue/OS/VO 标注）/ No dialogue},\n{音效描述（英文）}.\n\`\`\`\n\n#### 生成约束\n1. **Instruction 必须用英文**\n2. **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段，不编造额外信息\n3. **角色动作**从 videoDesc 的「角色动作」字段提取，翻译为简洁英文动作描述\n4. **台词不可缺失**：videoDesc 中有台词的分镜，必须在 Instruction 中体现台词内容（保持原始语言，不翻译）\n5. **台词类型标注**：普通对白标注 \`(dialogue)\`；内心独白标注 \`(inner monologue, OS)\`；画外音标注 \`(voiceover, VO)\`\n6. **镜头风格**使用标准标签：\`cinematic\` / \`wide-angle\` / \`close-up\` / \`slow motion\` / \`surround shooting\` / \`handheld\`\n7. **空间关系**使用标准动词：\`wearing\` / \`holding\` / \`standing on\` / \`following behind\` / \`sitting in\`\n8. 单条分镜对应单个 \`@图N \`，不做多帧跨镜描述\n9. 无需描述角色外观（由参考图负责）\n10. 无时长标注（由模型推断）\n11. **无分镜图时**：当 \`shouldGenerateImage="false"\` 时，该分镜无分镜图，\`[References]\` 中不列出该分镜图，\`[Instruction]\` 中不使用 \`@图N \` 引用该分镜图，改为纯文本描述画面内容\n\n#### KlingOmni 完整示例\n\n输入：\n\`\`\`\n模型：KlingOmni\n资产信息[A001, character, 沈辞], [A002, character, 苏锦], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem videoDesc='（沈辞独立城楼远眺苍茫大地、城楼、沈辞/城楼、4s、全景、静止、负手而立衣袂随风飘扬、坚定决绝、黄昏冷调侧逆光、无台词、风声衣袂声、A001/A003）' prompt='全景，平视略仰，城楼之上，沈辞负手而立，衣袂飘扬，黄昏冷调侧逆光...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n<storyboardItem videoDesc='（苏锦登上城楼走向沈辞、城楼、苏锦/沈辞/城楼、4s、中景、跟踪、苏锦拾级而上走向沈辞、担忧、黄昏余晖渐暗、无台词、脚步声风声、A001/A002/A003）' prompt='中景，跟踪，苏锦拾级而上走向城楼上的沈辞...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A002&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n\`\`\`\n\n输出：\n\`\`\`\n[References]\n@图1 : [沈辞参考图]\n@图2 : [苏锦参考图]\n@图3 : [城楼参考图]\n@图4 : [分镜图1]\n@图5 : [分镜图2]\n\n[Instruction]\nBased on the storyboard from @图4 to @图5 :\n@图1 standing alone atop the city wall, hands clasped behind back, robes billowing in the wind, gazing across the vast land,\n@图2 ascending the steps toward @图1 , expression worried,\nset in the ancient city wall environment of @图3 ,\nwide shot transitioning to medium tracking shot, cinematic,\nresolute determination shifting to concerned anticipation, dusk cold-toned side-backlit atmosphere fading,\nno dialogue,\nwind howling, fabric flapping, footsteps on stone.\n\`\`\`\n\n---\n\n### 二、通用首尾帧模式\n\n#### 核心原则\n- **纯文本提示词**：提示词内**不使用任何 \`@图N \` 引用**（不引用角色资产、场景资产、也不引用分镜图），全部内容用纯文本描述\n- **五维度结构**：Visual / Motion / Camera / Audio / Narrative\n- **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段生成，不编造额外内容\n- **台词不可缺失**：videoDesc 中有台词的分镜，必须在 \`[Audio]\` 中完整输出台词内容\n- **台词类型标注**：区分普通对白（dialogue, lip-sync active）、内心独白（inner monologue OS, silent lips）、画外音（voiceover VO, silent lips），并在 \`[Audio]\` 中明确标注\n- **不说话的主体标注 \`silent\`** — 防止误生口型\n- **全程单一连贯镜头**：从头到尾一个镜头，不存在切镜\n- **时间轴分段**：每段最低 1 秒，用 \`0s-Xs\` 标注\n\n#### prompt 生成模板\n\n\`\`\`\n[Visual]\n{主体A名}: {外观简述}, {站位/姿态}, {说话状态 speaking/silent}.\n{主体B名}: {外观简述}, {站位/姿态}, {说话状态}.\n{场景描述}, {道具描述}.\n{视觉风格标签}.\n\n[Motion]\n0s-{X}s: {主体A名} {动作描述段1}.\n{X}s-{Y}s: {主体B名} {动作描述段2}.\n\n[Camera]\n{镜头类型}, {运镜方式}, {全程单一连贯镜头描述}.\n\n[Audio]\n{Xs-Ys}: "{台词内容}" — {说话者名} ({dialogue / inner monologue OS / voiceover VO}), {lip-sync active / silent lips}.\n{音效描述}.\n\n[Narrative]\n{情节点概述}, {叙事位置}.\n\`\`\`\n\n#### 生成约束\n1. **全部用英文**\n2. **不使用任何 \`@图N \` 引用**：提示词内不引用角色资产、场景资产、分镜图，全部内容用纯文本描述\n3. **主体用文字描述**：在 [Visual] 中简要描述主体外观特征（如服饰、发型等关键辨识特征）\n4. **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段，不编造额外信息\n5. **每个主体必须标注说话状态**：\`speaking\` / \`silent\` / \`speaking simultaneously\`\n6. **台词不可缺失**：videoDesc 中有台词的分镜，必须在 \`[Audio]\` 中完整输出台词内容（保持原始语言，不翻译）\n7. **台词类型标注**：普通对白标注 \`dialogue, lip-sync active\`；内心独白标注 \`inner monologue (OS), silent lips\`；画外音标注 \`voiceover (VO), silent lips\`\n8. **Motion 时间轴**每段最低 1 秒，不超过总时长\n9. **全程单一连贯镜头**：Camera 段落描述从头到尾的一个镜头，绝不切镜\n10. **视觉风格**参考 Assistant 中的「视觉风格约束」部分内容\n11. **镜头类型**从以下选取：\`Wide establishing shot / Over-the-shoulder / Medium shot / Close-up / Wide shot / POV / Dutch angle / Crane up / Dolly right / Whip pan / Handheld / Slow motion\`\n\n#### Seedance 1.5 Pro 完整示例\n\n输入：\n\`\`\`\n模型：Seedance1.5\n资产信息[A001, character, 沈辞], [A002, character, 苏锦], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem videoDesc='（沈辞独立城楼远眺苍茫大地、城楼、沈辞/城楼、4s、全景、静止、负手而立衣袂随风飘扬、坚定决绝、黄昏冷调侧逆光、无台词、风声衣袂声、A001/A003）' prompt='全景，平视略仰，城楼之上，沈辞负手而立，衣袂飘扬，黄昏冷调侧逆光...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n<storyboardItem videoDesc='（苏锦登上城楼走向沈辞、城楼、苏锦/沈辞/城楼、4s、中景、跟踪、苏锦拾级而上走向沈辞、担忧、黄昏余晖渐暗、无台词、脚步声风声、A001/A002/A003）' prompt='中景，跟踪，苏锦拾级而上走向城楼上的沈辞...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A002&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n\`\`\`\n\n输出：\n\`\`\`\n[Visual]\nShen Ci: male, dark flowing robes, hair tied up, standing alone atop city wall, hands clasped behind back, robes billowing, silent.\nSu Jin: female, light-colored dress, hair partially down, ascending steps toward Shen Ci, expression worried, silent.\nAncient city wall, vast open land beyond, dusk sky fading.\nCinematic, photorealistic, 4K, high contrast, desaturated tones, shallow depth of field.\n\n[Motion]\n0s-4s: Shen Ci stands still on city wall edge, robes flutter in wind, hair sways gently. Gaze fixed on distant horizon.\n4s-8s: Su Jin climbs the last few steps onto the wall, walks toward Shen Ci. Shen Ci remains still, unaware. Su Jin slows as she approaches.\n\n[Camera]\nWide establishing shot, static for first 4 seconds capturing the lone figure. Then smooth transition to medium tracking shot following the woman ascending steps, single continuous take throughout, no cuts.\n\n[Audio]\n0s-4s: Wind howling across wall, fabric flapping rhythmically. No dialogue.\n4s-8s: Footsteps on stone, robes rustling. No dialogue.\nShen Ci — silent. Su Jin — silent.\n\n[Narrative]\nLone figure on city wall, then arrival of a companion. Tension between determination and concern. Single continuous take.\n\`\`\`\n\n---\n\n### 三、Seedance 2.0\n\n#### 核心原则\n- **结构化12维编码**：统一用 \`@图N \` 引用资产和分镜图，时长 \`<duration-ms>\`\n- **音色参数9维度精细描述**（有台词时必填）\n- **毫秒级时长控制**：单分镜时长最低 1000ms（1 秒）\n- **中文提示词**\n- **严格遵循 videoDesc**：每条分镜的描述内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段生成，不编造额外内容\n- **台词不可缺失**：videoDesc 中有台词的分镜，必须完整输出台词和音色描述\n- **台词类型标注**：区分普通对白（直接使用「说：」）、内心独白（使用「内心OS：」）、画外音（使用「画外音VO：」），并匹配对应的嘴型状态描述\n\n#### prompt 生成模板\n\n**单分镜模板：**\n\`\`\`\n画面风格和类型: {风格}, {色调}, {类型}\n\n生成一个由以下 1 个分镜组成的视频:\n\n场景:\n分镜过渡: 无\n\n分镜1<duration-ms>{毫秒数}</duration-ms>: 时间：{日/夜/晨/黄昏}，场景图片：@图{场景编号} ，镜头：{景别}，{角度}，{运镜}，@图{角色编号} {动作/表情/视线朝向/站位描述}。{台词与音色描述（如有）}。{背景环境补充}。{光影氛围}。{运镜补充}。\n\`\`\`\n\n**多分镜模板：**\n\`\`\`\n画面风格和类型: {风格}, {色调}, {类型}\n\n生成一个由以下 {N} 个分镜组成的视频:\n\n场景:\n分镜过渡: {全局过渡描述}\n\n分镜1<duration-ms>{毫秒数}</duration-ms>: 时间：{...}，场景图片：@图{场景编号} ，镜头：{...}，@图{角色编号} {...}。{...}。\n分镜2<duration-ms>{毫秒数}</duration-ms>: ...\n...\n\`\`\`\n\n#### 音色生成规则（有台词时必填）\n\n台词格式：\`@图{角色编号} 说：「{台词内容}」音色：{9维度描述}\`\n\n9维度按顺序填写：\n\`\`\`\n{性别}，{年龄音色}，{音调}，{音色质感}，{声音厚度}，{发音方式}，{气息}，{语速}，{特殊质感}\n\`\`\`\n\n> 当 desc 中未明确音色信息时，根据角色类型从以下参考表推断：\n\n| 角色类型特征 | 默认音色 |\n|------------|---------|\n| 男性权威/霸气角色 | 男声，中年音色，音调低沉，音色浑厚有力，声音厚重，发音标准，气息极其沉稳，语速偏慢 |\n| 女性温柔/甜美角色 | 女声，青年音色，音调中等偏高，音色质感明亮清脆，声音清亮柔和，气息充沛平稳，带温婉真诚感 |\n| 男性年轻/普通角色 | 男声，青年音色，音调中等，音色干净，声音厚度适中，发音清晰，气息平稳，语速适中 |\n| 女性活泼/外向角色 | 女声，青年音色，音调偏高，音色清脆活泼，声音轻盈，气息充沛，语速偏快，带笑意和感染力 |\n| 反派/冷酷角色 | 男声，中年音色，音调低沉，音色质感干燥偏暗，声音带沙砾感，气息平稳，语速极慢，有威胁感 |\n\n#### 无台词分镜处理\n- 不写 \`说：\` 和音色段落\n- 在动作描述后标注 \`无台词\`\n\n#### 台词类型格式\n\n| 台词类型 | 格式 | 嘴型描述 |\n|----------|------|----------|\n| 普通对白 | \`@图{角色编号} 说：「{台词}」音色：{9维度}\` | 角色嘴部开合说话 |\n| 内心独白 | \`@图{角色编号} 内心OS：「{台词}」音色：{9维度}\` | 角色嘴部紧闭不动 |\n| 画外音 | \`@图{角色编号} 画外音VO：「{台词}」音色：{9维度}\` | 角色嘴部紧闭不动（或角色不在画面中） |\n\n#### 生成约束\n1. **中文提示词**\n2. **严格遵循 videoDesc**：每条分镜内容严格基于 videoDesc 的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段，不编造额外信息\n3. **台词不可缺失**：videoDesc 中有台词的分镜，必须完整输出台词和音色\n4. **台词类型正确标注**：普通对白用「说：」，内心独白用「内心OS：」，画外音用「画外音VO：」\n5. **单分镜时长最低 1000ms（1 秒）**\n6. **时长单位**：将 videoDesc 中的秒 × 1000 转为毫秒填入 \`<duration-ms>\`\n\n#### Seedance 2.0 完整示例\n\n输入：\n\`\`\`\n模型：Seedance2.0\n资产信息[A001, character, 沈辞], [A002, character, 苏锦], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem videoDesc='（沈辞独立城楼远眺苍茫大地、城楼、沈辞/城楼、4s、全景、静止、负手而立衣袂随风飘扬、坚定决绝、黄昏冷调侧逆光、无台词、风声衣袂声、A001/A003）' prompt='全景，平视略仰，城楼之上，沈辞负手而立，衣袂飘扬，黄昏冷调侧逆光...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n<storyboardItem videoDesc='（苏锦登上城楼走向沈辞、城楼、苏锦/沈辞/城楼、4s、中景、跟踪、苏锦拾级而上走向沈辞、担忧、黄昏余晖渐暗、苏锦说：你又一个人在这里、脚步声风声、A001/A002/A003）' prompt='中景，跟踪，苏锦拾级而上走向城楼上的沈辞...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A002&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n\`\`\`\n\n输出：\n\`\`\`\n画面风格和类型: 真人写实, 电影风格, 冷调, 古风\n\n生成一个由以下 2 个分镜组成的视频:\n\n场景:\n分镜过渡: 镜头平滑切换，从全景过渡到中景跟踪，焦点从沈辞独处转向苏锦到来。\n\n分镜1<duration-ms>4000</duration-ms>: 时间：黄昏，场景图片：@图3 ，镜头：全景，平视略仰，静止镜头，@图1 独立城楼之上，负手而立，衣袂随风飘扬，目光远眺苍茫大地，神情肃然面容沉着，眼神坚定目光清冽，眉眼沉静气质凛然。无台词。背景是古城楼砖石纹理清晰，远方大地苍茫辽阔，天际线冷暖交替。黄昏斜射余晖侧逆光，冷调为主，长影拉伸，轮廓光微勾勒人物边缘，光感诗意。镜头静止。\n\n分镜2<duration-ms>4000</duration-ms>: 时间：黄昏，场景图片：@图3 ，镜头：中景，平视，跟踪拍摄，@图2 拾级而上，走向城楼上的@图1 ，面部朝向@图1 方向，神情微愣面色微变，眼神中带着担忧，@图2 说：「你又一个人在这里。」音色：女声，青年音色，音调中等偏高，音色质感明亮清脆，声音清亮柔和，发音方式干净，气息充沛平稳，语速适中，带温婉真诚感。背景城楼台阶纹理清晰，余晖渐暗，天际线冷暖交替加深。镜头跟踪苏锦移动。\n\`\`\`\n\n---\n\n### 四、Wan 2.6\n\n#### 核心原则\n- **单图首帧模式**：归类为首尾帧模式，但仅有首帧（分镜图），无尾帧\n- **单条分镜输入/输出**：每次仅输入一条 \`<storyboardItem>\` 及其关联资产信息，输出也仅为一段完整的叙事式提示词\n- **叙事式英文提示词**：像写小说一样描写画面，不使用标签罗列（不写 \`4K, cinematic, high quality\` 这类堆砌）\n- **三段式结构**：风格基调 → 主体动作 + 场景环境 + 光线氛围 → 镜头收尾\n- **纯文本提示词**：提示词内**不使用任何 \`@图N \` 引用**，全部内容用纯文本描述\n- **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段生成，不编造额外内容\n- **台词不可缺失**：videoDesc 中有台词的分镜，必须在提示词中体现台词相关描述\n- **台词类型标注**：区分普通对白（dialogue）、内心独白（inner monologue OS）、画外音（voiceover VO），在提示词中用括号标注\n\n#### prompt 生成模板\n\n每次输入一条分镜，输出一段完整提示词（无编号前缀），格式如下：\n\n\`\`\`\n{风格基调一句话定性},\n{主体名} {外观简述}, {具体动作/姿态描述}, {情绪/表情用动作暗示}.\n{场景背景主体}, {具体环境物件}, {空间感}, {时间/天气}.\n{光线方向/色温} {质感描述}, {情绪暗示光影}.\n{台词描述（如有，含 dialogue/OS/VO 标注）/ No dialogue}.\n{音效描述}.\n{拍摄方式}, {景别}, {视角}, {运镜方式}.\n\`\`\`\n\n#### 叙事式写法要点\n\n| 原则 | 说明 | 示例 |\n|------|------|------|\n| 风格基调放最前 | 一句话定性整体气质 | \`A cinematic epic scene\` / \`A melancholic cinematic scene\` |\n| 主体+动作紧密绑定 | 主体后面直接跟动作，外观细节嵌入主体描述 | \`A young man in dark flowing robes stands alone atop the city wall, hands clasped behind back\` |\n| 情绪用动作暗示 | 不直接陈述「他很悲伤」 | ❌ \`He is sad.\` → ✅ \`head drops slowly, shoulders slumped\` |\n| 环境融入叙事 | 不罗列环境属性 | ❌ \`The sky is blue. The grass is green.\` → ✅ \`hazy blue sky stretches over the emerald valley\` |\n| 光线单独成句 | 光线方向+色温+质感+情绪 | \`Warm golden hour light streams from behind, casting long shadows across the stone floor\` |\n| 镜头语言收尾 | 一句话点睛 | \`Captured in a wide establishing shot from a low-angle perspective, static camera\` |\n| 禁止标签堆砌 | 不写 \`4K, cinematic, high quality\` | \`cinematic\` 融入风格基调即可 |\n\n#### 生成约束\n1. **全部用英文**\n2. **不使用任何 \`@图N \` 引用**：提示词内不引用角色资产、场景资产、分镜图，全部内容用纯文本描述\n3. **叙事式描写**：像写小说一样构建画面，禁止标签罗列和配置清单式写法\n4. **主体用文字描述**：简要描述主体外观特征（如服饰、发型等关键辨识特征），嵌入主体描述中\n5. **严格遵循 videoDesc**：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段，不编造额外信息\n6. **台词不可缺失**：videoDesc 中有台词的分镜，必须在提示词中完整输出台词内容（保持原始语言，不翻译）\n7. **台词类型标注**：普通对白标注 \`(dialogue)\`；内心独白标注 \`(inner monologue, OS)\`；画外音标注 \`(voiceover, VO)\`\n8. **单条输入/输出**：每次仅处理一条分镜，输出一段提示词，无编号前缀\n9. **无需标注时长**：时长由模型侧控制，提示词中不写时长参数\n10. **镜头描述融入叙事**：不用方括号标签，用完整句子描述镜头\n11. **视觉风格**参考 Assistant 中的「视觉风格约束」部分内容\n\n#### Wan 2.6 完整示例\n\n**示例1：无台词分镜**\n\n输入：\n\`\`\`\n模型：Wan2.6\n资产信息[A001, character, 沈辞], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem videoDesc='（沈辞独立城楼远眺苍茫大地、城楼、沈辞/城楼、4s、全景、静止、负手而立衣袂随风飘扬、坚定决绝、黄昏冷调侧逆光、无台词、风声衣袂声、A001/A003）' prompt='全景，平视略仰，城楼之上，沈辞负手而立，衣袂飘扬，黄昏冷调侧逆光...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n\`\`\`\n\n输出：\n\`\`\`\nA cinematic epic scene with a cold, desaturated palette,\nA lone man in dark flowing robes stands atop an ancient city wall, hands clasped behind his back, robes and hair billowing in the wind, gaze fixed on the vast land stretching to the horizon, jaw set firm, eyes unwavering.\nThe weathered stone battlements frame the endless expanse below, rolling terrain fading into haze beneath a heavy dusk sky, clouds layered in muted golds and slate greys.\nCold side-backlight from the setting sun carves a sharp silhouette, long shadows stretching across the stone floor, a faint warm rim outlining the figure against the cool atmosphere.\nNo dialogue.\nWind howling across the open wall, fabric flapping rhythmically.\nCaptured in a wide establishing shot from a slightly low angle, static camera, single continuous take.\n\`\`\`\n\n**示例2：有台词分镜**\n\n输入：\n\`\`\`\n模型：Wan2.6\n资产信息[A001, character, 沈辞], [A002, character, 苏锦], [A003, scene, 城楼]\n\`\`\`\n\`\`\`xml\n<storyboardItem videoDesc='（苏锦登上城楼走向沈辞、城楼、苏锦/沈辞/城楼、4s、中景、跟踪、苏锦拾级而上走向沈辞、担忧、黄昏余晖渐暗、苏锦说：你又一个人在这里、脚步声风声、A001/A002/A003）' prompt='中景，跟踪，苏锦拾级而上走向城楼上的沈辞...' track='main' duration='4' associateAssetsIds="[&quot;A001&quot;,&quot;A002&quot;,&quot;A003&quot;]" shouldGenerateImage="true" ></storyboardItem>\n\`\`\`\n\n输出：\n\`\`\`\nA melancholic cinematic scene, dusk tones deepening,\nA young woman in a light-colored dress ascends the final stone steps onto the city wall, her gaze locked on the lone figure ahead, brow slightly furrowed, pace slowing as she approaches, lips parting softly.\nThe ancient city wall stretches behind her, weathered stairs leading up from below, the distant skyline dimming as the last traces of golden hour fade into twilight.\nFading warm light mingles with rising cool blue tones, the contrast between the two figures softened by the diffused remnants of sunset.\n"你又一个人在这里。" — Su Jin (dialogue).\nFootsteps on stone, wind sweeping across the battlements, fabric rustling.\nA medium tracking shot follows the woman from behind as she ascends and approaches, handheld camera with subtle movement, single continuous take.\n\`\`\`\n\n---\n\n## 景别 → 镜头标签映射\n\n| videoDesc 中的景别 | KlingOmni（英文标签） | Seedance 1.5（英文标签） | Seedance 2.0（中文描述） | Wan 2.6（英文叙事式） |\n|------|------|------|------|------|\n| 远景 | extreme wide shot | Extreme wide shot | 远景 | an extreme wide shot capturing the vast expanse |\n| 全景 | wide shot | Wide establishing shot | 全景 | a wide establishing shot |\n| 中景 | medium shot | Medium shot | 中景 | a medium shot |\n| 近景 | close-up | Close-up | 近景 | a close-up shot |\n| 特写 | close-up | Close-up | 特写 | a close-up capturing fine detail |\n| 大特写 | extreme close-up | Extreme close-up | 大特写 | an extreme close-up |\n\n## 运镜 → 镜头标签映射\n\n| videoDesc 中的运镜 | KlingOmni（英文标签） | Seedance 1.5（英文标签） | Seedance 2.0（中文描述） | Wan 2.6（英文叙事式） |\n|------|------|------|------|------|\n| 静止 | static camera | Static, no camera movement | 镜头静止 | static camera, locked off |\n| 推进 | dolly in / push in | Slow dolly forward | 镜头缓慢向前推进 | camera slowly pushing in |\n| 拉远 | dolly out / pull back | Slow dolly backward pull | 镜头缓慢向后拉远 | camera gently pulling back |\n| 跟踪 | tracking shot | Tracking shot, handheld | 跟踪拍摄 | tracking shot following the subject |\n| 摇镜 | pan left/right | Slow pan | 镜头缓慢摇移 | smooth pan across the scene |\n| 甩镜 | whip pan | Whip pan | 快速甩镜 | whip pan |\n| 升降 | crane up/down | Crane up/down | 镜头升降 | crane rising / descending |\n| 环绕 | surround shooting | Orbiting shot | 环绕拍摄 | orbiting around the subject |\n\n---\n\n## 执行流程\n\n1. **解析输入**：提取模型名和多参标志，按路由规则匹配模式；提取资产列表\n2. **构建 @图N 编号表**：资产按输入顺序从 \`@图1 \` 起编号，分镜图接续编号；\`shouldGenerateImage="false"\` 的分镜不分配分镜图编号\n3. **逐条解析 \`<storyboardItem>\`**：按 videoDesc 解析规则提取12个字段，结合 \`duration\`、\`associateAssetsIds\` 建立标签映射\n4. **整合为一个完整的视频提示词**：按目标模型格式编排全部分镜\n5. **输出视频提示词**\n\n---\n\n## 约束\n\n- **仅输出视频提示词**：不附加任何解释、注释或额外说明，只输出视频提示词文本\n- **严格遵循 videoDesc**（全模式通用）：提示词内容严格基于 videoDesc 中的画面描述、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效字段生成，不编造额外内容\n- **台词不可缺失**（全模式通用）：videoDesc 中有台词的分镜，必须在提示词中完整体现台词内容，不得遗漏\n- **台词保持原始输入**（全模式通用）：台词内容严禁翻译，必须保持 videoDesc 中的原始语言原样输出\n- **台词类型标注**（全模式通用）：必须区分普通对白（dialogue / 说）、内心独白（OS / 内心OS）、画外音（VO / 画外音VO），并在提示词中正确标注\n- **时间跨度最低 1 秒**（全模式通用）：所有模式中涉及时间分段（Motion 时间轴 / duration-ms）的最小粒度为 1 秒（1000ms），禁止出现 0.5 秒等低于 1 秒的间隔\n- **视觉风格**：风格相关描述参考 Assistant 中的「视觉风格约束」部分内容，不在本 Skill 内自行定义风格\n- **严格按匹配到的模式格式**，不混用不同模式的格式\n- **不修改原始输入**：不改写 \`<storyboardItem>\` 的任何字段；\`prompt\` 已有的分镜图提示词仅作画面参考\n- **不编造资产或台词**：只使用输入中的资产信息；无台词则标注「无台词」/ \`No dialogue\`\n- **时长单位转换**：Seedance 2.0 的 \`<duration-ms>\` 需将秒 × 1000 转为毫秒\n`,
          },
        ]);
      },
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
        table.integer("eventState");
        table.text("event");
        table.text("errorReason");
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
        table.integer("extractState");
        table.integer("createTime");
        table.text("errorReason");
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
        table.integer("scriptId"); //剧本id
        table.integer("imageId").unsigned().references("id").inTable("o_image");
        table.integer("assetsId");
        table.integer("projectId");
        table.integer("flowId"); //工作流id
        table.integer("startTime");
        table.string("promptState");
        table.text("promptErrorReason");
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
        table.text("errorReason");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //分镜
    {
      name: "o_storyboard",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("scriptId");
        table.text("prompt");
        table.text("filePath");
        table.text("duration");
        table.text("state");
        table.integer("trackId");
        table.text("reason");
        table.text("track");
        table.text("videoDesc");
        table.integer("shouldGenerateImage"); // 0 否  1 是
        table.integer("projectId");
        table.integer("flowId"); //工作流id
        table.integer("index");
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //flowData-剧本
    {
      name: "o_agentWorkData",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("projectId");
        table.integer("episodesId");
        table.string("key"); //用户其他方式索引
        table.string("data");
        table.integer("createTime");
        table.integer("updateTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //视频
    {
      name: "o_video",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("filePath");
        table.text("errorReason");
        table.integer("time");
        table.text("state");
        table.integer("scriptId");
        table.integer("projectId");
        table.integer("videoTrackId");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    // 视频轨道
    {
      name: "o_videoTrack",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("videoId");
        table.integer("projectId");
        table.integer("scriptId");
        table.text("state");
        table.text("reason");
        table.text("prompt");
        table.integer("selectVideoId");
        table.integer("duration");
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    //供应商配置表
    {
      name: "o_vendorConfig",
      builder: (table) => {
        table.string("id").notNullable();
        table.text("author");
        table.text("description");
        table.text("name");
        table.text("icon");
        table.text("inputs"); // 输入项配置 JSON
        table.text("inputValues"); // 输入项值 JSON
        table.text("models"); // 模型配置 JSON
        table.text("code"); // 模型配置 JSON
        table.integer("enable"); //是否启用供应商
        table.integer("createTime");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {
        await knex("o_vendorConfig").insert([
          {
            id: "toonflow",
            author: "Toonflow",
            description:
              "## Toonflow官方中转平台\n\nToonflow官方中转平台，提供**文本、图像、视频、音频**等多模态生成能力的中转服务，支持接入多个大模型供应商，方便用户统一管理和调用不同供应商的生成能力。\n\n🔗 [前往中转平台](https://api.toonflow.net/)\n\n如果这个项目对你有帮助，可以考虑支持一下我们的开发工作 ☕",
            name: "Toonflow官方中转平台",
            icon: "",
            inputs: '[{"key":"apiKey","label":"API密钥","type":"password","required":true}]',
            inputValues: '{"apiKey":"","baseUrl":"https://api.toonflow.net/v1"}',
            models:
              '[{"name":"claude-sonnet-4-6","type":"text","modelName":"claude-sonnet-4-6","think":false},{"name":"claude-opus-4-6","type":"text","modelName":"claude-opus-4-6","think":false},{"name":"claude-sonnet-4-5-20250929","type":"text","modelName":"claude-sonnet-4-5-20250929","think":false},{"name":"claude-opus-4-5-20251101","type":"text","modelName":"claude-opus-4-5-20251101","think":false},{"name":"claude-haiku-4-5-20251001","type":"text","modelName":"claude-haiku-4-5-20251001","think":false},{"name":"gpt-5.4","type":"text","modelName":"gpt-5.4","think":false},{"name":"gpt-5.2","type":"text","modelName":"gpt-5.2","think":false},{"name":"MiniMax-M2.7","type":"text","modelName":"MiniMax-M2.7","think":true},{"name":"MiniMax-M2.5","type":"text","modelName":"MiniMax-M2.5","think":true},{"name":"Wan2.6 I2V 1080P (支持真人)","type":"video","modelName":"Wan2.6-I2V-1080P","mode":["text","startEndRequired"],"durationResolutionMap":[{"duration":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["1080p"]}],"audio":true},{"name":"Wan2.6 I2V 720P (支持真人)","type":"video","modelName":"Wan2.6-I2V-720P","mode":["text","startEndRequired"],"durationResolutionMap":[{"duration":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["720p"]}],"audio":true},{"name":"Seedance 1.5 Pro","type":"video","modelName":"doubao-seedance-1-5-pro-251215","durationResolutionMap":[{"duration":[4,5,6,7,8,9,10,11,12],"resolution":["480p","720p","1080p"]}],"mode":["text","endFrameOptional"],"audio":true},{"name":"vidu2 turbo","type":"video","modelName":"ViduQ2-turbo","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":false},{"name":"ViduQ3 pro","type":"video","modelName":"ViduQ3-pro","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":false},{"name":"ViduQ2 pro","type":"video","modelName":"ViduQ2-pro","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":false},{"name":"Doubao Seedream 5.0 Lite","type":"image","modelName":"Doubao-Seedream-5.0-Lite","mode":["text","singleImage","multiReference"]},{"name":"Doubao Seedream 4.5","type":"image","modelName":"doubao-seedream-4-5-251128","mode":["text","singleImage","multiReference"]}]',
            code: '//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）\r\n// ==================== 类型定义 ====================\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[] // 混合参考\r\n  )[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\ndeclare const axios: any;\r\ndeclare const createOpenAI: any;\r\ndeclare const createDeepSeek: any;\r\ndeclare const createZhipu: any;\r\ndeclare const createQwen: any;\r\ndeclare const createAnthropic: any;\r\ndeclare const createOpenAICompatible: any;\r\ndeclare const createXai: any;\r\ndeclare const createMinimax: any;\r\ndeclare const createGoogleGenerativeAI: any;\r\ndeclare const logger: (logstring: string) => void;\r\ndeclare const jsonwebtoken: any;\r\n\r\n// ==================== 供应商数据 ====================\r\nconst vendor: VendorConfig = {\r\n  id: "toonflow",\r\n  author: "Toonflow",\r\n   description:\r\n    "## Toonflow官方中转平台\\n\\nToonflow官方中转平台，提供**文本、图像、视频、音频**等多模态生成能力的中转服务，支持接入多个大模型供应商，方便用户统一管理和调用不同供应商的生成能力。\\n\\n🔗 [前往中转平台](https://api.toonflow.net/)\\n\\n如果这个项目对你有帮助，可以考虑支持一下我们的开发工作 ☕",\r\n  name: "Toonflow官方中转平台",\r\n  icon: "",\r\n  inputs: [\r\n    { key: "apiKey", label: "API密钥", type: "password", required: true },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    baseUrl: "https://api.toonflow.net/v1"\r\n  },\r\n  models: [\r\n    {\r\n      name: "claude-sonnet-4-6",\r\n      type: "text",\r\n      modelName: "claude-sonnet-4-6",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "claude-opus-4-6",\r\n      type: "text",\r\n      modelName: "claude-opus-4-6",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "claude-sonnet-4-5-20250929",\r\n      type: "text",\r\n      modelName: "claude-sonnet-4-5-20250929",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "claude-opus-4-5-20251101",\r\n      type: "text",\r\n      modelName: "claude-opus-4-5-20251101",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "claude-haiku-4-5-20251001",\r\n      type: "text",\r\n      modelName: "claude-haiku-4-5-20251001",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "gpt-5.4",\r\n      type: "text",\r\n      modelName: "gpt-5.4",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "gpt-5.2",\r\n      type: "text",\r\n      modelName: "gpt-5.2",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "MiniMax-M2.7",\r\n      type: "text",\r\n      modelName: "MiniMax-M2.7",\r\n      think: true,\r\n    },\r\n    {\r\n      name: "MiniMax-M2.5",\r\n      type: "text",\r\n      modelName: "MiniMax-M2.5",\r\n      think: true,\r\n    },\r\n    {\r\n      name: "Wan2.6 I2V 1080P (支持真人)",\r\n      type: "video",\r\n      modelName: "Wan2.6-I2V-1080P",\r\n      mode: ["text", "startEndRequired"],\r\n      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["1080p"] }],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "Wan2.6 I2V 720P (支持真人)",\r\n      type: "video",\r\n      modelName: "Wan2.6-I2V-720P",\r\n      mode: ["text", "startEndRequired"],\r\n      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p"] }],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "Seedance 1.5 Pro",\r\n      type: "video",\r\n      modelName: "doubao-seedance-1-5-pro-251215",\r\n      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],\r\n      mode: ["text", "endFrameOptional"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "vidu2 turbo",\r\n      type: "video",\r\n      modelName: "ViduQ2-turbo",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "ViduQ3 pro",\r\n      type: "video",\r\n      modelName: "ViduQ3-pro",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "ViduQ2 pro",\r\n      type: "video",\r\n      modelName: "ViduQ2-pro",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n\r\n    {\r\n      name: "Doubao Seedream 5.0 Lite",\r\n      type: "image",\r\n      modelName: "Doubao-Seedream-5.0-Lite",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n    {\r\n      name: "Doubao Seedream 4.5",\r\n      type: "image",\r\n      modelName: "doubao-seedream-4-5-251128",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 适配器函数 ====================\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");\r\n\r\n  return createOpenAI({\r\n    baseURL: vendor.inputValues.baseUrl,\r\n    apiKey: apiKey,\r\n  }).chat(textModel.modelName);\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\n//豆包格式适配\r\nfunction doubaoAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {\r\n  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;\r\n  const sizeMap: Record<string, Record<string, string>> = {\r\n    "16:9": {\r\n      "2k": "2848x1600",\r\n      "2K": "2848x1600",\r\n      "4K": "4096x2304",\r\n      "4k": "4096x2304",\r\n    },\r\n    "9:16": {\r\n      "4k": "2304x4096",\r\n      "2k": "1600x2848",\r\n      "2K": "1600x2848",\r\n      "4K": "2304x4096",\r\n    },\r\n  };\r\n  const body = {\r\n    model: imageModel.modelName,\r\n    prompt: imageConfig.prompt,\r\n    size: sizeMap[imageConfig.aspectRatio][size],\r\n    response_format: "url",\r\n    sequential_image_generation: "disabled",\r\n    stream: false,\r\n    watermark: false,\r\n    ...(imageConfig.imageBase64 && { image: imageConfig.imageBase64 }),\r\n  };\r\n  return {\r\n    body,\r\n    processFn: (data) => {\r\n      return data.data[0].url;\r\n    },\r\n  };\r\n}\r\n\r\n// 提取图片内容\r\nfunction extractFirstImageFromMd(content) {\r\n  const regex = /!\\[([^\\]]*)\\]\\((data:image\\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\\/\\/[^\\s)]+|\\/\\/[^\\s)]+|[^\\s)]+)\\)/;\r\n  const match = content.match(regex);\r\n  if (!match) return null;\r\n  const raw = match[2].trim();\r\n  const url = raw.startsWith("data:") ? raw : raw.split(/\\s+/)[0];\r\n  return {\r\n    alt: match[1],\r\n    url,\r\n    type: url.startsWith("data:image") ? "base64" : "url",\r\n  };\r\n}\r\n// gemini 图片请求适配\r\nfunction geminiImageAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {\r\n  const images = [];\r\n  if (imageConfig.imageBase64 && imageConfig.imageBase64.length) {\r\n    images.push({\r\n      role: "user",\r\n      content: imageConfig.imageBase64.map((i) => ({\r\n        type: "image_url",\r\n        image_url: {\r\n          url: i,\r\n        },\r\n      })),\r\n    });\r\n  }\r\n  const imageConfigGoogle = {\r\n    aspect_ratio: imageConfig.aspectRatio,\r\n  };\r\n  // if(imageModel.ModelName == \'gemini-3-pro-image-preview-vt\'){\r\n  imageConfigGoogle.image_size = imageConfig.size;\r\n  // }\r\n  const body = {\r\n    model: imageModel.modelName,\r\n    messages: [{ role: "user", content: imageConfig.prompt + `请直接输出图片` }, ...images],\r\n    extra_body: {\r\n      google: {\r\n        image_config: {\r\n          ...imageConfigGoogle,\r\n        },\r\n      },\r\n    },\r\n  };\r\n  return {\r\n    body,\r\n    url: `${vendor.inputValues.baseUrl}/chat/completions`,\r\n    processFn: (data: any) => {\r\n      return extractFirstImageFromMd(data.choices[0].message.content).url;\r\n    },\r\n  };\r\n}\r\nfunction commonAdaptor(imageConfig: ImageConfig, imageModel: ImageModel) {\r\n  const defaultImageFn = [\r\n    ["doubao", doubaoAdaptor],\r\n    ["nano", geminiImageAdaptor],\r\n    ["gemini", geminiImageAdaptor],\r\n    ["seedream", doubaoAdaptor],\r\n  ];\r\n  const modelName = imageModel.modelName;\r\n  const lowerName = modelName.toLowerCase();\r\n  const match = defaultImageFn.find(([key]) => lowerName.includes(key));\r\n  return match ? match[1](imageConfig, imageModel) : {};\r\n}\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");\r\n  const adaptor = commonAdaptor(imageConfig, imageModel);\r\n\r\n  const requestUrl = adaptor?.url ? `${vendor.inputValues.baseUrl}/chat/completions` : vendor.inputValues.baseUrl + "/images/generations";\r\n  const response = await fetch(requestUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(adaptor.body),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n  return adaptor.processFn(data);\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number; //视频时长，单位秒\r\n  resolution: string; //视频分辨率，如"720p"、"1080p"\r\n  aspectRatio: "16:9" | "9:16"; //视频长宽比\r\n  prompt: string; //视频提示词\r\n  fileBase64?: string[]; // 文件base64 包含图片base64、视频base64、音频base64\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]; // 混合参考\r\n}\r\n// 豆包视频\r\nconst buildDoubaoMetadata = (videoConfig: VideoConfig) => {\r\n  const metaData = {\r\n    ...(typeof videoConfig.audio == "boolean" && { generate_audio: videoConfig.audio ?? false }),\r\n    ratio: videoConfig.aspectRatio,\r\n    image_roles: [],\r\n    references: [],\r\n  };\r\n  if (videoConfig.imageBase64 && videoConfig.imageBase64.length) {\r\n    videoConfig.imageBase64.forEach((i, index) => {\r\n      if (Array.isArray(videoConfig.mode)) {\r\n        metaData.references.push(i);\r\n      } else {\r\n        if (videoConfig.mode == "startEndRequired" || videoConfig.mode == "endFrameOptional" || videoConfig.mode == "startFrameOptional") {\r\n          (metaData.image_roles as string[]).push(index == 0 ? "first_frame" : "last_frame");\r\n        }\r\n        if (videoConfig.mode == "singleImage") {\r\n          (metaData.image_roles as string[]).push("reference_image");\r\n        }\r\n      }\r\n    });\r\n  }\r\n\r\n  return metaData;\r\n};\r\n\r\n// 万象\r\nconst buildWanMetadata = (videoConfig: VideoConfig) => {\r\n  const images = videoConfig.imageBase64 ?? [];\r\n  const metaData: Record<string, string | boolean> = {};\r\n  if (\r\n    (videoConfig.mode === "startEndRequired" || videoConfig.mode == "endFrameOptional" || videoConfig.mode == "startFrameOptional") &&\r\n    images.length == 2\r\n  ) {\r\n    if (images[0]) metaData.first_frame_url = images[0];\r\n    if (images[1]) metaData.last_frame_url = images[1];\r\n  } else if (images.length) {\r\n    metaData.img_url = images[0]!;\r\n  }\r\n  if (typeof videoConfig.audio == "boolean") {\r\n    metaData.audio = videoConfig.audio;\r\n  }\r\n  return metaData;\r\n};\r\n// 千问视频\r\nconst buildViduMetadata = (videoConfig: VideoConfig) => ({\r\n  aspect_ratio: videoConfig.aspectRatio,\r\n  audio: videoConfig.audio ?? false,\r\n  off_peak: false,\r\n});\r\n// 可灵\r\nconst buildKlingAdaptor = (videoConfig: VideoConfig) => {\r\n  const metaData: any = {\r\n    aspect_ratio: videoConfig.aspectRatio,\r\n  };\r\n\r\n  if (videoConfig.imageBase64 && videoConfig.imageBase64.length) {\r\n    if (Array.isArray(videoConfig.mode)) {\r\n      metaData.reference = videoConfig.imageBase64;\r\n    }\r\n    if (videoConfig.mode == "endFrameOptional") {\r\n      metaData.image_tail = videoConfig.imageBase64[0];\r\n    }\r\n    if (videoConfig.mode == "startEndRequired") {\r\n      metaData.image_list = [\r\n        {\r\n          image_url: videoConfig.imageBase64[0],\r\n          type: "first_frame",\r\n        },\r\n        {\r\n          image_url: videoConfig.imageBase64[1],\r\n          type: "last_frame",\r\n        },\r\n      ];\r\n    }\r\n    if (videoConfig.mode == "singleImage") {\r\n      metaData.image = videoConfig.imageBase64[0];\r\n    }\r\n  }\r\n\r\n  return metaData;\r\n};\r\ntype MetadataBuilder = (config: VideoConfig) => Record<string, any>;\r\nconst METADATA_BUILDERS: Array<[string, MetadataBuilder]> = [\r\n  ["doubao", buildDoubaoMetadata],\r\n  ["wan", buildWanMetadata],\r\n  ["vidu", buildViduMetadata],\r\n  ["seedance", buildDoubaoMetadata],\r\n  ["kling", buildKlingAdaptor],\r\n];\r\nconst buildModelMetadata = (modelName: string, videoConfig: VideoConfig) => {\r\n  const lowerName = modelName.toLowerCase();\r\n  const match = METADATA_BUILDERS.find(([key]) => lowerName.includes(key));\r\n  return match ? match[1](videoConfig) : {};\r\n};\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");\r\n  try {\r\n    videoConfig.mode = JSON.parse(videoConfig.mode);\r\n  } catch (e) {\r\n    videoConfig.mode = videoConfig.mode as any;\r\n  }\r\n  // 构建每个模型对应的附加参数\r\n  const metadata = buildModelMetadata(videoModel.modelName, videoConfig);\r\n\r\n  //公共请求参数\r\n  const publicBody = {\r\n    model: videoModel.modelName,\r\n    ...(videoConfig.imageBase64 && videoConfig.imageBase64.length && !Array.isArray(videoConfig.mode) ? { images: videoConfig.imageBase64 } : {}),\r\n    prompt: videoConfig.prompt,\r\n    duration: videoConfig.duration,\r\n    metadata: metadata,\r\n  };\r\n\r\n  if (videoModel.modelName.toLocaleLowerCase().includes("wan")) {\r\n    const sizeMap: Record<string, Record<string, string>> = {\r\n      "480p": {\r\n        "16:9": "832*480",\r\n        "9:16": "480*832",\r\n      },\r\n      "720p": {\r\n        "16:9": "1280*720",\r\n        "9:16": "720*1280",\r\n      },\r\n      "1080p": {\r\n        "16:9": "1920*1080",\r\n        "9:16": "1080*1920",\r\n      },\r\n    };\r\n    const size = sizeMap[videoConfig.resolution]?.[videoConfig.aspectRatio];\r\n    publicBody.size = size;\r\n  }\r\n  const requestUrl = vendor.inputValues.baseUrl + "/video/generations";\r\n  const queryUrl = vendor.inputValues.baseUrl + "/video/generations/{id}";\r\n  const response = await fetch(requestUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(publicBody),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n  const taskId = data.id;\r\n  const res = await pollTask(async () => {\r\n    const queryResponse = await fetch(queryUrl.replace("{id}", taskId), {\r\n      method: "GET",\r\n      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },\r\n    });\r\n    if (!queryResponse.ok) {\r\n      const errorText = await queryResponse.text(); // 获取错误信息\r\n      console.error("请求失败，状态码:", queryResponse.status, ", 错误信息:", errorText);\r\n      throw new Error(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);\r\n    }\r\n    const queryData = await queryResponse.json();\r\n    const status = queryData?.status ?? queryData?.data?.status;\r\n    const fail_reason = queryData?.data?.fail_reason ?? queryData?.data;\r\n    switch (status) {\r\n      case "completed":\r\n      case "SUCCESS":\r\n      case "success":\r\n        return { completed: true, data: queryData.data.result_url };\r\n      case "FAILURE":\r\n        return { completed: false, error: fail_reason || "视频生成失败" };\r\n      default:\r\n        return { completed: false };\r\n    }\r\n  });\r\n  if (res.error) throw new Error(res.error);\r\n  return res.data;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  return null;\r\n};\r\nexports.ttsRequest = ttsRequest;\r\n',
            enable: 0,
            createTime: 1775164020756,
          },
          {
            id: "volcengine",
            author: "leeqi",
            description:
              "火山引擎方舟官方直连模板，接入 Ark 的文本、图片、视频生成 API，支持 Doubao、DeepSeek、GLM 等模型。\n[](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)",
            name: "火山引擎",
            icon: "",
            inputs:
              '[{"key":"apiKey","label":"ARK API Key","type":"password","required":true},{"key":"text","label":"文本生成接口","type":"url","required":false,"placeholder":"如非必要请勿更改"},{"key":"baseUrl","label":"Ark Base URL","type":"url","required":false,"placeholder":"如非必要请勿更改"},{"key":"image","label":"图片生成接口","type":"url","required":false,"placeholder":"如非必要请勿更改"},{"key":"videoCreate","label":"视频任务创建接口","type":"url","required":false,"placeholder":"如非必要请勿更改"},{"key":"videoQuery","label":"视频任务查询接口","type":"url","required":false,"placeholder":"如非必要请勿更改"}]',
            inputValues:
              '{"apiKey":"","text":"https://ark.cn-beijing.volces.com/api/v3","baseUrl":"https://ark.cn-beijing.volces.com/api/v3","image":"https://ark.cn-beijing.volces.com/api/v3/images/generations","videoCreate":"https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks","videoQuery":"https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}"}',
            models:
              '[{"name":"Doubao-Seed-2.0-pro","type":"text","modelName":"doubao-seed-2-0-pro-260215","think":false},{"name":"Doubao-Seed-2.0-lite","type":"text","modelName":"doubao-seed-2-0-lite-260215","think":false},{"name":"Doubao-Seed-2.0-mini","type":"text","modelName":"doubao-seed-2-0-mini-260215","think":false},{"name":"Doubao-Seed-2.0-Code","type":"text","modelName":"doubao-seed-2-0-code-preview-260215","think":false},{"name":"Doubao-1.5-pro-32k","type":"text","modelName":"doubao-1-5-pro-32k-250115","think":false},{"name":"deepseek-v3-250324","type":"text","modelName":"deepseek-v3-250324","think":false},{"name":"glm-4-7-251222","type":"text","modelName":"glm-4-7-251222","think":false},{"name":"Doubao-Seedream-5.0-lite","type":"image","modelName":"doubao-seedream-5-0-260128","mode":["text","singleImage","multiReference"]},{"name":"Doubao-Seedream-4.5","type":"image","modelName":"doubao-seedream-4-5-251128","mode":["text","singleImage","multiReference"]},{"name":"Doubao-Seedream-4.0","type":"image","modelName":"doubao-seedream-4-0-250828","mode":["text","singleImage","multiReference"]},{"name":"Doubao-Seedance-1.5-pro","type":"video","modelName":"doubao-seedance-1-5-pro-251215","mode":["text","singleImage","endFrameOptional"],"audio":true,"durationResolutionMap":[{"duration":[4,5,6,7,8,9,10,11,12],"resolution":["480p","720p","1080p"]}]},{"name":"Doubao-Seedance-1.0-pro-fast","type":"video","modelName":"doubao-seedance-1-0-pro-fast-251015","mode":["text","singleImage"],"audio":false,"durationResolutionMap":[{"duration":[2,3,4,5,6,7,8,9,10,11,12],"resolution":["480p","720p","1080p"]}]},{"name":"Doubao-Seedance-2.0","modelName":"doubao-seedance-2-0-260128","type":"video","mode":[["textReference","videoReference","imageReference","audioReference"]],"audio":"optional","durationResolutionMap":[{"duration":[4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["480p","720p"]}],"associationSkills":""}]',
            code: '//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）\r\n// ==================== 类型定义 ====================\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]\r\n  )[]; // 混合参考\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\ndeclare const axios: any;\r\ndeclare const createOpenAI: any;\r\ndeclare const createDeepSeek: any;\r\ndeclare const createZhipu: any;\r\ndeclare const createQwen: any;\r\ndeclare const createAnthropic: any;\r\ndeclare const createOpenAICompatible: any;\r\ndeclare const createXai: any;\r\ndeclare const createMinimax: any;\r\ndeclare const createGoogleGenerativeAI: any;\r\ndeclare const logger: (logstring: string) => void;\r\ndeclare const jsonwebtoken: any;\r\n// ==================== 供应商数据 ====================\r\nconst ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";\r\nconst SUCCESS_TASK_STATUS = ["succeeded", "completed", "success"];\r\nconst FAILED_TASK_STATUS = ["failed", "failure", "error", "canceled", "cancelled"];\r\n\r\nconst vendor: VendorConfig = {\r\n  id: "volcengine",\r\n  author: "leeqi",\r\n  description:\r\n    "火山引擎方舟官方直连模板，接入 Ark 的文本、图片、视频生成 API，支持 Doubao、DeepSeek、GLM 等模型。\\n[](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)",\r\n  name: "火山引擎",\r\n  inputs: [\r\n    { key: "apiKey", label: "ARK API Key", type: "password", required: true },\r\n    { key: "text", label: "文本生成接口", type: "url", required: false, placeholder: "如非必要请勿更改" },\r\n    { key: "baseUrl", label: "Ark Base URL", type: "url", required: false, placeholder: "如非必要请勿更改" },\r\n    { key: "image", label: "图片生成接口", type: "url", required: false, placeholder: "如非必要请勿更改" },\r\n    { key: "videoCreate", label: "视频任务创建接口", type: "url", required: false, placeholder: "如非必要请勿更改" },\r\n    { key: "videoQuery", label: "视频任务查询接口", type: "url", required: false, placeholder: "如非必要请勿更改" },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    text: ARK_BASE_URL,\r\n    baseUrl: ARK_BASE_URL,\r\n    image: `${ARK_BASE_URL}/images/generations`,\r\n    videoCreate: `${ARK_BASE_URL}/contents/generations/tasks`,\r\n    videoQuery: `${ARK_BASE_URL}/contents/generations/tasks/{id}`,\r\n  },\r\n  models: [\r\n    {\r\n      name: "Doubao-Seed-2.0-pro",\r\n      type: "text",\r\n      modelName: "doubao-seed-2-0-pro-260215",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "Doubao-Seed-2.0-lite",\r\n      type: "text",\r\n      modelName: "doubao-seed-2-0-lite-260215",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "Doubao-Seed-2.0-mini",\r\n      type: "text",\r\n      modelName: "doubao-seed-2-0-mini-260215",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "Doubao-Seed-2.0-Code",\r\n      type: "text",\r\n      modelName: "doubao-seed-2-0-code-preview-260215",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "Doubao-1.5-pro-32k",\r\n      type: "text",\r\n      modelName: "doubao-1-5-pro-32k-250115",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "deepseek-v3-250324",\r\n      type: "text",\r\n      modelName: "deepseek-v3-250324",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "glm-4-7-251222",\r\n      type: "text",\r\n      modelName: "glm-4-7-251222",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "Doubao-Seedream-5.0-lite",\r\n      type: "image",\r\n      modelName: "doubao-seedream-5-0-260128",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n    {\r\n      name: "Doubao-Seedream-4.5",\r\n      type: "image",\r\n      modelName: "doubao-seedream-4-5-251128",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n    {\r\n      name: "Doubao-Seedream-4.0",\r\n      type: "image",\r\n      modelName: "doubao-seedream-4-0-250828",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n    {\r\n      name: "Doubao-Seedance-1.5-pro",\r\n      type: "video",\r\n      modelName: "doubao-seedance-1-5-pro-251215",\r\n      mode: ["text", "singleImage", "endFrameOptional"],\r\n      audio: true,\r\n      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],\r\n    },\r\n    {\r\n      name: "Doubao-Seedance-1.0-pro-fast",\r\n      type: "video",\r\n      modelName: "doubao-seedance-1-0-pro-fast-251015",\r\n      mode: ["text", "singleImage"],\r\n      audio: false,\r\n      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],\r\n    },\r\n    {\r\n      name: "Doubao-Seedance-2.0",\r\n      modelName: "doubao-seedance-2-0-260128",\r\n      type: "video",\r\n      mode: [["textReference", "videoReference", "imageReference", "audioReference"]],\r\n      audio: "optional",\r\n      durationResolutionMap: [\r\n        {\r\n          duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],\r\n          resolution: ["480p", "720p"],\r\n        },\r\n      ],\r\n      associationSkills: "",\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 适配器函数 ====================\r\nconst getApiKey = () => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  return vendor.inputValues.apiKey.replace(/^Bearer\\s+/i, "");\r\n};\r\n\r\nconst getBaseUrl = () => vendor.inputValues.baseUrl || ARK_BASE_URL;\r\nconst buildUrl = (overrideUrl: string | undefined, fallbackPath: string) => overrideUrl || `${getBaseUrl().replace(/\\/$/, "")}${fallbackPath}`;\r\n\r\nconst getHeaders = () => ({\r\n  Authorization: `Bearer ${getApiKey()}`,\r\n  "Content-Type": "application/json",\r\n});\r\n\r\nconst getOpenAIBaseUrl = () =>\r\n  (vendor.inputValues.text || getBaseUrl())\r\n    .trim()\r\n    .replace(/\\/$/, "")\r\n    .replace(/\\/chat\\/completions$/i, "");\r\n\r\nconst readJson = async (response: Response, action: string) => {\r\n  if (!response.ok) {\r\n    const errorText = await response.text();\r\n    throw new Error(`${action}失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n\r\n  return response.json();\r\n};\r\n\r\n//补齐图片 data url 前缀\r\nconst normalizeImageInput = (value: string) => {\r\n  if (!value) return value;\r\n  if (/^(https?:\\/\\/|data:|volc:)/i.test(value)) return value;\r\n  return `data:image/png;base64,${value}`;\r\n};\r\n\r\nconst normalizeImageList = (imageBase64?: string[]) => (imageBase64 || []).filter(Boolean).map(normalizeImageInput);\r\n\r\nconst extractImageResult = (data: any) => {\r\n  const first = data?.data?.[0] ?? data?.images?.[0] ?? data?.output?.[0];\r\n  return first?.url ?? first?.image_url ?? first?.b64_json ?? first?.base64;\r\n};\r\n\r\nconst extractTaskId = (data: any) => data?.id ?? data?.task_id ?? data?.taskId ?? data?.data?.id ?? data?.data?.task_id ?? data?.data;\r\n\r\nconst extractVideoUrl = (data: any) =>\r\n  data?.content?.video_url ??\r\n  data?.content?.video_urls?.[0] ??\r\n  data?.data?.content?.video_url ??\r\n  data?.data?.content?.video_urls?.[0] ??\r\n  data?.data?.video_url ??\r\n  data?.result?.video_url ??\r\n  data?.result_url ??\r\n  data?.data?.result_url;\r\n\r\nconst getTaskStatus = (data: any) => (data?.status ?? data?.data?.status ?? "").toString().toLowerCase();\r\n\r\nconst getTaskError = (data: any) =>\r\n  data?.error?.message ?? data?.message ?? data?.data?.message ?? data?.data?.fail_reason ?? data?.fail_reason ?? "任务执行失败";\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  return createOpenAI({\r\n    baseURL: getOpenAIBaseUrl(),\r\n    apiKey: getApiKey(),\r\n  }).chat(textModel.modelName);\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\n\r\nconst normalizeImageSize = (imageConfig: ImageConfig) => {\r\n  const normalizedAspectRatio = imageConfig.aspectRatio;\r\n  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;\r\n\r\n  const sizeMap: Record<string, Record<string, string>> = {\r\n    "16:9": {\r\n      "2K": "2848x1600",\r\n      "4K": "4096x2304",\r\n    },\r\n    "9:16": {\r\n      "2K": "1600x2848",\r\n      "4K": "2304x4096",\r\n    },\r\n  };\r\n    return sizeMap[normalizedAspectRatio][size];\r\n};\r\n\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  const images = normalizeImageList(imageConfig.imageBase64);\r\n  const body = {\r\n    model: imageModel.modelName,\r\n    prompt: imageConfig.prompt,\r\n    size: normalizeImageSize(imageConfig),\r\n    response_format: "url",\r\n    sequential_image_generation: "disabled",\r\n    stream: false,\r\n    watermark: false,\r\n    ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),\r\n  };\r\n\r\n  const data = await readJson(\r\n    await fetch(buildUrl(vendor.inputValues.image, "/images/generations"), {\r\n      method: "POST",\r\n      headers: getHeaders(),\r\n      body: JSON.stringify(body),\r\n    }),\r\n    "图片生成",\r\n  );\r\n\r\n  const result = extractImageResult(data);\r\n  if (!result) throw new Error(`图片生成返回格式异常: ${JSON.stringify(data)}`);\r\n  return result;\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number;\r\n  resolution: string;\r\n  aspectRatio: "16:9" | "9:16";\r\n  prompt: string;\r\n  imageBase64?: string[];\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("video" | "image" | "audio" | "text")[]; // 混合参考\r\n}\r\n\r\nconst isSeedanceModel = (modelName: string) => /^doubao-seedance-/i.test(modelName);\r\nconst isSeedance15ProModel = (modelName: string) => /^doubao-seedance-1-5-pro/i.test(modelName);\r\n\r\nconst appendPromptFlag = (prompt: string, flag: string, value: string | number | boolean | undefined) => {\r\n  if (value === undefined || value === null || value === "") return prompt;\r\n  const normalizedPrompt = prompt.trim();\r\n  const flagPattern = new RegExp(`(^|\\\\s)--${flag}(?:\\\\s+\\\\S+)?(?=\\\\s|$)`, "i");\r\n  if (flagPattern.test(normalizedPrompt)) return normalizedPrompt;\r\n  return `${normalizedPrompt} --${flag} ${value}`.trim();\r\n};\r\n\r\nconst buildVideoPrompt = (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  if (!isSeedanceModel(videoModel.modelName)) return videoConfig.prompt || "";\r\n\r\n  let prompt = videoConfig.prompt || "";\r\n  prompt = appendPromptFlag(prompt, "resolution", videoConfig.resolution);\r\n  prompt = appendPromptFlag(prompt, "duration", videoConfig.duration);\r\n  prompt = appendPromptFlag(prompt, "camerafixed", false);\r\n  prompt = appendPromptFlag(prompt, "watermark", false);\r\n  return prompt;\r\n};\r\n\r\n//判断base64前缀 适配多参\r\nfunction getBase64Type(base64: string) {\r\n  const match = base64.match(/^data:([-\\w]+)\\/([-\\w]+);base64,/);\r\n  if (!match) return "unknown";\r\n  const mainType = match[1];\r\n  if (mainType === "image") return "image";\r\n  if (mainType === "audio") return "audio";\r\n  if (mainType === "video") return "video";\r\n  return "unknown";\r\n}\r\n\r\nconst buildVideoContent = (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  const images = videoConfig?.imageBase64 ?? [];\r\n  const content: any[] = [{ type: "text", text: buildVideoPrompt(videoConfig, videoModel) }];\r\n  if (videoConfig.mode == "startEndRequired" || videoConfig.mode == "endFrameOptional") {\r\n    images[0] && content.push({ type: "image_url", image_url: { url: images[0] }, role: "first_frame" });\r\n    images[1] && content.push({ type: "image_url", image_url: { url: images[1] }, role: "last_frame" });\r\n  }\r\n  if (Array.isArray(videoConfig.mode)) {\r\n    images.forEach((item) => {\r\n      const type = getBase64Type(item);\r\n      if (type == "audio") {\r\n        content.push({\r\n          type: "audio_url",\r\n          audio_url: { url: item },\r\n          role: "reference_audio",\r\n        });\r\n      } else if (type == "video") {\r\n        content.push({\r\n          type: "video_url",\r\n          video_url: { url: item },\r\n          role: "reference_video",\r\n        });\r\n      } else {\r\n        content.push({\r\n          type: "image_url",\r\n          image_url: { url: item },\r\n          role: "reference_image",\r\n        });\r\n      }\r\n    });\r\n  }\r\n  if (videoConfig.mode == "singleImage") {\r\n    images[0] && content.push({ type: "image_url", image_url: { url: images[0] } });\r\n  }\r\n  return content;\r\n};\r\n\r\nconst buildVideoBody = (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  const isSeedance = isSeedanceModel(videoModel.modelName);\r\n  const isSeedance15Pro = isSeedance15ProModel(videoModel.modelName);\r\n\r\n  return {\r\n    model: videoModel.modelName,\r\n    content: buildVideoContent(videoConfig, videoModel),\r\n    ...(!isSeedance15Pro && !isSeedance\r\n      ? {\r\n          duration: videoConfig.duration,\r\n          resolution: videoConfig.resolution,\r\n          ratio: videoConfig.aspectRatio,\r\n        }\r\n      : {}),\r\n    ...(videoModel.audio === true && typeof videoConfig.audio === "boolean" ? { generate_audio: videoConfig.audio } : {}),\r\n  };\r\n};\r\n\r\nconst queryVideoResult = async (taskId: string) => {\r\n  const queryData = await readJson(\r\n    await fetch(buildUrl(vendor.inputValues.videoQuery, "/contents/generations/tasks/{id}").replace("{id}", taskId), {\r\n      method: "GET",\r\n      headers: getHeaders(),\r\n    }),\r\n    "视频任务查询",\r\n  );\r\n\r\n  const status = getTaskStatus(queryData);\r\n  if (SUCCESS_TASK_STATUS.includes(status)) {\r\n    const videoUrl = extractVideoUrl(queryData);\r\n    if (!videoUrl) return { completed: true, error: `视频任务成功但未返回结果: ${JSON.stringify(queryData)}` };\r\n    return { completed: true, data: videoUrl };\r\n  }\r\n\r\n  if (FAILED_TASK_STATUS.includes(status)) {\r\n    return { completed: false, error: getTaskError(queryData) };\r\n  }\r\n\r\n  return { completed: false };\r\n};\r\n\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  const createData = await readJson(\r\n    await fetch(buildUrl(vendor.inputValues.videoCreate, "/contents/generations/tasks"), {\r\n      method: "POST",\r\n      headers: getHeaders(),\r\n      body: JSON.stringify(buildVideoBody(videoConfig, videoModel)),\r\n    }),\r\n    "视频任务创建",\r\n  );\r\n\r\n  const taskId = extractTaskId(createData);\r\n  if (!taskId) throw new Error(`视频任务创建返回格式异常: ${JSON.stringify(createData)}`);\r\n\r\n  const result = await pollTask(() => queryVideoResult(taskId));\r\n  if (result.error) throw new Error(result.error);\r\n  return result.data;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\n\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  return null;\r\n};\r\nexports.ttsRequest = ttsRequest;\r\n',
            enable: 0,
            createTime: 1775407135202,
          },
          {
            id: "minimax",
            author: "Toonflow",
            description: "MiniMax标准格式接口，如果没有你想要的模型请手动添加。",
            name: "MiniMax标准接口",
            icon: "",
            inputs:
              '[{"key":"apiKey","label":"API密钥","type":"password","required":true},{"key":"baseUrl","label":"请求地址","type":"url","required":true,"placeholder":"已默认填入官方地址，非特殊情况不需要更改"}]',
            inputValues: '{"apiKey":"","baseUrl":"https://api.minimaxi.com/v1"}',
            models:
              '[{"name":"MiniMax-M2.7","modelName":"MiniMax-M2.7","type":"text","think":true},{"name":"MiniMax-M2.7-highspeed","modelName":"MiniMax-M2.7-highspeed","type":"text","think":true},{"name":"MiniMax-M2.5","modelName":"MiniMax-M2.5","type":"text","think":true},{"name":"MiniMax-M2.5-highspeed","modelName":"MiniMax-M2.5-highspeed","type":"text","think":true}]',
            code: '//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）\r\n// ==================== 类型定义 ====================\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]\r\n  )[]; // 混合参考\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\ndeclare const axios: any;\r\ndeclare const createOpenAI: any;\r\ndeclare const createDeepSeek: any;\r\ndeclare const createZhipu: any;\r\ndeclare const createQwen: any;\r\ndeclare const createAnthropic: any;\r\ndeclare const createOpenAICompatible: any;\r\ndeclare const createXai: any;\r\ndeclare const createMinimax: any;\r\ndeclare const createGoogleGenerativeAI: any;\r\ndeclare const logger: (logstring: string) => void;\r\ndeclare const jsonwebtoken: any;\r\n\r\n// ==================== 供应商数据 ====================\r\nconst vendor: VendorConfig = {\r\n  id: "minimax",\r\n  author: "Toonflow",\r\n  description: "MiniMax标准格式接口，如果没有你想要的模型请手动添加。",\r\n  name: "MiniMax标准接口",\r\n  icon: "",\r\n  inputs: [\r\n    { key: "apiKey", label: "API密钥", type: "password", required: true },\r\n    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "已默认填入官方地址，非特殊情况不需要更改" },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    baseUrl: "https://api.minimaxi.com/v1",\r\n  },\r\n  models: [\r\n    {\r\n      name: "MiniMax-M2.7",\r\n      modelName: "MiniMax-M2.7",\r\n      type: "text",\r\n      think: true,\r\n    },\r\n    {\r\n      name: "MiniMax-M2.7-highspeed",\r\n      modelName: "MiniMax-M2.7-highspeed",\r\n      type: "text",\r\n      think: true,\r\n    },\r\n    {\r\n      name: "MiniMax-M2.5",\r\n      modelName: "MiniMax-M2.5",\r\n      type: "text",\r\n      think: true,\r\n    },\r\n    {\r\n      name: "MiniMax-M2.5-highspeed",\r\n      modelName: "MiniMax-M2.5-highspeed",\r\n      type: "text",\r\n      think: true,\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 适配器函数 ====================\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");\r\n\r\n  return createOpenAI({\r\n    baseURL: vendor.inputValues.baseUrl,\r\n    apiKey: apiKey,\r\n  }).chat(textModel.modelName);\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  return null;\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number;\r\n  resolution: string;\r\n  aspectRatio: "16:9" | "9:16";\r\n  prompt: string;\r\n  imageBase64?: string[];\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("video" | "image" | "audio" | "text")[]; // 混合参考\r\n}\r\n\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  return null;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  return null;\r\n};\r\nexports.ttsRequest = ttsRequest;\r\n',
            enable: 0,
            createTime: 1775154441614,
          },
          {
            id: "openai",
            author: "Toonflow",
            description: "OpenAI标准格式接口，如果没有你想要的模型请手动添加。",
            name: "OpenAI标准接口",
            icon: "",
            inputs:
              '[{"key":"apiKey","label":"API密钥","type":"password","required":true},{"key":"baseUrl","label":"请求地址","type":"url","required":true,"placeholder":"以v1结束，示例：https://api.openai.com/v1"}]',
            inputValues: '{"apiKey":"","baseUrl":"http://192.168.0.116:33332/v1"}',
            models:
              '[{"name":"GPT-4o","modelName":"gpt-4o","type":"text","think":false},{"name":"GPT-4.1","modelName":"gpt-4.1","type":"text","think":false},{"name":"GPT-5.1","modelName":"gpt-5.1","type":"text","think":false},{"name":"GPT-5.2","modelName":"gpt-5.2","type":"text","think":false},{"name":"GPT-5.4","modelName":"gpt-5.4","type":"text","think":false}]',
            code: '//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）\r\n// ==================== 类型定义 ====================\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]\r\n  )[]; // 混合参考\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\ndeclare const axios: any;\r\ndeclare const createOpenAI: any;\r\ndeclare const createDeepSeek: any;\r\ndeclare const createZhipu: any;\r\ndeclare const createQwen: any;\r\ndeclare const createAnthropic: any;\r\ndeclare const createOpenAICompatible: any;\r\ndeclare const createXai: any;\r\ndeclare const createMinimax: any;\r\ndeclare const createGoogleGenerativeAI: any;\r\ndeclare const logger: (logstring: string) => void;\r\ndeclare const jsonwebtoken: any;\r\n\r\n// ==================== 供应商数据 ====================\r\nconst vendor: VendorConfig = {\r\n  id: "openai",\r\n  author: "Toonflow",\r\n  description: "OpenAI标准格式接口，如果没有你想要的模型请手动添加。",\r\n  name: "OpenAI标准接口",\r\n  icon: "",\r\n  inputs: [\r\n    { key: "apiKey", label: "API密钥", type: "password", required: true },\r\n    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://api.openai.com/v1" },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    baseUrl: "https://api.openai.com/v1",\r\n  },\r\n  models: [\r\n    {\r\n      name: "GPT-4o",\r\n      modelName: "gpt-4o",\r\n      type: "text",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "GPT-4.1",\r\n      modelName: "gpt-4.1",\r\n      type: "text",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "GPT-5.1",\r\n      modelName: "gpt-5.1",\r\n      type: "text",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "GPT-5.2",\r\n      modelName: "gpt-5.2",\r\n      type: "text",\r\n      think: false,\r\n    },\r\n    {\r\n      name: "GPT-5.4",\r\n      modelName: "gpt-5.4",\r\n      type: "text",\r\n      think: false,\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 适配器函数 ====================\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");\r\n\r\n  return createOpenAI({\r\n    baseURL: vendor.inputValues.baseUrl,\r\n    apiKey: apiKey,\r\n  }).chat(textModel.modelName);\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  return null;\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number;\r\n  resolution: string;\r\n  aspectRatio: "16:9" | "9:16";\r\n  prompt: string;\r\n  imageBase64?: string[];\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("video" | "image" | "audio" | "text")[]; // 混合参考\r\n}\r\n\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  return null;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  return null;\r\n};\r\nexports.ttsRequest = ttsRequest;\r\n',
            enable: 0,
            createTime: 1775154125094,
          },
          {
            id: "klingai",
            author: "klingai",
            description:
              "可灵AI新一代AI创意生产力工具，基于快手大模型团队自研的 图像生成@可图大模型 和 视频生成@可灵大模型 技术，提供丰富的AI图片、AI视频及相关可控编辑能力。https://app.klingai.com/cn/",
            name: "可灵AI",
            icon: "",
            inputs:
              '[{"key":"apiKey","label":"accsseKey","type":"password","required":true,"placeholder":"请到可灵官方申请"},{"key":"sk","label":"SecretKey","type":"password","required":true,"placeholder":"请到可灵官方申请"}]',
            inputValues: '{"apiKey":"","sk":""}',
            models:
              '[{"name":"kling-video-o1 标准版","type":"video","modelName":"kling-video-o1-std","durationResolutionMap":[{"duration":[5,10],"resolution":["540p","720p","1080p"]}],"mode":["text","startEndRequired"],"audio":false},{"name":"kling-video-o1 pro","type":"video","modelName":"kling-video-o1-pro","durationResolutionMap":[{"duration":[5,10],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":true},{"name":"kling-v3-omni std","type":"video","modelName":"kling-v3-omni-std","durationResolutionMap":[{"duration":[3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":false},{"name":"kling-v3-omni pro","type":"video","modelName":"kling-v3-omni-pro","durationResolutionMap":[{"duration":[3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":true},{"name":"kling-v1 std 5s","type":"video","modelName":"kling-v1-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage","text","startEndRequired"],"audio":true},{"name":"kling-v1 std 10s","type":"video","modelName":"kling-v1-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v1 pro 5s","type":"video","modelName":"kling-v1-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage","text","startEndRequired"],"audio":true},{"name":"kling-v1 pro 10s","type":"video","modelName":"kling-v1-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v1-5 std 5s","type":"video","modelName":"kling-v1-5-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage"],"audio":true},{"name":"kling-v1-5 std 10s","type":"video","modelName":"kling-v1-5-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage"],"audio":true},{"name":"kling-v1-5 pro 5s","type":"video","modelName":"kling-v1-5-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired","startFrameOptional"],"audio":true},{"name":"kling-v1-5 pro 10s","type":"video","modelName":"kling-v1-5-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired","startFrameOptional"],"audio":true},{"name":"kling-v1-6 std 5s","type":"video","modelName":"kling-v1-5-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v1-6 std 10s","type":"video","modelName":"kling-v1-5-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v1-6 pro 5s","type":"video","modelName":"kling-v1-5-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","text","startEndRequired","startFrameOptional"],"audio":true},{"name":"kling-v1-6 pro 10s","type":"video","modelName":"kling-v1-5-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["singleImage","text","startEndRequired","startFrameOptional"],"audio":true},{"name":"kling-v2-master 5s","type":"video","modelName":"kling-v2-master-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v2-master 10s","type":"video","modelName":"kling-v1-5-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v2-1 std 5s","type":"video","modelName":"kling-v1-5-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["720p"]}],"mode":["singleImage"],"audio":true},{"name":"kling-v2-1 std 10s","type":"video","modelName":"kling-v1-5-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["720p"]}],"mode":["singleImage"],"audio":true},{"name":"kling-v2-1 pro 5s","type":"video","modelName":"kling-v2-1-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"kling-v2-1 pro 10s","type":"video","modelName":"kling-v2-1-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"kling-v2-1-master 5s","type":"video","modelName":"kling-v2-1-master-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v2-1-master 10s","type":"video","modelName":"kling-v2-1-master-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["singleImage","text"],"audio":true},{"name":"kling-v2-5-turbo std 5s","type":"video","modelName":"kling-v2-5-turbo-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["text","singleImage"],"audio":true},{"name":"kling-v2-5-turbo std 10s","type":"video","modelName":"kling-v2-5-turbo-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["text","singleImage"],"audio":true},{"name":"kling-v2-5-turbo pro 5s","type":"video","modelName":"kling-v2-5-turbo-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["text","singleImage","startEndRequired"],"audio":true},{"name":"kling-v2-5-turbo pro 10s","type":"video","modelName":"kling-v2-5-turbo-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["text","singleImage","startEndRequired"],"audio":true},{"name":"kling-v2-6 std 5s","type":"video","modelName":"kling-v2-6-std-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["text","singleImage"],"audio":false},{"name":"kling-v2-6 std 10s","type":"video","modelName":"kling-v2-6-std-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["text","singleImage"],"audio":false},{"name":"kling-v2-6 pro 5s","type":"video","modelName":"kling-v2-6-pro-5s","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["text","singleImage","startEndRequired"],"audio":false},{"name":"kling-v2-6 pro 10s","type":"video","modelName":"kling-v2-6-pro-10s","durationResolutionMap":[{"duration":[10],"resolution":["1080p"]}],"mode":["text","singleImage","startEndRequired"],"audio":false},{"name":"kling-v3-omni std","type":"video","modelName":"kling-v3-omni-std","durationResolutionMap":[{"duration":[3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":false},{"name":"kling-v3-omni pro","type":"video","modelName":"kling-v3-omni-pro","durationResolutionMap":[{"duration":[3,4,5,6,7,8,9,10,11,12,13,14,15],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":false}]',
            code: '// ==================== 类型定义 ====================\r\n\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]\r\n  )[]; // 混合参考\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 供应商数据 ====================\r\nconst KLINGAI_API_URL = "https://api-beijing.klingai.com";\r\nconst vendor: VendorConfig = {\r\n  id: "klingai",\r\n  author: "klingai",\r\n  description:\r\n    "可灵AI新一代AI创意生产力工具，基于快手大模型团队自研的 图像生成@可图大模型 和 视频生成@可灵大模型 技术，提供丰富的AI图片、AI视频及相关可控编辑能力。https://app.klingai.com/cn/",\r\n  name: "可灵AI",\r\n  inputs: [\r\n    { key: "apiKey", label: "accsseKey", type: "password", required: true, placeholder: "请到可灵官方申请" },\r\n    { key: "sk", label: "SecretKey", type: "password", required: true, placeholder: "请到可灵官方申请" },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    sk: "",\r\n  },\r\n  models: [\r\n    {\r\n      name: "kling-video-o1 标准版",\r\n      type: "video",\r\n      modelName: "kling-video-o1-std",\r\n      durationResolutionMap: [{ duration: [5, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["text", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-video-o1 pro",\r\n      type: "video",\r\n      modelName: "kling-video-o1-pro",\r\n      durationResolutionMap: [{ duration: [5, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v3-omni std",\r\n      type: "video",\r\n      modelName: "kling-v3-omni-std",\r\n      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v3-omni pro",\r\n      type: "video",\r\n      modelName: "kling-v3-omni-pro",\r\n      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1 std 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1 std 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1 pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1 pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-5 std 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-5 std 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-5 pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "startFrameOptional"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-5 pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "startFrameOptional"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-6 std 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-6 std 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-6 pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "text", "startEndRequired", "startFrameOptional"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v1-6 pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "text", "startEndRequired", "startFrameOptional"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-master 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-master-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-master 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1 std 5s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],\r\n      mode: ["singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1 std 10s",\r\n      type: "video",\r\n      modelName: "kling-v1-5-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["720p"] }],\r\n      mode: ["singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1 pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-1-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1 pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-1-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1-master 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-1-master-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-1-master 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-1-master-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-5-turbo std 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-5-turbo-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-5-turbo std 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-5-turbo-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-5-turbo pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-5-turbo-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-5-turbo pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-5-turbo-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "kling-v2-6 std 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-6-std-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v2-6 std 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-6-std-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v2-6 pro 5s",\r\n      type: "video",\r\n      modelName: "kling-v2-6-pro-5s",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v2-6 pro 10s",\r\n      type: "video",\r\n      modelName: "kling-v2-6-pro-10s",\r\n      durationResolutionMap: [{ duration: [10], resolution: ["1080p"] }],\r\n      mode: ["text", "singleImage", "startEndRequired"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v3-omni std",\r\n      type: "video",\r\n      modelName: "kling-v3-omni-std",\r\n      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: false,\r\n    },\r\n    {\r\n      name: "kling-v3-omni pro",\r\n      type: "video",\r\n      modelName: "kling-v3-omni-pro",\r\n      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: false,\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string | []; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\n\r\ndeclare const JWT: any;\r\n// ==================== 适配器函数 ====================\r\n\r\nfunction getToken() {\r\n  const headers = {\r\n    alg: "HS256",\r\n    typ: "JWT",\r\n  };\r\n  const payload = {\r\n    iss: vendor.inputValues.ak,\r\n    exp: Date.now() + 1800000,\r\n    nbf: Date.now() - 5000,\r\n  };\r\n  let token = jwt.sign(payload, vendor.inputValues.sk, headers);\r\n  return token;\r\n}\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  throw new Error("可灵暂未提供文本大模型");\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const token = getToken();\r\n\r\n  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;\r\n  const sizeMap: Record<string, Record<string, string>> = {\r\n    "16:9": {\r\n      "1k": "1920x1080",\r\n      "2K": "2848x1600",\r\n      "4K": "4096x2304",\r\n    },\r\n    "9:16": {\r\n      "1k": "1920x1080",\r\n      "2K": "1600x2848",\r\n      "4K": "2304x4096",\r\n    },\r\n  };\r\n\r\n  const body: Record<string, any> = {\r\n    model_name: imageModel.modelName,\r\n    prompt: imageConfig.prompt,\r\n    aspect_ratio: sizeMap[imageConfig.aspectRatio][size],\r\n    seed: 0,\r\n    resolution: size,\r\n    ...(imageConfig.imageBase64 && { image: imageConfig.imageBase64 }),\r\n  };\r\n\r\n  const createImageUrl = KLINGAI_API_URL + "/v1/images/omni-image";\r\n  const response = await fetch(createImageUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(body),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n  const checkUrl = KLINGAI_API_URL + "/v1/images/omni-image/{id}";\r\n  const res = await checkKlingTaskResult(data.data.task_id, checkUrl);\r\n  const resData = JSON.parse(JSON.stringify(res.data));\r\n  return resData?.task_result.images[0].url;\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number;\r\n  resolution: string;\r\n  aspectRatio: "16:9" | "9:16";\r\n  prompt: string;\r\n  imageBase64?: string[];\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("video" | "image" | "audio" | "text")[]; // 混合参考\r\n}\r\n\r\n// 检查生成物结果\r\nconst checkKlingTaskResult = async (taskId: string, checkUrl: string) => {\r\n  const token = getToken();\r\n  const res = await pollTask(async () => {\r\n    const queryResponse = await fetch(checkUrl.replace("{id}", taskId), {\r\n      method: "GET",\r\n      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },\r\n    });\r\n    if (!queryResponse.ok) {\r\n      const errorText = await queryResponse.text(); // 获取错误信息\r\n      console.error("请求失败，状态码:", queryResponse.status, ", 错误信息:", errorText);\r\n      throw new Error(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);\r\n    }\r\n    const queryData = await queryResponse.json();\r\n    const status = queryData?.state ?? queryData?.data?.state;\r\n    const fail_reason = queryData?.data?.err_code ?? queryData?.data;\r\n    switch (status) {\r\n      case "completed":\r\n      case "SUCCESS":\r\n      case "success":\r\n        return { completed: true, data: queryData.data };\r\n      case "FAILURE":\r\n      case "failed":\r\n        return { completed: false, error: fail_reason || "生成失败" };\r\n      default:\r\n        return { completed: false };\r\n    }\r\n  });\r\n  if (res.error) throw new Error(res.error);\r\n  return res;\r\n};\r\n\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const token = getToken();\r\n\r\n  //公共请求参数\r\n  const publicBody = {\r\n    model_name: videoModel.modelName,\r\n    ...(videoConfig.imageBase64 && videoConfig.imageBase64.length ? { images: videoConfig.imageBase64 } : {}),\r\n    prompt: videoConfig.prompt,\r\n    size: videoConfig.resolution,\r\n    duration: videoConfig.duration,\r\n  };\r\n\r\n  const requestUrl = KLINGAI_API_URL + "/v1/videos/omni-video";\r\n  const response = await fetch(requestUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(publicBody),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n\r\n  const checkUrl = KLINGAI_API_URL + "/v1/videos/omni-video/{id}";\r\n  const result = await checkKlingTaskResult(data.data.task_id, checkUrl);\r\n  const resData = JSON.parse(JSON.stringify(result.data));\r\n  return resData?.task_result.videos;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  throw new Error("可灵 暂不支持语音合成（TTS）");\r\n};\r\n',
            enable: 0,
            createTime: 1775155145953,
          },
          {
            id: "vidu",
            author: "搬砖的Coder",
            description:
              "Vidu 是由生数科技联合清华大学正式发布的中国首个长时长、高一致性、高动态性视频大模型。Vidu 在语义理解、推理速度、动态幅度等方面具备领先优势，并上线了全球首个“多主体参考”功能，突破视频模型一致性生成难题，开启了视觉上下文时代",
            name: "Vidu 开放平台",
            icon: "",
            inputs:
              '[{"key":"apiKey","label":"API密钥","type":"password","required":true,"placeholder":"请到Vidu官方申请"},{"key":"baseUrl","label":"接口路径","type":"url","required":false,"placeholder":"https://api.vidu.cn/ent/v2"}]',
            inputValues: '{"apiKey":"","baseUrl":"https://api.vidu.cn/ent/v2"}',
            models:
              '[{"name":"ViduQ3 turbo","type":"video","modelName":"ViduQ3-turbo","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":true},{"name":"ViduQ3 pro","type":"video","modelName":"ViduQ3-pro","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":true},{"name":"ViduQ2 pro fast","type":"video","modelName":"ViduQ2-pro-fast","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10],"resolution":["720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"viduQ2 turbo","type":"video","modelName":"ViduQ2-turbo","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"ViduQ2 pro","type":"video","modelName":"ViduQ2-pro","durationResolutionMap":[{"duration":[1,2,3,4,5,6,7,8,9,10],"resolution":["540p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"ViduQ2","type":"video","modelName":"ViduQ2","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["text"],"audio":true},{"name":"ViduQ1","type":"video","modelName":"ViduQ1","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired","text"],"audio":true},{"name":"ViduQ1 classic","type":"video","modelName":"viduQ1-classic","durationResolutionMap":[{"duration":[5],"resolution":["1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"Vidu2.0","type":"video","modelName":"vidu2.0","durationResolutionMap":[{"duration":[4,8],"resolution":["360p","720p","1080p"]}],"mode":["singleImage","startEndRequired"],"audio":true},{"name":"viduq1 for image","type":"image","modelName":"viduq1","mode":["text"]},{"name":"viduq2 for image","type":"image","modelName":"viduq2","mode":["text","singleImage","multiReference"]}]',
            code: '//如需遥测AI请使用在toonflow安装目录运行npx @ai-sdk/devtools （要求在其他设置中打开遥测功能，且toonflow有权限在安装目录创建.devtools文件夹）\r\n// ==================== 类型定义 ====================\r\n// 文本模型\r\ninterface TextModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "text";\r\n  think: boolean; // 前端显示用\r\n}\r\n\r\n// 图像模型\r\ninterface ImageModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "image";\r\n  mode: ("text" | "singleImage" | "multiReference")[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n}\r\n// 视频模型\r\ninterface VideoModel {\r\n  name: string; // 显示名称\r\n  modelName: string; //全局唯一\r\n  type: "video";\r\n  mode: (\r\n    | "singleImage" // 单图\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[] // 混合参考\r\n  )[];\r\n  associationSkills?: string; // 关联技能，多个技能用逗号分隔\r\n  audio: "optional" | false | true; // 音频配置\r\n  durationResolutionMap: { duration: number[]; resolution: string[] }[];\r\n}\r\n\r\ninterface TTSModel {\r\n  name: string; // 显示名称\r\n  modelName: string;\r\n  type: "tts";\r\n  voices: {\r\n    title: string; //显示名称\r\n    voice: string; //说话人\r\n  }[];\r\n}\r\n// 供应商配置\r\ninterface VendorConfig {\r\n  id: string; //供应商唯一标识，必须全局唯一\r\n  author: string;\r\n  description?: string; //md5格式\r\n  name: string;\r\n  icon?: string; //仅支持base64格式\r\n  inputs: {\r\n    key: string;\r\n    label: string;\r\n    type: "text" | "password" | "url";\r\n    required: boolean;\r\n    placeholder?: string;\r\n  }[];\r\n  inputValues: Record<string, string>;\r\n  models: (TextModel | ImageModel | VideoModel)[];\r\n}\r\n// ==================== 全局工具函数 ====================\r\n//Axios实例\r\n//压缩图片大小(1MB = 1 * 1024 * 1024)\r\ndeclare const zipImage: (completeBase64: string, size: number) => Promise<string>;\r\n//压缩图片分辨率\r\ndeclare const zipImageResolution: (completeBase64: string, width: number, height: number) => Promise<string>;\r\n//多图拼接乘单图 maxSize  最大输出大小，默认为 10mb\r\ndeclare const mergeImages: (completeBase64: string[], maxSize?: string) => Promise<string>;\r\n//Url转Base64\r\ndeclare const urlToBase64: (url: string) => Promise<string>;\r\n//轮询函数\r\ndeclare const pollTask: (\r\n  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,\r\n  interval?: number,\r\n  timeout?: number,\r\n) => Promise<{ completed: boolean; data?: string; error?: string }>;\r\ndeclare const axios: any;\r\ndeclare const createOpenAI: any;\r\ndeclare const createDeepSeek: any;\r\ndeclare const createZhipu: any;\r\ndeclare const createQwen: any;\r\ndeclare const createAnthropic: any;\r\ndeclare const createOpenAICompatible: any;\r\ndeclare const createXai: any;\r\ndeclare const createMinimax: any;\r\ndeclare const createGoogleGenerativeAI: any;\r\ndeclare const logger: (logstring: string) => void;\r\ndeclare const jsonwebtoken: any;\r\n// ==================== 供应商数据 ====================\r\nconst vendor: VendorConfig = {\r\n  id: "vidu",\r\n  author: "搬砖的Coder",\r\n  description:\r\n    "Vidu 是由生数科技联合清华大学正式发布的中国首个长时长、高一致性、高动态性视频大模型。Vidu 在语义理解、推理速度、动态幅度等方面具备领先优势，并上线了全球首个“多主体参考”功能，突破视频模型一致性生成难题，开启了视觉上下文时代",\r\n  name: "Vidu 开放平台",\r\n  inputs: [\r\n    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "请到Vidu官方申请" },\r\n    { key: "baseUrl", label: "接口路径", type: "url", required: false, placeholder: "https://api.vidu.cn/ent/v2" },\r\n  ],\r\n  inputValues: {\r\n    apiKey: "",\r\n    baseUrl: "https://api.vidu.cn/ent/v2",\r\n  },\r\n  models: [\r\n    {\r\n      name: "ViduQ3 turbo",\r\n      type: "video",\r\n      modelName: "ViduQ3-turbo",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ3 pro",\r\n      type: "video",\r\n      modelName: "ViduQ3-pro",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ2 pro fast",\r\n      type: "video",\r\n      modelName: "ViduQ2-pro-fast",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "viduQ2 turbo",\r\n      type: "video",\r\n      modelName: "ViduQ2-turbo",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ2 pro",\r\n      type: "video",\r\n      modelName: "ViduQ2-pro",\r\n      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"], //参考生视频无有效设置值\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ2",\r\n      type: "video",\r\n      modelName: "ViduQ2",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ1",\r\n      type: "video",\r\n      modelName: "ViduQ1",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired", "text"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "ViduQ1 classic",\r\n      type: "video",\r\n      modelName: "viduQ1-classic",\r\n      durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "Vidu2.0",\r\n      type: "video",\r\n      modelName: "vidu2.0",\r\n      durationResolutionMap: [{ duration: [4, 8], resolution: ["360p", "720p", "1080p"] }],\r\n      mode: ["singleImage", "startEndRequired"],\r\n      audio: true,\r\n    },\r\n    {\r\n      name: "viduq1 for image",\r\n      type: "image",\r\n      modelName: "viduq1",\r\n      mode: ["text"],\r\n    },\r\n    {\r\n      name: "viduq2 for image",\r\n      type: "image",\r\n      modelName: "viduq2",\r\n      mode: ["text", "singleImage", "multiReference"],\r\n    },\r\n  ],\r\n};\r\nexports.vendor = vendor;\r\n\r\n// ==================== 适配器函数 ====================\r\n\r\n// 文本请求函数\r\nconst textRequest: (textModel: TextModel) => { url: string; model: string } = (textModel) => {\r\n  throw new Error("当前供应商仅支持视频大模型，谢谢！");\r\n};\r\nexports.textRequest = textRequest;\r\n\r\n//图片请求函数\r\ninterface ImageConfig {\r\n  prompt: string; //图片提示词\r\n  imageBase64: string[]; //输入的图片提示词\r\n  size: "1K" | "2K" | "4K"; // 图片尺寸\r\n  aspectRatio: `${number}:${number}`; // 长宽比\r\n}\r\nconst imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Token ", "");\r\n\r\n  const size = imageConfig.size === "1K" ? "2K" : imageConfig.size;\r\n  const sizeMap: Record<string, Record<string, string>> = {\r\n    "16:9": {\r\n      "1k": "1920x1080",\r\n      "2K": "2848x1600",\r\n      "4K": "4096x2304",\r\n    },\r\n    "9:16": {\r\n      "1k": "1920x1080",\r\n      "2K": "1600x2848",\r\n      "4K": "2304x4096",\r\n    },\r\n  };\r\n\r\n  const body: Record<string, any> = {\r\n    model: imageModel.modelName,\r\n    prompt: imageConfig.prompt,\r\n    aspect_ratio: sizeMap[imageConfig.aspectRatio][size],\r\n    seed: 0,\r\n    resolution: size,\r\n    ...(imageConfig.imageBase64 && { image: imageConfig.imageBase64 }),\r\n  };\r\n\r\n  const createImageUrl = vendor.inputValues.baseUrl + "/reference2image";\r\n  const response = await fetch(createImageUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(body),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n  const res = await checkTaskResult(data.task_id);\r\n  if (!res.data) {\r\n    throw new Error("图片未能生成");\r\n  }\r\n  const list = JSON.parse(JSON.stringify(res.data));\r\n  return list[0].url;\r\n};\r\nexports.imageRequest = imageRequest;\r\n\r\ninterface VideoConfig {\r\n  duration: number;\r\n  resolution: string;\r\n  aspectRatio: "16:9" | "9:16";\r\n  prompt: string;\r\n  imageBase64?: string[];\r\n  audio?: boolean;\r\n  mode:\r\n    | "singleImage" // 单图\r\n    | "multiImage" // 多图模式\r\n    | "gridImage" // 网格单图（传入一张图片，但该图片是网格图）\r\n    | "startEndRequired" // 首尾帧（两张都得有）\r\n    | "endFrameOptional" // 首尾帧（尾帧可选）\r\n    | "startFrameOptional" // 首尾帧（首帧可选）\r\n    | "text" // 文本生视频\r\n    | ("video" | "image" | "audio" | "text")[]; // 混合参考\r\n}\r\n\r\n// 构建 各个平台的metadata参数\r\n\r\nconst buildViduMetadata = (videoConfig: VideoConfig) => ({\r\n  aspect_ratio: videoConfig.aspectRatio,\r\n  audio: videoConfig.audio ?? false,\r\n  off_peak: false,\r\n});\r\n\r\ntype MetadataBuilder = (config: VideoConfig) => Record<string, any>;\r\nconst METADATA_BUILDERS: Array<[string, MetadataBuilder]> = [["vidu", buildViduMetadata]];\r\nconst buildModelMetadata = (modelName: string, videoConfig: VideoConfig) => {\r\n  const lowerName = modelName.toLowerCase();\r\n  const match = METADATA_BUILDERS.find(([key]) => lowerName.includes(key));\r\n  return match ? match[1](videoConfig) : {};\r\n};\r\n// 检查生成物结果\r\nconst checkTaskResult = async (taskId: string) => {\r\n  const queryUrl = vendor.inputValues.baseUrl + "/tasks/{id}/creations";\r\n  const apiKey = vendor.inputValues.apiKey;\r\n  const res = await pollTask(async () => {\r\n    const queryResponse = await fetch(queryUrl.replace("{id}", taskId), {\r\n      method: "GET",\r\n      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },\r\n    });\r\n    if (!queryResponse.ok) {\r\n      const errorText = await queryResponse.text(); // 获取错误信息\r\n      console.error("请求失败，状态码:", queryResponse.status, ", 错误信息:", errorText);\r\n      throw new Error(`请求失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);\r\n    }\r\n    const queryData = await queryResponse.json();\r\n    const status = queryData?.state ?? queryData?.data?.state;\r\n    const fail_reason = queryData?.data?.err_code ?? queryData?.data;\r\n    switch (status) {\r\n      case "completed":\r\n      case "SUCCESS":\r\n      case "success":\r\n        return { completed: true, data: queryData.creations };\r\n      case "FAILURE":\r\n      case "failed":\r\n        return { completed: false, error: fail_reason || "生成失败" };\r\n      default:\r\n        return { completed: false };\r\n    }\r\n  });\r\n  if (res.error) throw new Error(res.error);\r\n  return res;\r\n};\r\n\r\nconst videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {\r\n  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");\r\n  const apiKey = vendor.inputValues.apiKey.replace("Token ", "");\r\n\r\n  // 构建每个模型对应的附加参数\r\n  const metadata = buildModelMetadata(videoModel.modelName, videoConfig);\r\n\r\n  //公共请求参数\r\n  const publicBody = {\r\n    model: videoModel.modelName,\r\n    ...(videoConfig.imageBase64 && videoConfig.imageBase64.length ? { images: videoConfig.imageBase64 } : {}),\r\n    prompt: videoConfig.prompt,\r\n    size: videoConfig.resolution,\r\n    duration: videoConfig.duration,\r\n    metadata: metadata,\r\n  };\r\n\r\n  const requestUrl = vendor.inputValues.baseUrl + "/start-end2video";\r\n  const response = await fetch(requestUrl, {\r\n    method: "POST",\r\n    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },\r\n    body: JSON.stringify(publicBody),\r\n  });\r\n  if (!response.ok) {\r\n    const errorText = await response.text(); // 获取错误信息\r\n    console.error("请求失败，状态码:", response.status, ", 错误信息:", errorText);\r\n    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);\r\n  }\r\n  const data = await response.json();\r\n  const taskId = data.id;\r\n  const result = await checkTaskResult(taskId);\r\n  return result.data;\r\n};\r\nexports.videoRequest = videoRequest;\r\n\r\ninterface TTSConfig {\r\n  text: string;\r\n  voice: string;\r\n  speechRate: number;\r\n  pitchRate: number;\r\n  volume: number;\r\n}\r\nconst ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {\r\n  throw new Error("Vidu 暂不支持语音合成（TTS）");\r\n};\r\n',
            enable: 0,
            createTime: 1775155162784,
          },
        ]);
      },
    },
    //图片工作流表
    {
      name: "o_imageFlow",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("flowData").notNullable();
        table.primary(["id"]);
        table.unique(["id"]);
      },
    },
    {
      name: "o_assets2Storyboard",
      builder: (table) => {
        table.integer("storyboardId").notNullable();
        table.integer("assetId").notNullable();
        table.primary(["storyboardId", "assetId"]);
        table.unique(["storyboardId", "assetId"]);
      },
    },
    {
      name: "o_scriptAssets",
      builder: (table) => {
        table.integer("scriptId").notNullable();
        table.integer("assetId").notNullable();
        table.primary(["scriptId", "assetId"]);
        table.unique(["scriptId", "assetId"]);
      },
    },
    {
      name: "o_skillList",
      builder: (table) => {
        table.text("id").notNullable();
        table.text("md5").notNullable();
        table.text("path").notNullable();
        table.text("name").notNullable(); //文件名
        table.text("description").notNullable(); //描述
        table.text("embedding"); // 向量嵌入 JSON
        table.text("type").notNullable(); // "main" | "references"
        table.integer("createTime").notNullable();
        table.integer("updateTime").notNullable();
        table.integer("state").notNullable(); // 1正常，0正在生成description，-1description为空。-2归属为空,-3md5变动，-4文件不存在
        table.primary(["id"]);
      },
      initData: async (knex) => {
        const list = [
          {
            id: "4fb36012e56e395b425569987f5dab0e",
            md5: "fca3c269c5f325a65dafa663c9bb9773",
            path: "production_agent_decision.md",
            name: "production_agent_decision",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "017b6338d7aa227cd614ec1fb25fd83e",
            md5: "2610b80abe4bd048fe61c73adc7388ac",
            path: "production_agent_execution.md",
            name: "production_agent_execution",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "f03c8e67b61580de9ea5b9d166521b67",
            md5: "d41d8cd98f00b204e9800998ecf8427e",
            path: "production_agent_supervision.md",
            name: "production_agent_supervision",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "50b49d8af5d364665b463c23f6a4d8bb",
            md5: "fbba66e0df2426996277b299710c3033",
            path: "script_agent_decision.md",
            name: "script_agent_decision",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "427727727e1095c54b6840cd21382d82",
            md5: "7e5911242af7233854d533278c6a8ccb",
            path: "script_agent_execution.md",
            name: "script_agent_execution",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "02848fb0dd582fd926502c77ecf9679c",
            md5: "7a8b6a311b015cd47bf17cc52b935348",
            path: "script_agent_supervision.md",
            name: "script_agent_supervision",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "a1e818cc03a0b355b239ac1fb0512969",
            md5: "1fd22029e8047aa30b0dfd703cb837ed",
            path: "universal_agent.md",
            name: "universal_agent",
            description: "",
            embedding: "",
            type: "main",
            createTime: 1774447310118,
            updateTime: 1774447310118,
            state: -1,
          },
          {
            id: "3e5efec258c8d8e6a39bcef12f8ee058",
            md5: "efccb0464cfd472861b49ebf737d4820",
            path: "references/event_extract.md",
            name: "event_extract",
            description:
              "专为小说改编短剧设计的文本分析助手，逐章提取涉及角色、核心事件、主线关系、信息密度、预估集长及情绪强度等结构化信息，以Markdown表格形式输出，并附汇总统计，辅助短剧制作的内容规划与时长估算。",
            embedding: "",
            type: "references",
            createTime: 1774447310118,
            updateTime: 1774450165911,
            state: 1,
          },
          {
            id: "52c51fa8655f899a1b7aae9b6aad7251",
            md5: "783678aaab829b34e7c30a414c356bf6",
            path: "references/novel_character_extract.md",
            name: "novel_character_extract",
            description:
              "专为小说内容分析设计的角色提取助手，从原文中识别并结构化输出所有重要角色的视觉描述信息，包括外貌、服饰、体态、状态变体等字段，供美术制作和AI角色图生成使用。",
            embedding: "",
            type: "references",
            createTime: 1774447310118,
            updateTime: 1774450080903,
            state: 1,
          },
          {
            id: "6d46cdca10b2f49e07e515885d1387a0",
            md5: "10544d12c4ef011e6b3b63a99b8c7fa8",
            path: "references/novel_props_extract.md",
            name: "novel_props_extract",
            description:
              "专注于从小说原文中提取道具物品信息的分析助手，能识别武器、法器、药物等各类道具，生成包含外观、材质、尺寸、功能及状态变体的结构化视觉描述表格，供美术制作和AI绘图使用。",
            embedding: "",
            type: "references",
            createTime: 1774447310118,
            updateTime: 1774450094771,
            state: 1,
          },
          {
            id: "1864df75d1d65f76e275046649ecaef8",
            md5: "65603aa495a541f54c55b7f30e149f45",
            path: "references/novel_scene_extract.md",
            name: "novel_scene_extract",
            description:
              "专注于从小说原文中提取并结构化场景信息的分析助手，可识别各类场景地点，输出包含空间描述、光照氛围、关键陈设、色调基调等字段的标准化场景资产表，用于美术制作和AI绘图的场景概念图生成。",
            embedding: "",
            type: "references",
            createTime: 1774447310118,
            updateTime: 1774450161878,
            state: 1,
          },
          {
            id: "7fbce6f90d7d85496ba9817e9622e640",
            md5: "830559e8f2cd5d0fa8e6df48a164fe2d",
            path: "references/video_dialogue_extract.md",
            name: "video_dialogue_extract",
            description:
              "这是一个专门从视频分镜提示词中提取结构化台词、旁白与音效信息的AI助手配置文档，定义了完整的输出格式（含镜号、角色、台词类型、表演指导等字段）、提取规则及处理流程，用于将视频分镜描述转化为标准化台词表。",
            embedding: "",
            type: "references",
            createTime: 1774447310118,
            updateTime: 1774450180712,
            state: 1,
          },
          {
            id: "31fb5c5a1f514ec1e66b4eba9f22d4db",
            md5: "43e63450efe0c9af8a3a40b036d36cb4",
            path: "references/pipeline.md",
            name: "pipeline",
            description:
              "面向短剧改编项目的四阶段流水线说明文档，涵盖事件提取、故事骨架、改编策略、剧本编写的串行执行流程，定义了决策层、执行层、监督层的协作规范及派发、审核、修复的交互格式与质量门控标准。",
            embedding: "",
            type: "references",
            createTime: 1774451946248,
            updateTime: 1774451984533,
            state: 1,
          },
          {
            id: "27dc2dfc901de2180227d0269217583a",
            md5: "7d353be4bab7a794436d9abff2b9c6ee",
            path: "references/adaptation_format.md",
            name: "adaptation_format",
            description:
              "本文档规定了改编策略输出的标准格式，包括核心改编原则、删除决策和世界观呈现策略三大模块的书写规范，明确各模块所需涵盖的维度与要素，用于指导竖屏短剧等载体的文学改编工作。",
            embedding: "",
            type: "references",
            createTime: 1774452010535,
            updateTime: 1774452022083,
            state: 1,
          },
          {
            id: "d49fa09504fe784a8e6eb102756c6d56",
            md5: "2ef08a7479f29d74986999ceb02092c8",
            path: "references/event_format.md",
            name: "event_format",
            description:
              "本文档规定了影视改编项目中事件表的标准输出格式，包括文件头、事件表格、各字段填写规范（章节、角色、核心事件、主线关系、情绪强度、预估时长）及汇总统计模板，用于指导从原著提取事件并评估改编集数与压缩比的第一阶段工作。",
            embedding: "",
            type: "references",
            createTime: 1774452010535,
            updateTime: 1774452030858,
            state: 1,
          },
          {
            id: "797906c2ddf0750f050bcdeae23eae3d",
            md5: "f5e7fe6db7e05db69d5dc327c4c538f2",
            path: "references/script_format.md",
            name: "script_format",
            description:
              "本文档为竖屏短剧剧本的输出格式规范，定义了文件头、节拍结构、分镜脚本、画面描述、台词、转场标注等标准格式要求，并附有时长控制参数与自查清单，供AI视频生成和导演制作使用。",
            embedding: "",
            type: "references",
            createTime: 1774452010535,
            updateTime: 1774452042934,
            state: 1,
          },
          {
            id: "1abd8675c0c3e62b20c0b151d2ec0fb1",
            md5: "a587532c737ce15022e1522021f099bb",
            path: "references/skeleton_format.md",
            name: "skeleton_format",
            description:
              "本文档定义了故事骨架文件（skeleton.md）的标准化输出格式，涵盖故事核、人物成长隐线、三幕结构、分集决策模板、全局删减记录、付费卡点设计及自查清单，用于指导编剧将章节事件列表转化为结构完整的剧集改编方案。",
            embedding: "",
            type: "references",
            createTime: 1774452010535,
            updateTime: 1774452057184,
            state: 1,
          },
          {
            id: "0b7828d7a6ab458a4b201122f08d6c16",
            md5: "120b3c856f1b2a8a429e11319e8c95fe",
            path: "references/quality_criteria.md",
            name: "quality_criteria",
            description:
              "本文档为影视/短剧项目的质量审核标准手册，涵盖事件表、故事骨架、改编策略和剧本四大模块的详细审核规则，规定了格式规范、角色名称统一、时长合理性、画面可执行性及场景氛围一致性等审核要求，用于确保各阶段产出物的内容准确性与制作可行性。",
            embedding: "",
            type: "references",
            createTime: 1774452068093,
            updateTime: 1774452087877,
            state: 1,
          },
          {
            id: "5c1772b5f9c420d9eae9ca02914ba087",
            md5: "c710ab7d237e1f0c5aa3d208e0f5b484",
            path: "references/plan.md",
            name: "plan",
            description:
              "该文档定义了AI代理生成执行计划的规范，包括任务总览、步骤列表（含编号、名称、详细内容、预期输出及依赖关系）和执行顺序标注，并提供标准回复模板，用于将用户需求拆解为可直接传入子代理工具执行的具体步骤。",
            embedding: "",
            type: "references",
            createTime: 1774452098447,
            updateTime: 1774452109574,
            state: 1,
          },
          {
            id: "75a45cf996015ca819582873887ec301",
            md5: "6045d76873fd58b8b87a914a21a38439",
            path: "references/derive_assets_extraction.md",
            name: "derive_assets_extraction",
            description:
              "本文档是一份技术操作指南，说明如何根据剧本内容和已有资产列表，提取每个资产在剧情中出现的不同视觉状态变体（derive），并通过工具函数读取和写入数据，用于后续图片生成参考。",
            embedding: "",
            type: "references",
            createTime: 1774452119499,
            updateTime: 1774452129516,
            state: 1,
          },
          {
            id: "fce75f69d704c19bebcb356bc1bd6e81",
            md5: "a3b3432854970f22949ba47236a6532f",
            path: "references/storyboard_generation.md",
            name: "storyboard_generation",
            description:
              "根据剧本和资产列表生成结构化分镜面板的工具指南，涵盖分镜拆分原则、字段填写规范及工具调用流程，用于将剧本转化为含画面描述、镜头语言、台词和AI绘图提示词的分镜数据。",
            embedding: "",
            type: "references",
            createTime: 1774452119499,
            updateTime: 1774452140873,
            state: 1,
          },
        ];
        await Promise.all(
          list.map(async (item) => {
            const embedding = await getEmbedding(item.description);
            item.embedding = JSON.stringify(embedding);
          }),
        );
        await knex("o_skillList").insert(list);
      },
    },
    {
      name: "o_skillAttribution",
      builder: (table) => {
        table.text("skillId").notNullable().references("id").inTable("o_skillList").onDelete("CASCADE");
        table.text("attribution").notNullable(); // "production_agent_decision.md" | "production_agent_execution.md" | "production_agent_supervision.md" | "script_agent_decision.md" | "script_agent_execution.md" | "script_agent_supervision.md" | "universal_agent.md"
        table.primary(["skillId", "attribution"]);
        table.index(["attribution"]);
      },
      initData: async (knex) => {
        await knex("o_skillAttribution").insert([
          {
            skillId: "52c51fa8655f899a1b7aae9b6aad7251",
            attribution: "universal_agent.md",
          },
          {
            skillId: "6d46cdca10b2f49e07e515885d1387a0",
            attribution: "universal_agent.md",
          },
          {
            skillId: "1864df75d1d65f76e275046649ecaef8",
            attribution: "universal_agent.md",
          },
          {
            skillId: "3e5efec258c8d8e6a39bcef12f8ee058",
            attribution: "universal_agent.md",
          },
          {
            skillId: "7fbce6f90d7d85496ba9817e9622e640",
            attribution: "universal_agent.md",
          },
          {
            skillId: "31fb5c5a1f514ec1e66b4eba9f22d4db",
            attribution: "script_agent_decision.md",
          },
          {
            skillId: "27dc2dfc901de2180227d0269217583a",
            attribution: "script_agent_execution.md",
          },
          {
            skillId: "d49fa09504fe784a8e6eb102756c6d56",
            attribution: "script_agent_execution.md",
          },
          {
            skillId: "797906c2ddf0750f050bcdeae23eae3d",
            attribution: "script_agent_execution.md",
          },
          {
            skillId: "1abd8675c0c3e62b20c0b151d2ec0fb1",
            attribution: "script_agent_execution.md",
          },
          {
            skillId: "0b7828d7a6ab458a4b201122f08d6c16",
            attribution: "script_agent_supervision.md",
          },
          {
            skillId: "5c1772b5f9c420d9eae9ca02914ba087",
            attribution: "production_agent_decision.md",
          },
          {
            skillId: "75a45cf996015ca819582873887ec301",
            attribution: "production_agent_execution.md",
          },
          {
            skillId: "fce75f69d704c19bebcb356bc1bd6e81",
            attribution: "production_agent_execution.md",
          },
        ]);
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
        table.text("name");
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
    {
      name: "o_assetsRole2Audio",
      builder: (table) => {
        table.integer("assetsRoleId").notNullable();
        table.integer("assetsAudioId").notNullable();
        table.primary(["assetsAudioId", "assetsRoleId"]);
        table.unique(["assetsAudioId", "assetsRoleId"]);
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
