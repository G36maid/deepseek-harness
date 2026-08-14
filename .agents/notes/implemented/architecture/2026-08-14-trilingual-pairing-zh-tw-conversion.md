# Agent Note: Trilingual documentation pairing and the zh-TW conversion pipeline

Status: implemented



## Problem

The repo's documentation and Web UI shipped English plus Simplified Chinese only, and every pairing gate, the website projection, the locale registry, and the translation prompt encoded exactly two languages. Adding Taiwan Traditional Chinese (zh-TW) therefore touched every layer: the pairing record format, the corpus discovery, the merge driver, the site locale model, the client locale set, and the machine translation contract. The zh-TW side could not be hand-translated from English like zh-CN — the corpus is ~1,000 documents and zh-TW is derived from zh-CN, not from English, so a mechanical conversion pipeline followed by review is the only tractable production path.

## Decision

**The pairing model is a language map, not a fixed two-slot record.** `PAIRED_LANGUAGES = ['en', 'zh', 'zh-TW']` with per-language file suffixes (`.md`, `.zh.md`, `.zh-tw.md`) and a `.i18n.yaml` record holding one git blob hash per language. The gate, the merge driver, and the `--write` flow all iterate the language set instead of hardcoding the Chinese side; adding a fourth language later is a one-line registry change.

**zh-TW is machine-derived from zh-CN, then reviewed against English.** The conversion tool (`scripts/convert-zh-tw.ts`) runs zhtw-js — a vocabulary-first Taiwan converter with ~31K terms and a custom dictionary from `docs/i18n/terminology-zh-tw.md` — then an OpenCC s2t glyph fallback for characters zhtw-js leaves behind, then the pairing-gate re-record. Review cross-checks the result against the English source because a pure zh→zh-TW pass inherits any drift in the zh rendering. The mechanical-trap table of the terminology file records OpenCC outputs that must be corrected (权限 → 許可權 is wrong; 權限 is right).

**The zh-TW gate reports residual Simplified characters, not vocabulary preferences.** `scripts/verify-zh-tw.ts` filters zhtw-js check findings through OpenCC s2t: only spans that still contain a Simplified character fail. Vocabulary suggestions (聲明 → 宣告, 綁定 → 繫結) stay review decisions because both forms are legitimate Taiwan usage.

**Every shipped layer carries the third language.** The browser client locale set is `['zh', 'zh-TW', 'en']` with script-subtag browser detection (`zh-Hant-TW` → zh-TW); every locale namespace registers a zh-TW dictionary; the website projects a `/zh-TW/` route with its own sidebar and search labels; the translation prompt accepts a `Chinese-TW` target for zh→zh-TW transcription.

**Frozen archived triplets never gain a zh-TW side.** `.agents/notes/archived/` is excluded from conversion discovery and pairing; the converter skips the tree, and the archive verifier continues to seal the existing en+zh triplet.

## Consequences

The pairing gate is green across all 936 in-scope pairs with three recorded hashes each. The conversion corpus is 934 zh-TW files (the two contract files under docs/i18n/ existed first); `verify-zh-tw --all` reports 14 residual Simplified characters, all in the 面包/游程 edge vocabulary where 面/游 have legitimate traditional readings the converter cannot disambiguate. The website builds in three locales (`pnpm run docs:build`), the client test suite is green with the third locale (`pnpm run test:gui`), and `customConditions: ['node']` was added to the base tsconfig so TypeScript resolves zhtw-js's conditional exports (the package ships `node`/`browser` export conditions without a top-level `types`).

## Alternatives considered

- **OpenCC s2twp as the conversion engine** — produces 5,094 residual findings across the corpus because its Taiwan phrase table is thinner than zhtw-js's and it mis-converts 权限 → 許可權 (a trap the terminology table must then fix). zhtw-js converts the same corpus to 14 residuals. Its vocabulary-first design also lets the repo terminology table act as a custom dictionary, so 打包 stays 打包 in a packaging sense instead of becoming 外帶.
- **Two-slot record with a hardcoded zh-TW field** — avoids generalizing the gate, but every future language (zh-HK, ja) would repeat the same churn; the map is the same cost now and free later.
- **Hand-translating zh-TW from English** — infeasible at ~1,000 documents and redundant with the zh rendering; machine conversion plus review keeps the human cost on quality, not transcription.
- **Treating archived triplets as convertible** — violates the freeze; the archive verifier would reject a fourth file and the pairing contract promises never to rewrite archived content.
