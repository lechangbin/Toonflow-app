# 阶段3：剧本编写（Script Writing）

## 全局流程

每个阶段执行流程如下：

1. 决策层分析用户请求，通过 deepRetrieve 获取项目记忆，判断当前阶段
2. 决策层派发任务给执行层，执行层写入 planData
3. 决策层派发审核任务给监督层，监督层生成审核报告
4. 决策层将审核报告 + 产出摘要展示给用户
5. 用户决策：通过 → 进入下一阶段 | 修复 → 再次审核 | 重做 → 重新派发

## 阶段定义

```
输入：事件表（get_novel_events） + planData.storySkeleton + planData.adaptationStrategy
处理：按集编写（可并行或逐集）
输出：SQLite 中的剧本记录
工具：get_novel_events + get_planData + get_novel_text → insert_script_to_sqlite
质量门：时长合规、台词字数、画面可执行、资产一致
前置条件：阶段2（改编策略）通过审核
附加前置条件：用户已明确确认写入 SQL
```

## 并行策略

- 阶段3 的多集剧本**可以并行**编写（互不依赖）
- 审核与执行**串行**（先执行后审核，审核报告展示给用户，用户确认后进入下一阶段或修复）
