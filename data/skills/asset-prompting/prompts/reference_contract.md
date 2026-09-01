---
name: reference_contract
description: 将人工 Asset Reference 契约编译为图片模型可执行的中文约束片段
metaData: asset-prompting
---

# 系统提示词片段：参考图权威契约

仅在存在有效 Asset Reference 时加载本片段。

对每张参考图生成独立约束，保持人工标签和描述原文不变：

`{原始标签}（职责：{primaryRole}；主体：{subjectSelector 或“整图指定主体”}）：必须继承 {mustPreserve}；仅控制 {controlledDimensions}；必须忽略 {mustIgnore}。`

规则：

1. 每张图只有一个主要职责；每个受控维度只有一个最高优先级参考图。
2. 不依据上传顺序、文件类型、画面中央位置或清晰度自动授予权威。
3. 多主体图片必须包含 `subjectSelector`；缺失时不得编译该引用。
4. `mustPreserve` 仅描述允许迁移的维度；`mustIgnore` 明确阻止背景、人物、服装、色彩、构图、文字、水印或其他偶然内容迁移。
5. 不翻译、缩写、改名或润色人工标签与描述。
6. 没有控制维度的参考图不进入本次生成。超出 Model Profile 上限时按优先级与受控维度覆盖度稳定选择，并把相同输入解析为相同结果。
7. 参考图与 Script 冲突时遵守人工契约；参考图未控制的维度继续遵守 Asset Brief。

输出时只产生可嵌入最终图片提示词的连续中文约束，不输出表格、解释、文件路径或未被选中的参考图。若有效参考图为零，输出空字符串。
