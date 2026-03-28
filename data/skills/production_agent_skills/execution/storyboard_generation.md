# 分镜面板生成（从剧本 + 资产 → storyboard）

本指南只做一件事：
根据剧本内容和已有资产，将剧本拆分为一系列分镜，生成结构化的分镜面板。

> **核心概念**：分镜面板是将剧本转化为视觉画面的中间产物。每条分镜对应一个独立的画面/镜头，包含画面描述、镜头语言、台词、音效和关联资产等信息，用于后续图片生成。

## 1. 输入与输出

### 输入

- 剧本文本（字符串），通过 `get_flowData("script")` 获取
- 已有资产列表（数组），通过 `get_flowData("assets")` 获取

### 输出

调用 `set_flowData` 将分镜面板写入工作区：

```ts
set_flowData({
  key: "storyboard",
  value: [
    {
      id: 1,
      title: "分镜标题",
      description: "画面描述",
      camera: "镜头语言",
      duration: 3,
      frameMode: "firstFrame",
      prompt: "图片生成提示词",
      lines: "台词文本",
      sound: "音效描述",
      associateAssetsIds: [0, 2]
    },
    // ...更多分镜
  ]
})
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 分镜序号，从 1 开始递增 |
| `title` | string | 分镜标题，简明概括画面内容（2~10字） |
| `description` | string | 画面描述，描述画面中发生的事件和视觉元素 |
| `camera` | string | 镜头语言，描述镜头角度、运动方式 |
| `duration` | number | 画面持续时长（秒），根据内容复杂度和节奏估算 |
| `frameMode` | enum | 帧模式：`firstFrame`（首帧）/ `endFrame`（尾帧）/ `linesSoundEffects`（台词音效帧） |
| `prompt` | string | 图片生成提示词，用于 AI 绘图的英文提示词 |
| `lines` | string \| null | 台词，该分镜中角色说的话，无台词填 `null` |
| `sound` | string \| null | 音效描述，该分镜中的环境音/音效，无音效填 `null` |
| `associateAssetsIds` | number[] | 关联资产的索引（对应 assets 数组的下标），标注该分镜画面中出现的资产 |

## 2. 分镜拆分原则

### 2.1 拆分粒度

- **一个独立画面 = 一条分镜**：画面主体、场景或视角发生明显变化时，新起一条分镜
- 同一段对话如果镜头在不同角色间切换，每个镜头视角单独拆分
- 动作场景按关键动作节点拆分，不要把整段打戏塞进一条分镜
- 过渡/转场单独拆分为一条分镜（如果有明确的过渡描写）

### 2.2 拆分判断标准

新起一条分镜的信号：
- 场景/地点切换
- 时间跳跃
- 镜头主体切换（从角色 A 切到角色 B）
- 同一角色的视角/景别明显变化（远景 → 特写）
- 重要动作或事件节点

不需要新起分镜的情况：
- 同一画面内的连续对话（可合并到一条分镜）
- 表情微变或小动作（可在描述中囊括）

## 3. 各字段填写指引

### 3.1 title（分镜标题）

- 2~10 个字，概括核心画面内容
- 格式：`[主体] + [动作/状态]`
- 示例："凌玄吐血"、"青云令碎裂"、"宗门远景"、"苏晚卿冷笑"

### 3.2 description（画面描述）

- 描述画面中**可见的**视觉内容，不要写心理活动
- 包含：人物动作、表情、环境状态、关键物件
- 20~80 字为宜
- 示例："凌玄跪在大殿地面上，鲜血从嘴角溢出，右手死死攥住已经裂开的青云令，面色苍白"

### 3.3 camera（镜头语言）

常用镜头语言参考：

| 景别 | 说明 |
|------|------|
| 大远景 | 展示环境全貌，人物极小 |
| 远景 | 展示场景与人物关系 |
| 全景 | 展示人物全身与周围环境 |
| 中景 | 人物膝盖以上 |
| 近景 | 人物胸部以上 |
| 特写 | 面部或物件局部放大 |
| 大特写 | 眼睛、手等极致局部 |

常用运镜：
- 推镜头：从远到近，强调主体
- 拉镜头：从近到远，展示环境
- 摇镜头：镜头固定位置旋转，扫视场景
- 移镜头：镜头跟随主体移动
- 俯拍：从上往下拍
- 仰拍：从下往上拍

格式：`[景别] · [运镜]`（运镜非必须）
示例："特写"、"近景 · 缓慢推进"、"大远景 · 俯拍"、"中景 · 跟随移动"

### 3.4 duration（时长）

根据内容估算画面持续时间（秒）：
- 静态画面/特写：2~3 秒
- 对话镜头：根据台词长度，约 3~6 秒
- 动作场景：2~4 秒
- 环境全景/过渡：2~4 秒
- 复杂场景：5~8 秒

### 3.5 frameMode（帧模式）

根据分镜内容选择合适的帧模式：

| 模式 | 使用场景 |
|------|----------|
| `firstFrame` | 最常见。画面以**起始状态**为主，如角色站立、场景展示、动作起始瞬间 |
| `endFrame` | 画面以**结束状态**为主，如打击命中瞬间、物件破碎后、倒地后 |
| `linesSoundEffects` | 画面以**台词或音效**为主，画面本身变化不大，重点在声音内容 |

### 3.6 prompt（图片生成提示词）

- **必须使用英文**
- 描述画面的视觉内容，包含人物外观、动作、场景、光影、氛围等
- 可以参考关联资产的 `desc` 来描述人物/物件的外观特征
- 不要包含剧情叙事或对话内容
- 格式建议：`[主体描述], [动作/姿态], [场景/背景], [光影/氛围], [风格/画质关键词]`
- 示例："A young man in white robes kneeling on the ground of a grand hall, blood dripping from his mouth, clenching a cracked jade token, pale face, dramatic lighting, cinematic composition"

### 3.7 lines（台词）

- 该分镜中角色说的台词，直接提取剧本原文
- 如有多个角色说话，按顺序排列，格式：`角色名：台词内容`
- 无台词的分镜填 `null`

### 3.8 sound（音效）

- 描述该分镜中需要的音效或环境声
- 示例："剑鸣声"、"风声呼啸"、"玉石碎裂声"、"人群惊呼"
- 无特殊音效填 `null`

### 3.9 associateAssetsIds（关联资产）

- 填写该分镜画面中**出现的资产**在 assets 数组中的**索引**（从 0 开始）
- 只关联画面中**可见的**资产，不关联仅被提及但不在画面中的资产
- 示例：如果 assets[0] 是"凌玄"、assets[2] 是"青云令"，且这两个都出现在画面中，则填 `[0, 2]`

## 4. 示例

### 输入剧本片段

```
苏晚卿冷笑：「还有你当宝贝的青云令」
「若不是我趁你养伤时，偷偷在令牌上动了手脚」
△ 凌玄气血逆流，再次一口鲜血喷出
△ 青云令表面灵纹暗淡，隐约可见细微裂痕
```

### 输入资产

```json
[
  { "assetsId": "char-1", "name": "凌玄", "desc": "男主 · 青云宗宗主 · 白发修长 · 身着白色宗主袍" },
  { "assetsId": "char-2", "name": "苏晚卿", "desc": "女配 · 凌玄未婚妻 · 红衣 · 冷艳" },
  { "assetsId": "item-1", "name": "青云令", "desc": "宗主信物 · 青玉材质 · 灵纹浮刻" }
]
```

### 输出

```ts
set_flowData({
  key: "storyboard",
  value: [
    {
      id: 1,
      title: "苏晚卿冷笑",
      description: "苏晚卿站在大殿中，嘴角勾起冷笑，目光居高临下看着跪在地上的凌玄",
      camera: "近景",
      duration: 4,
      frameMode: "linesSoundEffects",
      prompt: "A beautiful woman in red robes standing in a grand hall, cold smirk on her face, looking down at someone, dramatic indoor lighting, cinematic",
      lines: "苏晚卿：还有你当宝贝的青云令，若不是我趁你养伤时，偷偷在令牌上动了手脚",
      sound: null,
      associateAssetsIds: [1]
    },
    {
      id: 2,
      title: "凌玄吐血",
      description: "凌玄气血逆流，猛然喷出一口鲜血，身体摇摇欲坠",
      camera: "中景 · 缓慢推进",
      duration: 3,
      frameMode: "endFrame",
      prompt: "A white_haired young man in white robes kneeling on the floor, spitting blood, trembling body, pale face, dramatic lighting, cinematic composition",
      lines: null,
      sound: "喷血声",
      associateAssetsIds: [0]
    },
    {
      id: 3,
      title: "青云令裂痕",
      description: "青云令表面灵纹逐渐暗淡，青玉上浮现细微裂痕",
      camera: "大特写",
      duration: 3,
      frameMode: "firstFrame",
      prompt: "Close_up of a jade token with glowing runes fading, fine cracks appearing on the surface, dark moody lighting, cinematic detail shot",
      lines: null,
      sound: "玉石碎裂声",
      associateAssetsIds: [2]
    }
  ]
})
```

## 5. 补充说明

- 分镜数量与剧本长度成正比，一般每 50~100 字剧本对应 1~2 条分镜
- prompt 必须使用英文，且只描述视觉内容
- `associateAssetsIds` 使用资产数组的索引（0-based），确保索引不越界
- 如果剧本中出现了资产列表中不存在的角色/物件，仍要在分镜中描述，但不要在 `associateAssetsIds` 中编造不存在的索引
- 分镜的顺序应与剧本的叙事顺序一致
- 合理使用三种 frameMode，大部分分镜使用 `firstFrame`，涉及动作结果的用 `endFrame`，以对话为主的用 `linesSoundEffects`
