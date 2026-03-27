# 阶段2：改编策略（Adaptation Strategy）

## 全局流程

每个阶段执行流程如下：

1. 决策层分析用户请求，通过 deepRetrieve 获取项目记忆，判断当前阶段
2. 决策层派发任务给执行层，执行层写入 planData
3. 决策层派发审核任务给监督层，监督层生成审核报告
4. 决策层将审核报告 + 产出摘要展示给用户
5. 用户决策：通过 → 进入下一阶段 | 修复 → 再次审核 | 重做 → 重新派发

## 阶段定义

```
输入：事件表（get_novel_events） + planData.storySkeleton
处理：提炼改编原则、确定删减依据、世界观呈现策略
输出：planData.adaptationStrategy
工具：get_planData → set_planData_adaptationStrategy
质量门：原则与骨架一致、服务于故事核
前置条件：阶段1（故事骨架）通过审核
```

## 阶段约束

- 阶段1-2 **必须串行**（后续阶段依赖前置输出）
- 审核与执行**串行**（先执行后审核，审核报告展示给用户，用户确认后进入下一阶段或修复）
