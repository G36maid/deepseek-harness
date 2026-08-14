/**
 * Enforce complete English/Chinese pairs, matching structure, and recorded git
 * blob hashes for every in-scope document. The manifest contains only explicit
 * exclusions, which may have neither a counterpart nor a sidecar.
 * `--list` reports state; `--write <pairs...>` records the named confirmed
 * pairs (`--write --all` records every complete pair); `--cached <pairs...>`
 * checks exact index bytes for hooks. A check or write named with pair paths
 * touches only those pairs, so update iteration does not pay for a corpus
 * scan. Translation quality remains a review responsibility.
 * See `docs/i18n/README.md` for the owning contract.
 */

import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { gitBlobHash, readGitIndexBlob, storeGitBlob } from './translation-pairing-git.ts'
import {
  PAIRED_LANGUAGES,
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPaths,
  type PairedLanguage,
  type TranslationPairLanguages,
} from './translation-pairing-record.ts'
import {
  languageSwitcherTargets,
  languageSwitcherTargetsForAll,
  linksTo,
  parseTranslationMarkdown,
  parseTranslationPairingCliArgs,
  parseTranslationPairingManifest,
  partitionGeneratedRegions,
  requiresSourceLanguageSwitcher,
  isTranslationScopeFile,
  TRANSLATION_SCOPE_GLOB_EXCLUDES,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'

const root = resolve(import.meta.dirname, '..')
let request: ReturnType<typeof parseTranslationPairingCliArgs>
try {
  request = parseTranslationPairingCliArgs(process.argv.slice(2))
} catch (error) {
  console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const listMode = request.mode === 'list'
const writeMode = request.mode === 'write'
const indexMode = request.input === 'index'

const contentCache = new Map<string, Buffer | undefined>()

/** Read one repository path from the selected worktree or index plane. */
function readRepositoryFile(file: string): Buffer | undefined {
  if (contentCache.has(file)) return contentCache.get(file)
  const content = indexMode
    ? readGitIndexBlob(root, file)?.content
    : existsSync(join(root, file)) ? readFileSync(join(root, file)) : undefined
  contentCache.set(file, content)
  return content
}

/** Whether one path exists in the selected content plane. */
function repositoryFileExists(file: string): boolean {
  return readRepositoryFile(file) !== undefined
}

/** Discover source Markdown and pairing sidecars before applying the corpus predicate. */
const SCOPE_PATTERNS = [
  '**/*.md',
  '**/*.i18n.yaml',
]

const manifestContent = readRepositoryFile('scripts/translation-pairing.manifest.json')
if (manifestContent === undefined) {
  throw new Error('scripts/translation-pairing.manifest.json is missing from the selected content plane')
}
const manifest = parseTranslationPairingManifest(manifestContent.toString('utf8'))

/**
 * An excluded entry ending in `/` excludes the whole directory. The trailing
 * slash IS the path boundary — `docs/tool-catalog/` cannot prefix-match a
 * sibling like `docs/tool-catalog-notes/x.md` — so directory entries in the
 * manifest must keep their trailing slash.
 */
function isExcluded(file: string): boolean {
  return manifest.excluded.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

// Enumerate the scope once: the whole corpus, or exactly the named pairs'
// files (a named pair whose files are absent is caught by the same
// completeness rules that cover discovered remnants).
const files = new Set<string>()
if (request.scope === 'pairs') {
  for (const anchor of request.anchors) {
    const paths = translationPairPaths(anchor)
    for (const file of [paths.source, ...Object.values(paths.languages), paths.meta]) {
      if (repositoryFileExists(file)) files.add(file)
    }
    // A named worktree anchor with no files still enters the source list so
    // an interactive check reports it. An index check accepts a complete
    // pair deletion and still rejects every partial deletion below.
    if (!indexMode && !repositoryFileExists(anchor)) files.add(anchor)
  }
} else {
  for (const pattern of SCOPE_PATTERNS) {
    for (const match of globSync(pattern, { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join('/')
      if (isTranslationScopeFile(normalized)) files.add(normalized)
    }
  }
}
const languageSuffixes = PAIRED_LANGUAGES.filter(language => language !== 'en')
const isLanguageSide = (file: string) => languageSuffixes.some(language => file.endsWith(`${language === 'zh-TW' ? '.zh-tw' : '.zh'}.md`))
const translations = [...files].filter(isLanguageSide).sort()
const metas = [...files].filter(f => f.endsWith('.i18n.yaml')).sort()
const sources = [...files].filter(f => f.endsWith('.md') && !isLanguageSide(f)).sort()

if (request.scope === 'pairs') {
  const rejected = request.anchors.filter(anchor => !isTranslationScopeFile(anchor) || isExcluded(anchor))
  const absent = request.anchors.filter((anchor) => {
    const paths = translationPairPaths(anchor)
    return ![paths.source, ...Object.values(paths.languages), paths.meta].some(repositoryFileExists)
  })
  if (rejected.length > 0 || (!indexMode && absent.length > 0)) {
    for (const anchor of rejected) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`)
    }
    for (const anchor of absent) {
      console.error(`verify-translation-pairing: ${anchor} names no pair on disk (none of its files exist)`)
    }
    process.exit(2)
  }
}

// --write: (re)record hashes for the requested complete pairs, creating
// missing records. A named pair that cannot be recorded (missing counterpart)
// fails loud; corpus scope (--all) skips pairless sources as before.
if (writeMode) {
  let written = 0
  for (const source of sources) {
    if (isExcluded(source)) continue
    const paths = translationPairPaths(source)
    const { meta } = paths
    const present = PAIRED_LANGUAGES.every(language => repositoryFileExists(paths.languages[language]))
    if (!present) {
      if (request.scope === 'pairs') {
        const missing = PAIRED_LANGUAGES
          .filter(language => !repositoryFileExists(paths.languages[language]))
          .map(language => paths.languages[language])
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${missing.join(', ')}`)
        process.exit(2)
      }
      continue
    }
    const contents = {} as Record<PairedLanguage, Buffer | undefined>
    for (const language of PAIRED_LANGUAGES) {
      contents[language] = readRepositoryFile(paths.languages[language])
    }
    if (PAIRED_LANGUAGES.some(language => contents[language] === undefined)) {
      throw new Error(`${source}: complete pair became unreadable`)
    }
    const read = contents as Record<PairedLanguage, Buffer>
    // A consistency record is also a recovery pointer for the briefing
    // generator. Persist every snapshot even when the sidecar text is already
    // current, because the bytes may exist only in this working tree.
    const record = renderTranslationPairingRecord(paths, {
      ...Object.fromEntries(PAIRED_LANGUAGES.map(language => [
        language,
        storeGitBlob(root, read[language]),
      ])),
    } as Record<PairedLanguage, string>)
    if (existsSync(join(root, meta)) && readFileSync(join(root, meta), 'utf8') === record) continue
    writeFileSync(join(root, meta), record)
    console.log(`verify-translation-pairing: recorded ${meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}

const errors: string[] = []
const state = new Map<string, 'ok' | 'out-of-sync' | 'missing'>()

/** All non-English sides of one pair. */
function languageSides(paths: ReturnType<typeof translationPairPaths>): TranslationPairLanguages {
  return Object.fromEntries(PAIRED_LANGUAGES
    .filter(language => language !== 'en')
    .map(language => [language, paths.languages[language]])) as TranslationPairLanguages
}

// 1. Every discovered, non-excluded source merges in every language.
for (const source of sources) {
  if (isExcluded(source)) continue
  const { languages } = translationPairPaths(source)
  const missing = PAIRED_LANGUAGES
    .filter(language => language !== 'en' && !repositoryFileExists(languages[language]))
    .map(language => languages[language])
  if (missing.length > 0) {
    errors.push(`${source}: in-scope documentation must merge in every language (docs/i18n/README.md); add the missing counterpart(s) and record the pair`)
    state.set(source, 'missing')
  }
}

// 2. Every pair that exists at all is complete and consistent. Anchor on the
// union of language-side files and .i18n.yaml records so a half-deleted pair
// is caught from either remnant.
const pairAnchors = new Set<string>()
for (const translation of translations) pairAnchors.add(translation.replace(/\.zh(?:-tw)?\.md$/, '.md'))
for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, '.md'))

for (const source of [...pairAnchors].sort()) {
  const paths = translationPairPaths(source)
  const { meta } = paths
  const sides = languageSides(paths)
  const have = {
    source: repositoryFileExists(source),
    ...Object.fromEntries(PAIRED_LANGUAGES.filter(language => language !== 'en')
      .map(language => [language, repositoryFileExists(paths.languages[language])])),
    meta: repositoryFileExists(meta),
  } as Record<'source' | PairedLanguage | 'meta', boolean>

  if (isExcluded(source)) {
    for (const language of PAIRED_LANGUAGES) {
      if (language !== 'en' && have[language]) {
        errors.push(`${paths.languages[language]}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`)
      }
    }
    if (have.meta) errors.push(`${meta}: ${source} is excluded from pairing; this consistency record must not exist`)
    continue
  }
  const fileOf = (key: string) => key === 'source' ? source : key === 'meta' ? meta : sides[key as PairedLanguage]
  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => fileOf(k))
  if (missing.length > 0) {
    errors.push(`${source}: incomplete pair — missing ${missing.join(', ')} (pairs merge whole: every language plus the .i18n.yaml record)`)
    continue
  }

  const contents = {} as Record<PairedLanguage, Buffer | undefined>
  for (const language of PAIRED_LANGUAGES) {
    contents[language] = readRepositoryFile(paths.languages[language])
  }
  const metaContent = readRepositoryFile(meta)
  if (PAIRED_LANGUAGES.some(language => contents[language] === undefined) || metaContent === undefined) {
    throw new Error(`${source}: complete pair became unreadable`)
  }
  const read = contents as Record<PairedLanguage, Buffer>
  const record = parseTranslationPairingRecord(metaContent.toString('utf8'), paths)
  if (record === undefined) {
    errors.push(`${meta}: malformed consistency record (expected one \`<basename>.md: <40-hex>\` line per language)`)
    continue
  }

  let consistent = true
  for (const language of PAIRED_LANGUAGES) {
    const current = gitBlobHash(read[language])
    if (record[language] !== current) {
      errors.push(`${paths.languages[language]}: out of sync — content no longer matches the pair's last confirmed-consistent state in ${meta} (bring the other side along, then re-record with --write)`)
      consistent = false
    }
  }
  if (!consistent) {
    state.set(source, 'out-of-sync')
    continue
  }

  // Generated regions are language-invariant: the exact same generator output
  // (markers included) must appear in every side, in the same order. The
  // structural signature below compares the region content again as part of
  // the whole document; this dedicated check exists to name the divergence
  // precisely and to reject a region grammar violation on any side.
  let regionParsed: Record<PairedLanguage, { regions: string[]; stripped: string }>
  try {
    regionParsed = Object.fromEntries(PAIRED_LANGUAGES.map(language => [
      language,
      partitionGeneratedRegions(read[language].toString('utf8')),
    ])) as Record<PairedLanguage, { regions: string[]; stripped: string }>
  } catch (error) {
    errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`)
    state.set(source, 'out-of-sync')
    continue
  }
  const sourceRegions = regionParsed.en.regions
  const regionMismatch = PAIRED_LANGUAGES
    .filter(language => language !== 'en')
    .find(language => regionParsed[language].regions.length !== sourceRegions.length
      || regionParsed[language].regions.some((region, index) => region !== sourceRegions[index]))
  if (regionMismatch !== undefined) {
    errors.push(`${source} ↔ ${paths.languages[regionMismatch]}: generated regions differ between the pair — regenerate (the generator writes every side byte-identically)`)
    state.set(source, 'out-of-sync')
  }

  const trees = Object.fromEntries(PAIRED_LANGUAGES.map(language => [
    language,
    parseTranslationMarkdown(read[language].toString('utf8')),
  ])) as Record<PairedLanguage, ReturnType<typeof parseTranslationMarkdown>>
  const sourceSwitcherTargets = languageSwitcherTargets(source)
  const counterpartTargets = languageSwitcherTargetsForAll(
    PAIRED_LANGUAGES.filter(language => language !== 'en').map(language => paths.languages[language]),
  )
  // Every language side links to the English source and to its siblings;
  // the signature must skip all three switcher targets on every side.
  const allSwitcherTargets = [...sourceSwitcherTargets, ...counterpartTargets]
  for (const language of PAIRED_LANGUAGES) {
    if (language === 'en') continue
    const side = paths.languages[language]
    if (!linksTo(trees[language], sourceSwitcherTargets)) {
      errors.push(`${side}: missing language switcher — no link to ${basename(source)}`)
    }
  }
  if (requiresSourceLanguageSwitcher(source) && !linksTo(trees.en, counterpartTargets)) {
    errors.push(`${source}: missing language switcher — no link back to any counterpart`)
  }
  const sourceSignature = translationStructureSignature(trees.en, allSwitcherTargets)
  for (const language of PAIRED_LANGUAGES) {
    if (language === 'en') continue
    const side = paths.languages[language]
    for (const divergence of translationStructureDiff(
      sourceSignature,
      translationStructureSignature(trees[language], allSwitcherTargets),
    )) {
      errors.push(`${source} ↔ ${side}: ${divergence}`)
    }
  }
  if (!state.has(source)) state.set(source, 'ok')
}

// Complete the state map for --list: any in-scope, non-excluded document with no pair is missing.
for (const source of sources) {
  if (!isExcluded(source) && !state.has(source)) state.set(source, 'missing')
}

if (listMode) {
  const order = { 'out-of-sync': 0, missing: 1, ok: 2 } as const
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
  }
  const counts = { 'ok': 0, 'out-of-sync': 0, 'missing': 0 }
  for (const status of state.values()) counts[status]++
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
  process.exit(0)
}

if (errors.length === 0) {
  console.log(request.scope === 'pairs'
    ? `verify-translation-pairing: ${pairAnchors.size} named ${indexMode ? 'staged ' : ''}pair(s) consistent; the corpus-wide check still runs in doc-sync.`
    : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`)
  process.exit(0)
}

console.error('verify-translation-pairing: bilingual pairing rules violated (see docs/i18n/README.md):')
for (const message of errors) console.error(`  ${message}`)
process.exit(1)
