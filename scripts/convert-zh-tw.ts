/**
 * Convert Simplified Chinese (zh-CN) Markdown into Traditional Chinese
 * (zh-TW). The pipeline protects code spans and link targets from conversion,
 * applies the zhtw-js converter for character and vocabulary conversion, and
 * feeds the repo's [terminology-zh-tw.md](../docs/i18n/terminology-zh-tw.md)
 * replacement table as a custom dictionary so technical-context renderings
 * override the general converter (e.g. 打包 stays 打包 in a packaging sense,
 * not 外帶).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createConverter } from 'zhtw-js'
import * as OpenCC from 'opencc-js'
import { protectSpans, restoreSpans } from './zh-tw-spans.ts'

/** Simplified → standard-Traditional glyph fallback for chars zhtw-js leaves behind. */
const simplifiedToStandard = OpenCC.Converter({ from: 'cn', to: 't' })

/** A parsed simplified-to-traditional correction entry. */
export type ZhTwCorrections = Map<string, string>

const CORRECTION_LINE = /^\|\s*([^|\s][^|]*?)\s*\|\s*([^|\s][^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/

/** Sort a correction map longest-key-first so multi-character terms win. */
function sorted(map: Map<string, string>): Map<string, string> {
  return new Map([...map].sort(([left], [right]) => right.length - left.length))
}

/**
 * Parse the `docs/i18n/terminology-zh-tw.md` replacement table into
 * simplified → traditional pairs. Same-form rows (同形词) are kept so the
 * custom dictionary can pin a rendering zhtw-js would otherwise mis-convert
 * (e.g. 打包 stays 打包 in a packaging sense, not 外帶). Rows whose
 * traditional form contains the key as a substring are dropped — the custom
 * dictionary would otherwise compound the replacement (工作流 → 工作流程 → 工作流程程).
 *
 * @param table - Full Markdown of the terminology-zh-tw table.
 * @returns The correction map, longest-key-first so multi-character terms win.
 */
export function loadZhTwCorrections(table: string): ZhTwCorrections {
  const corrections = new Map<string, string>()
  let inReplacementTable = false
  for (const line of table.split('\n')) {
    if (line.startsWith('## ')) {
      inReplacementTable = line.includes('需要替换的词条')
      continue
    }
    if (!inReplacementTable) continue
    const match = CORRECTION_LINE.exec(line)
    if (!match?.[1] || !match[2]) continue
    const simplified = match[1].trim()
    const traditional = match[2].trim()
    // Keep same-form rows (打包→打包) so the dictionary pins a rendering the
    // converter would mis-convert, but drop rows whose value contains the key
    // as a proper longer substring (工作流→工作流程 would compound).
    if (!(simplified !== traditional && traditional.includes(simplified))) corrections.set(simplified, traditional)
  }
  return sorted(corrections)
}

/** Fix the language-switcher line for the Traditional Chinese side. */
function fixSwitcher(markdown: string): string {
  // Any surviving two-way form (old `| 中文`, or a bare `| 简体中文` whose
  // label survived protection) becomes the three-way switcher.
  return markdown.replace(
    /^\[English\]\(([^)]*\.md)\) \| (?:中文|简体中文)(?: \| \[繁體中文\]\([^)]*\))?$/gm,
    (_match, enRef: string) => `[English](${enRef}) | [简体中文](${enRef.replace(/\.md$/, '.zh.md')}) | 繁體中文`,
  )
}

/**
 * Convert one zh-CN Markdown document into zh-TW.
 *
 * The zhtw-js converter handles character and vocabulary conversion; the repo
 * replacement table overrides vocabulary where the general converter would
 * mis-render a technical context (e.g. 打包 → 打包 in a packaging sense, not
 * 外帶); OpenCC s2t finishes any Simplified characters zhtw-js leaves behind
 * (循环 → 循環, 准 → 準, 面包 → 麵包). Code spans and link targets stay
 * protected throughout.
 *
 * @param markdown - Simplified Chinese Markdown source.
 * @param corrections - Pre-conversion correction set; defaults to the repo table.
 * @returns The converted Traditional Chinese Markdown.
 */
