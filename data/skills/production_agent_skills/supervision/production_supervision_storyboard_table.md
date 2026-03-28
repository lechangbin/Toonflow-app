# 分镜表审核

基于 [supervision_common.md](supervision_common.md) 中的通用规范执行审核。

## 数据准备

1. 调用 `get_flowData` 获取分镜表数据（storyboard）
2. 调用 `get_flowData` 获取剧本数据（script）和资产数据（assets）

## 审核维度

| 审核项 | 标准 | 严重程度 |
|--------|------|----------|
| 字段完整性 | 每条分镜的所有必填字段（id、title、description、camera、duration、frameMode、prompt、lines、sound、associateAssetsIds）均已填写 | 严重 |
| 关联资产正确 | associateAssetsIds 中的索引均在 assets 数组范围内；画面中可见的资产已关联 | 严重 |
| 剧本覆盖度 | 剧本中的全部场景和关键事件均有对应分镜，无遗漏 | 严重 |
| 拆分粒度 | 一个独立画面对应一条分镜；无过度合并或过度拆分 | 中等 |
| prompt 质量 | 英文撰写；包含主体、动作、场景、氛围等视觉要素；无剧情叙事或对话内容 | 中等 |
| 镜头语言合理 | camera 字段使用标准景别术语；景别变化服务于叙事节奏 | 中等 |
| 时长合理性 | duration 与画面复杂度匹配；总时长与剧本预估时长基本吻合 | 中等 |
| frameMode 选择 | 帧模式与分镜内容匹配（动作结果用 endFrame、对话为主用 linesSoundEffects、其余用 firstFrame） | 轻微 |

## 详细审核标准

### 字段完整性（严重）

验证方法：
1. 遍历每条分镜，检查所有必填字段是否存在且非空
2. id 应从 1 开始递增且无重复
3. title 应在 2~10 字范围内
4. lines 和 sound 允许为 `null`（表示无台词/音效），但不允许缺失字段

### 关联资产正确（严重）

验证方法：
1. 获取 assets 数组长度 N
2. 遍历每条分镜的 associateAssetsIds，检查所有索引 < N
3. 对照 description，判断画面中明显可见的资产是否都已关联
4. 标注索引越界或明显遗漏关联的分镜

不通过示例：
- assets 只有 3 个（索引 0-2），但分镜中出现 `associateAssetsIds: [0, 5]`
- description 描述"凌玄手持青云令"，但 associateAssetsIds 只有凌玄的索引，遗漏了青云令

### 剧本覆盖度（严重）

验证方法：
1. 将剧本按场景/事件节点拆分
2. 逐一检查每个场景是否有对应分镜
3. 标注未被覆盖的剧情段落

### 拆分粒度（中等）

过度合并的信号：
- 一条分镜的 description 超过 100 字
- 一条分镜包含明显的场景切换或视角变化
- 一条分镜的 duration 超过 8 秒

过度拆分的信号：
- 连续多条分镜描述同一画面内的微小变化
- 同一段对话被拆成超过 3 条分镜（无视角切换时）

### prompt 质量（中等）

验证要点：
- 必须为英文
- 包含：主体描述 + 动作/姿态 + 场景/背景 + 光影/氛围
- 不包含对话、叙事或心理活动
- 与 description 的视觉内容一致

不通过示例：
- 中文 prompt
- "A scene where the character feels sad" ← 情绪而非视觉
- prompt 描述与 description 矛盾

### 镜头语言合理（中等）

- 使用标准景别术语（大远景/远景/全景/中景/近景/特写/大特写）
- 重要细节用特写/大特写，场景建立用远景/全景
- 对话场景通常用近景/中景
- 不允许连续 5 条以上使用完全相同的景别
