# Agent Note: 把 vendored Cordis 重新命名進 @deepseek-ai scope

Status: implemented

[English](2026-08-10-vendor-package-rescope.md) | [简体中文](2026-08-10-vendor-package-rescope.zh.md) | 繁體中文

## 問題

`vendor/` 下的九個包此前保留上游 npm 名（`cordis`、`cosmokit`、`schemastery`、`@cordisjs/plugin-*`）。這個前提在發布時不成立：每個 harness 包都把 `cordis` 聲明成 peer dependency，裝了 `@deepseek-ai/dsh-*` 的消費者必須能從 registry 解析到它，所以發布 harness 必然連帶發布這一層框架。用上游名發布就是在 registry 上佔用別人的名字；若該 registry 對 npmjs 做上游代理，本名條目還會遮蔽真正的上游包，把錯誤的框架裝進無關項目。

## 決定

九個包統一改名進 `@deepseek-ai` scope。目錄名、上游版本號、相依性 range 一律不動，所以 `vendor/README.md` 的清單仍然讀作一份上游快照。面向使用者的對映表見 [docs/rescope.md](../../../../docs/rescope.md)。

| 目錄 | npm 名 | 上游名 |
|---|---|---|
| `cordis/` | `@deepseek-ai/cordis` | `cordis` |
| `cosmokit/` | `@deepseek-ai/cosmokit` | `cosmokit` |
| `schemastery/` | `@deepseek-ai/schemastery` | `schemastery` |
| `loader/` | `@deepseek-ai/cordis-plugin-loader` | `@cordisjs/plugin-loader` |
| `include/` | `@deepseek-ai/cordis-plugin-include` | `@cordisjs/plugin-include` |
| `group/` | `@deepseek-ai/cordis-plugin-group` | `@cordisjs/plugin-group` |
| `timer/` | `@deepseek-ai/cordis-plugin-timer` | `@cordisjs/plugin-timer` |
| `hmr/` | `@deepseek-ai/cordis-plugin-hmr` | `@cordisjs/plugin-hmr` |
| `logger-console/` | `@deepseek-ai/cordis-plugin-logger-console` | `@cordisjs/plugin-logger-console` |

改寫只落在**帶定界符的完整包名 token** 上：引號或反引號包裹的 specifier（可帶 `/子路径`）、`package.json` 的 `name` 與相依性鍵、`cordis.yml` 的 `name:` 值、`tsconfig.base.json` 的 `paths` 鍵。因此以下同形串一律未改，它們不是包名：`cordis.yml` 及其家族檔名、Loader 的 `cordis:` 內建前綴（`cordis:include`、`cordis:group`，見 `vendor/loader/src/config/tree.ts`）、`cordis-config-entry` 這類 kind 串、`@deepseek-ai/dsh-tool-cordis`、Schemastery 上游的 `Symbol.for('schemastery')` 與 `vendor:` 元資料、`scripts/gen-module-graph.ts` 與 `gen-doc-graphs.ts` 裡 `GROUP_ORDER` 的 `packages/<group>/` 目錄名，以及 `vendor/*/README.md` 裡的上游安裝指引。

Token 規則看不見兩類點位，它們按名字逐處改：一是屬性訪問 `manifest.peerDependencies?.cordis`——TypeScript 抓不到過期的 `Record<string, string>` 鍵；二是把名字當資料的常數（`check-workspace-constraints.ts` 的 vendored 集合、`verify-cordis-config.ts` 的 group/include 名、`cordis-walk.ts` 與 `gen-scoped-events.ts` 與 typert `analyzer.ts` 裡識別 `declare module` 目標的字串、`app-boot/tsdown.config.ts` 的 `alwaysBundle`）。

Markdown 按「讀者拿它做什麼」一分為二。圍欄一律跟著改，不看 info string——圍欄裡是讀者要照抄的程式碼或要掛載的設定，包括寫著 Loader 外掛程式名的 `yaml` 圍欄和緊鄰編譯圍欄的 `ts ignore-check` 圍欄。散文只在 `docs/` 下跟著改：教程裡引用某個名字的句子，教的是本倉已不解析的東西。`docs/` 之外的散文——`vendor/*/README.md`、各包 README、`.agents/notes/`——保留寫作當時的名字：既因為它記錄的是當時的事實，也因為同一個拼寫可能指別的東西，比如 Python SDK 的 `cordis` 選項、我們沒 vendor 的 `@cordisjs/plugin-http`，或某個 agent-preset 的 id。

## 影響

- 發布集裡不再有任何上游名：`publish-npm-baseline.ts` 現在無條件要求每個待發包都是 `@deepseek-ai/*`，vendored 包不再豁免，改名一旦回退就會在打包前失敗。
- `vendor/README.md` 的清單表新增「上游名」列，`gen-third-party-notices` 隨之解析六列並把上游名渲進 `THIRD_PARTY_NOTICES.md`；MIT 歸屬指向 fork 的來源，而不是我們的 scope。
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 刪去 `cordis` 與 `@cordisjs/plugin-loader` 兩條：改名後這兩個名字永遠不從 registry 取。`knip.json` 的 `@cordisjs/.+` 忽略模式同理刪除，已被 `@deepseek-ai/.+` 覆蓋。
- 上游 sync 照 `vendor/README.md` 的流程走，第 3 步多一項：對拷進來的原始碼重跑 `pnpm run rescope-vendor --apply`，指令碼裡的對映與清單表兩列名字必須一致。
- **要回到官方上游包**時反著跑這份對映——`pnpm run rescope-vendor --apply --reverse`——再補回 `minimumReleaseAgeExclude` 兩條、放開發布集對 `@deepseek-ai/*` 的斷言。改寫量約 1300 個文件，用指令碼重放而不是手改。

改名這件事由 `scripts/rescope-vendor.ts` 承載：對映、帶定界符的 token 規則、名字其實是目錄而非包時的逐文件豁免、上面那批精確改寫，以及一個斷言「零殘留、每條精確改寫都落上、冪等」的 `--check` 模式——它由 `hygiene` 門在每次 CI 上執行。rebase 時重放它，而不是去解一個 1300 文件的衝突；上游動了任一被釘住的點位，指令碼會響亮失敗而不是靜默漏改。

## 考慮過的替代方案

**保留上游名，把 `vendor/` 排除在發布集之外。** 否決：每個 harness 包都聲明 `cordis` 為 peer dependency，裝好的 `@deepseek-ai/dsh-*` 會解析不到框架。

**只在打包時改名。** 否決：寄出去的名字與原始碼樹不一致，所有模組 specifier 得在發布路徑裡現改，本機也沒有任何一次執行能復現發布出去的東西。

**目錄名與版本號一並改。** 否決：目錄名不是發布標識，改它會連帶項目引用、tsdown glob 與文件路徑，收益為零；版本號並入 `0.0.1` 後不再滿足保留下來的 `^4.0.0-rc.7` range，pnpm 會轉去 registry 找副本，`verify-vendored-links` 直接紅。

**`docs/` 之外的散文與歷史 Agent Note 一起改。** 否決：它們記錄的是寫作當時的事實，而且那裡的裸 `cordis` 同樣可能是 SDK 選項名或某個 preset id，未必是包；面向讀者的對映由 `docs/rescope.md` 承載。
