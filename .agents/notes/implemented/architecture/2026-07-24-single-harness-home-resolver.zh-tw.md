# Agent Note: 單一 harness home 解析器

Status: implemented

[English](2026-07-24-single-harness-home-resolver.md) | [简体中文](2026-07-24-single-harness-home-resolver.zh.md) | 繁體中文

## 問題

對於"DeepSeek Harness 使用者資料存放在哪裡"，harness 裡存在兩套互不一致的約定：

- `@deepseek-ai/dsh-home` 按 `configured ?? $DSH_HOME ?? ~/.dsh` 解析。
- `@deepseek-ai/dsh-home-paths` 又提供了**第二個** `resolveDshHome`，優先級相同但額外做了波浪號展開——它幾乎是 `dsh-home` 的重複實作，卻沒有任何閘門發現，因為兩者分屬不同的包，而且早已漂移（只有一個會展開波浪號）。

同一條橫切事實有兩個解析器，意味著不存在單一的 home 策略。

## 決策

由一個解析器統一掌管 harness home，落在 `@deepseek-ai/dsh-home-paths`，採用單一根目錄：

```
explicit configured path  >  $DSH_HOME  >  ~/.dsh
```

空或僅含空白的 `$DSH_HOME` 被當作未設定處理；否則，`resolve('')` 會悄悄把 home 落在當前工作目錄。harness 把所有使用者資料都放在同一個根目錄下；不存在 XDG 的 config/data/cache 拆分。`dshHomePath(...segments)` 將部署負責的子路徑拼接到該根目錄下，`dsh-app-boot` 在掛載條目前向 Loader `!!js` 設定表達式暴露它，因此出廠組合無需複製解析器即可派生 `sessions` 和 `storages`。`dshHomeDisplay()` 為面向使用者的路徑以符號形式命名已解析的根目錄——默認 home 顯示為 `~/.dsh`，任何已設定的 home 顯示為 `$DSH_HOME`——這樣使用者全域性的 `AGENTS.md` 標籤就絕不會洩露機器上的絕對路徑。它取代了 agent-instructions 中自訂的「預設值 vs `$DSH_HOME`」判斷。

`@deepseek-ai/dsh-home` 被刪除。它的三個引用方（`dsh-tool-bash`、`dsh-skill-filesystem`、`dsh-agent-spine-demo`）從 `dsh-home-paths` 匯入 `resolveDshHome`。

`dsh-telemetry` 及其獨立 home 策略已隨 [SDK 項目工具鏈移除](../simplification/2026-08-11-remove-sdk-project-toolchain.md)一並消失，因此該解析器是唯一的 home 策略。

## 備選方案

**保留兩份 `resolveDshHome` 副本。** 它們早已漂移（一個展開波浪號，一個不展開），並把同一條橫切事實編碼了兩遍。`util/` 層的意義正是在於合併，重複的解析器是一個潛在的分歧 bug。

**採用 XDG（遵從 `$XDG_CONFIG_HOME`，或把 config/data/cache 拆分到各自的目錄樹）。** 經過考慮後放棄，轉而採用一個顯而易見的根目錄。單一的 `$DSH_HOME || ~/.dsh` 基準事實與 `~/.claude` / `~/.aws` 一致，無需對每個 `~/.dsh` 消費端按類別重新歸類，也不留下任何需要協調的解析器不對稱。

## 影響

- 單一 home 事實，單一解析器。`dsh-home-paths` 是唯一歸屬方；`util/` 組失去了 `home` 包。
