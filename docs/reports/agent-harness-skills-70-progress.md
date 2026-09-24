# Agent Harness T14 · Skill 发布与 Run 绑定（阶段进度）

Issue：`lechangbin/Toonflow-app#70`。本分支堆叠在尚未验收的 T12 ContextBuilder 分支上。以下是发布/绑定第一切片，不是完整 Skill Runtime 或 T21 验收。

## 已实现

- 领域术语和 ADR-0021 将稳定 Skill Definition、可编辑草稿/不可变已发布 SkillRevision、当前 SkillBinding、Run 自身的冻结绑定分开；当前 Markdown 路径不再被新运行时当作修订身份。
- 四张 SQLite 表分别保存 Definition、Revision、激活指针和 Run 绑定；版本化 manifest 描述适配角色与意图、依赖声明、请求的 Tools/Capabilities、资源声明、路由元数据及归属。发布前校验身份、语义版本、去重、大小与安全文本；它只声明请求，不授予 Tool 权限。
- 草稿可按预期内容哈希更新；发布会重验内容与 manifest 哈希，并由 SQLite 触发器禁止修改或删除已发布修订。激活使用绑定版本检查；回滚只是重新指向旧的已发布修订。
- queued Agent Run 可在 Project 作用域内冻结所选 Revision ID 及内容/manifest 哈希。重试读取已冻结绑定，不会因之后激活新版本而改写旧 Run；新 Run 接受新指针。角色不匹配拒绝，Project 删除事务可清理 Run 绑定证据。
- 旧 `o_skillList` 可编辑记录保持原样；升级新增四张表时不会把未验证的旧文件自动发布。

## 阶段验证与未完成边界

`tests/skillRuntime.test.ts` 的 2 个定向用例覆盖草稿更新、过时哈希冲突、发布不可变、绑定版本冲突、Run 冻结、未来 Run 激活与回滚、角色拒绝、跨 Project 拒绝、删除许可和旧库兼容。另运行 `contextBundle.test.ts` 3 个依赖回归，TypeScript `--noEmit` 通过。未运行全量测试、构建、浏览器或真实 Provider。

依赖闭包与环校验、资源按 ID 加载、有效权限交集、路由和高风险歧义暂停、管理 UI/API、受控的旧 Skill 导入、Run 创建时自动绑定以及旧 Socket Agent 迁移尚未完成。当前 manifest 中的依赖/资源/权限是经结构校验的声明，不是已解析或已授权的执行能力；面试材料不得夸称完整 Skill Marketplace 或安全授权闭环。
