/** Regression tests for zh-CN → zh-TW Markdown conversion. */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  convertChineseMarkdown,
  loadZhTwCorrections,
} from './convert-zh-tw.ts'

const root = resolve(import.meta.dirname, '..')

describe('zh-TW conversion corrections', () => {
  it('loads the terminology tables into a correction map', () => {
    const table = readFileSync(join(root, 'docs/i18n/terminology-zh-tw.md'), 'utf8')
    const corrections = loadZhTwCorrections(table)
    expect(corrections.get('智能体')).toBe('代理')
    expect(corrections.get('配置')).toBe('設定')
    expect(corrections.get('插件')).toBe('外掛程式')
    expect(corrections.size).toBeGreaterThan(50)
  })

  it('skips rows with identical or absent translations', () => {
    const corrections = loadZhTwCorrections('| 简体中文 | 繁體中文 | English 錨點 | 備註 |\n|---|---|---|---|\n| 子代理 | 子代理 | subagent | 同形词 |\n| 事件 | 事件 | event | 同形词 |\n')
    expect(corrections.size).toBe(0)
  })

  it('drops rows whose translation contains the key, which would compound on re-application', () => {
    const corrections = loadZhTwCorrections('| 简体中文 | 繁體中文 | English 錨點 | 備註 |\n|---|---|---|---|\n| 工作流 | 工作流程 | workflow | |\n| 高可用 | 高可用性 | high availability | |\n')
    expect(corrections.has('工作流')).toBe(false)
    expect(corrections.has('高可用')).toBe(false)
  })
})

describe('zh-CN to zh-TW Markdown conversion', () => {
  it('converts characters, phrases, and terminology while preserving structure', () => {
    const source = [
      '# 服务器',
      '',
      '[English](server.md) | 中文',
      '',
      '服务器的软件需要优化，用户权限请联系管理员。',
      '',
      '```ts',
      '// 这是注释：const x = "信息"',
      'const message = "data"',
      '```',
      '',
      '命令是 `print("信息")`，文件在 `docs/guide.md`。',
    ].join('\n')

    const converted = convertChineseMarkdown(source)

    expect(converted).toContain('[English](server.md) | [简体中文](server.zh.md) | 繁體中文')
    expect(converted).toContain('伺服器的軟體需要最佳化，使用者權限請聯絡管理員。')
    // code fence content stays byte-identical (comments included)
    expect(converted).toContain('// 这是注释：const x = "信息"')
    expect(converted).toContain('const message = "data"')
    // inline code stays byte-identical
    expect(converted).toContain('`print("信息")`')
    expect(converted).toContain('`docs/guide.md`')
  })

  it('fixes the OpenCC 权限→許可權 mis-conversion via the correction table', () => {
    const converted = convertChineseMarkdown('用户权限。')
    expect(converted).toBe('使用者權限。')
    expect(converted).not.toContain('許可權')
  })

  it('does not convert English terms kept in the repo terminology', () => {
    const source = 'agent harness 提供 seam 与 spill，通过 waterfall 事件。'
    const converted = convertChineseMarkdown(source)
    expect(converted).toContain('agent harness')
    expect(converted).toContain('seam')
    expect(converted).toContain('spill')
    expect(converted).toContain('waterfall')
  })

  it('preserves structure when inline code mentions a triple backtick', () => {
    // ` ```ts type-equiv ` inside inline code must not be treated as a fence.
    const source = [
      '# 服务器',
      '',
      '代码块使用 ` ```ts type-equiv ` 围栏，`doc-typecheck` 编译它。',
      '',
      '- 列表项一',
      '- 列表项二',
      '',
      '完整声明逐字粘贴。',
    ].join('\n')
    const converted = convertChineseMarkdown(source)
    expect(converted.split('\n')).toHaveLength(8)
    expect(converted).toContain('- 清單項一')
    expect(converted).toContain('- 清單項二')
    expect(converted).toContain('` ```ts type-equiv `')
  })

  it('preserves relative link targets (visible text converts; the switcher becomes zh-tw-flavored)', () => {
    const source = '见 [开发指南](../development.md) 与 [README](README.md)。'
    const converted = convertChineseMarkdown(source)
    // Link text is Chinese prose and converts; the destination path stays byte-identical.
    expect(converted).toContain('[開發指南](../development.md)')
    expect(converted).toContain('[README](README.md)')
  })

  it('restores protected spans without token-prefix collisions at two-digit indices', () => {
    // More than 10 inline-code spans force two-digit token indices; a naive
    // sequential restore would let token 3 corrupt the prefix of token 32.
    const codes = Array.from({ length: 14 }, (_unused, index) => `\`code${index}\``).join(' ')
    const source = `# 服务器\n\n[English](server.md) | 中文\n\n${codes}\n\n命令是 \`print("信息")\`。`
    const converted = convertChineseMarkdown(source)
    expect(converted).toContain('[English](server.md) | [简体中文](server.zh.md) | 繁體中文')
    for (let index = 0; index < 14; index++) {
      expect(converted).toContain(`\`code${index}\``)
    }
    expect(converted).toContain('`print("信息")`')
  })

  it('keeps 驱动 as the verb 驅動, not the noun 驅動程式', () => {
    const source = '模型驱动每个请求，循环驱动的 agent 使用运行时事实。'
    const converted = convertChineseMarkdown(source)
    expect(converted).toContain('驅動每個請求')
    expect(converted).toContain('迴圈驅動的 agent')
    expect(converted).not.toContain('驅動程式每個請求')
    expect(converted).not.toContain('迴圈驅動程式的 agent')
  })

  it('protects a three-way language switcher from label conversion', () => {
    // A zh.md whose switcher already names 简体中文 (as the repo-wide
    // three-way form) must survive re-conversion verbatim: converting the
    // Simplified label would turn it into 繁體中文.
    const source = '# 标题\n\n[English](server.md) | [简体中文](server.zh.md) | 繁體中文\n\n正文。\n'
    const converted = convertChineseMarkdown(source)
    expect(converted).toContain('[English](server.md) | [简体中文](server.zh.md) | 繁體中文')
    expect(converted).not.toContain('| [繁體中文](server.zh.md) |')
  })
})
