---
name: localize-codex-skills
description: 用于扫描 Codex 可见的 skill，生成翻译包，就地应用中文描述，校验覆盖、生成审计报告、清理旧影子副本并一键回滚；适合处理 skill 列表、插件缓存、Superpowers 技能和提示词汉化。
---

# localize-codex-skills

## 核心目标

把 Codex 里能看到的 skill 描述翻成中文，并且让翻译结果在重启后还能保住。

## 默认策略

1. 先扫描当前 Codex 会读取的 skill 根目录，排除 `.codex/.tmp` 临时目录。
2. 对当前可见 skill 按名称去重，并记录被同名更高优先级 skill 遮蔽的项。
3. 对 `~/.agents/skills` 里的真实个人 skill，直接原地改。
4. 对插件、Bundled、Superpowers 这类缓存来源，直接写回插件缓存里的 `agents/openai.yaml`，不要复制到 `~/.agents/skills`。
5. 默认只改 `agents/openai.yaml.interface.short_description` 这一层。
6. `SKILL.md` frontmatter `description`、提示词 frontmatter、`argument-hint` 是高风险字段，只有用户明确允许时才改。
7. 如果历史流程已经在 `~/.agents/skills` 生成了插件影子副本，运行 `dedupe` 归档清理。

## 工作流

### 1. 提取

运行：

```powershell
& "<node>" scripts/localize-codex-skills.mjs extract --out .\skill-ui-pack.json
```

提取结果要包含：

- 原始 skill 路径
- 实际写入的目标根目录
- 原文
- 译文占位
- 是否可见
- 是否被同名 skill 遮蔽

### 2. 翻译

只填 `translation` 字段，不改路径、ID、字段名和风险标记。

要求：

- 保留原意
- 技术名词、产品名、API 名称保持英文
- 译文要短，适合在 UI 列表里快速扫读

### 3. 应用

运行：

```powershell
& "<node>" scripts/localize-codex-skills.mjs apply --pack .\skill-ui-pack.json
```

应用时要：

- 直接写入 pack 中的目标文件
- 自动备份所有被改动的文件
- 生成回滚脚本

### 4. 校验

运行：

```powershell
& "<node>" scripts/localize-codex-skills.mjs verify --pack .\skill-ui-pack.json
```

校验必须报告：

- 已应用项
- 缺失翻译项
- 当前内容与翻译包不一致的项
- 被同名 skill 遮蔽、因此未处理的项

### 5. 报表

运行：

```powershell
& "<node>" scripts/localize-codex-skills.mjs report --pack .\skill-ui-pack.json --out .\skill-ui-pack.audit.md
```

审计报表必须保留：

- 全量扫描项
- 原文 / 译文对照
- 目标文件和目标根目录
- 当前内容
- 结果状态
- 遮蔽关系

### 6. 回滚

运行生成的 PowerShell 脚本：

```powershell
& .\backups\<timestamp>\rollback.ps1
```

它要恢复原文件，并删除这次新建的影子根目录。

### 7. 清理旧影子副本

如果 Codex UI 出现大量来源为“个人”的插件 skill，运行：

```powershell
& "<node>" scripts/localize-codex-skills.mjs dedupe
```

它会把 `~/.agents/skills` 中与已启用插件同名的旧副本移动到备份目录，并生成回滚脚本。

## 风险边界

- 不要默认改 `SKILL.md` frontmatter `description`
- 不要默认改提示词 frontmatter
- 不要把写入落到 `.codex\.tmp`
- 不要把插件 skill 复制到 `~\.agents\skills`
- 如果用户明确要做高风险字段改写，先说明影响范围，再继续
