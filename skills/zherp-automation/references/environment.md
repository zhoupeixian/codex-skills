# ZHERP-Automation 环境配置参考

## 用户可提前提供的配置

```yaml
workspace: "<workspace>"
codex_automations_dir: "$env:USERPROFILE\\.codex\\automations"
time_range:
  start: "<start datetime>"
  end: "<end datetime>"
maven_cmd: "<maven_cmd>"
maven_settings: "<workspace>\\bokeerp\\maven_settings.xml"
entity_generator_module: "../erp-entity-generator"
report_root: "<workspace>\\automation-output\\svn审查"
svn_username: "<optional>"
svn_password_env_file: "<workspace>\\.zherp-automation\\svn-automation.env"
svn_cmd: "<optional path to svn.exe>"
skip_log_patterns:
  - "【 ZHERP】"
  - "【Jenkins 发布版本】"
```

## 缺配置时的处理

- 缺 `workspace`：要求用户提供 ZHERP 根目录；不要把当前 Codex 会话 `cwd` 当成工作副本，不要自行扫描磁盘猜测工作副本路径。
- 已提供 `workspace`：先确认目录存在，再优先用 `.svn` 存在做本地工作副本检查。需要执行 `svn info .` 时，只把它当成本地工作副本检查；验证失败时停止并要求用户重新提供，不要把工作副本验证失败当成 SVN 远端认证失败。
- 受限环境缺独立 SVN config：必须先确认 `workspace` 和 `time_range`。确认后，Agent 再判断当前是否是沙箱、CI 或受限自动化用户；如果是，先查找 `<workspace>\.zherp-automation\svn-automation.env` 和 `<workspace>\.zherp-automation\svn-config-codexsandbox`；找不到时要求用户按下面模板创建变量文件。正式环境无需额外处理。不要要求用户在“创建 env 文件”和“直接提供 config 目录”之间二选一。
- 缺 `time_range`：用户说“当日、当天、今日提交”但未给起止时间时，使用默认业务日窗口；完全没说时间范围时，询问用户使用自定义范围还是默认业务日窗口。
- 缺 SVN 命令：脚本会先检测全局 `svn`；找不到时要求用户在 `<workspace>\.zherp-automation\svn-automation.env` 里填写 `SVN_CMD`。
- 只有用户要求 Maven 构建、实体生成或完整审查时，才处理 `maven_cmd` 和 `maven_settings`。
- 缺 `maven_cmd`：可先执行 `mvn.cmd -version` 或 `mvn -version` 检测全局 Maven；找不到时要求用户提供 Maven 路径。
- 缺 `maven_settings`：先检查 `<workspace>\bokeerp\maven_settings.xml`；不存在时要求用户提供。
- 缺 Maven 聚合入口：`<workspace>\bokeerp\pom.xml` 不存在时停止，不要尝试把 workspace 当普通 Maven 根目录构建。
- 只有用户要求代码审查时，才处理 `report_root`；缺失时默认使用 `<workspace>\automation-output\svn审查`。

## 受限环境变量文件模板

当受限环境没有可用的独立 SVN config 目录时，让用户在 workspace 下创建：

`<workspace>\.zherp-automation\svn-automation.env`

文件固定使用 UTF-8。模板如下，用户复制后只替换尖括号内容。不要提交该文件，也不要提交整个 `.zherp-automation` 目录；不要把文件内容粘贴到对话、运行日志或审查日志里。

Agent 要在回复里直接给出这个模板，不要只引用本文件路径。

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

读取规则：

- 只在当前进程读取变量，不输出文件内容。
- `SVN_PASSWORD` 只能通过 `--password-from-stdin` 传给 `svn`。
- `svn-automation.env` 和 `SVN_CONFIG_DIR` 必须位于 `<workspace>\.zherp-automation` 下；脚本会拒绝 workspace 外的 env 或 config 路径。
- `REPORT_ROOT`、日志输出和 diff 输出必须位于 `workspace` 内；脚本会拒绝 workspace 外的输出路径。
- 如果 `SVN_CONFIG_DIR` 不存在，由 Codex 创建目录。
- 如果已有 `SVN_CONFIG_DIR`，先直接作为受限环境 config 使用；不要求创建变量文件。第一阶段最小认证失败时，才读取变量文件做一次认证引导。变量文件里的 `SVN_CONFIG_DIR` 会覆盖当前 `$svnConfigDir`，覆盖后必须重新设置 `@svnArgs` 和 `$svnBootstrapArgs`。`SVN_USERNAME` 和 `SVN_PASSWORD` 都必须存在。
- 受限环境 `auth-check` 成功后，如果 `svn-automation.env` 中存在 `SVN_USERNAME` 和 `SVN_PASSWORD`，脚本会自动移除这两项，保留 Maven、SVN 命令和报告目录等非密钥配置。后续如果认证缓存失效或更换沙箱用户，最小认证失败后会再次要求补回用户名和密码。

