# Safety Surfaces

Use this file to decide which metadata is safe to localize.

## Low Risk

- `agents/openai.yaml` `interface.short_description`

Why:

- UI-facing metadata
- intended for skill lists and chips
- can be added even when the skill originally had no UI metadata
- least likely to affect automatic skill routing

## Medium Risk

- `agents/openai.yaml` `interface.display_name`
- `agents/openai.yaml` `interface.default_prompt`
- slash-command style prompt hints or other human-facing launcher text

Why:

- mainly UI-facing, but can shape how users invoke a skill
- usually safe, but not necessary if the user only wants descriptions localized

## High Risk

- `SKILL.md` frontmatter `description`
- prompt frontmatter `description`
- prompt frontmatter `argument-hint`
- `superpowers/skills/*-prompt.md` frontmatter `description` and `argument-hint`

Why:

- these fields are often part of the model-facing routing layer
- translating them can change trigger precision
- if localization must touch them, do it only with explicit user approval and a full rollback plan
- prompt template files in `superpowers` are especially sensitive because they are reused to generate subagent task prompts

## Recommended Strategy

1. Keep trigger metadata in English.
2. Add or update `agents/openai.yaml` as a UI shadow layer.
3. Localize only `interface.short_description` first.
4. Re-check the visible skill list in Codex.
5. Expand to higher-risk fields only if the UI still reads from them and the user accepts the tradeoff.
