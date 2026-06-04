# 安全边界

用这个文件判断哪些元数据适合汉化。

## 低风险

- `agents/openai.yaml` `interface.short_description`

原因：

- 面向 UI 展示
- 用于 skill 列表和标签
- 对真实个人 skill 可直接原地写入
- 对插件和 Bundled skill，应写回插件缓存里的 `agents/openai.yaml`
- 最不容易影响自动 skill 调度

## 中风险

- `agents/openai.yaml` `interface.display_name`
- `agents/openai.yaml` `interface.default_prompt`
- slash-command style prompt hints or other human-facing launcher text

原因：

- 主要面向 UI，但可能影响用户如何调用 skill
- 通常可控，但如果只需要汉化描述，不必修改

## 高风险

- `SKILL.md` frontmatter `description`
- prompt frontmatter `description`
- prompt frontmatter `argument-hint`
- `superpowers/skills/*-prompt.md` frontmatter `description`
- `superpowers/skills/*-prompt.md` frontmatter `argument-hint`

原因：

- 这些字段通常会进入模型侧调度层
- 翻译后可能改变触发精度
- 如果必须改，需要用户明确允许，并保留完整回滚方案

## 推荐策略

1. 默认不改模型调度字段。
2. 先只汉化 `interface.short_description`。
3. 插件缓存就地写入，不复制到 `~/.agents/skills`。
4. 用 `verify` 和 `report` 检查覆盖、错漏和遮蔽关系。
5. 如果历史运行创建了个人影子副本，用 `dedupe` 归档清理。
6. 只有用户明确接受影响时，才扩展到高风险字段。
7. `apply` 前必须先确认 pack 的结构指纹和当前可见 skill 一致，否则拒绝继续，强制重新 `extract/replay`。
