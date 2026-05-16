---
name: localize-codex-skills
description: Safely extract, translate, apply, verify, and roll back Codex-visible skill metadata. Use when auditing which files back the skill descriptions shown in Codex, generating a batch translation pack for skills, applying Chinese UI descriptions with backups, or restoring the original metadata after a localization experiment. Prefer the low-risk UI shadow metadata in agents/openai.yaml and avoid rewriting SKILL.md descriptions unless the user explicitly accepts possible routing side effects.
---

# Localize Codex Skills

## Overview

Use this skill to localize Codex skill descriptions in a way that is fast, repeatable, reversible, and auditable.

The default workflow is intentionally conservative:

1. Extract the currently active skills into one translation pack.
2. Include visible runtime shadow copies and prompt-role descriptions when needed.
3. Translate the pack in one pass.
4. Apply the translations to the correct visible surface.
5. Verify coverage.
6. Generate a strict bilingual audit report.
7. Keep the generated rollback script for one-click restore.

This avoids touching `SKILL.md` `description` by default, which is the higher-risk field because it helps Codex decide when a skill should trigger.

## Safety Model

Read [references/safety-surfaces.md](references/safety-surfaces.md) before changing anything.

Use these rules:

- Default to UI-only localization.
- Prefer `agents/openai.yaml` `interface.short_description` as the localized surface.
- Preserve existing `display_name`, icons, colors, and other UI metadata.
- Do not rewrite `SKILL.md` `description` unless the user explicitly asks for a higher-risk full rewrite.
- Do not assume plugin cache hashes are stable. Always discover the active cache directories at runtime.

## Workflow

### 1. Extract active skill metadata

Run:

```powershell
& "<node>" scripts/localize-codex-skills.mjs extract --out .\skill-ui-pack.json
```

This scans:

- `C:\Users\<user>\.codex\skills`
- `C:\Users\<user>\.codex\superpowers\skills`
- `C:\Users\<user>\.agents\skills`
- active plugin cache roots under `.codex\plugins\cache`
- runtime plugin shadows under `.codex\.tmp\plugins\plugins`
- runtime bundled marketplace shadows under `.codex\.tmp\bundled-marketplaces`
- prompt role descriptions under `.codex\prompts`
- superpowers prompt templates ending in `-prompt.md`

The output pack is a single JSON file. Each item includes:

- source skill path
- target file path
- original English description to translate
- empty `translation` field to fill

This extracted pack is also the source of truth for the later audit report. Do not remove or reorder items unless you intentionally want a different audit scope.

For prompt roles, the target is the prompt markdown frontmatter `description`, not `agents/openai.yaml`.
For superpowers prompt templates, scan and report both `description` and `argument-hint`, but only apply them when the user explicitly approves high-risk prompt rewrites with `--allow-high-risk`.

If you want to test on a small subset first, pass one or more custom roots:

```powershell
& "<node>" scripts/localize-codex-skills.mjs extract --root C:\path\to\some\skills --out .\subset-pack.json
```

### 2. Translate the pack once

Translate only the `translation` values in the JSON pack.

Requirements:

- Preserve meaning exactly.
- Keep product names, APIs, and proper nouns in English when that improves clarity.
- Do not change file paths, ids, or source text.
- Keep the translation concise enough for UI scanning.

### 3. Apply with backup and rollback generation

Run:

```powershell
& "<node>" scripts/localize-codex-skills.mjs apply --pack .\skill-ui-pack.json
```

This will:

- create or update `agents/openai.yaml`
- update only low-risk UI metadata by default
- back up every touched file
- generate a backup manifest
- generate `rollback.ps1`

The script writes `interface.short_description` for skills by default. If a skill does not already have `agents/openai.yaml`, the script creates one with just that field.

Prompt-role items, Superpowers prompt templates, and `SKILL.md` `description` targets are high-risk. The script refuses to apply them unless `--allow-high-risk` is present after explicit user approval.

### 4. Verify

Run:

```powershell
& "<node>" scripts/localize-codex-skills.mjs verify --pack .\skill-ui-pack.json
```

Verification reports:

- items applied successfully
- items missing translations
- items whose current file content does not match the translated pack

Treat mismatches as a failed rollout until resolved.

### 5. Generate the audit report

Run:

```powershell
& "<node>" scripts/localize-codex-skills.mjs report --pack .\skill-ui-pack.json --out .\skill-ui-pack.audit.md
```

This report is mandatory after every real run of the skill.

The report includes:

- the complete scanned item inventory
- source skill file and target UI file for every item
- source field used for extraction
- target field actually written
- original text
- translated Chinese text
- current applied UI text
- verification status and mismatch notes

If you skip this report, the run is incomplete.

### 6. Roll back

Run the generated PowerShell script:

```powershell
& .\backups\<timestamp>\rollback.ps1
```

That restores original files and deletes any `agents/openai.yaml` files that were created only for the localization pass.

## Notes

- This skill is optimized for the Codex skill list UI problem.
- It does not rewrite `SKILL.md` trigger descriptions or prompt-template metadata unless the user explicitly approves high-risk prompt rewrites.
- If the user explicitly wants a broader rewrite, stop and call out the routing risk first.
- Every completed run should leave behind three artifacts together: translation pack, audit report, and rollback script.
- Runtime-visible English may come from shadow copies under `.codex\.tmp`; if the visible UI still shows English, inspect those before assuming the cache copy is authoritative.
