# Translation Pack Format

The extraction script writes one JSON pack that drives apply, verify, rollback, and audit reporting.

```json
{
  "generatedAt": "2026-05-16T08:00:00.000Z",
  "strategy": "ui-shadow-plus-prompt-audit",
  "itemCount": 1,
  "items": [
    {
      "id": "skill-ui::C:\\path\\to\\SKILL.md",
      "name": "example-skill",
      "sourceFamily": "user-skill",
      "skillFile": "C:\\path\\to\\SKILL.md",
      "uiFile": "C:\\path\\to\\agents\\openai.yaml",
      "targetFile": "C:\\path\\to\\agents\\openai.yaml",
      "sourceField": "SKILL.md.description",
      "targetField": "agents/openai.yaml.interface.short_description",
      "original": "English source text",
      "translation": "",
      "risk": "low"
    }
  ]
}
```

## Editable Field

- Edit only `translation`.
- Leave `translation` empty for items that should not be applied.
- Do not change ids, paths, source text, fields, or risk labels.

## Risk Labels

- `low`: UI metadata such as `agents/openai.yaml` `interface.short_description` or plugin UI descriptions.
- `high`: trigger or prompt metadata such as `SKILL.md` `description`, prompt frontmatter, or Superpowers prompt-template task descriptions.

## Apply Rules

- Apply writes only items whose `translation` is non-empty.
- High-risk items are rejected unless `--allow-high-risk` is passed.
- Every apply creates backups, a manifest, and `rollback.ps1`.

## Verify Rules

- Verify compares each target field with the pack's `translation`.
- Missing translations are reported but do not fail the command.
- Mismatches fail verification and must be fixed before claiming completion.

## Audit Rules

Every real run must generate a report with:

- complete scanned item inventory
- source and target fields
- original and translated text
- current applied text
- verification status and notes
