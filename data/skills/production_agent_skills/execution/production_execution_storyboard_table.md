---
name: production_execution_storyboard_table
description: >-
  执行层技能：构建分镜表。根据剧本和资产生成结构化分镜表，通过 set_flowData 保存。
---

# 构建分镜表

## 工具

| 操作 | 调用 |
|------|------|
| 读取剧本与资产 | `get_flowData` (key: "script") / `get_flowData` (key: "assets") |
| 写入分镜表 | `set_flowData({ key: "storyboard", value: 分镜数组 })` |

## 参考资料

根据任务需要使用 `read_skill_file` 工具按需加载：

- [分镜表生成](storyboard_generation.md) — 分镜拆分原则、字段规范和示例

## 执行流程

1. 调用 `get_flowData` 分别获取 `script`（剧本）和 `assets`（现有资产列表）
2. 根据[分镜表生成](storyboard_generation.md)文档中的拆分原则和字段填写指引，将剧本拆分为分镜
3. 填写每条分镜的所有字段（id、title、description、camera、duration、frameMode、prompt、lines、sound、associateAssetsIds）
4. 调用 `set_flowData({ key: "storyboard", value: 分镜数组 })` 一次性保存完整分镜表
5. 返回简短确认

## 约束

- 分镜拆分粒度合理
- 所有字段完整填写
- 关联资产 ID 必须与工作区现有资产匹配
- 场景描述足够具体，可直接用于 AI 视频/图片生成
