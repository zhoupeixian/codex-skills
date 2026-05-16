#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.log(`Usage:
  node scripts/localize-codex-skills.mjs extract --out <pack.json> [--root <skills-dir> ...]
  node scripts/localize-codex-skills.mjs apply --pack <pack.json> [--backup-dir <dir>]
  node scripts/localize-codex-skills.mjs apply --pack <pack.json> --allow-high-risk [--backup-dir <dir>]
  node scripts/localize-codex-skills.mjs verify --pack <pack.json>
  node scripts/localize-codex-skills.mjs report --pack <pack.json> [--out <report.md>] [--verify]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) return { command: null, options: {} };
  const options = { root: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (key === 'allow-high-risk' || key === 'verify') {
      options[key] = true;
      continue;
    }
    if (key === 'root') {
      if (!next || next.startsWith('--')) throw new Error('--root requires a value');
      options.root.push(next);
      i += 1;
      continue;
    }
    if (!next || next.startsWith('--')) throw new Error(`--${key} requires a value`);
    options[key] = next;
    i += 1;
  }
  return { command, options };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function detectNewline(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function unquote(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      if (trimmed.startsWith('"')) {
        return JSON.parse(trimmed);
      }
    } catch {}
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quote(value) {
  return JSON.stringify(value);
}

function parseFrontmatter(content) {
  const lines = splitLines(content);
  if (lines[0] !== '---') return null;
  const endIndex = lines.indexOf('---', 1);
  if (endIndex === -1) return null;
  return {
    lines,
    frontmatterLines: lines.slice(1, endIndex),
    bodyLines: lines.slice(endIndex + 1),
    newline: detectNewline(content),
  };
}

function readTopLevelField(frontmatterLines, fieldName) {
  const prefix = `${fieldName}:`;
  for (let i = 0; i < frontmatterLines.length; i += 1) {
    const line = frontmatterLines[i];
    if (!line.startsWith(prefix)) continue;
    const raw = line.slice(prefix.length).trim();
    if (raw.startsWith('|') || raw.startsWith('>')) {
      const collected = [];
      let j = i + 1;
      while (j < frontmatterLines.length) {
        const next = frontmatterLines[j];
        if (next.startsWith(' ') || next === '') {
          collected.push(next.startsWith('  ') ? next.slice(2) : next.trimStart());
          j += 1;
          continue;
        }
        break;
      }
      return collected.join('\n').trim();
    }
    return unquote(raw);
  }
  return null;
}

function readNestedField(frontmatterLines, parentKey, childKey) {
  const parentPrefix = `${parentKey}:`;
  for (let i = 0; i < frontmatterLines.length; i += 1) {
    if (!frontmatterLines[i].startsWith(parentPrefix)) continue;
    let j = i + 1;
    while (j < frontmatterLines.length) {
      const line = frontmatterLines[j];
      if (!line.startsWith(' ')) break;
      const trimmed = line.trimStart();
      const childPrefix = `${childKey}:`;
      if (trimmed.startsWith(childPrefix)) {
        return unquote(trimmed.slice(childPrefix.length).trim());
      }
      j += 1;
    }
    break;
  }
  return null;
}

function parseOpenAiYaml(content) {
  const lines = splitLines(content);
  const result = {};
  const blockIndex = lines.findIndex((line) => /^interface:\s*$/.test(line));
  if (blockIndex === -1) return result;
  for (let i = blockIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && !line.startsWith(' ')) break;
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = unquote(match[2]);
  }
  return result;
}

function parsePluginJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function updatePluginJsonInterface(content, updates) {
  const data = JSON.parse(content);
  data.interface = data.interface || {};
  for (const [key, value] of Object.entries(updates)) {
    data.interface[key] = value;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

function upsertTopLevelFieldInFrontmatter(content, fieldName, value) {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return `---\n${fieldName}: ${quote(value)}\n---\n${content}`;
  }
  const { frontmatterLines, bodyLines, newline } = parsed;
  const prefix = `${fieldName}:`;
  let replaced = false;
  const updatedFrontmatter = [];

  for (let i = 0; i < frontmatterLines.length; i += 1) {
    const line = frontmatterLines[i];
    if (!replaced && line.startsWith(prefix)) {
      updatedFrontmatter.push(`${fieldName}: ${quote(value)}`);
      replaced = true;

      const raw = line.slice(prefix.length).trim();
      if (raw.startsWith('|') || raw.startsWith('>')) {
        i += 1;
        while (i < frontmatterLines.length) {
          const next = frontmatterLines[i];
          if (next.startsWith(' ') || next === '') {
            i += 1;
            continue;
          }
          i -= 1;
          break;
        }
      }
      continue;
    }
    updatedFrontmatter.push(line);
  }

  if (!replaced) {
    updatedFrontmatter.push(`${fieldName}: ${quote(value)}`);
  }

  return ['---', ...updatedFrontmatter, '---', ...bodyLines].join(newline);
}

function upsertInterfaceField(content, fieldName, value) {
  const newline = detectNewline(content);
  const lines = splitLines(content);
  const replacement = `  ${fieldName}: ${quote(value)}`;
  let blockIndex = lines.findIndex((line) => /^interface:\s*$/.test(line));
  if (blockIndex === -1) {
    const suffix = lines.length && lines[lines.length - 1] !== '' ? newline : '';
    return `${content}${suffix}interface:${newline}${replacement}${newline}`;
  }
  let blockEnd = blockIndex + 1;
  while (blockEnd < lines.length && (lines[blockEnd] === '' || lines[blockEnd].startsWith(' '))) {
    blockEnd += 1;
  }
  for (let i = blockIndex + 1; i < blockEnd; i += 1) {
    if (new RegExp(`^\\s{2}${fieldName}:`).test(lines[i])) {
      lines[i] = replacement;
      return lines.join(newline);
    }
  }
  lines.splice(blockEnd, 0, replacement);
  return lines.join(newline);
}

function readPromptTemplateField(content, fieldName) {
  const lines = splitLines(content);
  const prefix = `${fieldName}:`;
  let inCodeBlock = false;
  let inPromptTool = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '```') {
      inCodeBlock = !inCodeBlock;
      inPromptTool = false;
      continue;
    }
    if (!inCodeBlock) continue;
    if (/Task tool/i.test(line)) {
      inPromptTool = true;
      continue;
    }
    if (!inPromptTool) continue;
    const body = line.trimStart();
    if (body.startsWith(prefix)) {
      return unquote(body.slice(prefix.length).trim());
    }
  }
  return null;
}

function upsertPromptTemplateField(content, fieldName, value) {
  const newline = detectNewline(content);
  const lines = splitLines(content);
  const replacement = `  ${fieldName}: ${quote(value)}`;
  let inCodeBlock = false;
  let inPromptTool = false;
  let toolStart = -1;
  let toolEnd = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '```') {
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock && inPromptTool && toolEnd === -1) {
        toolEnd = i;
      }
      continue;
    }
    if (!inCodeBlock) continue;
    if (/Task tool/i.test(lines[i])) {
      inPromptTool = true;
      toolStart = i;
      continue;
    }
    if (!inPromptTool) continue;
    const body = lines[i].trimStart();
    if (body.startsWith(`${fieldName}:`)) {
      lines[i] = replacement;
      return lines.join(newline);
    }
  }
  if (toolStart === -1 || toolEnd === -1) return content;
  lines.splice(toolEnd, 0, replacement);
  return lines.join(newline);
}

async function walk(dir, visitor) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, visitor);
    } else {
      await visitor(full);
    }
  }
}

async function newestChildDirs(baseDir) {
  if (!(await exists(baseDir))) return [];
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parent = path.join(baseDir, entry.name);
    const children = (await fs.readdir(parent, { withFileTypes: true }))
      .filter((child) => child.isDirectory())
      .map((child) => path.join(parent, child.name));
    if (!children.length) {
      roots.push(parent);
      continue;
    }
    const ranked = [];
    for (const child of children) {
      const stats = await fs.stat(child);
      ranked.push({ child, mtimeMs: stats.mtimeMs });
    }
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || a.child.localeCompare(b.child));
    roots.push(ranked[0].child);
  }
  return roots;
}

async function bundledRoots(baseDir) {
  if (!(await exists(baseDir))) return [];
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name));
}

async function pluginShadowRoots(baseDir) {
  if (!(await exists(baseDir))) return [];
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name, 'skills'));
}

