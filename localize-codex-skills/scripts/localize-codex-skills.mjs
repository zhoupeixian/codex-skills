#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.log(`Usage:
  node scripts/localize-codex-skills.mjs extract --out <pack.json> [--root <skills-dir> ...]
  node scripts/localize-codex-skills.mjs apply --pack <pack.json> [--backup-dir <dir>] [--allow-high-risk]
  node scripts/localize-codex-skills.mjs verify --pack <pack.json>
  node scripts/localize-codex-skills.mjs report --pack <pack.json> [--out <report.md>] [--verify]
  node scripts/localize-codex-skills.mjs dedupe [--backup-dir <dir>]
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

function requireUserProfile() {
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) throw new Error('USERPROFILE is not set');
  return userProfile;
}

function codexHome() {
  return path.join(requireUserProfile(), '.codex');
}

function agentsSkillsRoot() {
  return path.join(requireUserProfile(), '.agents', 'skills');
}

function normalizeForCompare(target) {
  return path.resolve(target).replaceAll('\\', '/').toLowerCase();
}

function sourcePriority(skillFile) {
  const normalized = normalizeForCompare(skillFile);
  if (normalized.includes('/.agents/skills/')) return 500;
  if (normalized.includes('/.codex/skills/')) return 400;
  if (normalized.includes('/.codex/superpowers/skills/')) return 350;
  if (normalized.includes('/.codex/plugins/cache/')) return 200;
  if (normalized.includes('/.codex/.tmp/')) return 100;
  return 50;
}

function isPersistentSkillRoot(skillRoot) {
  const normalized = normalizeForCompare(skillRoot);
  return (
    normalized.includes('/.agents/skills/') ||
    normalized.includes('/.codex/skills/')
  );
}

async function findSkillRoot(filePath) {
  let current = path.dirname(filePath);
  while (true) {
    if (await exists(path.join(current, 'SKILL.md'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveShadowRootForName(skillName) {
  return path.join(agentsSkillsRoot(), skillName);
}

function isPluginCacheSkillRoot(skillRoot) {
  const normalized = normalizeForCompare(skillRoot);
  return (
    normalized.includes('/.codex/superpowers/skills/') ||
    normalized.includes('/.codex/plugins/cache/')
  );
}

function isAgentsSkillRoot(skillRoot) {
  return normalizeForCompare(skillRoot).includes('/.agents/skills/');
}

async function ensureDirectoryCopy(sourceRoot, targetRoot) {
  if (!sourceRoot || !targetRoot) return { created: false };
  if (normalizeForCompare(sourceRoot) === normalizeForCompare(targetRoot)) {
    return { created: false };
  }
  if (await exists(targetRoot)) {
    return { created: false };
  }
  await fs.mkdir(path.dirname(targetRoot), { recursive: true });
  await fs.cp(sourceRoot, targetRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: false,
    preserveTimestamps: true,
  });
  return { created: true };
}

async function pluginShadowRoots(baseDir) {
  if (!(await exists(baseDir))) return [];
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDir, entry.name, 'skills'));
}

function relativeFromRoot(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === '' ? path.basename(filePath) : relative;
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

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
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

function readPromptTargetField(content, fieldName) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;
  return readTopLevelField(frontmatter.frontmatterLines, fieldName);
}

function readPromptTemplateField(content, fieldName) {
  const lines = splitLines(content);
  let inCodeFence = false;
  const prefix = `  ${fieldName}:`;
  for (const line of lines) {
    if (line.trim() === '```') {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (!inCodeFence) continue;
    if (!line.startsWith(prefix)) continue;
    return unquote(line.slice(prefix.length).trim());
  }
  return null;
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

function upsertTopLevelFieldInFrontmatter(content, fieldName, value) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return content;

  const { frontmatterLines, bodyLines, newline } = frontmatter;
  const replacement = `${fieldName}: ${quote(value)}`;
  const updatedFrontmatterLines = [...frontmatterLines];
  const prefix = `${fieldName}:`;
  let replaced = false;

  for (let i = 0; i < updatedFrontmatterLines.length; i += 1) {
    if (!updatedFrontmatterLines[i].startsWith(prefix)) continue;
    updatedFrontmatterLines[i] = replacement;
    replaced = true;
    break;
  }

  if (!replaced) {
    updatedFrontmatterLines.push(replacement);
  }

  return ['---', ...updatedFrontmatterLines, '---', ...bodyLines].join(newline);
}

function upsertPromptTemplateField(content, fieldName, value) {
  const newline = detectNewline(content);
  const lines = splitLines(content);
  const replacement = `  ${fieldName}: ${quote(value)}`;
  let inCodeFence = false;
  let fieldIndex = -1;
  let insertBeforeIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '```') {
      if (!inCodeFence) {
        inCodeFence = true;
        continue;
      }
      break;
    }
    if (!inCodeFence) continue;
    if (line.startsWith(`  ${fieldName}:`)) {
      fieldIndex = i;
      break;
    }
    if (insertBeforeIndex === -1 && line.startsWith('  prompt:')) {
      insertBeforeIndex = i;
    }
  }

  if (fieldIndex !== -1) {
    lines[fieldIndex] = replacement;
    return lines.join(newline);
  }

  if (insertBeforeIndex === -1) {
    return content;
  }

  lines.splice(insertBeforeIndex, 0, replacement);
  return lines.join(newline);
}

async function walk(dir, visitor) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`跳过不可读目录: ${dir} (${error.message})`);
    return;
  }
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
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    console.warn(`跳过不可读目录: ${baseDir} (${error.message})`);
    return [];
  }
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parent = path.join(baseDir, entry.name);
    let children;
    try {
      children = (await fs.readdir(parent, { withFileTypes: true }))
        .filter((child) => child.isDirectory())
        .map((child) => path.join(parent, child.name));
    } catch (error) {
      console.warn(`跳过不可读目录: ${parent} (${error.message})`);
      continue;
    }
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
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    console.warn(`跳过不可读目录: ${baseDir} (${error.message})`);
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name));
}

