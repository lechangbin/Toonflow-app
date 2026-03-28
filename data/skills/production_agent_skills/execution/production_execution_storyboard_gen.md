---
name: production_execution_storyboard_gen
description: >-
  执行层技能：生成分镜图片。根据分镜表调用图片生成接口生成分镜图片。
---

# 生成分镜图片

## 工具

| 操作 | 调用 |
|------|------|
| 读取剧本 | `get_flowData` (key: "script") |
| 生成分镜图片 | `generate_storyboard_images({ script: 剧本文本 })` |

## 执行流程

1. 调用 `get_flowData` 获取 `script`（剧本文本）
2. 调用 `generate_storyboard_images({ script: 剧本文本 })` 生成分镜图片
3. 返回简短确认

## 约束

- 图片必须与分镜描述匹配
- 图片生成为异步操作，发起后即可返回确认
- 前置条件：分镜表已构建完成且用户已确认
