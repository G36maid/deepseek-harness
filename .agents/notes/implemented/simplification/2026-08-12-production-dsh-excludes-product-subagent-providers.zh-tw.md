# Agent Note: 生產 dsh 排除產品 subagent 提供方

Status: implemented

[English](2026-08-12-production-dsh-excludes-product-subagent-providers.md) | [简体中文](2026-08-12-production-dsh-excludes-product-subagent-providers.zh.md) | 繁體中文

## 問題

`@deepseek-ai/dsh` 會獲得 `@deepseek-ai/dsh-base` 的相依性閉包。如果 base 包含 Codex 與 Claude Code subagent 提供方，每次生產安裝都會下載選填的產品整合程式碼，包括 Claude Agent SDK，即使使用者並未使用任一整合。

## 決策

本決策取代[共享 host 放置決策](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md)：`@deepseek-ai/dsh-base` 不相依性也不掛載 Codex 與 Claude Code subagent 提供方。需要這些整合的 Profile 仍可顯式安裝並掛載對應包。倉庫 examples 保留直接開發相依性，使其顯式提供方設定可以繼續解析。

## 驗證

base 組合包測試會拒絕這兩個提供方相依性與設定行。Cordis 設定驗證要求顯式 examples 聲明其引用的提供方包。

## 考慮過的替代方案

**在 base 組合包中保留休眠提供方。** 休眠提供方不會啟動產品行程，但其包仍會進入每次生產 NPM 安裝。

## 後果

安裝 `@deepseek-ai/dsh` 時，不會透過 base 組合包下載任一產品提供方。使用任一整合都需要顯式 Profile 設定。