async function collectChildRoots(baseDir) {
  return newestChildDirs(baseDir);
}

function classifySource(skillFile) {
  const normalized = normalizeForCompare(skillFile);
  if (normalized.includes('/.agents/skills/')) return 'personal-skill';
  if (normalized.includes('/.codex/skills/')) return 'codex-skill';
  if (normalized.includes('/.codex/superpowers/skills/')) return 'superpowers-skill';
  if (normalized.includes('/.codex/plugins/cache/openai-curated/')) return 'plugin-curated';
  if (normalized.includes('/.codex/plugins/cache/openai-primary-runtime/')) return 'plugin-runtime';
  if (normalized.includes('/.codex/plugins/cache/openai-bundled/')) return 'plugin-bundled';
  if (normalized.includes('/.codex/.tmp/')) return 'runtime-shadow';
  return 'other';
}

function packItemId(kind, key, sourceFile) {
  return `${kind}::${key}::${normalizeForCompare(sourceFile)}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function packStructureSignature(pack) {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const shadowedItems = Array.isArray(pack?.shadowedItems) ? pack.shadowedItems : [];
  return {
    itemIds: items.map((item) => String(item?.id || '')).sort((a, b) => a.localeCompare(b)),
    shadowedIds: shadowedItems
      .map((item) => String(item?.id || item?.name || ''))
      .sort((a, b) => a.localeCompare(b)),
  };
}

function packRootsSignature(pack) {
  const roots = Array.isArray(pack?.sourceRoots) ? pack.sourceRoots : [];
  return uniqueStrings(roots);
}

function signaturesMatch(expected, actual) {
  return (
    JSON.stringify(expected.itemIds) === JSON.stringify(actual.itemIds) &&
    JSON.stringify(expected.shadowedIds) === JSON.stringify(actual.shadowedIds)
  );
}

async function defaultSkillRoots() {
  const codex = codexHome();
  return [
    path.join(codex, 'skills'),
    agentsSkillsRoot(),
    path.join(codex, 'superpowers', 'skills'),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-curated'))),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-primary-runtime'))),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-bundled'))),
  ];
}

async function collectSkillCandidates(customRoots) {
  const roots = customRoots.length ? customRoots : await defaultSkillRoots();
  const duplicateAgentNames = customRoots.length ? new Set() : await pluginSkillNames();
  const files = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    if (normalizeForCompare(root).includes('/.codex/.tmp/')) continue;
    await walk(root, async (file) => {
      if (path.basename(file) === 'SKILL.md') files.push(file);
    });
  }
  const deduped = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  const candidates = [];
  for (const skillFile of deduped) {
    const raw = await fs.readFile(skillFile, 'utf8');
    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter) continue;
    const name = readTopLevelField(frontmatter.frontmatterLines, 'name');
    const description = readTopLevelField(frontmatter.frontmatterLines, 'description');
    if (!name || !description) continue;
    const skillRoot = path.dirname(skillFile);
    if (isAgentsSkillRoot(skillRoot) && duplicateAgentNames.has(name)) continue;
    const targetRoot = skillRoot;
    const targetFile = path.join(targetRoot, 'agents', 'openai.yaml');
    let original = description;
    if (await exists(targetFile)) {
      const current = parseOpenAiYaml(await fs.readFile(targetFile, 'utf8')).short_description;
      if (current) original = current;
    }
    candidates.push({
      kind: 'skill',
      logicalKey: `skill::${name}`,
      id: packItemId('skill', name, skillFile),
      name,
      sourceFamily: classifySource(skillFile),
      sourcePriority: sourcePriority(skillFile),
      skillFile,
      skillRoot,
      targetRoot,
      targetFile,
      sourceField: 'SKILL.md.description',
      targetField: 'agents/openai.yaml.interface.short_description',
      original,
      translation: '',
      risk: 'low',
      visible: false,
      shadowedBy: null,
      shadowTarget: false,
    });
  }
  return candidates;
}

function selectVisibleCandidates(candidates) {
  const byKey = new Map();
  const visible = [];
  const shadowed = [];
  const sorted = [...candidates].sort(
    (a, b) =>
      b.sourcePriority - a.sourcePriority ||
      a.logicalKey.localeCompare(b.logicalKey) ||
      a.skillFile.localeCompare(b.skillFile),
  );
  for (const candidate of sorted) {
    const winner = byKey.get(candidate.logicalKey);
    if (!winner) {
      const visibleCandidate = { ...candidate, visible: true };
      byKey.set(candidate.logicalKey, visibleCandidate);
      visible.push(visibleCandidate);
      continue;
    }
    shadowed.push({
      ...candidate,
      visible: false,
      shadowedBy: winner.skillFile,
    });
  }
  visible.sort((a, b) => a.name.localeCompare(b.name) || a.skillFile.localeCompare(b.skillFile));
  shadowed.sort((a, b) => a.name.localeCompare(b.name) || a.skillFile.localeCompare(b.skillFile));
  return { visible, shadowed };
}

async function collectPromptRoleCandidates() {
  const promptsDir = path.join(codexHome(), 'prompts');
  if (!(await exists(promptsDir))) return [];
  const entries = await fs.readdir(promptsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(promptsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
  const items = [];
  for (const promptFile of files) {
    const raw = await fs.readFile(promptFile, 'utf8');
    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter) continue;
    const description = readTopLevelField(frontmatter.frontmatterLines, 'description');
    if (!description) continue;
    let original = description;
    if (await exists(promptFile)) {
      const current = readPromptTargetField(await fs.readFile(promptFile, 'utf8'), 'description');
      if (current) original = current;
    }
    items.push({
      kind: 'prompt-role',
      logicalKey: `prompt-role::${normalizeForCompare(promptFile)}`,
      id: packItemId('prompt-role', path.basename(promptFile, '.md'), promptFile),
      name: `prompts:${path.basename(promptFile, '.md')}`,
      sourceFamily: 'prompt-role',
      sourcePriority: 300,
      skillFile: promptFile,
      skillRoot: path.dirname(promptFile),
      targetRoot: path.dirname(promptFile),
      targetFile: promptFile,
      sourceField: 'prompt.frontmatter.description',
      targetField: 'prompt.frontmatter.description',
      original,
      translation: '',
      risk: 'high',
      visible: true,
      shadowedBy: null,
      shadowTarget: false,
    });
  }
  return items;
}

async function collectPromptTemplateCandidates(visibleSkills) {
  const items = [];
  for (const skill of visibleSkills) {
    if (!(await exists(skill.skillRoot))) continue;
    await walk(skill.skillRoot, async (file) => {
      if (path.basename(file).endsWith('-prompt.md')) {
        const raw = await fs.readFile(file, 'utf8');
        const relativePath = path.relative(skill.skillRoot, file);
        const targetRoot = skill.shadowTarget ? skill.targetRoot : skill.skillRoot;
        const targetFile = path.join(targetRoot, relativePath);
        const base = {
          kind: 'prompt-template',
          name: path.basename(file, '.md'),
          sourceFamily: skill.sourceFamily,
          sourcePriority: skill.sourcePriority,
          skillFile: file,
          skillRoot: skill.skillRoot,
          targetRoot,
          targetFile,
          visible: true,
          shadowedBy: null,
          shadowTarget: skill.shadowTarget,
        };
        const description = readPromptTemplateField(raw, 'description');
        let currentDescription = description;
        if (await exists(targetFile)) {
          const current = readPromptTargetField(await fs.readFile(targetFile, 'utf8'), 'description');
          if (current) currentDescription = current;
        }
        if (description) {
          items.push({
            ...base,
            logicalKey: `prompt-template::${skill.name}::${normalizeForCompare(relativePath)}::description`,
            id: packItemId('prompt-template', `${skill.name}:${relativePath}:description`, file),
            sourceField: 'prompt-template.task.description',
            targetField: 'prompt-template.task.description',
            original: currentDescription,
            translation: '',
            risk: 'high',
          });
        }
        const argumentHint = readPromptTemplateField(raw, 'argument-hint');
        let currentArgumentHint = argumentHint;
        if (await exists(targetFile)) {
          const current = readPromptTargetField(await fs.readFile(targetFile, 'utf8'), 'argument-hint');
          if (current) currentArgumentHint = current;
        }
        if (argumentHint) {
          items.push({
            ...base,
            logicalKey: `prompt-template::${skill.name}::${normalizeForCompare(relativePath)}::argument-hint`,
            id: packItemId('prompt-template', `${skill.name}:${relativePath}:argument-hint`, file),
            sourceField: 'prompt-template.task.argument-hint',
            targetField: 'prompt-template.task.argument-hint',
            original: currentArgumentHint,
            translation: '',
            risk: 'high',
          });
        }
      }
    });
  }
  return items;
}

async function buildPack(customRoots) {
  const rawSkills = await collectSkillCandidates(customRoots);
  const { visible: visibleSkills, shadowed: shadowedSkills } = selectVisibleCandidates(rawSkills);
  const promptRoles = await collectPromptRoleCandidates();
  const promptTemplates = await collectPromptTemplateCandidates(visibleSkills);
  const items = [...visibleSkills, ...promptRoles, ...promptTemplates].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.kind.localeCompare(b.kind) ||
      a.targetField.localeCompare(b.targetField) ||
      a.skillFile.localeCompare(b.skillFile),
  );
  const shadowedItems = shadowedSkills.sort(
    (a, b) => a.name.localeCompare(b.name) || a.skillFile.localeCompare(b.skillFile),
  );
  const sourceRoots = uniqueStrings([
    ...(customRoots.length ? customRoots : await defaultSkillRoots()),
    ...items.map((item) => item.skillRoot),
    ...shadowedItems.map((item) => item.skillRoot),
  ]);
  const structureSignature = packStructureSignature({ items, shadowedItems });
  return {
    generatedAt: new Date().toISOString(),
    strategy: 'in-place-plugin-cache-plus-audit',
    itemCount: items.length,
    shadowedCount: shadowedItems.length,
    sourceRoots,
    structureSignature,
    items,
    shadowedItems,
  };
}

async function pluginSkillNames() {
  const codex = codexHome();
  const roots = [
    path.join(codex, 'superpowers', 'skills'),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-curated'))),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-primary-runtime'))),
    ...(await collectChildRoots(path.join(codex, 'plugins', 'cache', 'openai-bundled'))),
  ];
  const names = new Set();
  for (const root of roots) {
    if (!(await exists(root))) continue;
    await walk(root, async (file) => {
      if (path.basename(file) !== 'SKILL.md') return;
      const raw = await fs.readFile(file, 'utf8');
      const frontmatter = parseFrontmatter(raw);
      if (!frontmatter) return;
      const name = readTopLevelField(frontmatter.frontmatterLines, 'name');
      if (name) names.add(name);
    });
  }
  return names;
}

async function agentSkillName(skillRoot) {
  const skillFile = path.join(skillRoot, 'SKILL.md');
  if (!(await exists(skillFile))) return null;
  const raw = await fs.readFile(skillFile, 'utf8');
  const frontmatter = parseFrontmatter(raw);
  if (!frontmatter) return null;
  return readTopLevelField(frontmatter.frontmatterLines, 'name');
}

async function findDuplicateAgentSkillRoots() {
  const pluginNames = await pluginSkillNames();
  const root = agentsSkillsRoot();
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const duplicates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillRoot = path.join(root, entry.name);
    const name = await agentSkillName(skillRoot);
    if (!name || !pluginNames.has(name)) continue;
    duplicates.push({ name, path: skillRoot });
  }
  duplicates.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return duplicates;
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

async function readSkillPack(packPath) {
  const pack = JSON.parse(await fs.readFile(packPath, 'utf8'));
  if (!pack || !Array.isArray(pack.items)) {
    throw new Error('Invalid pack: missing items array');
  }
  return pack;
}

function translateValue(item) {
  return typeof item.translation === 'string' ? item.translation.trim() : '';
}

function isHighRisk(item) {
  return (
    item.risk === 'high' ||
    item.kind === 'prompt-role' ||
    item.kind === 'prompt-template'
  );
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

function buildDedupeBackupFolder(explicitBackupDir) {
  if (explicitBackupDir) return path.resolve(explicitBackupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'description-restore-audit', 'dedupe-backups', stamp);
}

async function createRollbackArtifacts(backupDir, manifest) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  await writeJson(manifestPath, manifest);
  const rollbackScript = `param()

$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

function Remove-TreeIfExists([string]$PathValue) {
  if (Test-Path -LiteralPath $PathValue) {
    Remove-Item -LiteralPath $PathValue -Recurse -Force
    Write-Host "Removed $PathValue"
  }
}

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
    Remove-TreeIfExists $target
  }
}