function classifySource(skillFile) {
  const normalized = skillFile.toLowerCase();
  if (normalized.includes('\\.codex\\.tmp\\plugins\\plugins\\')) return 'plugin-runtime-shadow';
  if (normalized.includes('\\.codex\\.tmp\\bundled-marketplaces\\')) return 'plugin-bundled-shadow';
  if (normalized.includes('\\.codex\\plugins\\cache\\openai-curated\\')) return 'plugin-curated';
  if (normalized.includes('\\.codex\\plugins\\cache\\openai-primary-runtime\\')) return 'plugin-runtime';
  if (normalized.includes('\\.codex\\plugins\\cache\\openai-bundled\\')) return 'plugin-bundled';
  if (normalized.includes('\\.codex\\superpowers\\skills\\')) return 'plugin-user-overlay';
  if (normalized.includes('\\.agents\\skills\\')) return 'agent-skill';
  return 'user-skill';
}

function packItemId(skillFile) {
  return `skill-ui::${skillFile}`;
}

function classifyPromptSource(promptFile) {
  const normalized = promptFile.toLowerCase();
  if (normalized.includes('\\.codex\\superpowers\\skills\\')) return 'prompt-template';
  if (normalized.includes('\\.codex\\.tmp\\plugins\\plugins\\superpowers\\skills\\')) return 'prompt-template-shadow';
  if (normalized.includes('\\.codex\\plugins\\cache\\openai-curated\\superpowers\\')) return 'prompt-template-curated';
  if (normalized.includes('\\.codex\\prompts\\')) return 'prompt-role';
  return 'prompt';
}

function promptPackItemId(promptFile) {
  return `prompt-ui::${promptFile}`;
}

async function discoverSkillFiles(customRoots) {
  if (customRoots.length) {
    const discovered = [];
    for (const root of customRoots) {
      if (!(await exists(root))) continue;
      await walk(root, async (file) => {
        if (path.basename(file) === 'SKILL.md') discovered.push(file);
      });
    }
    return discovered.sort((a, b) => a.localeCompare(b));
  }

  const userProfile = process.env.USERPROFILE;
  if (!userProfile) throw new Error('USERPROFILE is not set');
  const codexHome = path.join(userProfile, '.codex');
  const agentsHome = path.join(userProfile, '.agents');
  const defaultRoots = [
    path.join(codexHome, 'skills'),
    path.join(codexHome, 'superpowers', 'skills'),
    path.join(agentsHome, 'skills'),
    ...(await newestChildDirs(path.join(codexHome, 'plugins', 'cache', 'openai-curated'))),
    ...(await newestChildDirs(path.join(codexHome, 'plugins', 'cache', 'openai-primary-runtime'))),
    ...(await bundledRoots(path.join(codexHome, 'plugins', 'cache', 'openai-bundled'))),
    ...(await pluginShadowRoots(path.join(codexHome, '.tmp', 'plugins', 'plugins'))),
    ...(await pluginShadowRoots(path.join(codexHome, '.tmp', 'bundled-marketplaces', 'openai-bundled', 'plugins'))),
  ];

  const dedupedRoots = [...new Set(defaultRoots)];
  const discovered = [];
  for (const root of dedupedRoots) {
    if (!(await exists(root))) continue;
    await walk(root, async (file) => {
      if (path.basename(file) === 'SKILL.md') discovered.push(file);
    });
  }
  return discovered.sort((a, b) => a.localeCompare(b));
}

