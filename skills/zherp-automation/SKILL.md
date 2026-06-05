---
name: zherp-automation
description: Automate ZHERP/YigoERP SVN workflows with strict SVN authentication, log collection, optional update, Maven build, entity generation, diff retrieval, and optional Markdown review logs. Use when Codex is asked to inspect, collect, update, build, generate entities, or audit same-day or custom-range SVN revisions in a ZHERP/YigoERP repository, especially when the local environment may need sandbox-safe SVN config, Maven path, bokeerp maven_settings.xml, erp-entity-generator packaging, or review log output setup.
---

# ZHERP-Automation

## Core Rules

- 全程中文沟通；Windows 命令；中文文件按 UTF-8 处理。
- 这是 SVN 自动化 skill，不按 Git 工作流处理。
- 所有输出、运行日志和审查日志中禁止出现 `SVN_PASSWORD` 明文。
- 如果用户没有明确要求代码审查或审查提交，不拉审查 diff，不生成审查日志。
- 受限环境的 SVN 配置只使用 `<workspace>\.zherp-automation`；不要读取、迁移或解密主用户 SVN auth 缓存。
- `<workspace>\.zherp-automation` 是本机私有配置目录，禁止提交。
- `$env:USERPROFILE\.codex\automations` 只用于自动化记忆/状态，不是 SVN 认证配置来源。正式自动化任务可按需读取/更新记忆，但不能用记忆替代本轮 SVN 日志、diff 或认证配置。
- 除非用户明确要求诊断历史运行，否则每次日志/审查请求都视为一轮新运行。禁止为了“复用、增量、避免重复”在本轮 `log` 成功前搜索或读取 `automation-output\svn审查` 下已有的 `log.json`、diff、manifest 或审查日志。

## Required Order

按这个状态机执行，失败就停在当前阶段：

1. 确认 `workspace` 和 `time_range`。
   - 用户说“当日、当天、今日提交”但未给起止时间时，使用默认业务日窗口：本地当前日期前一天 `19:00:00` 到当前日期 `18:59:59`。
   - 完全没说时间范围时，先询问。
2. 建立本轮运行身份：记录 `run_started_at`，创建本轮 `run_dir`，例如 `report_root\<YYYY-MM-DD>\run-<yyyyMMdd-HHmmss>\`。
3. 验证 `workspace` 是本地 SVN 工作副本。
4. 判断当前是否为沙箱、CI 或受限自动化用户，显式决定 `-Restricted yes` 或 `-Restricted no`。不要用 `.zherp-automation` 是否存在来判断正式/受限环境。
5. 第一阶段：`auth-check -> log`。
6. 第一阶段失败立即停止；成功后只执行用户明确要求的后续动作。
7. 用户要求完整代码审查时，执行：`post-log-prep -> diff -> requesting-code-review -> report`。

## Script First

机械步骤优先调用 [zherp_svn.ps1](scripts/zherp_svn.ps1)。脚本只依赖 Windows PowerShell，不依赖 Python 或第三方包。

常用命令形态：

```powershell
$restricted = "<yes-or-no-after-agent-judgement>"
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path <workspace> ("automation-output\svn审查\" + (Get-Date -Format "yyyy-MM-dd") + "\run-" + $runId)

powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 prepare -Workspace <workspace> -Start "<start>" -End "<end>" -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 auth-check -Workspace <workspace> -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 log -Workspace <workspace> -Start "<start>" -End "<end>" -Restricted $restricted -Output (Join-Path $runDir "log.json")
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 post-log-prep -Workspace <workspace> -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 diff -Workspace <workspace> -Revisions r123 r124 -Restricted $restricted -OutputDir (Join-Path $runDir "diffs")
```

需要 env 模板时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 env-template -Workspace <workspace>
```

脚本返回 JSON。不要只看退出码，必须读取 `status`：

- `ok`：继续下一步。
- `restricted_unresolved`：停止；Agent 必须重新判断环境并显式传 `-Restricted yes/no`。
- `need_env`：停止；调用 `env-template`，把模板给用户。
- `workspace_invalid`：停止，要求用户重新提供 `workspace`。
- `svn_not_found`：停止，要求用户提供 `SVN_CMD`。
- `auth_failed`：停止，只汇报 `本次阻塞于 SVN 远端认证失败`。
- `log_failed` / `update_failed`：停止，汇报对应阶段失败。
- `maven_not_found` / `maven_settings_missing` / `maven_pom_missing` / `maven_failed`：停止，汇报构建阻塞。
- `diff_failed`：可以生成审查日志，但必须标注 `部分 revision 缺少 diff，结论受限`。

详细配置、手工命令和 env 模板见 [environment.md](references/environment.md)。

## Evidence Boundary

每轮必须有独立证据链，防止复用旧产物：

- `log` 必须显式写入本轮 `run_dir\log.json`。
- `diff` 必须显式写入本轮 `run_dir\diffs`。
- 本轮 `log` 成功前，不读取、不搜索、不解析任何历史输出目录里的 `log.json`、diff、manifest 或审查日志。历史产物只允许在用户明确要求排查历史运行时读取。
- `log.json` 是规范对象，顶层包含 `schema_version`、`time_range`、`revisions`、`reviewable_revisions`、`skipped_revisions`；不要把它当成原始数组。
- 脚本 `log` 返回 `ok` 后，优先使用 stdout JSON 的 `reviewable_revisions`；需要从文件恢复时读取 `log.json.reviewable_revisions`。禁止因为解析预期错误改用手写 `svn log --xml` 重拉。
- 审查只能基于本轮 `reviewable_revisions` 和本轮 diff manifest。
- 汇报本地审查日志前，必须确认该文件是本轮新写入，且 `LastWriteTime >= run_started_at`。
- 最终汇报必须列出本轮 `time_range`、`log.json` 路径、diff manifest 路径（如执行审查）、审查日志路径（如生成）。

## Review Flow

只有用户明确要求代码审查或审查提交时执行本节。

1. 第一阶段成功且 revision 列表非空后，过滤提交说明包含 `【 ZHERP】` 或 `【Jenkins 发布版本】` 的 revision。
2. 过滤后为空时，生成简短审查日志说明“无需要审查的提交”，然后停止。
3. 调用 `post-log-prep`。该命令内部固定串行执行 `svn update -> entity-generate -> maven-build`；禁止并行拆跑。
4. `post-log-prep` 任一步失败，立即停止，不拉 diff，不做审查。
5. 对每个需要审查的 revision 调用 `diff`，只基于成功取得的本轮 diff 分析。
6. 审查口径按 [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md) 执行。
7. 审查日志按 [report-template.md](references/report-template.md) 写入本轮 `run_dir`。

Maven 约束：

- `maven-build` 默认执行 `compile -DskipTests`。
- `entity-generate` 默认执行 `-pl ../erp-entity-generator package`。
- 完整审查必须先实体生成再 Maven 构建。

审查日志必须包含：提交人、提交时间、revision、变更概览、关键风险、按 P 级分类的问题、理由、影响、修改建议、总体审查结论。

问题清单只输出实际发现的问题级别。没有问题时只写：`未发现需要列入问题清单的问题。`
