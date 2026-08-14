/** Regression tests for the zh-TW verification gate. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkZhTwDocument,
  checkZhTwFile,
} from './verify-zh-tw.ts'

describe('zh-TW document check', () => {
  it('accepts clean Traditional Chinese prose', () => {
    expect(checkZhTwDocument('這個軟體需要最佳化，使用者權限請聯絡管理員。')).toEqual([])
  })

  it('protects the three-way language-switcher line', () => {
    const doc = '# 標題\n\n[English](server.md) | [简体中文](server.zh.md) | 繁體中文\n\n正文。\n'
    expect(checkZhTwDocument(doc)).toEqual([])
  })

  it('flags residual Simplified Chinese characters', () => {
    const issues = checkZhTwDocument('这个软件需要优化，用户权限请联系管理员。')
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some(issue => issue.source === '这个')).toBe(true)
    expect(issues.some(issue => issue.source === '用户')).toBe(true)
  })

  it('ignores vocabulary-preference suggestions with no Simplified characters', () => {
    // 聲明/綁定 are already Traditional; the suggestion to use 宣告/繫結 is a
    // review call, not a residual-Simplified error.
    expect(checkZhTwDocument('聲明與綁定。')).toEqual([])
  })

  it('ignores code spans and fenced blocks', () => {
    const doc = '命令是 `打印文件` 和 `服务器`。\n\n```ts\nconst 信息 = "数据"\n```\n'
    expect(checkZhTwDocument(doc)).toEqual([])
  })

  it('flags only the prose around protected spans', () => {
    const doc = '这个软件 `服务器` 需要优化'
    const issues = checkZhTwDocument(doc)
    expect(issues.some(issue => issue.source === '这个')).toBe(true)
    expect(issues.some(issue => issue.source === '服务器')).toBe(false)
  })

  it('reports a stable issue shape with offsets', () => {
    const [issue] = checkZhTwDocument('用户')
    expect(issue).toBeDefined()
    if (issue === undefined) return
    expect(issue).toMatchObject({ source: '用户', target: '使用者' })
    expect(typeof issue.start).toBe('number')
    expect(typeof issue.end).toBe('number')
  })
})

describe('zh-TW file check', () => {
  it('throws on a missing named path', () => {
    expect(() => checkZhTwFile('docs/i18n/does-not-exist.zh-tw.md')).toThrow(/missing/)
  })

  it('exits non-zero from the CLI when a named path is missing', () => {
    const script = resolve(import.meta.dirname, 'verify-zh-tw.ts')
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', script, 'docs/i18n/does-not-exist.zh-tw.md'],
      { encoding: 'utf8' },
    )
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('missing or unreadable')
  })
})
