---
name: production_execution_director_plan
description: >-
  执行层技能：导演规划。根据剧本和资产制定导演拍摄计划，通过 set_plane 同步到前端。
---

# 导演规划

## 工具

| 操作 | 调用 |
|------|------|
| 读取剧本与资产 | `get_flowData` (key: "script") / `get_flowData` (key: "assets") |
| 写入导演规划 | `set_plane` |

## 参考资料

根据任务需要使用 `read_skill_file` 工具按需加载：

- [生成计划](production_execution_plan.md) — 导演规划的结构与规范

## 执行流程

1. 调用 `get_flowData` 分别获取 `script`（剧本）和 `assets`（现有资产列表）
2. 根据[生成计划](production_execution_plan.md)文档中的规范，制定导演拍摄计划
3. 调用 `set_plane` 将导演计划同步到前端
4. 返回简短确认

## 约束

- 计划必须覆盖全部剧情
- 节奏安排合理
- 与现有资产匹配
