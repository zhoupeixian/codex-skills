---
name: zherp-automation
description: Automate ZHERP/YigoERP SVN workflows for log collection, update, entity generation, Maven compile, diff retrieval, and optional code-review reports. Use when Codex is asked to run ZHERP SVN automation for a same-day or custom time range, especially in sandbox/restricted environments that need workspace-local SVN config, Maven path discovery, bokeerp maven_settings.xml, erp-entity-generator, or review report output.
---

# ZHERP-Automation

## Purpose

Run the ZHERP/YigoERP SVN automation as a staged, script-backed workflow. The skill should make the mechanical steps deterministic and leave code-review judgment to the model plus `requesting-code-review`.

## Non-Negotiables

- Communicate in Chinese. Use Windows/PowerShell. Treat Chinese text files as UTF-8.
- This is an SVN workflow, not a Git workflow.
- Never expose `SVN_PASSWORD`.
- Do not use or migrate the main user SVN auth cache in a sandbox/restricted environment.
- Do not do code review, pull review diffs, or write review reports unless the user explicitly asks for code review/revision review.
- Each normal run is a fresh run. Historical reports may be used only when the user asks to inspect or diagnose history.

## Inputs

Resolve these before remote SVN access:

- `workspace`: ZHERP SVN working copy.
- `time_range`: explicit start/end, or default business window for “today/current day”: previous local date `19:00:00` through current local date `18:59:59`.
- `goal`: log only, update, entity generation, Maven compile, or full code review.
- `restricted`: decide from the current execution environment and user-provided config; pass explicit `-Restricted yes` or `-Restricted no`.

If configuration details are missing or unclear, read only the relevant section of [environment.md](references/environment.md).

## Script Contract

Use [scripts/zherp_svn.ps1](scripts/zherp_svn.ps1) for mechanical steps. Resolve this path from the directory containing this `SKILL.md`; it is not `<workspace>\scripts\zherp_svn.ps1`. Do not reimplement SVN/Maven command assembly unless the script is unavailable.

`prepare` is optional diagnostics. It may show workspace-local env/config files, but it does not decide whether the current run is restricted; the agent still must pass explicit `-Restricted yes` or `-Restricted no`.

Minimum command sequence:

```powershell
$skillDir = "<directory containing this SKILL.md>"
$script = Join-Path $skillDir "scripts\zherp_svn.ps1"
$workspace = "<workspace>"
$restricted = "<yes-or-no>"
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $workspace ("automation-output\svn审查\" + (Get-Date -Format "yyyy-MM-dd") + "\run-" + $runId)

powershell -NoProfile -ExecutionPolicy Bypass -File $script auth-check -Workspace $workspace -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File $script log -Workspace $workspace -Start "<start>" -End "<end>" -Restricted $restricted -Output (Join-Path $runDir "log.json")
```

For full code review, read the current run log and continue only if `reviewable_revisions` is non-empty:

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

- The current run’s `log` command must write `runDir\log.json`.
- The current run’s `diff` command must write `runDir\diffs`.
- Before current-run `log` succeeds, do not use existing `automation-output\svn审查` files as evidence for this run.
- `log.json.revisions` is the raw log list.
- `log.json.reviewable_revisions` is the only review list.
- `log.json.skipped_revisions` contains logs skipped by script rules, such as Jenkins release or ZHERP update-log commits.
- Final responses and reports must identify the current run’s `time_range`, `log.json`, diff manifest when applicable, and report path when applicable.

## Goal Handling

- Log-only request: stop after `log` and summarize count/reviewable/skipped.
- Update/entity/build request without code review: run only the requested actions; do not pull review diffs or write review reports.
- Full code review request:
  1. If `count == 0`, write the short `无新增提交` report.
  2. Otherwise use only current-run `reviewable_revisions`.
  3. If `reviewable_revisions` is empty, write the short `无需要审查的提交` report.
  4. Run `post-log-prep`; stop on failure.
  5. Pull diffs for `reviewable_revisions`.
  6. Review using [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md).
  7. Write the report using [report-template.md](references/report-template.md) under `runDir`.

## Maven Defaults

- Main compile: `compile -DskipTests`.
- Entity generation: `-pl ../erp-entity-generator package`.
- Full review order: entity generation before Maven compile.

## When To Load References

- Load [environment.md](references/environment.md) only for missing/failed configuration, env template, restricted SVN details, Maven path/settings, or automations writable-roots.
- Load [report-template.md](references/report-template.md) only when writing a review report.
- Load [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md) only when code review is requested.
