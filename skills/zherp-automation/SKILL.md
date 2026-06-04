---
name: zherp-automation
description: Automate ZHERP/YigoERP SVN workflows with strict SVN authentication, log collection, optional update, Maven build, entity generation, diff retrieval, and optional Markdown review logs. Use when Codex is asked to inspect, collect, update, build, generate entities, or audit same-day or custom-range SVN revisions in a ZHERP/YigoERP repository, especially when the local environment may need sandbox-safe SVN config, Maven path, bokeerp maven_settings.xml, erp-entity-generator packaging, or review log output setup.
---

# ZHERP-Automation

## 目标

执行 ZHERP/YigoERP 项目的 SVN 自动化。先完成认证和日志拉取，再按用户请求决定是否进入更新、构建、实体生成、diff 拉取和代码审查。禁止把认证、取数、更新、构建、实体生成和审查混成一个大步骤反复重试。

## 执行边界

- 全程使用中文沟通和汇报。
- Windows 环境下执行命令，中文文件固定按 UTF-8 处理。
- 这是 SVN 自动化 skill，不按 Git 工作流处理。
- 报告和日志中禁止出现 `SVN_PASSWORD` 明文值。
- 如果用户没有明确要求代码审查或审查提交，不进入代码审查流程，不拉取审查 diff，不生成审查日志。

## 先收集配置

如果用户已经在请求中提供环境信息，直接使用。缺少必要信息时，先要求用户补齐，不要猜。

基础必要配置：

- `workspace`: ZHERP 工作目录，例如 `D:\SVN\ZHERP`
- `time_range`: 日志或审查时间范围；支持用户指定起止时间。未指定时，询问用户是否使用默认业务日窗口：本地当前日期前一天 `19:00:00` 到当前日期 `18:59:59`

按动作补充配置：

- Agent 判断当前是沙箱、CI 或受限自动化用户时，需要 `svn_config_dir`；正式环境无需额外处理。
- 用户要求 Maven 构建或完整审查时，需要 `maven_cmd` 和 `maven_settings`。`maven_cmd` 可先尝试全局 `mvn.cmd` 或 `mvn`；找不到时要求用户提供。
- 用户要求实体生成或完整审查时，需要 `entity_generator_module`，ZHERP 通常为 `../erp-entity-generator`。
- 用户要求代码审查时，需要 `report_root`，通常为 `automation-output\svn审查`。

可选配置：

- `svn_username`: 需要恢复认证缓存或显式认证时使用
- `svn_password_env_file`: 只允许读取当前流程指定的安全 env 文件，且不得输出内容
- `skip_log_patterns`: 默认跳过包含 `【 ZHERP】` 或 `【Jenkins 发布版本】` 的日志

详细配置清单见 [environment.md](references/environment.md)。

## 沙箱与 SVN 认证

先由 Agent 判断当前环境是否是沙箱、CI 或受限自动化用户。判断依据包括：当前工具权限提示、filesystem sandbox 状态、writable roots、是否能写入目标 SVN config 目录、用户是否提供了自动化专用 config 目录等。

- 正式环境无需额外处理 SVN config-dir。
- 如果判断为沙箱、CI 或受限自动化用户，必须使用 `--config-dir <svn_config_dir>`，不能读取或迁移主用户 SVN auth 缓存。
- 沙箱、CI 或受限自动化用户执行 `svn` 命令时，必须显式带上 `--non-interactive --no-auth-cache --config-dir <svn_config_dir>`。
- 认证恢复只能从用户明确提供的 env 文件读取 `SVN_PASSWORD` 到当前进程变量，使用 `--password-from-stdin` 传给 `svn`。
- 禁止使用 `--password 明文`。
- 禁止打印 env 文件内容。
- 禁止读取、解密、迁移或输出任何已有 SVN auth 缓存中的密码。

## 第一阶段：认证与日志拉取

严格按顺序执行：

