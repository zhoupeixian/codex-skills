---
name: zherp-automation
description: Automate ZHERP/YigoERP SVN workflows for update, entity generation, Maven compile, revision discovery, diff retrieval, and optional code-review reports. Use when Codex is asked to run ZHERP SVN automation, especially in sandbox/restricted environments that need workspace-local SVN config, Maven path discovery, bokeerp maven_settings.xml, erp-entity-generator, or review report output.
---

# ZHERP-Automation

## Purpose

Run the ZHERP/YigoERP SVN automation as a staged, script-backed workflow. The skill should make the mechanical steps deterministic and leave code-review judgment to the model plus `requesting-code-review`.

## Non-Negotiables

- Communicate in Chinese. Use Windows/PowerShell. Treat Chinese text files as UTF-8.
- This is an SVN workflow, not a Git workflow.
- Never expose `SVN_PASSWORD`.
- In sandbox/restricted environments, use workspace-local SVN config and keep the main user SVN auth cache out of the workflow.
- Run only the routed goal for the current request. Use historical artifacts only when the user asks to inspect or diagnose history.

## Execution Model

Before running `prepare`, `auth-check`, `log`, `update`, Maven, or any other command, resolve the current run’s `workspace` and `goal`.

- `goal` must come from the user request or automation task definition. If it is missing or ambiguous, stop and ask what to do. Do not infer it from this skill’s capabilities.
- `workspace` may come from the user request, automation configuration, script arguments, or an execution context that clearly identifies the ZHERP SVN working copy. If it cannot be determined confidently, stop and ask for it.
- `restricted` must be decided from the current execution environment and user-provided config; pass explicit `-Restricted yes` or `-Restricted no`.
- `time_range` is needed only for revision discovery goals. Use explicit start/end when provided; otherwise use the default business window for “today/current day”: previous local date `19:00:00` through current local date `18:59:59`.
- `revision_filter` is optional and deterministic. Use script parameters for exact author/message filtering only; leave semantic filtering to Codex after `log.json` exists.

Route the goal before asking for optional inputs or running commands:

| Goal | Required inputs | Command flow | Output |
| --- | --- | --- | --- |
| `update` | `workspace`, `restricted` | `auth-check -> update` | update result |
| `entity-generate` | `workspace` | `entity-generate` | entity generation result |
| `maven-build` | `workspace` | `maven-build` | compile result |
| `update + entity-generate + maven-build` | `workspace`, `restricted` | `auth-check -> post-log-prep` | prep result |
| `revision-listing` | `workspace`, `restricted`, `time_range` | `auth-check -> log` | `log.json` summary |
| `code-review` | `workspace`, `restricted`, `time_range` | `auth-check -> log -> post-log-prep -> diff -> review -> report` | review report |

If configuration details are missing or unclear, read only the relevant section of [environment.md](references/environment.md).

## Script Contract

Use [scripts/zherp_svn.ps1](scripts/zherp_svn.ps1) for mechanical steps. Resolve this path from the directory containing this `SKILL.md`; it is not `<workspace>\scripts\zherp_svn.ps1`. Do not reimplement SVN/Maven command assembly unless the script is unavailable.

`prepare` is optional diagnostics. It may show workspace-local env/config files, but it does not decide whether the current run is restricted; the agent still must pass explicit `-Restricted yes` or `-Restricted no`.

Every SVN-backed route starts with `auth-check`, then follows the command flow selected in the Execution Model.

```powershell
$skillDir = "<directory containing this SKILL.md>"
$script = Join-Path $skillDir "scripts\zherp_svn.ps1"
$workspace = "<workspace>"
$restricted = "<yes-or-no>"
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $workspace ("automation-output\svn审查\" + (Get-Date -Format "yyyy-MM-dd") + "\run-" + $runId)

powershell -NoProfile -ExecutionPolicy Bypass -File $script auth-check -Workspace $workspace -Restricted $restricted
```

