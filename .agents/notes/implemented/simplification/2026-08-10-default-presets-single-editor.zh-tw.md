# Agent Note: 通用 preset 只提供一套編輯工具

Status: implemented

[English](2026-08-10-default-presets-single-editor.md) | [简体中文](2026-08-10-default-presets-single-editor.zh.md) | 繁體中文

## 問題

`standard`、`code` 和 `cordis` preset 同時提供 `read`/`write`/`edit` 檔案系統工具與 `str_replace_editor`。兩套介面在常規文件查看和編輯上重疊，導致每次請求都攜帶額外的工具 schema，卻沒有增加獨立的默認能力。`minimal` preset 具有不同的組合約定：它固定的雙工具清單有意在持久 `bash` 之外提供 `str_replace_editor`。

## 決策

`standard`、`code` 和 `cordis` preset 設定掛載 `dsh-tool-fs` 與 `dsh-tool-fs-search`，但不掛載 `dsh-tool-str-replace-editor`。因此 Code Mode 的登錄檔和生成的 SDK 均不包含 `str_replace_editor`。`minimal` preset 繼續掛載 `dsh-tool-str-replace-editor`，部署設定或使用者自訂 preset 仍可顯式掛載該外掛程式。

此決策收窄 preset 工具清單，不移除工具包及其 Python 執行時期支持。較早的[共享清單決策](../feature/2026-07-31-even-out-shipped-tool-rosters.md)繼續說明與 surface 無關的工具為何歸 preset 組合所有；本記錄說明編輯器例外。

## 曾考慮的替代方案

**在通用 preset 中保留兩套編輯介面。** 不予採用，因為重疊的模型可見 schema 增加了工具選擇，卻沒有提供不同的默認操作。

**從所有交付組閤中移除 `str_replace_editor`。** 不予採用，因為 `minimal` preset 有意將該 schema 作為兩個工具之一，顯式部署仍是該獨立外掛程式的有效消費端。

## 後果

通用 agent 使用 `read`、`write` 和 `edit` 完成檔案系統修改，minimal agent 保留 `str_replace_editor`。preset 組合測試固定其不會出現在 standard 清單、Cordis 清單及 Code Mode SDK 中，同時 minimal 斷言繼續固定其存在。
