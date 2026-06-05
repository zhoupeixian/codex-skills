param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('env-template', 'prepare', 'auth-check', 'log', 'diff', 'update', 'maven-config', 'maven-build', 'entity-generate', 'post-log-prep', 'report-path')]
    [string]$Command,

    [string]$Workspace,
    [string]$SvnCmd,
    [ValidateSet('auto', 'yes', 'no')]
    [string]$Restricted = 'auto',
    [string]$EnvFile,
    [string]$ConfigDir,
    [string]$Start,
    [string]$End,
    [string]$BusinessDate,
    [string[]]$Revisions,
    [string]$Output,
    [string]$OutputDir,
    [string]$MavenCmd,
    [string]$MavenSettings,
    [string]$EntityModule,
    [string]$ReportRoot,
    [string]$ReportDate,
    [string]$Name,
    [string[]]$MavenArgs
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$LeftCjkBracket = [string][char]0x3010
$RightCjkBracket = [string][char]0x3011
$ReleaseVersionText = -join ([char[]](0x53d1, 0x5e03, 0x7248, 0x672c))
$ReviewText = -join ([char[]](0x5ba1, 0x67e5))
$LogText = -join ([char[]](0x65e5, 0x5fd7))
$SkipLogTokens = @(
    ($LeftCjkBracket + 'ZHERP' + $RightCjkBracket),
    ($LeftCjkBracket + 'Jenkins' + $ReleaseVersionText + $RightCjkBracket)
)
$DefaultEntityModule = '../erp-entity-generator'
$DefaultReportRoot = 'automation-output\svn' + $ReviewText

function Write-JsonResult {
    param(
        [string]$Status,
        [hashtable]$Data = @{}
    )
    $result = [ordered]@{ status = $Status }
    foreach ($key in $Data.Keys) {
        $result[$key] = $Data[$key]
    }
    $result | ConvertTo-Json -Depth 12
    if ($Status -eq 'ok') { exit 0 }
    exit 2
}

function ConvertTo-ResolvedPathString {
    param([string]$PathText)
    if ([string]::IsNullOrWhiteSpace($PathText)) { return $null }
    $expanded = [Environment]::ExpandEnvironmentVariables($PathText)
    return [System.IO.Path]::GetFullPath($expanded)
}

function Normalize-PathForCompare {
    param([string]$PathText)
    $resolved = ConvertTo-ResolvedPathString $PathText
    if (-not $resolved) { return $null }
    return $resolved.TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
}

function Test-PathWithin {
    param([string]$PathText, [string]$BasePath)
    $pathNorm = Normalize-PathForCompare $PathText
    $baseNorm = Normalize-PathForCompare $BasePath
    if (-not $pathNorm -or -not $baseNorm) { return $false }
    if ([string]::Equals($pathNorm, $baseNorm, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $baseNorm + [System.IO.Path]::DirectorySeparatorChar
    return $pathNorm.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-PathWithin {
    param([string]$PathText, [string]$BasePath, [string]$Purpose)
    $resolved = ConvertTo-ResolvedPathString $PathText
    if (-not (Test-PathWithin $resolved $BasePath)) {
        Write-JsonResult 'path_out_of_scope' @{
            purpose = $Purpose
            path = $resolved
            allowed_root = (ConvertTo-ResolvedPathString $BasePath)
            message = 'Path must stay inside the allowed workspace scope.'
        }
    }
    return $resolved
}

function Get-WorkspacePath {
    if ([string]::IsNullOrWhiteSpace($Workspace)) {
        Write-JsonResult 'config_error' @{ message = 'workspace is required.' }
    }
    return ConvertTo-ResolvedPathString $Workspace
}

function Get-AutomationDir {
    param([string]$WorkspacePath)
    return Join-Path $WorkspacePath '.zherp-automation'
}

function Get-DefaultEnvFile {
    param([string]$WorkspacePath)
    return Join-Path (Get-AutomationDir $WorkspacePath) 'svn-automation.env'
}

function Get-DefaultConfigDir {
    param([string]$WorkspacePath)
    return Join-Path (Get-AutomationDir $WorkspacePath) 'svn-config-codexsandbox'
}

function Get-DefaultReportRoot {
    param([string]$WorkspacePath)
    return Join-Path $WorkspacePath $DefaultReportRoot
}

function Get-EnvTemplate {
    param([string]$WorkspacePath)
    $config = Get-DefaultConfigDir $WorkspacePath
    $settings = Join-Path (Join-Path $WorkspacePath 'bokeerp') 'maven_settings.xml'
    $report = Get-DefaultReportRoot $WorkspacePath
    return @"
# ZHERP-Automation local secrets. Do not commit this file or this directory.
SVN_USERNAME=<your svn username>
SVN_PASSWORD=<your svn password>
SVN_CONFIG_DIR=$config

# Optional. Fill these only when this machine cannot auto-detect them.
SVN_CMD=<path to svn.exe>
MAVEN_CMD=<path to mvn.cmd>
MAVEN_SETTINGS=$settings
ENTITY_GENERATOR_MODULE=$DefaultEntityModule
REPORT_ROOT=$report
"@
}

function Read-EnvFile {
    param([string]$PathText)
    $values = @{}
    if ([string]::IsNullOrWhiteSpace($PathText) -or -not (Test-Path -LiteralPath $PathText)) {
        return $values
    }
    foreach ($line in Get-Content -LiteralPath $PathText -Encoding UTF8) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
            continue
        }
        $parts = $trimmed.Split('=', 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key.Length -gt 0) {
            $values[$key] = $value
        }
    }
    return $values
}

function Remove-EnvSecrets {
    param([string]$PathText)
    if ([string]::IsNullOrWhiteSpace($PathText) -or -not (Test-Path -LiteralPath $PathText)) {
        return $false
    }
    $kept = @()
    foreach ($line in Get-Content -LiteralPath $PathText -Encoding UTF8) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^(SVN_USERNAME|SVN_PASSWORD)\s*=') {
            continue
        }
        $kept += $line
    }
    Set-Content -LiteralPath $PathText -Encoding UTF8 -Value $kept
    return $true
}

