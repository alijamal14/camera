#!/usr/bin/env node
/**
 * Lightweight Docsify docs integrity check (no build step).
 * - Every sidebar .md link resolves to a file under docs/
 * - Relative .md links from docs pages resolve
 * - #hash targets match a heading slug on the destination page
 *
 * Usage: node scripts/check-docs.mjs
 * Exit 0 on success; non-zero with a printed report on failure.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(root, 'docs');

const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const HREF_MD_RE = /href=["']([^"']+\.md(?:#[^"']*)?)["']/gi;

function slugify(headingText) {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown) {
  const slugs = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\s+\{#[\w-]+\}\s*$/, '');
    const explicit = /\{#([\w-]+)\}\s*$/.exec(m[2]);
    slugs.add(explicit ? explicit[1] : slugify(text));
  }
  return slugs;
}

function collectLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(MD_LINK_RE)) {
    links.push(match[2].trim());
  }
  for (const match of markdown.matchAll(HREF_MD_RE)) {
    links.push(match[1].trim());
  }
  return links;
}

function parseSidebarTargets(sidebar) {
  const targets = [];
  for (const match of sidebar.matchAll(MD_LINK_RE)) {
    const href = match[2].trim();
    if (href === '/' || href.startsWith('http')) continue;
    targets.push(href.split('#')[0]);
  }
  return targets;
}

async function listMarkdownFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'assets') continue;
      out.push(...await listMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function underDocs(absPath) {
  const rel = relative(docsRoot, absPath);
  return rel && !rel.startsWith('..') && !normalize(rel).startsWith(`..${sep}`);
}

async function main() {
  const errors = [];
  const sidebarPath = join(docsRoot, '_sidebar.md');
  const sidebar = await readFile(sidebarPath, 'utf8');

  for (const target of parseSidebarTargets(sidebar)) {
    const abs = resolve(docsRoot, target);
    if (!underDocs(abs)) {
      errors.push(`sidebar escapes docs/: ${target}`);
      continue;
    }
    try {
      await readFile(abs, 'utf8');
    } catch {
      errors.push(`sidebar missing file: ${target}`);
    }
  }

  const files = await listMarkdownFiles(docsRoot);
  const cache = new Map();

  async function load(abs) {
    if (cache.has(abs)) return cache.get(abs);
    const text = await readFile(abs, 'utf8');
    const entry = { text, slugs: headingSlugs(text) };
    cache.set(abs, entry);
    return entry;
  }

  for (const file of files) {
    const { text } = await load(file);
    const from = relative(docsRoot, file).split(sep).join('/');
    for (const raw of collectLinks(text)) {
      if (/^(https?:|mailto:|\/\/)/i.test(raw)) continue;
      if (raw.startsWith('#')) {
        const hash = raw.slice(1);
        if (hash && !(await load(file)).slugs.has(hash)) {
          errors.push(`${from}: missing in-page anchor #${hash}`);
        }
        continue;
      }
      if (!raw.includes('.md')) continue;

      const [pathPart, hashPart] = raw.split('#');
      const abs = resolve(dirname(file), pathPart);
      if (!underDocs(abs)) {
        errors.push(`${from}: link escapes docs/: ${raw}`);
        continue;
      }
      let dest;
      try {
        dest = await load(abs);
      } catch {
        errors.push(`${from}: missing file ${raw}`);
        continue;
      }
      if (hashPart && !dest.slugs.has(hashPart)) {
        errors.push(`${from}: missing anchor ${raw}`);
      }
    }
  }

  if (errors.length) {
    console.error(`docs check failed (${errors.length}):`);
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  console.log(`docs check ok (${files.length} markdown files, sidebar links resolved)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
