---
name: execution
description: >
  用户需要拆分剧本、提取衍生资产或生成分镜表时可以看此skill的参考资料，了解拆分原则、衍生资产提取原则、分镜表生成规范和示例
---

# execution Agent

执行层，负责整体决策和协调。接收用户需求后，完成对应的任务。

## 何时使用

当用户需要以下帮助时激活此技能：

- 拆分剧本
- 提取衍生资产（从剧本和已有角色资产中提取关联道具、场景物件等衍生资产）
- 生成分镜表（根据剧本和资产生成结构化的分镜表）

## 工作指引

### 提取衍生资产流程

1. 调用 `get_flowData` 分别获取 `script`（剧本）和 `assets`（现有资产列表）
2. 根据[衍生资产提取](references/derive_assets_extraction.md)文档中的提取原则，分析剧本内容，为每个角色资产识别出关联的衍生资产（道具、服饰、法器、座驾、场景物件等）
3. 对每个有衍生状态的资产调用 `set_flowData_assets` 保存
4. 告知用户提取完成，列出为每个角色提取的衍生资产概要
5. **询问用户是否需要生成衍生资产图片**：
   - 如果用户确认需要，收集所有需要生成图片的资产 id，调用 `generate_assets_images({ ids: [资产id列表] })` 生成图片
   - 如果用户拒绝，跳过此步骤，流程结束
   - 生成图片为异步操作，可以先回复用户"正在生成图片，稍后会自动更新"，等图片生成完成后再通知用户查看

### 生成分镜表流程

1. 调用 `get_flowData` 分别获取 `script`（剧本）和 `assets`（现有资产列表）
2. 根据[分镜表生成](references/storyboard_generation.md)文档中的拆分原则和字段填写指引，将剧本拆分为分镜，填写每条分镜的所有字段（id、title、description、camera、duration、frameMode、prompt、lines、sound、associateAssetsIds）
3. 调用 `set_flowData({ key: "storyboard", value: 分镜数组 })` 一次性保存完整分镜表
4. 告知用户分镜表生成完成，列出分镜概要（总条数、主要场景）
5. **询问用户是否需要生成分镜图片**：
   - 如果用户确认需要，调用 `generate_storyboard_images({ script: 剧本文本 })` 生成分镜图
   - 如果用户拒绝，跳过此步骤，流程结束

## 参考资料

本技能附带以下参考资料，根据任务需要使用 `read_skill_file` 工具按需加载：

- [衍生资产提取](references/derive_assets_extraction.md) — 从剧本和角色资产中提取衍生资产的原则和示例
- [分镜表生成](references/storyboard_generation.md) — 从剧本和资产生成分镜表的拆分原则、字段规范和示例

**注意**：根据用户当前任务选择性加载对应参考资料，不要一次性全部加载。
