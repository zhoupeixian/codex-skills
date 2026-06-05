# ZHERP-Automation 使用说明

## 获取方式

- GitHub：<https://github.com/zhoupeixian/codex-skills>
- 本地压缩包：`zherp-automation-skill.zip`

## 安装方式

### 手动安装

将 `zherp-automation` 放到本机 Codex skills 目录：

```text
C:\Users\<你的用户名>\.codex\skills\zherp-automation
```

如果拿到的是压缩包，先解压后再放入该目录。

### Codex 帮忙安装

把 GitHub 链接或本地压缩包路径发给 Codex，并说明：

```text
请帮我安装 zherp-automation skill。
来源：https://github.com/zhoupeixian/codex-skills
```

截图预留：

```text
[此处放 Codex 安装截图]
```

## 首次使用

自动化正式使用前，先手动跑一次。目的：

- 初始化工作区本地配置：`<workspace>\.zherp-automation`。
- 初始化受限环境可用的 SVN 独立认证缓存。
- 确认 Maven 路径、实体生成、编译和报告输出能跑通。
- 确认自动化目录写入权限可用。

示例请求：

```text
使用 $zherp-automation
workspace：D:\SVN\ZHERP
目标：更新代码 + 生成实体 + Maven 编译
```

如果只想做代码审查：

```text
使用 $zherp-automation
workspace：D:\SVN\ZHERP
目标：代码审查
time_range：当天
```

## 可选目标

默认业务目标只有 5 个：

1. 更新代码
2. 生成实体
3. Maven 编译
4. 更新代码 + 生成实体 + Maven 编译
5. 代码审查

只有明确要求“查提交”“看日志”或“列 revision”时，才会单独查询 SVN 提交记录。查询提交记录不是更新、实体生成或编译的必经步骤。

## SVN 凭据初始化

如果提示 `need_env`，Skill 会在工作区自动生成：

```text
<workspace>\.zherp-automation\svn-automation.env
```

打开这个文件，填写占位值：

```dotenv
SVN_USERNAME=<你的 SVN 用户名>
SVN_PASSWORD=<你的 SVN 密码>
```

不要把 SVN 密码发到聊天、日志或报告里。

首次受限认证成功后，Skill 会移除 env 文件中的 `SVN_USERNAME` 和 `SVN_PASSWORD`，保留 Maven 路径等非密钥配置。

## Maven 配置

如果本机没有全局 Maven，在 env 文件中配置 `MAVEN_CMD`：

```dotenv
MAVEN_CMD=<你的 mvn.cmd 路径>
MAVEN_SETTINGS=<workspace>\bokeerp\maven_settings.xml
ENTITY_GENERATOR_MODULE=../erp-entity-generator
```

ZHERP 项目使用 `bokeerp\maven_settings.xml`。实体生成模块使用 `../erp-entity-generator`。

## 代码审查行为

只有明确要求“代码审查”时，Skill 才会：

- 查询当前时间范围内的 SVN 提交。
- 过滤 Jenkins/ZHERP 自动提交。
- 执行更新代码、生成实体、Maven 编译。
- 拉取审查候选 revision 的 diff。
- 生成审查报告。

没有要求代码审查时，不会拉审查 diff，也不会生成审查报告。

## 注意事项

- 不要提交 `<workspace>\.zherp-automation`。
- 不要提交自动化输出目录中的临时运行文件。
- 不要把 `SVN_PASSWORD` 粘贴到聊天、日志或报告中。
- 自动化任务正式启用前，必须先完成一次手动跑通验证。