foreach ($shadow in $manifest.shadowRoots) {
  Remove-TreeIfExists $shadow
}
`;
  await fs.writeFile(path.join(backupDir, 'rollback.ps1'), rollbackScript, 'utf8');
}

async function applyCommand(options) {
  if (!options.pack) throw new Error('apply requires --pack');
  const packPath = path.resolve(options.pack);
  const pack = await readSkillPack(packPath);
  const currentPack = await buildPack(packRootsSignature(pack));
  const expectedSignature = packStructureSignature(pack);
  const currentSignature = packStructureSignature(currentPack);
  if (!signaturesMatch(expectedSignature, currentSignature)) {
    throw new Error(
      [
        'Pack is stale or mismatched with the currently visible skill set.',
        'Re-run extract/replay to regenerate the pack before apply.',
        `Expected items: ${expectedSignature.itemIds.length}, current items: ${currentSignature.itemIds.length}.`,
        `Expected shadowed: ${expectedSignature.shadowedIds.length}, current shadowed: ${currentSignature.shadowedIds.length}.`,
      ].join(' '),
    );
  }
  const actionable = pack.items.filter((item) => translateValue(item).length > 0);
  if (!actionable.length) {
    console.log('No translated items to apply.');
    return;
  }
  const highRisk = actionable.filter((item) => isHighRisk(item));
  if (highRisk.length && !options['allow-high-risk']) {
    throw new Error(`High-risk items present (${highRisk.length}). Re-run with --allow-high-risk after explicit approval.`);
  }

  const backupDir = buildBackupFolder(packPath, options['backup-dir']);
  const filesDir = path.join(backupDir, 'files');
  await fs.mkdir(filesDir, { recursive: true });

  const fileState = new Map();
  const shadowRoots = new Set();
  const clonedTargets = new Map();
  const writes = new Map();

  for (const item of actionable) {
    if (item.kind === 'skill' && item.shadowTarget) {
      const sourceRoot = item.skillRoot;
      const targetRoot = item.targetRoot;
      if (!clonedTargets.has(targetRoot)) {
        const existed = await exists(targetRoot);
        if (!existed) {
          await ensureDirectoryCopy(sourceRoot, targetRoot);
          shadowRoots.add(targetRoot);
          clonedTargets.set(targetRoot, true);
        } else {
          clonedTargets.set(targetRoot, false);
        }
      }
    }
    if (!writes.has(item.targetFile)) {
      const existed = await exists(item.targetFile);
      const content = existed ? await fs.readFile(item.targetFile, 'utf8') : '';
      writes.set(item.targetFile, { existed, content });
    }
  }

  const manifestFiles = [];
  for (const [targetFile, state] of writes.entries()) {
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
    if (!grouped.has(item.targetFile)) grouped.set(item.targetFile, []);
    grouped.get(item.targetFile).push(item);
  }

  let changedFiles = 0;
  for (const [targetFile, items] of grouped.entries()) {
    const state = writes.get(targetFile);
    let updated = state.content;
    for (const item of items) {
      const translation = translateValue(item);
      if (item.kind === 'skill') {
        updated = upsertInterfaceField(updated, 'short_description', translation);
      } else if (item.sourceField === 'prompt.frontmatter.description') {
        updated = upsertTopLevelFieldInFrontmatter(updated, 'description', translation);
      } else if (item.sourceField === 'prompt.frontmatter.argument-hint') {
        updated = upsertTopLevelFieldInFrontmatter(updated, 'argument-hint', translation);
      } else if (item.sourceField === 'prompt-template.task.description') {
        updated = upsertPromptTemplateField(updated, 'description', translation);
      } else if (item.sourceField === 'prompt-template.task.argument-hint') {
        updated = upsertPromptTemplateField(updated, 'argument-hint', translation);
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
    shadowRoots: [...shadowRoots],
  });

  console.log(`Applied ${actionable.length} translations across ${changedFiles} files.`);
  console.log(`Backup: ${backupDir}`);
  console.log(`Rollback: ${path.join(backupDir, 'rollback.ps1')}`);
}

async function dedupeCommand(options) {
  const duplicates = await findDuplicateAgentSkillRoots();
  const backupDir = buildDedupeBackupFolder(options['backup-dir']);
  const movedDir = path.join(backupDir, 'agents-skills');
  await fs.mkdir(movedDir, { recursive: true });

  const moved = [];
  for (const duplicate of duplicates) {
    const destination = path.join(movedDir, path.basename(duplicate.path));
    if (await exists(destination)) {
      throw new Error(`Backup destination already exists: ${destination}`);
    }
    await fs.rename(duplicate.path, destination);
    moved.push({
      name: duplicate.name,
      originalPath: duplicate.path,
      backupPath: destination,
    });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    reason: 'Moved .agents skills that duplicate enabled plugin skills.',
    moved,
  };
  await writeJson(path.join(backupDir, 'manifest.json'), manifest);
  const rollbackScript = `param()

