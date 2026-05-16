# Codex Skills

This is my personal Codex skills repository.

The repository is organized as a collection: each skill lives under `skills/<skill-name>/` and keeps the normal Codex skill layout inside that folder.

## Repository Layout

```text
skills/
  localize-codex-skills/
    SKILL.md
    agents/
    references/
    scripts/
```

## Skills

| Skill | Description | Status |
| --- | --- | --- |
| `localize-codex-skills` | Extracts, translates, applies, verifies, audits, and rolls back Codex-visible skill metadata. Defaults to low-risk UI metadata and gates trigger/prompt metadata behind explicit high-risk approval. | Active |

## Adding A Skill

Add new skills as sibling directories under `skills/`:

```text
skills/<new-skill-name>/SKILL.md
```

Recommended minimum files:

- `SKILL.md`: required skill definition and workflow.
- `agents/openai.yaml`: optional UI metadata for Codex skill lists.
- `references/`: optional supporting docs loaded only when needed.
- `scripts/`: optional deterministic helper scripts.

## Installing Locally

To install or update a skill manually, copy or sync a skill directory into:

```text
C:\Users\31487\.codex\skills\<skill-name>
```

For example:

```powershell
Copy-Item -Recurse -Force .\skills\localize-codex-skills C:\Users\31487\.codex\skills\localize-codex-skills
```

## Maintenance Rules

- Keep each skill self-contained.
- Do not commit generated translation packs, audit reports, or backups.
- Prefer scripts for repeatable operations.
- Document high-risk writes explicitly when a skill can modify model-facing metadata.