export function convertChineseMarkdown(markdown: string, corrections?: ZhTwCorrections): string {
  const table = corrections ?? loadZhTwCorrections(
    readFileSync(resolve(import.meta.dirname, '../docs/i18n/terminology-zh-tw.md'), 'utf8'),
  )
  // The language-switcher line carries language labels (简体中文 / 繁體中文)
  // that are UI chrome, not body prose: converting them would turn the
  // Simplified label into 繁體中文. Protect the whole line verbatim before
  // code-span protection so its link targets still match.
  const switcherLines: string[] = []
  const withSwitchers = markdown.replace(
    /^\[English\]\([^)]*\.md\) \| .+$/gm,
    (line: string) => {
      switcherLines.push(line)
      return '\u0000ZH_TW_SWITCHER\u0000'
    },
  )
  const { text, spans } = protectSpans(withSwitchers)
  const converter = createConverter({ customDict: Object.fromEntries(table) })
  let converted = simplifiedToStandard(converter.convert(text))
  // Reinsert the protected switcher lines in order.
  converted = converted.replace(/\u0000ZH_TW_SWITCHER\u0000/g, () => switcherLines.shift() ?? 'SWITCHER')
  const restored = restoreSpans(converted, spans)
  return fixSwitcher(applyTerminologyOverrides(restored))
}

/**
 * Fix zhtw-js output that is Traditional Chinese but mainland-flavored.
 * zhtw-js converts 进程→進程 (literal) where Taiwan uses 行程, keeps 用户 as
 * 用戶 where Taiwan uses 使用者 (except the compound 用戶端 = client, which
 * is the standard Taiwan rendering), and maps 噪声→噪聲 where Taiwan uses
 * 噪音. Each replacement is unambiguous in the repo corpus: 程序 (program)
 * is NOT remapped because it legitimately means 程式.
 */
function applyTerminologyOverrides(markdown: string): string {
  return markdown
    .split('用戶端').join('\u0000ZH_TW_CLIENT\u0000')
    .split('用戶').join('使用者')
    .split('\u0000ZH_TW_CLIENT\u0000').join('用戶端')
    .split('噪聲').join('噪音')
    .split('存儲').join('儲存')
    .split('進程').join('行程')
}

/** Convert one zh-CN file into its `.zh-tw.md` sibling. */
export function convertFile(path: string): string {
  const source = resolve(import.meta.dirname, '..', path)
  const target = source.replace(/\.zh\.md$/, '.zh-tw.md')
  if (!source.endsWith('.zh.md')) {
    throw new Error(`convert-zh-tw: expected a .zh.md path, got ${JSON.stringify(path)}`)
  }
  if (!existsSync(source)) throw new Error(`convert-zh-tw: source file missing: ${path}`)
  const converted = convertChineseMarkdown(readFileSync(source, 'utf8'))
  writeFileSync(target, converted)
  return target.replace(resolve(import.meta.dirname, '..'), '').replace(/^\//, '')
}

/** Repo root for corpus discovery. */
const root = resolve(import.meta.dirname, '..')

/** Convert every paired zh-CN file named on the command line, or the whole corpus. */
export function main(argv: string[]): void {
  const allMode = argv.includes('--all')
  const paths = argv.filter(argument => !argument.startsWith('--'))
  if (allMode && paths.length > 0) {
    throw new Error('convert-zh-tw: --all takes no path arguments')
  }
  let targets: string[]
  if (allMode) {
    const scope = readFileSync(resolve(import.meta.dirname, '../scripts/translation-pairing.manifest.json'), 'utf8')
    const excluded = (JSON.parse(scope) as { excluded: string[] }).excluded
    targets = []
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git' || entry.name === 'vendor') continue
        const full = join(dir, entry.name)
        const rel = full.slice(root.length + 1).split(sep).join('/')
        if (entry.isDirectory()) {
          // Frozen archived triplets never gain a zh-TW side.
          if (rel === '.agents/notes/archived' || rel.startsWith('.agents/notes/archived/')) continue
          walk(full)
        } else if (entry.name.endsWith('.zh.md') && !excluded.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) {
          targets.push(rel)
        }
      }
    }
    walk(root)
  } else if (paths.length === 0) {
    throw new Error('convert-zh-tw: expected one or more .zh.md paths, or --all for the whole corpus')
  } else {
    targets = paths
  }
  for (const path of targets) {
    const written = convertFile(path)
    console.log(`convert-zh-tw: wrote ${written}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`convert-zh-tw: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
