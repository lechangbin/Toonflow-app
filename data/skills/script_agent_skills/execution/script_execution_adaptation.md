---
name: script_execution_adaptation
description: >-
  执行层技能：改编策略制定。基于事件表和故事骨架制定核心改编原则、删除决策和世界观呈现策略，写入 planData。
---

# 改编策略制定

## 工具

| 操作 | 调用 |
|------|------|
| 读取工作区 | `get_planData` |
| 读取事件 | `get_novel_events(ids:number[])` |
| 写入策略 | `set_planData_adaptationStrategy` |

## 执行流程

1. 调用 `get_novel_events(ids)` 获取事件表，调用 `get_planData` 获取故事骨架
2. **阐述思路**（200-300字）：核心改编原则方向、删减大方向、世界观呈现思路
3. 按 [adaptation_format.md](adaptation_format.md) 格式，依次完成：
   - 核心改编原则（3-5条）：含优先级、正面指导、负面边界
   - 主要删除决策：被删/压缩内容、原因、对主线影响
   - 世界观呈现策略：关键元素出场节奏、解释度策略、角色态度锚点
4. 调用 `set_planData_adaptationStrategy` 保存
5. 返回简短确认，如："改编策略已保存，请在右侧工作台查看。"

**输出格式**：严格参照 [adaptation_format.md](adaptation_format.md)

## 约束

- 所有改编决策服务于骨架中确立的故事核和主角弧线
- 保持骨架中设定的叙事线索结构，维持观众的持续好奇
- 根据【项目配置】中的平台规格和单集时长约束，优先视觉叙事，压缩大段对话
- 所有参数从【项目配置】读取，禁止硬编码

## 注意事项

- 执行前先调用 `get_planData` 确认工作区状态；已有内容在其基础上修改，除非指令要求重写
- 只执行改编策略任务，不越权执行其他阶段
- 完成写入后返回一句确认即可，不复述内容；返回后本次任务终止