function Test-UsableValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $trimmed = $Value.Trim()
    $placeholderTokens = @('<workspace>', '<your svn username>', '<your svn password>', '<path to svn.exe>', '<path to mvn.cmd>')
    foreach ($token in $placeholderTokens) {
        if ($trimmed.Contains($token)) { return $false }
    }
    if ($trimmed -match '^<[^>]+>$') { return $false }
    return $true
}

function Get-EnvSummary {
    param([hashtable]$Values)
    return [ordered]@{
        exists = ($Values.Count -gt 0)
        has_svn_username = (Test-UsableValue $Values['SVN_USERNAME'])
        has_svn_password = (Test-UsableValue $Values['SVN_PASSWORD'])
        has_svn_config_dir = (Test-UsableValue $Values['SVN_CONFIG_DIR'])
        has_svn_cmd = (Test-UsableValue $Values['SVN_CMD'])
        has_maven_cmd = (Test-UsableValue $Values['MAVEN_CMD'])
        has_maven_settings = (Test-UsableValue $Values['MAVEN_SETTINGS'])
        has_entity_generator_module = (Test-UsableValue $Values['ENTITY_GENERATOR_MODULE'])
        has_report_root = (Test-UsableValue $Values['REPORT_ROOT'])
    }
}

function Get-ExecutablePath {
    param([string]$Candidate)
    if (-not (Test-UsableValue $Candidate)) { return $null }
    $cmd = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        if (Test-UsableValue $cmd.Source) { return $cmd.Source }
        if (Test-UsableValue $cmd.Path) { return $cmd.Path }
        if (Test-UsableValue $cmd.Definition) { return $cmd.Definition }
    }
    $resolved = ConvertTo-ResolvedPathString $Candidate
    if (Test-Path -LiteralPath $resolved -PathType Leaf) { return $resolved }
    return $null
}

function Get-SvnCommand {
    param([hashtable]$EnvValues)
    foreach ($candidate in @($SvnCmd, $EnvValues['SVN_CMD'], 'svn')) {
        $path = Get-ExecutablePath $candidate
        if ($path) { return $path }
    }
    return $null
}