$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

foreach ($entry in $manifest.moved) {
  $source = $entry.backupPath
  $target = $entry.originalPath
  if (Test-Path -LiteralPath $source) {
    $parent = Split-Path -Parent $target
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Move-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Restored $target"
  }
}
`;
  await writeText(path.join(backupDir, 'rollback.ps1'), rollbackScript);
  console.log(`Moved duplicate .agents skills: ${moved.length}`);
  console.log(`Backup: ${backupDir}`);
  console.log(`Rollback: ${path.join(backupDir, 'rollback.ps1')}`);
}

async function verifyCommand(options) {
  if (!options.pack) throw new Error('verify requires --pack');
  const pack = await readSkillPack(path.resolve(options.pack));
  const result = await verifyPack(pack);

  console.log(`Verified: ${result.ok}`);
  console.log(`Missing translations: ${result.missingTranslation}`);
  console.log(`Mismatches: ${result.mismatch}`);
  console.log(`Shadowed items: ${result.shadowed}`);
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
  let shadowed = 0;
  const problems = [];
  const rows = [];

  for (const item of pack.items) {
    const translation = translateValue(item);
    if (!translation) {
      missingTranslation += 1;
      rows.push({
        ...item,
        translation: item.translation || '',
        currentValue: '',
        status: 'missing-translation',
        note: 'translation field is empty',
      });
      continue;
    }
    if (item.visible === false) {
      shadowed += 1;
      rows.push({
        ...item,
        translation,
        currentValue: '',
        status: 'shadowed',
        note: item.shadowedBy ? `shadowed by ${item.shadowedBy}` : 'shadowed',
      });
      continue;
    }
    if (!(await exists(item.targetFile))) {
      mismatch += 1;
      problems.push(`${item.name}: missing ${item.targetFile}`);
      rows.push({
        ...item,
        translation,
        currentValue: '',
        status: 'mismatch',
        note: `missing ${item.targetFile}`,
      });
      continue;
    }
    const targetText = await fs.readFile(item.targetFile, 'utf8');
    let currentValue = '';
    if (item.kind === 'skill') {
      currentValue = parseOpenAiYaml(targetText).short_description ?? '';
    } else if (item.sourceField === 'prompt.frontmatter.description') {
      currentValue = readTopLevelField(parseFrontmatter(targetText)?.frontmatterLines || [], 'description') || '';
    } else if (item.sourceField === 'prompt.frontmatter.argument-hint') {
      currentValue = readTopLevelField(parseFrontmatter(targetText)?.frontmatterLines || [], 'argument-hint') || '';
    } else if (item.sourceField === 'prompt-template.task.description') {
      currentValue = readPromptTemplateField(targetText, 'description') || '';
    } else if (item.sourceField === 'prompt-template.task.argument-hint') {
      currentValue = readPromptTemplateField(targetText, 'argument-hint') || '';
    }
    if (currentValue !== translation) {
      mismatch += 1;
      problems.push(`${item.name}: expected "${translation}" but found "${currentValue}"`);
      rows.push({
        ...item,
        translation,
        currentValue,
        status: 'mismatch',
        note: `expected "${translation}" but found "${currentValue}"`,
      });
      continue;
    }
    ok += 1;
    rows.push({
      ...item,
      translation,
      currentValue,
      status: 'verified',
      note: '',
    });
  }

  if (Array.isArray(pack.shadowedItems)) {
    shadowed += pack.shadowedItems.length;
  }

  return { ok, missingTranslation, mismatch, shadowed, problems, rows };
}

function buildAuditReport({ packPath, pack, verification }) {
  const lines = [];
  lines.push('# Localize Codex Skills Audit Report');
  lines.push('');
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Pack: \`${path.resolve(packPath)}\``);
  lines.push(`- Strategy: \`${pack.strategy}\``);
  lines.push(`- Item count: ${pack.itemCount}`);
  lines.push(`- Shadowed count: ${pack.shadowedCount || 0}`);
  lines.push(`- Verified: ${verification.ok}`);
  lines.push(`- Missing translations: ${verification.missingTranslation}`);
  lines.push(`- Mismatches: ${verification.mismatch}`);
  lines.push('');
  lines.push('## Visible Items');
  lines.push('');
  lines.push('| # | Skill | Family | Target root | Source field | Target file | Original | Translation | Current | Status | Note |');
  lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  verification.rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${escapeCell(row.name)} | ${escapeCell(row.sourceFamily)} | ${escapeCell(row.targetRoot)} | ${escapeCell(row.sourceField)} | ${escapeCell(row.targetFile)} | ${escapeCell(row.original)} | ${escapeCell(row.translation)} | ${escapeCell(row.currentValue)} | ${escapeCell(row.status)} | ${escapeCell(row.note)} |`,
    );
  });
  lines.push('');
  lines.push('## Shadowed Items');
  lines.push('');
  lines.push('| Skill | Source file | Shadowed by | Target root |');
  lines.push('| --- | --- | --- | --- |');
  (pack.shadowedItems || []).forEach((item) => {
    lines.push(
      `| ${escapeCell(item.name)} | ${escapeCell(item.skillFile)} | ${escapeCell(item.shadowedBy || '')} | ${escapeCell(item.targetRoot || '')} |`,
    );
  });
  lines.push('');
  lines.push('## Verification Summary');
  lines.push('');
  lines.push(`- Verified: ${verification.ok}`);
  lines.push(`- Missing translations: ${verification.missingTranslation}`);
  lines.push(`- Mismatches: ${verification.mismatch}`);
  lines.push(`- Shadowed: ${verification.shadowed}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function reportCommand(options) {
  if (!options.pack) throw new Error('report requires --pack');
  const packPath = path.resolve(options.pack);
  const pack = await readSkillPack(packPath);
  const verification = await verifyPack(pack);
  const reportPath = path.resolve(options.out || `${path.parse(packPath).name}.audit.md`);
  const markdown = buildAuditReport({ packPath, pack, verification });
  await writeText(reportPath, markdown);
  console.log(`Report: ${reportPath}`);
  console.log(`Rows: ${pack.items.length}`);
  console.log(`Verified: ${verification.ok}`);
  console.log(`Missing translations: ${verification.missingTranslation}`);
  console.log(`Mismatches: ${verification.mismatch}`);
  console.log(`Shadowed: ${verification.shadowed}`);
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
  if (!['extract', 'apply', 'verify', 'report', 'dedupe'].includes(command)) {
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
  if (command === 'dedupe') {
    await dedupeCommand(options);
    return;
  }
  await reportCommand(options);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
