# ZHERP-Automation 环境配置参考

## 用户可提前提供的配置

```yaml
workspace: "D:\\SVN\\ZHERP"
svn_config_dir: "<sandbox_svn_config_dir>"
time_range:
  start: "2026-06-03 19:00:00"
  end: "2026-06-04 18:59:59"
maven_cmd: "<maven_cmd>"
maven_settings: "<workspace>\\bokeerp\\maven_settings.xml"
entity_generator_module: "../erp-entity-generator"
report_root: "<workspace>\\automation-output\\svn审查"
svn_username: "<optional>"
svn_password_env_file: "<svn_password_env_file>"
skip_log_patterns:
  - "【 ZHERP】"
  - "【Jenkins 发布版本】"
```

## 缺配置时的处理

- 缺 `workspace`：要求用户提供 ZHERP 根目录。
- 缺 `svn_config_dir`：Agent 先判断当前是否是沙箱、CI 或受限自动化用户；如果是，要求用户提供或创建独立 SVN config 目录；正式环境无需额外处理。
- 缺 `time_range`：询问用户使用自定义范围，还是默认业务日窗口。
- 只有用户要求 Maven 构建、实体生成或完整审查时，才处理 `maven_cmd` 和 `maven_settings`。
- 缺 `maven_cmd`：可先执行 `mvn.cmd -version` 或 `mvn -version` 检测全局 Maven；找不到时要求用户提供 Maven 路径。
- 缺 `maven_settings`：先检查 `<workspace>\bokeerp\maven_settings.xml`；不存在时要求用户提供。
- 只有用户要求代码审查时，才处理 `report_root`；缺失时默认使用 `<workspace>\automation-output\svn审查`。

## Codex 沙箱 writable_roots

如果自动化需要写入 `C:\Users\<user>\.codex\automations`，用户需要在 Codex 配置 TOML 中加入：

```toml
writable_roots = ["C:\\Users\\<user>\\.codex\\automations"]
```

如果未配置，Agent 可能无法写入自动化使用的 SVN config 或报告输出目录。遇到写入失败时，不要绕开到主用户 SVN auth 缓存；应要求用户补配置。

## SVN 命令形态

沙箱、CI 或受限自动化用户的 SVN 命令必须包含：

```powershell
--non-interactive --no-auth-cache --config-dir <svn_config_dir>
```

最小认证验证：

```powershell
svn log -l 1 <sandbox_svn_args_if_needed> .
```

按时间范围拉日志：

```powershell
svn log -r "{<start>}:{<end>}" <sandbox_svn_args_if_needed> .
```

更新工作副本：

```powershell
svn update <sandbox_svn_args_if_needed> .
```

拉取单个 revision diff：

```powershell
svn diff -c <revision> <sandbox_svn_args_if_needed> .
```

## 认证恢复

只在最小认证验证失败后允许执行一次。恢复时：

- 从用户明确指定的 env 文件读取 `SVN_PASSWORD`。
- 只放在当前进程变量中使用。
- 使用 `--password-from-stdin`。
- 不输出密码，不写入报告或日志。
- 不读取、解密、迁移或输出任何已有 SVN auth 缓存中的密码。

## Maven 与实体生成命令形态

检测 Maven：

```powershell
& <maven_cmd> -version
```

主工程构建示例：

```powershell
& <maven_cmd> -s <maven_settings> -f <workspace>\bokeerp\pom.xml package
```

实体生成示例：

```powershell
& <maven_cmd> -s <maven_settings> -f <workspace>\bokeerp\pom.xml -pl ../erp-entity-generator package
```

如果项目现场使用了特定 profile、跳测试参数或专用 goal，要求用户提供；只有生成审查日志时才写入日志。
