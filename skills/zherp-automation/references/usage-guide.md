# ZHERP-Automation Skill 使用说明

## 获取方式

- GitHub：<https://github.com/zhoupeixian/codex-skills>
- 压缩包：`zherp-automation-skill.zip`

## 安装方式

### 方式一：手动安装

将 `zherp-automation` 放到本机 Codex skills 目录，如果是压缩包要先解压：

```text
C:\Users\<你的用户名>\.codex\skills\zherp-automation
```

安装后，在 Codex 中用 `$zherp-automation` 触发。

### 方式二：让 Codex 帮忙安装

把 GitHub 链接或本地压缩包路径发给 Codex，并说明：

```text
请帮我安装 zherp-automation skill。
来源：https://github.com/zhoupeixian/codex-skills
或：压缩包地址
```

安装完成后，在 Codex 中用 `$zherp-automation` 触发。

## 首次使用

自动化运行前，必须先手动执行一次。目的：

- 初始化本机配置，例如 `.zherp-automation`、SVN 独立认证缓存。
- 确认 Codex 是否能写入自动化目录。
- 确认 SVN、Maven、实体生成和报告输出流程能正常跑通。

示例请求：

```text
使用 $zherp-automation
workspace：D:\SVN\ZHERP
time_range：当天
目标：拉日志 / 更新 / 实体生成 / Maven 构建 / 完整代码审查
```

如果提示需要创建 env 文件，按输出模板创建：

```text
<workspace>\.zherp-automation\svn-automation.env
```

首次认证成功后，Skill 会移除 env 中的 `SVN_USERNAME` 和 `SVN_PASSWORD`，保留 Maven 路径等非密钥配置。

## 常用目标

- 只拉 SVN 日志：`目标：拉日志`
- 更新并构建：`目标：更新 / 实体生成 / Maven 构建`
- 完整代码审查：`目标：完整代码审查`

完整流程会按顺序执行：

```text
auth-check -> log -> svn update -> entity-generate -> maven-build -> diff -> 审查日志
```

如果没有明确要求代码审查，不会拉审查 diff，也不会生成审查日志。

## 注意事项

- 不要提交 `.zherp-automation` 目录。
- 不要把 `SVN_PASSWORD` 粘贴到聊天、日志或报告中。
- 没有全局 Maven 时，在 env 文件里配置 `MAVEN_CMD`。
- 自动化任务正式启用前，先完成一次手动跑通验证。