## Codex 自动化记忆目录 writable_roots

`$env:USERPROFILE\.codex\automations` 是 Codex 自动化记忆/状态目录，不是 SVN 认证配置目录，也不是本前置探测步骤的认证资料来源。SVN 受限环境配置仍优先放在 `<workspace>\.zherp-automation`。

只有本次任务需要写入或更新自动化记忆、状态文件、运行记录、审查日志索引，或当前运行明确属于自动化任务时，才在流程开头探测 `automations` 是否可访问、必要时是否可写。普通会话只使用本 skill 做 SVN 日志、更新、构建、实体生成或代码审查时，可以跳过本节，不要因为 `automations` 不存在或不可写而阻塞主流程。

检查顺序：

1. Codex 先用 `$env:USERPROFILE` 解析实际目录：`$automations = Join-Path $env:USERPROFILE ".codex\automations"`。
2. 检查目录是否存在、能否访问；目录不存在时可以创建。
3. 需要确认可写时，写入一个不含敏感信息的临时检查标记，然后立即删除该标记。
4. 自动化运行可按任务需要读取或更新自己的记忆/状态文件，但这些内容只能作为历史上下文，不能作为本轮 SVN 认证配置、revision 列表、diff 或审查结论的替代证据。
5. 禁止从 `automations` 目录获取 `svn_config_dir`、`SVN_USERNAME`、`SVN_PASSWORD` 或任何认证参数；SVN 受限环境配置只走 `<workspace>\.zherp-automation`。
6. 如果无法访问或写入，且本次任务确实需要写自动化记忆/状态，再检查 `$env:USERPROFILE\.codex\config.toml` 是否存在 `writable_roots` 配置。
7. 如果 `config.toml` 不存在、无法访问，或没有包含该目录，只阻塞会写自动化记忆/状态的步骤，并要求用户在 `config.toml` 中加入实际用户目录，例如：

```toml
writable_roots = ["C:\\Users\\actual-user\\.codex\\automations"]
```

不要因为 `automations` 不可写而绕开到主用户 SVN auth 缓存。

完成探测后，如果后续自动化任务本身需要读取或更新自动化记忆，可以按任务需要处理；但 SVN 认证配置来源仍只能按 `workspace` 和 `<workspace>\.zherp-automation` 流程确认，不能用 `automations` 历史文件替代。

## SVN 命令形态

优先使用 `scripts\zherp_svn.ps1` 执行机械流程。该脚本只依赖 Windows PowerShell，不依赖 Python。不要要求使用者安装 Python、pip 或第三方包；`quick_validate.py` 只属于 skill 作者维护时的本机校验，不属于本自动化运行流程。

```powershell
$restricted = "<yes-or-no-after-agent-judgement>"
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 prepare -Workspace <workspace> -Start "<start>" -End "<end>" -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 auth-check -Workspace <workspace> -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 log -Workspace <workspace> -Start "<start>" -End "<end>" -Restricted $restricted -Output <run_dir>\log.json
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 diff -Workspace <workspace> -Revisions r123 r124 -Restricted $restricted -OutputDir <run_dir>\diffs
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 update -Workspace <workspace> -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 post-log-prep -Workspace <workspace> -Restricted $restricted
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 maven-build -Workspace <workspace>
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 entity-generate -Workspace <workspace>
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 report-path -Workspace <workspace>
```

`$restricted` 必须由 Agent 在确认 `workspace` 和 `time_range` 后，根据当前工具权限提示、filesystem sandbox、writable roots、CI/受限用户迹象和用户提供的本地配置判断。`-Restricted auto` 只能作为已有 workspace 本地配置的兜底探测，不要把它当成沙箱判断。

