/**
 * Verify a Traditional Chinese (zh-TW) Markdown document for residual
 * Simplified Chinese characters and mainland vocabulary, using the zhtw-js
 * checker over prose only (code spans and link targets stay protected).
 * The pairing gate owns cross-language consistency; this gate owns the
 * quality of the zh-TW side itself.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, type Match } from 'zhtw-js'
import * as OpenCC from 'opencc-js'
import { protectSpans } from './zh-tw-spans.ts'

/** One residual-Simplified finding in a zh-TW document. */
export interface ZhTwIssue extends Match {
  /** Repository-relative document path. */
  file: string
}

const simplifiedToStandard = OpenCC.Converter({ from: 'cn', to: 't' })

/**
 * Whether the line containing a finding still carries Simplified characters.
 * Judged on the whole line, not the matched substring: OpenCC s2t maps 面 to
 * 麵 in isolation, but 面 is correct inside 介面包 (interface wrapper), so a
 * substring check would misreport it.
 */
function lineHasSimplifiedChars(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  return simplifiedToStandard(line) !== line
}

/**
 * Check one zh-TW Markdown document for residual Simplified Chinese.
 *
 * Only findings whose containing line still carries a Simplified character are
 * reported — a zh-TW document is done when every Simplified character is
 * converted. Vocabulary-preference suggestions (聲明→宣告, 綁定→繫結) and
 * substring false positives (面包 inside 介面包) are left to review.
 *
 * @param markdown - Traditional Chinese Markdown prose.
 * @param file - Repository-relative path for reporting.
 * @returns Every residual-Simplified finding in unprotected prose.
 */
export function checkZhTwDocument(markdown: string, file = ''): ZhTwIssue[] {
  // The language-switcher line carries the 简体中文 label (UI chrome, not
  // body prose); without protection its Simplified characters would count
  // as residual findings in every document.
  const switcherLines: string[] = []
  const withSwitchers = markdown.replace(
    /^\[English\]\([^)]*\.md\) \| .+$/gm,
    (line: string) => {
      switcherLines.push(line)
      return '\u0000ZH_TW_SWITCHER\u0000'
    },
  )
  const { text } = protectSpans(withSwitchers)
  return check(text)
    .filter(issue => lineHasSimplifiedChars(text, issue.start))
    .map(issue => ({ ...issue, file }))
}

/**
 * Check one `.zh-tw.md` file from the working tree.
 *
 * @param path - Repository-relative `.zh-tw.md` path.
 * @returns Findings for that file.
 * @throws Error when the file is missing.
 */
export function checkZhTwFile(path: string): ZhTwIssue[] {
  const source = resolve(import.meta.dirname, '..', path)
  if (!existsSync(source)) throw new Error(`missing ${path}`)
  return checkZhTwDocument(readFileSync(source, 'utf8'), path)
}

/** Discover every `.zh-tw.md` in the pairing corpus. */
function discoverCorpus(): string[] {
  const root = resolve(import.meta.dirname, '..')
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/translation-pairing.manifest.json'), 'utf8')) as {
    excluded: string[]
  }
  const excluded = manifest.excluded.map(entry => entry.endsWith('/') ? entry : `${entry}/`)
  const targets: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'lib', '.git', 'vendor', '.cache', '.sessions', '.storages', '.artifacts', 'dist-exe', 'coverage'].includes(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = full.slice(root.length + 1).split(sep).join('/')
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.zh-tw.md') && !excluded.some(prefix => rel.startsWith(prefix))) targets.push(rel)
    }
  }
  walk(root)
  return targets.sort()
}

/** CLI entry: check named files, or the whole corpus with --all. */
export function main(argv: string[]): void {
  const allMode = argv.includes('--all')
  const paths = argv.filter(argument => !argument.startsWith('--'))
  const targets = allMode ? discoverCorpus() : paths
  if (targets.length === 0) {
    throw new Error('verify-zh-tw: expected one or more .zh-tw.md paths, or --all for the whole corpus')
  }
  let total = 0
  const missing: string[] = []
  for (const path of targets) {
    let issues: ZhTwIssue[]
    try {
      issues = checkZhTwFile(path)
    } catch (error) {
      console.error(`verify-zh-tw: ${error instanceof Error ? error.message : String(error)}`)
      missing.push(path)
      continue
    }
    for (const issue of issues) {
      console.log(`${issue.file}:${issue.start}-${issue.end}: ${issue.source} → ${issue.target}`)
      total++
    }
  }
  if (total > 0 || missing.length > 0) {
    if (total > 0) {
      console.error(`verify-zh-tw: ${total} residual Simplified-Chinese finding(s) in ${targets.length} file(s)`)
    }
    if (missing.length > 0) {
      console.error(`verify-zh-tw: ${missing.length} of ${targets.length} named file(s) missing or unreadable`)
    }
    process.exit(1)
  }
  console.log(`verify-zh-tw: ${targets.length} zh-TW file(s) checked, no residual Simplified Chinese.`)
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href

if (isMain) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`verify-zh-tw: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
