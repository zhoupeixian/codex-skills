# Personal Codex Skills Repository

This repository stores Codex skills I maintain locally. Each skill lives in `skills/<skill-name>/` and keeps the standard Codex skill structure.

## Repository Layout

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
```

## Skills

| Skill | Purpose | Status |
| --- | --- | --- |
| `localize-codex-skills` | Scan visible Codex skills, generate translation packs, apply localized descriptions, verify coverage, produce audit reports, and clean up stale shadow copies. | Available |
| `zherp-automation` | Automate ZHERP/YigoERP SVN workflows with authentication, log collection, optional update, Maven build, entity generation, diff retrieval, and review logs. | Available |

## Add a New Skill

Place a new skill as an independent directory under `skills/`:

```text
skills/<new-skill-name>/SKILL.md
```

Recommended minimal structure:

- `SKILL.md`: required, defines the skill and workflow.
- `agents/openai.yaml`: optional, for Codex skill UI metadata.
- `references/`: optional, supporting references loaded on demand.
- `scripts/`: optional, deterministic helper scripts.

## Local Install

When installing or updating manually, copy the skill directory to:

```text
C:\Users\31487\.codex\skills\<skill-name>
```

Example:

```powershell
Copy-Item -Recurse -Force .\skills\localize-codex-skills C:\Users\31487\.codex\skills\localize-codex-skills
```

## Maintenance Rules

- Each skill must be self-contained.
- Do not commit translated packs, audit reports, backups, or local shadow copies.
- Keep reusable automation in `scripts/`.
- Skills that modify model-tuning-related metadata must clearly document risk boundaries.
- `~/.agents/skills` is only for real personal skills, not for plugin skill shadow copies.