缺少 `<workspace>\.zherp-automation` 只能说明 workspace 里还没有受限环境本地配置，不能说明当前是正式环境。脚本在 `-Restricted auto` 且缺少 env/config 时会返回 `restricted_unresolved`；此时 Agent 必须重新判断并显式传 `-Restricted yes` 或 `-Restricted no`。如果当前是沙箱、CI 或受限自动化用户，正确结果应是 `-Restricted yes` 后进入 `need_env` 模板分支。

脚本不可用时，才按下面命令手工执行。执行 SVN 命令前先展开 PowerShell 参数数组，禁止原样执行占位符。

正式环境：

```powershell
$svnArgs = @()
```

沙箱、CI 或受限自动化用户的 SVN 命令必须包含：

```powershell
$svnArgs = @("--non-interactive", "--no-auth-cache", "--config-dir", $svnConfigDir)
```

受限环境首次认证引导需要生成独立 config 时使用：

```powershell
$svnBootstrapArgs = @("--non-interactive", "--config-dir", $svnConfigDir)
$env:SVN_PASSWORD | svn log -l 1 --username $env:SVN_USERNAME --password-from-stdin @svnBootstrapArgs .
```

不要把 `$env:SVN_PASSWORD` 打印出来；它只能来自用户指定的 env 文件。

最小认证验证：

```powershell
svn log -l 1 @svnArgs .
```

按时间范围拉日志：

```powershell
$revisionRange = "{<start>}:{<end>}"
svn log -r $revisionRange @svnArgs .
```

更新工作副本：

```powershell
svn update @svnArgs .
```

完整审查或同时要求更新、实体生成和构建时，不要并行执行单步命令，直接使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\zherp_svn.ps1 post-log-prep -Workspace <workspace> -Restricted $restricted
```

`post-log-prep` 内部固定串行执行 `svn update -> entity-generate -> maven-build`，任一步失败都会立即停止并返回失败阶段。必须先实体生成再 Maven 构建，否则新增实体被 Java 引用时会因为实体类不存在而编译失败。

拉取单个 revision diff：

```powershell
svn diff -c <revision> @svnArgs .
```

每次运行必须先确定本轮 `run_started_at` 和 `run_dir`，例如：

```text
<workspace>\automation-output\svn审查\<YYYY-MM-DD>\run-<yyyyMMdd-HHmmss>
```

本轮审查只能使用本轮 `log.json`、本轮 diff manifest 和本轮新写入的审查日志。不要把日期目录中已有的旧 `log.json`、旧 diff、旧审查日志或自动化记忆当成本轮结果。

`log.json` 是脚本生成的规范对象，顶层包含：

- `schema_version`
- `time_range`
- `revisions`
- `reviewable_revisions`
- `skipped_revisions`

不要把它当成原始 revision 数组解析。脚本 `log` 返回 `ok` 时，优先使用 stdout JSON 的 `reviewable_revisions`；需要从文件恢复时读取 `log.json.reviewable_revisions`。不要因为解析预期错误而绕过脚本重跑手写 `svn log --xml`。

## 认证恢复

只在最小认证验证失败后允许执行一次。恢复时：

- 从用户明确指定的 env 文件读取 `SVN_PASSWORD`。
- 只放在当前进程变量中使用。
- 使用 `--password-from-stdin`。
- 不输出密码，不写入运行日志或审查日志。
- 不读取、解密、迁移或输出任何已有 SVN auth 缓存中的密码。

## Maven 与实体生成命令形态

检测 Maven：

```powershell
& <maven_cmd> -version
```

主工程构建示例：

```powershell
& <maven_cmd> -s <maven_settings> -f <workspace>\bokeerp\pom.xml compile -DskipTests
```

`maven-build` 默认只做编译检查并跳过测试，不执行 `package`。只有用户明确要求打包或跑测试时，才覆盖默认 Maven 参数。

实体生成示例：

```powershell
& <maven_cmd> -s <maven_settings> -f <workspace>\bokeerp\pom.xml -pl ../erp-entity-generator package
```

如果项目现场使用了特定 profile、跳测试参数或专用 goal，要求用户提供；只有生成审查日志时才写入日志。
