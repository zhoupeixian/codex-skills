# 个人 Codex Skills 仓库

这个仓库用于存放个人维护的 Codex skills。每个 skill 独立放在 `skills/<skill-name>/` 下，并保留标准 Codex skill 结构。

## 仓库结构

```text
skills/
  localize-codex-skills/
    SKILL.md
    agents/
    references/
    scripts/
  zherp-automation/
    SKILL.md
    agents/
    references/
    references/usage-guide.md
```

## Skills

| Skill | 用途 | 状态 |
| --- | --- | --- |
| `localize-codex-skills` | 扫描 Codex 可见 skill，生成翻译包，就地应用中文 UI 描述，校验覆盖，生成审计报告和回滚脚本，并清理历史影子副本。 | 可用 |
| `zherp-automation` | ZHERP/YigoERP SVN 自动化 skill，覆盖认证、日志拉取、可选更新、Maven 构建、实体生成、diff 拉取和审查日志生成。 | 可用 |

## 添加新 Skill

新 skill 作为独立目录放在 `skills/` 下：

```text
skills/<new-skill-name>/SKILL.md
```

推荐最小结构：

- `SKILL.md`：必需，定义 skill 和工作流。
- `agents/openai.yaml`：可选，用于 Codex skill 列表的 UI 元数据。
- `references/`：可选，按需加载的参考文档。
- `scripts/`：可选，确定性辅助脚本。

## 本地安装

手动安装或更新时，将 skill 目录复制到：

```text
C:\Users\31487\.codex\skills\<skill-name>
```

For example:

```powershell
Copy-Item -Recurse -Force .\skills\localize-codex-skills C:\Users\31487\.codex\skills\localize-codex-skills
```

## 维护规则

- 每个 skill 必须自包含。
- 不提交翻译包、审计报告、备份和本地快照。
- 可重复操作优先放进 `scripts/`。
- 会修改模型调度相关元数据的 skill，必须在文档中明确标出风险边界。
- `~/.agents/skills` 只用于真实个人 skill，不用于保存插件 skill 的影子副本。
