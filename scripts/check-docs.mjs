#!/usr/bin/env node
/**
 * Lightweight Docsify docs integrity check (no build step).
 * - Every sidebar link resolves to a file under docs/
 * - In-body links use Docsify root-absolute routes (`/guide/…`, no `.md`) so nested
 *   hashes do not rewrite to sibling 404s
 * - `#/…` HTML hash routes and `/…` markdown routes resolve to real pages
 * - #hash targets match a heading slug on the destination page
 *
 * Usage: node scripts/check-docs.mjs
 * Exit 0 on success; non-zero with a printed report on failure.
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(root, 'docs');

/** Docsify loads these from the docs root; `.md` paths here are OK. */
const DOCSIFY_SHELL = new Set(['_sidebar.md', '_navbar.md']);

const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const HREF_RE = /href=["']([^"']+)["']/gi;

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
  for (const match of markdown.matchAll(HREF_RE)) {
    links.push(match[1].trim());
  }
  return links;
}

function underDocs(absPath) {
  const rel = relative(docsRoot, absPath);
  return rel && !rel.startsWith('..') && !normalize(rel).startsWith(`..${sep}`);
}

function routeToAbs(routePath) {
  const cleaned = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned || cleaned === 'home') return join(docsRoot, 'home.md');
  return join(docsRoot, `${cleaned}.md`);
}

function parseRoute(raw) {
  let route = raw;
  if (route.startsWith('#/')) route = route.slice(2);
  else if (route.startsWith('/')) route = route.slice(1);
  else return null;

  const q = route.indexOf('?');
  if (q >= 0) route = route.slice(0, q);
  const [pathPart, hashPart] = route.split('#');
  return { pathPart: pathPart || '', hashPart: hashPart || '' };
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

async function main() {
  const errors = [];
  const files = await listMarkdownFiles(docsRoot);
  const cache = new Map();

  async function load(abs) {
    if (cache.has(abs)) return cache.get(abs);
    const text = await readFile(abs, 'utf8');
    const entry = { text, slugs: headingSlugs(text) };
    cache.set(abs, entry);
    return entry;
  }

  async function checkTarget(from, raw, abs, hashPart) {
    if (!underDocs(abs)) {
      errors.push(`${from}: link escapes docs/: ${raw}`);
      return;
    }
    let dest;
    try {
      dest = await load(abs);
    } catch {
      errors.push(`${from}: missing file ${raw}`);
      return;
    }
    if (hashPart && !dest.slugs.has(hashPart)) {
      errors.push(`${from}: missing anchor ${raw}`);
    }
  }

  for (const file of files) {
    const { text } = await load(file);
    const from = relative(docsRoot, file).split(sep).join('/');
    const shell = DOCSIFY_SHELL.has(basename(file));

    for (const raw of collectLinks(text)) {
      if (/^(https?:|mailto:|\/\/)/i.test(raw)) continue;

      // In-page anchor only.
      if (raw.startsWith('#') && !raw.startsWith('#/')) {
        const hash = raw.slice(1);
        if (hash && !(await load(file)).slugs.has(hash)) {
          errors.push(`${from}: missing in-page anchor #${hash}`);
        }
        continue;
      }

      // Docsify root-absolute markdown (`/guide/…`) or HTML hash (`#/guide/…`).
      if (raw === '/' || raw.startsWith('/') || raw.startsWith('#/')) {
        if (raw.includes('.md')) {
          errors.push(
            `${from}: use Docsify absolute route without .md (got ${raw})`,
          );
          continue;
        }
        if (raw === '/') continue;
        const parsed = parseRoute(raw);
        if (!parsed) {
          errors.push(`${from}: unparseable route ${raw}`);
          continue;
        }
        await checkTarget(from, raw, routeToAbs(parsed.pathPart), parsed.hashPart);
        continue;
      }

      // Sidebar / navbar may still use docs-root-relative `.md` paths.
      if (shell && raw.includes('.md')) {
        const [pathPart, hashPart] = raw.split('#');
        const abs = resolve(docsRoot, pathPart);
        await checkTarget(from, raw, abs, hashPart);
        continue;
      }

      // Body content: relative `.md` (or `../…md`) is rewritten wrong on nested routes.
      if (/\.md(?:#|$)/i.test(raw)) {
        errors.push(
          `${from}: relative .md link breaks Docsify nested routes: ${raw} (use /path without .md)`,
        );
        continue;
      }

      // Any other relative internal href in body is also fragile under nested hashes.
      if (!shell) {
        errors.push(
          `${from}: non-absolute internal link (use /path or #/path): ${raw}`,
        );
      }
    }
  }

  if (errors.length) {
    console.error(`docs check failed (${errors.length}):`);
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  console.log(`docs check ok (${files.length} markdown files, Docsify routes resolved)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