async function discoverPromptFiles() {
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) throw new Error('USERPROFILE is not set');
  const promptsDir = path.join(userProfile, '.codex', 'prompts');
  if (!(await exists(promptsDir))) return [];
  const entries = await fs.readdir(promptsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(promptsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function discoverPromptTemplateFiles() {
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) throw new Error('USERPROFILE is not set');
  const codexHome = path.join(userProfile, '.codex');
  const defaultRoots = [
    path.join(codexHome, 'superpowers', 'skills'),
    ...(await newestChildDirs(path.join(codexHome, 'plugins', 'cache', 'openai-curated', 'superpowers'))),
    path.join(codexHome, '.tmp', 'plugins', 'plugins', 'superpowers', 'skills'),
  ];

  const dedupedRoots = [...new Set(defaultRoots)];
  const discovered = [];
  for (const root of dedupedRoots) {
    if (!(await exists(root))) continue;
    await walk(root, async (file) => {
      if (path.basename(file).endsWith('-prompt.md')) discovered.push(file);
    });
  }
  return discovered.sort((a, b) => a.localeCompare(b));
}

function resolveSkillTarget(skillFile, uiFile) {
  const normalized = skillFile.toLowerCase();

  if (normalized.includes('\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled\\plugins\\')) {
    const pluginRoot = skillFile.slice(0, normalized.indexOf('\\skills\\'));
    const pluginJson = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
    return {
      targetFile: pluginJson,
      targetField: 'plugin.json.interface.longDescription',
      displayField: 'plugin.json.interface.longDescription',
    };
  }

  if (
    normalized.includes('\\.codex\\superpowers\\skills\\') ||
    normalized.includes('\\.codex\\.tmp\\plugins\\plugins\\superpowers\\skills\\') ||
    normalized.includes('\\.codex\\plugins\\cache\\openai-curated\\superpowers\\')
  ) {
    return {
      targetFile: skillFile,
      targetField: 'SKILL.md.description',
      displayField: 'SKILL.md.description',
    };
  }

  return {
    targetFile: uiFile,
    targetField: 'agents/openai.yaml.interface.short_description',
    displayField: 'agents/openai.yaml.interface.short_description',
  };
}

async function buildPack(customRoots) {
  const skillFiles = await discoverSkillFiles(customRoots);
  const items = [];
  for (const skillFile of skillFiles) {
    const raw = await fs.readFile(skillFile, 'utf8');
    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter) continue;
    const name = readTopLevelField(frontmatter.frontmatterLines, 'name');
    const description = readTopLevelField(frontmatter.frontmatterLines, 'description');
    if (!name || !description) continue;
    const shortFromMetadata = readNestedField(frontmatter.frontmatterLines, 'metadata', 'short-description');
    const skillDir = path.dirname(skillFile);
    const uiFile = path.join(skillDir, 'agents', 'openai.yaml');
    const target = resolveSkillTarget(skillFile, uiFile);
    let currentUi = null;
    if (await exists(uiFile)) {
      currentUi = parseOpenAiYaml(await fs.readFile(uiFile, 'utf8'));
    }
    let visibleCurrent = null;
    if (target.targetFile && await exists(target.targetFile)) {
      const targetRaw = await fs.readFile(target.targetFile, 'utf8');
      if (target.targetField === 'plugin.json.interface.longDescription') {
        visibleCurrent = parsePluginJson(targetRaw)?.interface?.longDescription ?? null;
      } else if (target.targetField === 'SKILL.md.description') {
        const parsed = parseFrontmatter(targetRaw);
        visibleCurrent = parsed ? readTopLevelField(parsed.frontmatterLines, 'description') : null;
      } else {
        visibleCurrent = parseOpenAiYaml(targetRaw).short_description ?? null;
      }
    }
    items.push({
      id: packItemId(skillFile),
      name,
      sourceFamily: classifySource(skillFile),
      skillFile,
      uiFile,
      targetFile: target.targetFile,
      sourceField: visibleCurrent
        ? target.displayField
        : currentUi?.short_description
        ? 'agents/openai.yaml.interface.short_description'
        : shortFromMetadata
          ? 'SKILL.md.metadata.short-description'
          : 'SKILL.md.description',
      targetField: target.targetField,
      original: visibleCurrent || currentUi?.short_description || shortFromMetadata || description,
      translation: '',
      risk: target.targetField === 'SKILL.md.description' ? 'high' : 'low',
    });
  }

  const promptFiles = await discoverPromptFiles();
  for (const promptFile of promptFiles) {
    const raw = await fs.readFile(promptFile, 'utf8');
    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter) continue;
    const description = readTopLevelField(frontmatter.frontmatterLines, 'description');
    if (!description) continue;
    items.push({
      id: promptPackItemId(promptFile),
      name: `prompts:${path.basename(promptFile, '.md')}`,
      sourceFamily: classifyPromptSource(promptFile),
      skillFile: promptFile,
      uiFile: promptFile,
      targetFile: promptFile,
      sourceField: 'prompt.frontmatter.description',
      targetField: 'prompt.frontmatter.description',
      original: description,
      translation: '',
      risk: 'high',
    });
  }

  const promptTemplateFiles = await discoverPromptTemplateFiles();
  for (const promptFile of promptTemplateFiles) {
    const raw = await fs.readFile(promptFile, 'utf8');
    const description = readPromptTemplateField(raw, 'description');
    if (!description) continue;
    const argumentHint = readPromptTemplateField(raw, 'argument-hint');
    items.push({
      id: `${promptPackItemId(promptFile)}::task-description`,
      name: path.basename(promptFile, '.md'),
      sourceFamily: classifyPromptSource(promptFile),
      skillFile: promptFile,
      uiFile: promptFile,
      targetFile: promptFile,
      sourceField: 'prompt-template.task.description',
      targetField: 'prompt-template.task.description',
      original: description,
      translation: '',
      risk: 'high',
    });
    if (argumentHint) {
      items.push({
        id: `${promptPackItemId(promptFile)}::task-argument-hint`,
        name: path.basename(promptFile, '.md'),
        sourceFamily: classifyPromptSource(promptFile),
        skillFile: promptFile,
        uiFile: promptFile,
        targetFile: promptFile,
        sourceField: 'prompt-template.task.argument-hint',
        targetField: 'prompt-template.task.argument-hint',
        original: argumentHint,
        translation: '',
        risk: 'high',
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    strategy: 'ui-shadow-plus-prompt-audit',
    itemCount: items.length,
    items,
  };
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

async function extractCommand(options) {
  if (!options.out) throw new Error('extract requires --out');
  const pack = await buildPack(options.root);
  await writeJson(path.resolve(options.out), pack);
  console.log(`Extracted ${pack.itemCount} skills to ${path.resolve(options.out)}`);
}

function buildBackupFolder(packPath, explicitBackupDir) {
  if (explicitBackupDir) return path.resolve(explicitBackupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(path.resolve(packPath)), 'backups', stamp);
}

async function createRollbackArtifacts(backupDir, manifest) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  await writeJson(manifestPath, manifest);
  const rollbackScript = `param()

$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

foreach ($entry in $manifest.files) {
  $target = $entry.path
  if ($entry.existed) {
    $source = Join-Path $PSScriptRoot $entry.backupRelativePath
    $content = Get-Content -Raw -LiteralPath $source -Encoding UTF8
    $directory = Split-Path -Parent $target
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($target, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Restored $target"
  } else {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
      Write-Host "Removed $target"
    }
  }
}
`;
  await fs.writeFile(path.join(backupDir, 'rollback.ps1'), rollbackScript, 'utf8');
}

async function applyCommand(options) {
  if (!options.pack) throw new Error('apply requires --pack');
  const packPath = path.resolve(options.pack);
  const pack = JSON.parse(await fs.readFile(packPath, 'utf8'));
  const actionable = pack.items.filter(
    (item) => typeof item.translation === 'string' && item.translation.trim().length > 0,
  );
  if (!actionable.length) {
    console.log('No translated items to apply.');
    return;
  }
  const highRisk = actionable.filter((item) => item.risk === 'high');
  if (highRisk.length && !options['allow-high-risk']) {
    throw new Error(`High-risk items present (${highRisk.length}). Re-run with --allow-high-risk after explicit approval.`);
  }

  const backupDir = buildBackupFolder(packPath, options['backup-dir']);
  const filesDir = path.join(backupDir, 'files');
  await fs.mkdir(filesDir, { recursive: true });

  const fileState = new Map();
  for (const item of actionable) {
    const targetFile = item.targetFile || item.uiFile;
    if (fileState.has(targetFile)) continue;
    const existed = await exists(targetFile);
    const content = existed ? await fs.readFile(targetFile, 'utf8') : '';
    fileState.set(targetFile, { existed, content });
  }

  const manifestFiles = [];
  for (const [targetFile, state] of fileState.entries()) {
    const hash = crypto.createHash('sha1').update(targetFile).digest('hex');
    const backupRelativePath = path.join('files', `${hash}.txt`);
    const backupAbsolutePath = path.join(backupDir, backupRelativePath);
    await fs.writeFile(backupAbsolutePath, state.content, 'utf8');
    manifestFiles.push({
      path: targetFile,
      existed: state.existed,
      backupRelativePath,
    });
  }

  const grouped = new Map();
  for (const item of actionable) {
    const targetFile = item.targetFile || item.uiFile;
    if (!grouped.has(targetFile)) grouped.set(targetFile, []);
    grouped.get(targetFile).push(item);
  }

  let changedFiles = 0;
  for (const [targetFile, items] of grouped.entries()) {
    const state = fileState.get(targetFile);
    let updated = state.content;
    for (const item of items) {
      if (item.targetField === 'prompt.frontmatter.description') {
        updated = upsertTopLevelFieldInFrontmatter(updated, 'description', item.translation.trim());
      } else if (item.targetField === 'prompt.frontmatter.argument-hint') {
        updated = upsertTopLevelFieldInFrontmatter(updated, 'argument-hint', item.translation.trim());
      } else if (item.targetField === 'prompt-template.task.description') {
        updated = upsertPromptTemplateField(updated, 'description', item.translation.trim());
      } else if (item.targetField === 'prompt-template.task.argument-hint') {
        updated = upsertPromptTemplateField(updated, 'argument-hint', item.translation.trim());
      } else if (item.targetField === 'SKILL.md.description') {
        updated = upsertTopLevelFieldInFrontmatter(updated, 'description', item.translation.trim());
      } else if (item.targetField === 'plugin.json.interface.longDescription') {
        updated = updatePluginJsonInterface(updated, {
          longDescription: item.translation.trim(),
          shortDescription: item.translation.trim(),
        });
      } else {
        updated = upsertInterfaceField(updated, 'short_description', item.translation.trim());
      }
    }
    if (updated !== state.content) {
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, updated, 'utf8');
      changedFiles += 1;
    }
  }

  await createRollbackArtifacts(backupDir, {
    createdAt: new Date().toISOString(),
    packPath,
    files: manifestFiles,
  });

  console.log(`Applied ${actionable.length} translations across ${changedFiles} files.`);
  console.log(`Backup: ${backupDir}`);
  console.log(`Rollback: ${path.join(backupDir, 'rollback.ps1')}`);
}

async function verifyCommand(options) {
  if (!options.pack) throw new Error('verify requires --pack');
  const pack = JSON.parse(await fs.readFile(path.resolve(options.pack), 'utf8'));
  const result = await verifyPack(pack);

  console.log(`Verified: ${result.ok}`);
  console.log(`Missing translations: ${result.missingTranslation}`);
  console.log(`Mismatches: ${result.mismatch}`);
  if (result.problems.length) {
    for (const problem of result.problems.slice(0, 20)) {
      console.log(`- ${problem}`);
    }
  }
  if (result.mismatch > 0) {
    process.exitCode = 1;
  }
}

async function verifyPack(pack) {
  let ok = 0;
  let missingTranslation = 0;
  let mismatch = 0;
  const problems = [];
  const rows = [];

  for (const item of pack.items) {
    const translation = typeof item.translation === 'string' ? item.translation.trim() : '';
    if (!translation) {
      missingTranslation += 1;
      rows.push({
        name: item.name,
        sourceFamily: item.sourceFamily,
        skillFile: item.skillFile,
        uiFile: item.uiFile,
        sourceField: item.sourceField,
        targetField: item.targetField || 'agents/openai.yaml.interface.short_description',
        original: item.original,
        translation: '',
        currentUi: '',
        status: 'missing-translation',
        note: 'translation field is empty',
      });
      continue;
    }
    const targetFile = item.targetFile || item.uiFile;
    if (!(await exists(targetFile))) {
      mismatch += 1;
      const note = `missing ${targetFile}`;
      problems.push(`${item.name}: ${note}`);
      rows.push({
        name: item.name,
        sourceFamily: item.sourceFamily,
        skillFile: item.skillFile,
        uiFile: targetFile,
        sourceField: item.sourceField,
        targetField: item.targetField || 'agents/openai.yaml.interface.short_description',
        original: item.original,
        translation,
        currentUi: '',
        status: 'mismatch',
        note,
      });
      continue;
    }
    const targetText = await fs.readFile(targetFile, 'utf8');
    const currentValue = item.targetField === 'prompt.frontmatter.description'
      ? readTopLevelField(parseFrontmatter(targetText)?.frontmatterLines || [], 'description')
      : item.targetField === 'prompt.frontmatter.argument-hint'
        ? readTopLevelField(parseFrontmatter(targetText)?.frontmatterLines || [], 'argument-hint')
      : item.targetField === 'prompt-template.task.description'
        ? readPromptTemplateField(targetText, 'description')
      : item.targetField === 'prompt-template.task.argument-hint'
        ? readPromptTemplateField(targetText, 'argument-hint')
      : item.targetField === 'SKILL.md.description'
        ? readTopLevelField(parseFrontmatter(targetText)?.frontmatterLines || [], 'description')
      : item.targetField === 'plugin.json.interface.longDescription'
        ? parsePluginJson(targetText)?.interface?.longDescription
      : item.targetField === 'plugin.json.interface.shortDescription'
        ? parsePluginJson(targetText)?.interface?.shortDescription
      : parseOpenAiYaml(targetText).short_description;
    if (currentValue !== translation) {
      mismatch += 1;
      const note = `expected "${translation}" but found "${currentValue ?? ''}"`;
      problems.push(`${item.name}: ${note}`);
      rows.push({
        name: item.name,
        sourceFamily: item.sourceFamily,
        skillFile: item.skillFile,
        uiFile: targetFile,
        sourceField: item.sourceField,
        targetField: item.targetField || 'agents/openai.yaml.interface.short_description',
        original: item.original,
        translation,
        currentUi: currentValue ?? '',
        status: 'mismatch',
        note,
      });
      continue;
    }
    ok += 1;
    rows.push({
      name: item.name,
      sourceFamily: item.sourceFamily,
      skillFile: item.skillFile,
      uiFile: targetFile,
      sourceField: item.sourceField,
      targetField: item.targetField || 'agents/openai.yaml.interface.short_description',
      original: item.original,
      translation,
      currentUi: currentValue ?? '',
      status: 'verified',
      note: '',
    });
  }

  return { ok, missingTranslation, mismatch, problems, rows };
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function defaultReportPath(packPath) {
  const parsed = path.parse(path.resolve(packPath));
  return path.join(parsed.dir, `${parsed.name}.audit.md`);
}

function summarizeBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const label = item[key] ?? '';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function buildAuditReport({ packPath, pack, verification }) {
  const lines = [];
  lines.push('# Localize Codex Skills Audit Report');
  lines.push('');
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Pack: \`${path.resolve(packPath)}\``);
  lines.push(`- Strategy: \`${pack.strategy}\``);
  lines.push(`- Item count: ${pack.itemCount}`);
  lines.push(`- Verified: ${verification.ok}`);
  lines.push(`- Missing translations: ${verification.missingTranslation}`);
  lines.push(`- Mismatches: ${verification.mismatch}`);
  lines.push('');
  lines.push('## Scan Summary');
  lines.push('');
  lines.push('| Source family | Count |');
  lines.push('| --- | ---: |');
  for (const [family, count] of summarizeBy(pack.items, 'sourceFamily')) {
    lines.push(`| ${escapeCell(family)} | ${count} |`);
  }
  lines.push('');
  lines.push('## Verification Summary');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('| --- | ---: |');
  for (const [status, count] of summarizeBy(verification.rows, 'status')) {
    lines.push(`| ${escapeCell(status)} | ${count} |`);
  }
  lines.push('');
  lines.push('## Bilingual Audit Table');
  lines.push('');
  lines.push('| # | Skill | Family | Source field | Target field | Original | Translation | Current text | Status | Note |');
  lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  verification.rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${escapeCell(row.name)} | ${escapeCell(row.sourceFamily)} | ${escapeCell(row.sourceField)} | ${escapeCell(row.targetField)} | ${escapeCell(row.original)} | ${escapeCell(row.translation)} | ${escapeCell(row.currentUi)} | ${escapeCell(row.status)} | ${escapeCell(row.note)} |`,
    );
  });
  lines.push('');
  lines.push('## File Inventory');
  lines.push('');
  lines.push('| Skill | Skill file | UI file |');
  lines.push('| --- | --- | --- |');
  for (const row of verification.rows) {
    lines.push(
      `| ${escapeCell(row.name)} | ${escapeCell(row.skillFile)} | ${escapeCell(row.uiFile)} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function reportCommand(options) {
  if (!options.pack) throw new Error('report requires --pack');
  const packPath = path.resolve(options.pack);
  const pack = JSON.parse(await fs.readFile(packPath, 'utf8'));
  const verification = await verifyPack(pack);
  const reportPath = path.resolve(options.out || defaultReportPath(packPath));
  const markdown = buildAuditReport({ packPath, pack, verification });
  await writeText(reportPath, markdown);

  console.log(`Report: ${reportPath}`);
  console.log(`Rows: ${verification.rows.length}`);
  console.log(`Verified: ${verification.ok}`);
  console.log(`Missing translations: ${verification.missingTranslation}`);
  console.log(`Mismatches: ${verification.mismatch}`);
  if (options.verify && verification.mismatch > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || options.help) {
    usage();
    return;
  }
  if (!['extract', 'apply', 'verify', 'report'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (command === 'extract') {
    await extractCommand(options);
    return;
  }
  if (command === 'apply') {
    await applyCommand(options);
    return;
  }
  if (command === 'verify') {
    await verifyCommand(options);
    return;
  }
  await reportCommand(options);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
