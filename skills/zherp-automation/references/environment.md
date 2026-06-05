# ZHERP-Automation Environment Reference

Read this only when configuration is missing, a script status needs explanation, or the user asks how to prepare the environment.

## Required Inputs

```yaml
workspace: "<ZHERP SVN working copy>"
time_range:
  start: "<start datetime>"
  end: "<end datetime>"
goal: "log | update | entity-generate | maven-build | code-review"
```

Defaults:

- “今天/当天/当日/current day” means previous local date `19:00:00` to current local date `18:59:59`.
- `report_root` defaults to `<workspace>\automation-output\svn审查`.
- `entity_generator_module` defaults to `../erp-entity-generator`.
- `maven_settings` defaults to `<workspace>\bokeerp\maven_settings.xml`.

## Workspace Checks

- `workspace` must exist and be an SVN working copy.
- Prefer local `.svn` check. If needed, use `svn info .` only as a working-copy check.
- Do not scan disks to guess the workspace.
- Do not treat working-copy check failures as remote authentication failures.

## Restricted SVN Config

The agent must decide `-Restricted yes` or `-Restricted no` from the current execution environment.

Formal/local environment:

- Use `-Restricted no`.
- No extra SVN config-dir handling is required.

Sandbox, CI, or restricted automation user:

- Use `-Restricted yes`.
- SVN data commands must use workspace-local config:
  `<workspace>\.zherp-automation\svn-config-codexsandbox`
- Do not use, read, migrate, decrypt, or print the main user SVN auth cache.
- Do not pass passwords on the command line.

Workspace-local private files:

```text
<workspace>\.zherp-automation\svn-automation.env
<workspace>\.zherp-automation\svn-config-codexsandbox
```

These files are local/private and must not be committed.

## Env Template

When the script returns `need_env`, it creates `<workspace>\.zherp-automation\svn-automation.env` if the file is missing. Stop and tell the user to fill `SVN_USERNAME` and `SVN_PASSWORD` in that local file; never ask them to send SVN credentials in chat.

```dotenv
# ZHERP-Automation local secrets. Do not commit this file or this directory.
SVN_USERNAME=<your svn username>
SVN_PASSWORD=<your svn password>
SVN_CONFIG_DIR=<workspace>\.zherp-automation\svn-config-codexsandbox

# Optional. Fill these only when this machine cannot auto-detect them.
SVN_CMD=<path to svn.exe>
MAVEN_CMD=<path to mvn.cmd>
MAVEN_SETTINGS=<workspace>\bokeerp\maven_settings.xml
ENTITY_GENERATOR_MODULE=../erp-entity-generator
REPORT_ROOT=<workspace>\automation-output\svn审查
```

Handling rules:

- Prefer running `env-template` to create the workspace-local env file instead of asking the user to create the file manually.
- Read the env file only in the current process.
- Never print its contents.
- `SVN_PASSWORD` may only be passed through `--password-from-stdin`.
- After restricted auth succeeds, the script removes `SVN_USERNAME` and `SVN_PASSWORD` while preserving non-secret local config.
- If a later restricted auth check fails and the env file no longer has username/password, ask the user to fill them again.

## Maven And Entity Generation

Main Maven entry:

```text
<workspace>\bokeerp\pom.xml
```

Settings:

```text
<workspace>\bokeerp\maven_settings.xml
```

Defaults:

- `maven-build`: `compile -DskipTests`
- `entity-generate`: `-pl ../erp-entity-generator package`

Notes:

- Do not assume global Maven exists. The script tries `MAVEN_CMD`, then global `mvn.cmd`/`mvn`.
- If Maven is not found, ask the user to set `MAVEN_CMD` in `svn-automation.env`.
- If using Maven `-pl` for this project, `erp-entity-generator` must be `../erp-entity-generator`.

## Automations Directory

`$env:USERPROFILE\.codex\automations` is for Codex automation memory/state only.

Allowed:

- Probe existence and writability when the task needs automation memory/state.
- Read/update the automation’s own memory/state when useful.

Not allowed:

- Use automation memory as SVN auth config.
- Use automation memory as the current run’s revision list, diff evidence, or review conclusion.
- Store `SVN_PASSWORD` there.

If automation memory must be writable but is not, ask the user to configure Codex `config.toml`:

```toml
writable_roots = ["C:\\Users\\actual-user\\.codex\\automations"]
```

Do not block ordinary non-automation runs only because this directory is unavailable.
