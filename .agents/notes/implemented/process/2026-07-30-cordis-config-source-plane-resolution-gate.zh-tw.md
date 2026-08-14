# Agent Note: verify-cordis-config 對設定中外掛程式的原始碼面解析實施閘門

Status: implemented

[English](2026-07-30-cordis-config-source-plane-resolution-gate.md) | [简体中文](2026-07-30-cordis-config-source-plane-resolution-gate.zh.md) | 繁體中文

## 問題

`apps/cli/config/tui.cordis.yml` 新增了 `@deepseek-ai/dsh-tui/prompt` 設定項，卻沒有對應的 tsconfig `paths` 對映。通用的 `@deepseek-ai/dsh-*` 萬用字元會把 `tui/prompt` 整體代入其 `<group>/*/src` 候選路徑，而這些路徑全都不存在，因此 [tsx 原始碼啟動](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md) 會回退到包的 `exports`，解析出產物面文件 `lib/prompt.js`。任何帶有已建置 `lib/` 的環境（開發者目錄樹執行 `pnpm build` 後）都能正常啟動，而 e2e 工作流程以 `lib` 模式（`DSH_EXAMPLE_MODE=lib`，建置產物 bin 在普通 Node 下執行）執行無金鑰 TUI PTY 冒煙測試，因此 CI 根本不會經過原始碼啟動向量——與此同時，所有乾淨檢出環境中的 `pnpm dsh` 都會在啟動時失敗，並報錯 `plugin(s) failed to load: @deepseek-ai/dsh-tui/prompt`。當時沒有閘門檢查原始碼面，因此該故障未被發現便進入發布版本，僅在新的 worktree 中暴露。

## 決策

`scripts/verify-cordis-config.ts`（`validateSourcePlaneResolution`）要求設定中凡是引用本機 workspace 包的模組說明符（包括 harness 包與納入 vendor 的 Cordis）都必須透過 `tsconfig.base.json` 的 `paths` 外觀層（facade）解析到 `.ts`/`.tsx` 原始檔；解析以倉庫根目錄為起點，呼叫 `ts.resolveModuleName` 完成。解析失敗或命中 `.d.ts`（即經 `exports` 回退到建置出的 `lib/types`）都會使 `verify-cordis-config` 失敗，並列出設定檔與模組說明符。缺失的 `@deepseek-ai/dsh-tui/prompt` 對映已新增在其他顯式子路徑條目旁；刪除該對映即可復現閘門失敗。

## 備選方案

**相依性無金鑰 TUI PTY 冒煙測試。** 在默認原始碼模式下，該測試透過原始碼向量啟動真實目錄樹，確實能捕獲這個故障，但僅限乾淨目錄樹。CI 的 e2e 工作流程只以 `lib` 模式執行它（建置產物 bin 透過真實的包 `exports` 解析），因此沒有任何 CI 環節執行原始碼向量，而帶有過時 `lib/` 的開發者目錄樹在本機也仍被掩蓋。為 CI 增加一個原始碼模式冒煙測試，每次也只能證明一種組合；靜態閘門則覆蓋所有隨產品發布的設定與示例設定。

**將 `dsh-source-launch-smoke` 相容性測試擴充為完整啟動。** node-compat 冒煙測試只斷言 TTY 拒絕，而該拒絕發生在外掛程式載入之前。每條矩陣版本線都執行一次完整的無金鑰啟動，會以更高成本重複 PTY 冒煙測試，而且同樣只能驗證一種組合，無法覆蓋所有隨產品發布的設定與示例設定。

**使用類似 `@deepseek-ai/dsh-*/prompt` 的萬用字元對映。** 這能修復當前子路徑，卻不能杜絕這一類問題；下一個單文件子路徑匯出（`/surface`、`/message` 等）仍會以同樣方式復發。靜態閘門覆蓋當前及未來設定中引用的所有模組說明符。

## 結果

- 設定中的 workspace 模組說明符若只能透過建置後的 `lib/` 解析，現在會導致 `verify-cordis-config` 閘門失敗（在 `hygiene` 和 CI 中執行），而不再成為只在乾淨目錄樹中出現的啟動崩潰。
- cordis.yml 中引用新的單文件子路徑匯出時，必須同步為 `tsconfig.base.json` 新增顯式 `paths` 條目；閘門訊息會明確提示這一要求。
- 閘門只使用 `tsconfig.base.json` 的選項執行解析；如果某個模組說明符需要僅用戶端可用的編譯器選項才能解析，閘門就會失敗。這符合該外觀層作為 tsx 與 vitest 唯一解析入口的定位。
