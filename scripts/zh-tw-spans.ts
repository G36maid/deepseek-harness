/**
 * Shared code-span protection for the zh-TW conversion and verification
 * pipeline. Code spans, fenced blocks, and link targets are replaced with
 * opaque tokens before character conversion or linting so machine text stays
 * untouched, then restored.
 */

/** A protected span kept verbatim through conversion or checking. */
export interface ProtectedSpan {
  token: string
  content: string
}

const TOKEN_PREFIX = '\u0000ZH_TW\u0000'

/** Extract code spans, fenced blocks, and link targets into protected tokens. */
export function protectSpans(markdown: string): { text: string; spans: ProtectedSpan[] } {
  const spans: ProtectedSpan[] = []
  let index = 0
  const replace = (content: string): string => {
    // The trailing `;` bounds the numeric token: a span followed directly
    // by a prose digit would otherwise let the restore regex swallow it.
    const token = `${TOKEN_PREFIX}${index++};`
    spans.push({ token, content })
    return token
  }
  // Fenced code blocks first (their content may contain inline-backtick text).
  // The opener must sit at line start: inline code that merely mentions ``` is
  // not a fence.
  const withFences = markdown.replace(
    /(^```[^\n]*\n[\s\S]*?^```)/gm,
    (_match, block: string) => replace(block),
  )
  // Inline code spans.
  const withInline = withFences.replace(/`[^`\n]+`/g, match => replace(match))
  // Link targets — convert only the visible text, never the destination.
  const withLinks = withInline.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*))?\)/g,
    (_match, text: string, target: string, rest: string | undefined) => {
      const protectedTarget = replace(target)
      const protectedRest = rest === undefined ? '' : replace(rest)
      return `[${text}](${protectedTarget}${rest === undefined ? '' : ` ${protectedRest}`})`
    },
  )
  return { text: withLinks, spans }
}

/** Restore protected tokens to their original content in one pass. */
export function restoreSpans(text: string, spans: ProtectedSpan[]): string {
  const byToken = new Map(spans.map(span => [span.token, span.content]))
  return text.replace(/\u0000ZH_TW\u0000\d+;/g, token => byToken.get(token) ?? token)
}