function Invoke-External {
    param(
        [string[]]$CommandArgs,
        [string]$WorkingDirectory,
        [string]$InputText
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $CommandArgs[0]
    $psi.Arguments = Join-CommandArguments ($CommandArgs | Select-Object -Skip 1)
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = ($null -ne $InputText)
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    if ($null -ne $InputText) {
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
    }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Join-CommandArguments {
    param([object[]]$Items)
    $quoted = @()
    foreach ($item in $Items) {
        $text = [string]$item
        if ($text.Length -eq 0) {
            $quoted += '""'
            continue
        }
        if ($text -notmatch '[\s"]') {
            $quoted += $text
            continue
        }
        $escaped = $text -replace '(\\*)"', '$1$1\"'
        $escaped = $escaped -replace '(\\+)$', '$1$1'
        $quoted += '"' + $escaped + '"'
    }
    return ($quoted -join ' ')
}

function Limit-Text {
    param([string]$Text, [int]$Max = 3000)
    if ($null -eq $Text) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max)
}

function Test-Workspace {
    param([string]$WorkspacePath, [string]$SvnCmd)
    if (-not (Test-Path -LiteralPath $WorkspacePath -PathType Container)) {
        return [ordered]@{ ok = $false; workspace = $WorkspacePath; reason = 'directory_missing' }
    }
    if (Test-Path -LiteralPath (Join-Path $WorkspacePath '.svn')) {
        return [ordered]@{ ok = $true; workspace = $WorkspacePath; method = '.svn' }
    }
    if ([string]::IsNullOrWhiteSpace($SvnCmd)) {
        return [ordered]@{ ok = $false; workspace = $WorkspacePath; reason = 'svn_not_found' }
    }
    $proc = Invoke-External -CommandArgs @($SvnCmd, 'info', '.') -WorkingDirectory $WorkspacePath
    if ($proc.ExitCode -eq 0) {
        return [ordered]@{ ok = $true; workspace = $WorkspacePath; method = 'svn_info' }
    }
    return [ordered]@{
        ok = $false
        workspace = $WorkspacePath
        reason = 'svn_info_failed'
        stderr = (Limit-Text $proc.Stderr)
    }
}

function Get-TimeRange {
    if (($Start -and -not $End) -or ($End -and -not $Start)) {
        Write-JsonResult 'config_error' @{ message = 'Start and End must be provided together.'; start = $Start; end = $End }
    }
    if ($Start -and $End) {
        try {
            $startDate = [datetime]::Parse($Start)
            $endDate = [datetime]::Parse($End)
        } catch {
            Write-JsonResult 'config_error' @{ message = 'Start and End must be valid datetimes.'; start = $Start; end = $End }
        }
        if ($startDate -gt $endDate) {
            Write-JsonResult 'config_error' @{ message = 'Start must be earlier than or equal to End.'; start = $Start; end = $End }
        }
        return [ordered]@{ start = $Start; end = $End; source = 'explicit' }
    }
    if ($BusinessDate) {
        $today = [datetime]::ParseExact($BusinessDate, 'yyyy-MM-dd', $null).Date
    } else {
        $today = (Get-Date).Date
    }
    $startTime = $today.AddDays(-1).AddHours(19)
    $endTime = $today.AddHours(18).AddMinutes(59).AddSeconds(59)
    return [ordered]@{
        start = $startTime.ToString('yyyy-MM-dd HH:mm:ss')
        end = $endTime.ToString('yyyy-MM-dd HH:mm:ss')
        source = 'default_business_day'
    }
}

function Resolve-EnvAndConfig {
    param([string]$WorkspacePath)
    $automationDir = Get-AutomationDir $WorkspacePath
    $envPath = if ($EnvFile) { Assert-PathWithin $EnvFile $automationDir 'env_file' } else { Get-DefaultEnvFile $WorkspacePath }
    $values = Read-EnvFile $envPath
    if (Test-UsableValue $values['SVN_CONFIG_DIR']) {
        $config = Assert-PathWithin $values['SVN_CONFIG_DIR'] $automationDir 'svn_config_dir'
    } elseif ($ConfigDir) {
        $config = Assert-PathWithin $ConfigDir $automationDir 'svn_config_dir'
    } else {
        $config = Get-DefaultConfigDir $WorkspacePath
    }
    return [pscustomobject]@{ EnvFile = $envPath; Values = $values; ConfigDir = $config }
}

function Test-Restricted {
    param([string]$WorkspacePath, [string]$EnvPath, [string]$ConfigPath)
    if ($Restricted -eq 'yes') { return $true }
    if ($Restricted -eq 'no') { return $false }
    if ((Test-Path -LiteralPath $EnvPath) -or (Test-Path -LiteralPath $ConfigPath)) { return $true }
    Write-JsonResult 'restricted_unresolved' @{
        workspace = $WorkspacePath
        env_file = $EnvPath
        env_file_exists = (Test-Path -LiteralPath $EnvPath)
        svn_config_dir = $ConfigPath
        svn_config_dir_exists = (Test-Path -LiteralPath $ConfigPath)
        message = 'Restricted mode cannot be inferred from missing workspace config. Agent must pass -Restricted yes or -Restricted no after judging the current environment.'
    }
}

function Get-SvnArgs {
    param([bool]$IsRestricted, [string]$ConfigPath)
    if (-not $IsRestricted) { return @() }
    return @('--non-interactive', '--no-auth-cache', '--config-dir', $ConfigPath)
}

function Get-SvnBootstrapArgs {
    param([bool]$IsRestricted, [string]$ConfigPath)
    if (-not $IsRestricted) { return @() }
    return @('--non-interactive', '--config-dir', $ConfigPath)
}

function Resolve-Maven {
    param([string]$WorkspacePath, [hashtable]$EnvValues)
    $cmd = $MavenCmd
    if (-not $cmd -and (Test-UsableValue $EnvValues['MAVEN_CMD'])) {
        $cmd = $EnvValues['MAVEN_CMD']
    }
    $detected = $false
    if (-not $cmd) {
        $found = Get-ExecutablePath 'mvn.cmd'
        if (-not $found) { $found = Get-ExecutablePath 'mvn' }
        if ($found) {
            $cmd = $found
            $detected = $true
        }
    } else {
        $cmd = Get-ExecutablePath $cmd
    }
    $settings = $MavenSettings
    if (-not $settings -and (Test-UsableValue $EnvValues['MAVEN_SETTINGS'])) {
        $settings = $EnvValues['MAVEN_SETTINGS']
    }
    if ($settings) {
        $settingsPath = ConvertTo-ResolvedPathString $settings
    } else {
        $settingsPath = Join-Path (Join-Path $WorkspacePath 'bokeerp') 'maven_settings.xml'
    }
    $module = $EntityModule
    if (-not $module -and (Test-UsableValue $EnvValues['ENTITY_GENERATOR_MODULE'])) {
        $module = $EnvValues['ENTITY_GENERATOR_MODULE']
    }
    if (-not $module) { $module = $DefaultEntityModule }
    $pomPath = Join-Path (Join-Path $WorkspacePath 'bokeerp') 'pom.xml'
    return [ordered]@{
        maven_cmd = $cmd
        maven_detected = $detected
        maven_found = [bool]$cmd
        maven_settings = $settingsPath
        maven_settings_exists = (Test-Path -LiteralPath $settingsPath)
        maven_pom = $pomPath
        maven_pom_exists = (Test-Path -LiteralPath $pomPath)
        entity_generator_module = $module
    }
}

function Invoke-SvnUpdateStep {
    param([string]$WorkspacePath, [string]$SvnCmd, [bool]$IsRestricted, [string]$ConfigPath)
    $proc = Invoke-External -CommandArgs (@($SvnCmd, 'update') + (Get-SvnArgs $IsRestricted $ConfigPath) + @('.')) -WorkingDirectory $WorkspacePath
    return [ordered]@{
        name = 'update'
        status = $(if ($proc.ExitCode -eq 0) { 'ok' } else { 'update_failed' })
        exit_code = $proc.ExitCode
        stdout = (Limit-Text $proc.Stdout)
        stderr = (Limit-Text $proc.Stderr)
    }
}

function Invoke-MavenBuildStep {
    param([string]$WorkspacePath, [hashtable]$EnvValues)
    $maven = Resolve-Maven $WorkspacePath $EnvValues
    if (-not $maven.maven_cmd) { return [ordered]@{ name = 'maven-build'; status = 'maven_not_found'; maven = $maven } }
    if (-not $maven.maven_settings_exists) { return [ordered]@{ name = 'maven-build'; status = 'maven_settings_missing'; maven = $maven } }
    if (-not $maven.maven_pom_exists) { return [ordered]@{ name = 'maven-build'; status = 'maven_pom_missing'; maven = $maven } }
    $args = @($maven.maven_cmd, '-s', $maven.maven_settings, '-f', $maven.maven_pom)
    if ($MavenArgs) { $args += $MavenArgs } else { $args += @('compile', '-DskipTests') }
    $proc = Invoke-External -CommandArgs $args -WorkingDirectory $WorkspacePath
    return [ordered]@{
        name = 'maven-build'
        status = $(if ($proc.ExitCode -eq 0) { 'ok' } else { 'maven_failed' })
        exit_code = $proc.ExitCode
        stdout = (Limit-Text $proc.Stdout)
        stderr = (Limit-Text $proc.Stderr)
        maven = $maven
    }
}

function Invoke-EntityGenerateStep {
    param([string]$WorkspacePath, [hashtable]$EnvValues)
    $maven = Resolve-Maven $WorkspacePath $EnvValues
    if (-not $maven.maven_cmd) { return [ordered]@{ name = 'entity-generate'; status = 'maven_not_found'; maven = $maven } }
    if (-not $maven.maven_settings_exists) { return [ordered]@{ name = 'entity-generate'; status = 'maven_settings_missing'; maven = $maven } }
    if (-not $maven.maven_pom_exists) { return [ordered]@{ name = 'entity-generate'; status = 'maven_pom_missing'; maven = $maven } }
    $args = @($maven.maven_cmd, '-s', $maven.maven_settings, '-f', $maven.maven_pom, '-pl', $maven.entity_generator_module)
    if ($MavenArgs) { $args += $MavenArgs } else { $args += 'package' }
    $proc = Invoke-External -CommandArgs $args -WorkingDirectory $WorkspacePath
    return [ordered]@{
        name = 'entity-generate'
        status = $(if ($proc.ExitCode -eq 0) { 'ok' } else { 'maven_failed' })
        exit_code = $proc.ExitCode
        stdout = (Limit-Text $proc.Stdout)
        stderr = (Limit-Text $proc.Stderr)
        maven = $maven
    }
}

function Split-Revisions {
    param([array]$Items)
    $reviewable = New-Object 'System.Collections.Generic.List[object]'
    $skipped = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $Items) {
        $message = [string]$item.message
        $normalizedMessage = $message -replace '\s+', ''
        $skip = $false
        foreach ($token in $SkipLogTokens) {
            if ($normalizedMessage.Contains($token)) { $skip = $true; break }
        }
        if ($skip) { [void]$skipped.Add($item) } else { [void]$reviewable.Add($item) }
    }
    return [pscustomobject]@{ Reviewable = $reviewable; Skipped = $skipped }
}