1. 切到 `workspace`。
2. 执行最小认证验证，只验证仓库日志可访问：

```powershell
svn log -l 1 <sandbox_svn_args_if_needed> .
```

3. 如果最小认证失败，且用户提供了安全恢复方式，只允许恢复一次认证缓存或当前进程凭据，然后重新执行最小认证验证。
4. 如果恢复后仍失败，立即停止。输出：`本次阻塞于 SVN 远端认证失败`。不要进入第二阶段。
5. 最小认证成功后，按 `time_range` 拉取日志。日志至少包含 revision、提交人、提交时间、提交说明。
6. 如果当天或指定时间范围无提交：用户要求代码审查时，生成简短 Markdown 审查日志说明“无新增提交”；否则只汇报“无新增提交”，不生成审查日志。

不要在第一阶段拉 diff。不要在第一阶段做代码推断。

## 第二阶段：按请求执行后续动作

只有第一阶段成功拿到 revision 列表且列表不为空，且用户请求需要后续动作，才进入第二阶段。

如果用户只要求认证验证或日志拉取，第一阶段完成后立即汇报结果并停止。

如果用户没有明确要求代码审查或审查提交，本阶段只执行用户明确要求的动作，例如 `svn update`、Maven 构建或实体生成；不要拉取审查 diff，不要做代码审查分析，不要生成审查日志。

按用户请求选择对应流程：

- 只要求 `svn update`：执行 `svn update`；沙箱、CI 或受限自动化用户必须带 SVN config 参数；完成后汇报结果并停止。
- 只要求 Maven 构建：先确认 `maven_cmd` 和 `maven_settings`，再执行构建；完成后汇报结果并停止。
- 只要求实体生成：先确认 `maven_cmd`、`maven_settings` 和 `entity_generator_module`，再走 Maven `package`；完成后汇报结果并停止。
- 要求代码审查：按下面顺序执行完整流程，并生成审查日志。

完整代码审查流程：

1. 过滤日志，跳过提交说明包含默认跳过模式的 revision。
2. 执行 `svn update`；沙箱、CI 或受限自动化用户必须带 SVN config 参数。
3. Maven 构建项目。先用 `maven_cmd`；如果没有配置，可尝试全局 Maven，失败后要求用户提供 Maven 路径。
4. 更新实体类到最新。实体生成在 `erp-entity-generator` 对应 Maven 模块执行，优先走 Maven `package`。
5. 如果更新、Maven 构建或实体生成失败，立即停止并汇报失败阶段、命令意图和关键错误。不要继续拉 diff 和审查。
6. 对每个需要审查的 revision 单独拉取 diff。只基于成功取得的日志和 diff 做分析。
7. 如果部分 revision 无法拉取 diff，审查日志中必须写明：`部分 revision 缺少 diff，结论受限`。
8. 生成标准级 Markdown 审查日志并保存到按日期归档的目录。

Maven 规则：

- 使用 Maven 构建时必须显式指定 `maven_settings`。
- 如果在 ZHERP 主工程中使用 `-pl`，只能写 `bokeerp/pom.xml` 中 `<module>` 的相对路径。
- `erp-entity-generator` 模块必须写成 `../erp-entity-generator`，不要写成 `-pl erp-entity-generator`。

## 审查口径

按 [requesting-code-review/SKILL.md](references/requesting-code-review/SKILL.md) 执行。

## 报告要求

只有用户明确要求代码审查时，才执行本节。

报告必须包含：

- 提交人
- 提交时间
- revision
- 变更概览
- 关键风险
- 按严重级别 P 分类的问题
- 理由
- 影响
- 修改建议
- 总体审查结论

报告按样例使用 `P0/P1/P2/P3`。如复核输出使用 `Critical/Important/Minor`，生成最终报告时按 `Critical -> P0/P1`、`Important -> P1/P2`、`Minor -> P3` 映射；具体级别以实际影响判断。

报告模板见 [report-template.md](references/report-template.md)。
