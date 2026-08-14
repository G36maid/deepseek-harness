# `@deepseek-ai/dsh`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`dsh` 是 DeepSeek Harness 中用於啟動 profile 的命令；profile 由多個外掛程式組合包 patch 層按順序疊加而成，其上再應用使用者自己的覆蓋設定。[`src/args.ts`](src/args.ts) 負責命令文法，[`src/bin.ts`](src/bin.ts) 只載入選中的執行器。無效命令、來自其他模式的選項、設定錯誤和啟動失敗都會以非零狀態結束。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 啟動位於 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 執行一個全新的持久化工作階段，列印最終答案並結束。 |
| `dsh web` | `--profile web` 的別名。 |
| `dsh plugin --profile <name> <pnpm args>` | 透過在 profile 目錄中轉發給 pnpm 來管理該 profile 的外掛程式。 |

執行命令時所在的目錄將作為預設 workspace 根目錄。`web` 和 `headless` profile 在首次使用時會從隨附樣板自動初始化；其他任何 profile 都必須透過 `dsh plugin` 建立。

## 應用參數

啟動器只解析自身的 flag，並將其後的所有內容交給已啟動的 profile；注入該 profile 的任意應用外掛程式都可以解析這份共享的不可變快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.md)）。因此，啟動器的 flag 必須寫在最前面；啟動器無法識別的第一個 token 標志著應用參數的開始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profile

profile 目錄包含一個 `package.json`，其中記錄樹外外掛程式相依性，以及 profile manifest（中繼資料清單）`dsh.profile` 和其中按順序排列的 `bundles` 清單；還包含一個 `cordis.patch.yml`，其中保存使用者自己的 patch 層。

設定樹以空根為起點，依次疊加以下設定層：
- `dsh.profile.bundles` 中各組合包的 patch
- profile 自身的 `cordis.patch.yml`，然後是 home 級的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆蓋層

`dsh.profile.bundles` 中列出的組合包先從 dsh 安裝目錄解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再從 profile 自身的 `node_modules` 解析；pnpm 會將樹外外掛程式安裝到該目錄。

使用 `--dump-default-config` 和 `--dump-config` 可在不啟動的情況下檢查組合後的設定樹。

層的確切優先級、flag、關閉行為、部署預設值和原始碼執行方式，以 [CLI（命令列介面）行為參考](reference/README.md)為準。

## 開發

生產執行需要已建置的包與前端產物。請在倉庫根目錄單獨執行 `pnpm run build`，然後使用 `pnpm dsh <args...>` 執行 TypeScript 入口並轉發所有參數；模組解析約定以[原始碼執行參考](reference/README.md#source-execution)為準。