function Parse-SvnLogXml {
    param([string]$XmlText)
    [xml]$xml = $XmlText
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in $xml.log.logentry) {
        $item = [pscustomobject][ordered]@{
            revision = [string]$entry.revision
            author = [string]$entry.author
            date = [string]$entry.date
            message = [string]$entry.msg
        }
        [void]$items.Add($item)
    }
    return $items
}

function Ensure-WorkspaceArg {
    return Get-WorkspacePath
}

function Assert-Revision {
    param([string]$Revision)
    if ([string]::IsNullOrWhiteSpace($Revision) -or -not ($Revision -match '^\d+$')) {
        Write-JsonResult 'config_error' @{ message = 'Revision must be numeric.'; revision = $Revision }
    }
    return $Revision
}

function Assert-LeafFileName {
    param([string]$FileName)
    if ([string]::IsNullOrWhiteSpace($FileName)) {
        Write-JsonResult 'config_error' @{ message = 'Report file name must not be empty.' }
    }
    if ($FileName -ne [System.IO.Path]::GetFileName($FileName)) {
        Write-JsonResult 'path_out_of_scope' @{ purpose = 'report_name'; path = $FileName; message = 'Report file name must not contain a directory path.' }
    }
    return $FileName
}

function Assert-DatePart {
    param([string]$DateText)
    if ([string]::IsNullOrWhiteSpace($DateText) -or -not ($DateText -match '^\d{4}-\d{2}-\d{2}$')) {
        Write-JsonResult 'config_error' @{ message = 'ReportDate must use yyyy-MM-dd.'; report_date = $DateText }
    }
    return $DateText
}