Use `log` only when the requested goal needs revision discovery, such as an explicit revision listing request or full code review. Do not run it for update/entity/build-only requests.

The `log` command supports only deterministic filters:

- `-IncludeAuthors "a,b"`: keep only exact SVN authors.
- `-ExcludeAuthors "a,b"`: skip exact SVN authors.
- `-SkipMessageContains "text1,text2"`: skip messages containing literal text.
- `-NoDefaultSkipRules`: disable the default Jenkins/ZHERP skip rules.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $script log -Workspace $workspace -Start "<start>" -End "<end>" -Restricted $restricted -Output (Join-Path $runDir "log.json")
```

For full code review, read that current run log and continue only if `reviewable_revisions` is non-empty:

```powershell
$log = Get-Content -Raw -Encoding UTF8 (Join-Path $runDir "log.json") | ConvertFrom-Json
$reviewRevs = @($log.reviewable_revisions | ForEach-Object { $_.revision })

powershell -NoProfile -ExecutionPolicy Bypass -File $script post-log-prep -Workspace $workspace -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File $script diff -Workspace $workspace -Revisions ($reviewRevs -join ",") -Restricted $restricted -OutputDir (Join-Path $runDir "diffs")
```

`post-log-prep` is intentionally serial: `svn update -> entity-generate -> maven-build`.

Read script JSON `status` before deciding the next step:

- `ok`: continue.
- `need_env`: stop, run `env-template`, give the user the template.
- `restricted_unresolved`: stop, decide and pass explicit `-Restricted yes/no`.
- `workspace_invalid`, `svn_not_found`, `config_error`, `path_out_of_scope`: stop and ask for the missing/fixed input.
- `auth_failed`: stop and report `本次阻塞于 SVN 远端认证失败`.
- `log_failed`, `update_failed`, Maven failures: stop at that stage.
- `diff_failed`: review may continue only for retrieved diffs; report that the conclusion is limited.

## Evidence Contract

- Use only current-run artifacts as evidence for the active run.
- When the current goal runs `log`, write `runDir\log.json`.
- When the current goal runs `diff`, write `runDir\diffs`.
- `log.json.revisions` is the raw revision-discovery list.
- `log.json.reviewable_revisions` is the only review candidate list.
- `log.json.filter` records exact script filter settings.
- `log.json.skipped_revisions` contains revisions skipped by script rules. Each skipped item must include `skip_reason`, such as `default_message_contains:【Jenkins 发布版本】`, `include_author_mismatch:<author>`, or `exclude_author:<author>`.
- Final responses and reports must identify the current run’s `time_range`, `log.json`, diff manifest, and report path only when those artifacts apply to the requested goal.

## Review Handling

Only `revision-listing` and `code-review` enter this section.

- `revision-listing`: stop after `log` and summarize count/reviewable/skipped.
- `code-review`:
  1. If `count == 0`, write the short `无新增提交` report.
  2. Otherwise use only current-run `reviewable_revisions`.
  3. If `reviewable_revisions` is empty, write the short `无需要审查的提交` report.
  4. Run `post-log-prep`; stop on failure.
  5. Pull diffs for `reviewable_revisions`.
  6. Review using [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md).
  7. Write the report using [report-template.md](references/report-template.md) under `runDir`.

If the user adds semantic filtering instructions such as “only review Blue Sky related commits” or “exclude pure wording changes,” apply them after reading `log.json.reviewable_revisions`. Record the semantic filter instruction, selected revisions, excluded revisions, and exclusion reasons in the run summary or review report. Keep `log.json` as the script-generated fact layer.

## Maven Defaults

- Main compile: `compile -DskipTests`.
- Entity generation: `-pl ../erp-entity-generator package`.
- Full review order: entity generation before Maven compile.

## When To Load References

- Load [environment.md](references/environment.md) only for missing/failed configuration, env template, restricted SVN details, Maven path/settings, or automations writable-roots.
- Load [report-template.md](references/report-template.md) only when writing a review report.
- Load [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md) only when code review is requested.
