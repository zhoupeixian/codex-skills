# 翻译包格式

提取脚本会生成一个 JSON 文档，用于驱动应用、校验、报表和回滚。

```json
{
  "generatedAt": "2026-05-16T08:00:00.000Z",
  "strategy": "in-place-plugin-cache-plus-audit",
  "itemCount": 3,
  "shadowedCount": 1,
  "items": [
    {
      "id": "skill::brainstorming::c:\\path\\to\\skill",
      "kind": "skill",
      "name": "brainstorming",
      "sourceFamily": "plugin-curated",
      "skillFile": "C:\\path\\to\\SKILL.md",
      "skillRoot": "C:\\path\\to\\skill",
      "targetRoot": "C:\\Users\\me\\.codex\\plugins\\cache\\openai-curated\\superpowers\\ed8ce2ea\\skills\\brainstorming",
      "targetFile": "C:\\Users\\me\\.codex\\plugins\\cache\\openai-curated\\superpowers\\ed8ce2ea\\skills\\brainstorming\\agents\\openai.yaml",
      "sourceField": "SKILL.md.description",
      "targetField": "agents/openai.yaml.interface.short_description",
      "original": "Explore intent, requirements, and design before implementation",
      "translation": "",
      "risk": "low",
      "visible": true,
      "shadowTarget": false
    }
  ],
  "shadowedItems": [
    {
      "name": "code-review",
      "skillFile": "C:\\path\\to\\shadowed\\SKILL.md",
      "shadowedBy": "C:\\path\\to\\winner\\SKILL.md",
      "targetRoot": "C:\\Users\\me\\.codex\\skills\\code-review"
    }
  ]
}
```

## 编辑规则

- 只填写 `translation`。
- 不要改 `id`。
- 不要改路径或目标字段。
- 译文要简洁、忠实原意。
- 暂时不该汉化的项保持空译文。

## 应用规则

应用步骤只写入 `translation` 非空的项。

插件、Bundled、Superpowers 等来源直接写回各自缓存目录中的 `agents/openai.yaml`，不要复制到 `~/.agents/skills`。

## 校验规则

校验步骤会比较当前目标字段和 `translation` 是否一致。

## 审计规则

报表必须分别列出可见项和被遮蔽项，并保留中英文对照、目标文件、当前值和状态。