function Get-RunId {
    return (Get-Date).ToString('yyyyMMdd-HHmmss')
}

try {
    if ($Command -eq 'env-template') {
        $workspacePath = Ensure-WorkspaceArg
        Write-Output (Get-EnvTemplate $workspacePath)
        exit 0
    }

    $workspacePath = Ensure-WorkspaceArg
    $resolved = Resolve-EnvAndConfig $workspacePath
    $isRestricted = Test-Restricted $workspacePath $resolved.EnvFile $resolved.ConfigDir

    switch ($Command) {
        'prepare' {
            $svn = Get-SvnCommand $resolved.Values
            $workspaceCheck = Test-Workspace $workspacePath $svn
            $time = Get-TimeRange
            $maven = Resolve-Maven $workspacePath $resolved.Values
            $envCanBootstrap = ((Test-Path -LiteralPath $resolved.EnvFile) -and (Test-UsableValue $resolved.Values['SVN_USERNAME']) -and (Test-UsableValue $resolved.Values['SVN_PASSWORD']))
            $needEnv = ($isRestricted -and -not (Test-Path -LiteralPath $resolved.ConfigDir) -and -not $envCanBootstrap)
            $prepareStatus = if ($needEnv) { 'need_env' } else { 'ok' }
            Write-JsonResult $prepareStatus @{
                workspace = $workspacePath
                workspace_check = $workspaceCheck
                time_range = $time
                restricted = $isRestricted
                svn_found = [bool]$svn
                svn_config_dir = $resolved.ConfigDir
                svn_config_dir_exists = (Test-Path -LiteralPath $resolved.ConfigDir)
                env_file = $resolved.EnvFile
                env_file_exists = (Test-Path -LiteralPath $resolved.EnvFile)
                env = (Get-EnvSummary $resolved.Values)
                need_env = $needEnv
                env_template = $(if ($needEnv) { Get-EnvTemplate $workspacePath } else { $null })
                maven = $maven
            }
        }
        'auth-check' {
            $svn = Get-SvnCommand $resolved.Values
            if (-not $svn) { Write-JsonResult 'svn_not_found' }
            $workspaceCheck = Test-Workspace $workspacePath $svn
            if (-not $workspaceCheck.ok) { Write-JsonResult 'workspace_invalid' @{ workspace_check = $workspaceCheck } }
            $envCanBootstrap = ((Test-Path -LiteralPath $resolved.EnvFile) -and (Test-UsableValue $resolved.Values['SVN_USERNAME']) -and (Test-UsableValue $resolved.Values['SVN_PASSWORD']))
            if ($isRestricted -and -not (Test-Path -LiteralPath $resolved.ConfigDir) -and -not $envCanBootstrap) {
                Write-JsonResult 'need_env' @{
                    env_file = $resolved.EnvFile
                    env_template = (Get-EnvTemplate $workspacePath)
                    message = 'Create the env file, then rerun auth-check.'
                }
            }
            if ($isRestricted) { New-Item -ItemType Directory -Force -Path $resolved.ConfigDir | Out-Null }
            $args = @($svn, 'log', '-l', '1') + (Get-SvnArgs $isRestricted $resolved.ConfigDir) + @('.')
            $first = Invoke-External -CommandArgs $args -WorkingDirectory $workspacePath
            if ($first.ExitCode -eq 0) {
                $secretsRemoved = $false
                if ($isRestricted -and $envCanBootstrap) {
                    $secretsRemoved = Remove-EnvSecrets $resolved.EnvFile
                }
                Write-JsonResult 'ok' @{
                    restricted = $isRestricted
                    svn_config_dir = $(if ($isRestricted) { $resolved.ConfigDir } else { $null })
                    env_file = $resolved.EnvFile
                    used_bootstrap = $false
                    env_secrets_removed = $secretsRemoved
                    stdout = (Limit-Text $first.Stdout)
                }
            }
            if (-not $isRestricted) {
                Write-JsonResult 'auth_failed' @{ restricted = $false; stderr = (Limit-Text $first.Stderr) }
            }
            if (-not (Test-Path -LiteralPath $resolved.EnvFile) -or -not (Test-UsableValue $resolved.Values['SVN_USERNAME']) -or -not (Test-UsableValue $resolved.Values['SVN_PASSWORD'])) {
                Write-JsonResult 'need_env' @{
                    env_file = $resolved.EnvFile
                    env_template = (Get-EnvTemplate $workspacePath)
                    first_error = (Limit-Text $first.Stderr)
                    message = 'Create the env file, then rerun auth-check.'
                }
            }
            if (Test-UsableValue $resolved.Values['SVN_CONFIG_DIR']) {
                $resolved.ConfigDir = Assert-PathWithin $resolved.Values['SVN_CONFIG_DIR'] (Get-AutomationDir $workspacePath) 'svn_config_dir'
                New-Item -ItemType Directory -Force -Path $resolved.ConfigDir | Out-Null
            }
            $bootArgs = @($svn, 'log', '-l', '1', '--username', $resolved.Values['SVN_USERNAME'], '--password-from-stdin') + (Get-SvnBootstrapArgs $true $resolved.ConfigDir) + @('.')
            $boot = Invoke-External -CommandArgs $bootArgs -WorkingDirectory $workspacePath -InputText $resolved.Values['SVN_PASSWORD']
            if ($boot.ExitCode -ne 0) {
                Write-JsonResult 'auth_failed' @{
                    restricted = $true
                    svn_config_dir = $resolved.ConfigDir
                    env_file = $resolved.EnvFile
                    used_bootstrap = $true
                    stderr = (Limit-Text $boot.Stderr)
                }
            }
            $verify = Invoke-External -CommandArgs (@($svn, 'log', '-l', '1') + (Get-SvnArgs $true $resolved.ConfigDir) + @('.')) -WorkingDirectory $workspacePath
            if ($verify.ExitCode -ne 0) {
                Write-JsonResult 'auth_failed' @{
                    restricted = $true
                    svn_config_dir = $resolved.ConfigDir
                    env_file = $resolved.EnvFile
                    used_bootstrap = $true
                    stderr = (Limit-Text $verify.Stderr)
                }
            }
            $secretsRemoved = Remove-EnvSecrets $resolved.EnvFile
            Write-JsonResult 'ok' @{
                restricted = $true
                svn_config_dir = $resolved.ConfigDir
                env_file = $resolved.EnvFile
                used_bootstrap = $true
                env_secrets_removed = $secretsRemoved
                stdout = (Limit-Text $verify.Stdout)
            }
        }
        'log' {
            $svn = Get-SvnCommand $resolved.Values
            if (-not $svn) { Write-JsonResult 'svn_not_found' }
            $time = Get-TimeRange
            $range = '{' + $time.start + '}:{' + $time.end + '}'
            $proc = Invoke-External -CommandArgs (@($svn, 'log', '--xml', '-r', $range) + (Get-SvnArgs $isRestricted $resolved.ConfigDir) + @('.')) -WorkingDirectory $workspacePath
            if ($proc.ExitCode -ne 0) {
                Write-JsonResult 'log_failed' @{ stderr = (Limit-Text $proc.Stderr); time_range = $time }
            }
            $revisions = Parse-SvnLogXml $proc.Stdout
            $split = Split-Revisions $revisions
            $logPayload = [pscustomobject][ordered]@{
                schema_version = 1
                generated_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                workspace = $workspacePath
                time_range = $time
                count = $revisions.Count
                reviewable_count = $split.Reviewable.Count
                skipped_count = $split.Skipped.Count
                revisions = $revisions
                reviewable_revisions = $split.Reviewable
                skipped_revisions = $split.Skipped
            }
            if ($Output) {
                $outputPath = Assert-PathWithin $Output $workspacePath 'log_output'
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
                $logPayload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding UTF8
            }
            Write-JsonResult 'ok' @{
                time_range = $time
                count = $revisions.Count
                reviewable_count = $split.Reviewable.Count
                skipped_count = $split.Skipped.Count
                revisions = $revisions
                reviewable_revisions = $split.Reviewable
                skipped_revisions = $split.Skipped
                output = $Output
            }
        }
        'diff' {
            $svn = Get-SvnCommand $resolved.Values
            if (-not $svn) { Write-JsonResult 'svn_not_found' }
            if (-not $Revisions -or $Revisions.Count -eq 0) { Write-JsonResult 'config_error' @{ message = 'Revisions are required.' } }
            $today = (Get-Date).ToString('yyyy-MM-dd')
            $defaultDiffRoot = Join-Path (Join-Path (Join-Path (Get-DefaultReportRoot $workspacePath) $today) ('run-' + (Get-RunId))) 'diffs'
            $outDir = if ($OutputDir) { Assert-PathWithin $OutputDir $workspacePath 'diff_output_dir' } else { $defaultDiffRoot }
            New-Item -ItemType Directory -Force -Path $outDir | Out-Null
            $diffs = New-Object 'System.Collections.Generic.List[object]'
            $missing = New-Object 'System.Collections.Generic.List[object]'
            foreach ($revText in $Revisions) {
                foreach ($rev in ($revText -replace ',', ' ').Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
                    $clean = Assert-Revision ($rev.Trim().TrimStart('r'))
                    $file = Join-Path $outDir ('r' + $clean + '.diff')
                    $proc = Invoke-External -CommandArgs (@($svn, 'diff', '-c', $clean) + (Get-SvnArgs $isRestricted $resolved.ConfigDir) + @('.')) -WorkingDirectory $workspacePath
                    if ($proc.ExitCode -eq 0) {
                        Set-Content -LiteralPath $file -Encoding UTF8 -Value $proc.Stdout
                        [void]$diffs.Add([pscustomobject][ordered]@{ revision = $clean; file = $file; bytes = ([Text.Encoding]::UTF8.GetByteCount($proc.Stdout)) })
                    } else {
                        [void]$missing.Add([pscustomobject][ordered]@{ revision = $clean; stderr = (Limit-Text $proc.Stderr) })
                    }
                }
            }
            $status = if ($missing.Count -eq 0) { 'ok' } else { 'diff_failed' }
            $manifest = [ordered]@{
                status = $status
                workspace = $workspacePath
                output_dir = $outDir
                diffs = $diffs
                missing = $missing
                partial = ($missing.Count -gt 0)
            }
            $manifestPath = Join-Path $outDir 'manifest.json'
            $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
            Write-JsonResult $status @{
                manifest = $manifestPath
                workspace = $workspacePath
                output_dir = $outDir
                diffs = $diffs
                missing = $missing
                partial = ($missing.Count -gt 0)
            }
        }
        'update' {
            $svn = Get-SvnCommand $resolved.Values
            if (-not $svn) { Write-JsonResult 'svn_not_found' }
            $step = Invoke-SvnUpdateStep $workspacePath $svn $isRestricted $resolved.ConfigDir
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ step = $step } }
            Write-JsonResult 'ok' @{ step = $step; stdout = $step.stdout }
        }
        'maven-config' {
            Write-JsonResult 'ok' @{ env_file = $resolved.EnvFile; maven = (Resolve-Maven $workspacePath $resolved.Values) }
        }
        'maven-build' {
            $step = Invoke-MavenBuildStep $workspacePath $resolved.Values
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ step = $step; maven = $step.maven } }
            Write-JsonResult 'ok' @{ step = $step; stdout = $step.stdout; maven = $step.maven }
        }
        'entity-generate' {
            $step = Invoke-EntityGenerateStep $workspacePath $resolved.Values
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ step = $step; maven = $step.maven } }
            Write-JsonResult 'ok' @{ step = $step; stdout = $step.stdout; maven = $step.maven }
        }
        'post-log-prep' {
            $svn = Get-SvnCommand $resolved.Values
            if (-not $svn) { Write-JsonResult 'svn_not_found' }
            $steps = New-Object 'System.Collections.Generic.List[object]'
            $step = Invoke-SvnUpdateStep $workspacePath $svn $isRestricted $resolved.ConfigDir
            [void]$steps.Add([pscustomobject]$step)
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ steps = $steps; failed_step = $step.name } }
            $step = Invoke-EntityGenerateStep $workspacePath $resolved.Values
            [void]$steps.Add([pscustomobject]$step)
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ steps = $steps; failed_step = $step.name; maven = $step.maven } }
            $step = Invoke-MavenBuildStep $workspacePath $resolved.Values
            [void]$steps.Add([pscustomobject]$step)
            if ($step.status -ne 'ok') { Write-JsonResult $step.status @{ steps = $steps; failed_step = $step.name; maven = $step.maven } }
            Write-JsonResult 'ok' @{ steps = $steps }
        }
        'report-path' {
            $root = if ($ReportRoot) { Assert-PathWithin $ReportRoot $workspacePath 'report_root' } elseif (Test-UsableValue $resolved.Values['REPORT_ROOT']) { Assert-PathWithin $resolved.Values['REPORT_ROOT'] $workspacePath 'report_root' } else { Get-DefaultReportRoot $workspacePath }
            $datePart = if ($ReportDate) { Assert-DatePart $ReportDate } else { (Get-Date).ToString('yyyy-MM-dd') }
            $runId = Get-RunId
            $dir = Join-Path (Join-Path $root $datePart) ('run-' + $runId)
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            $fileName = if ($Name) { Assert-LeafFileName $Name } else { 'svn' + $ReviewText + $LogText + '-' + $runId + '.md' }
            $file = Join-Path $dir $fileName
            if (Test-Path -LiteralPath $file) {
                $base = [IO.Path]::GetFileNameWithoutExtension($fileName)
                $ext = [IO.Path]::GetExtension($fileName)
                $file = Join-Path $dir ($base + '-' + (Get-Date).ToString('HHmmss') + $ext)
            }
            Write-JsonResult 'ok' @{ report_dir = $dir; report_file = $file }
        }
    }
} catch {
    Write-JsonResult 'config_error' @{ message = $_.Exception.Message }
}
