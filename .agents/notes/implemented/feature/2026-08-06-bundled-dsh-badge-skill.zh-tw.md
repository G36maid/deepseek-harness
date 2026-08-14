# Agent Note: 內建 dsh 徽章 skill

Status: implemented

[English](2026-08-06-bundled-dsh-badge-skill.md) | [简体中文](2026-08-06-bundled-dsh-badge-skill.zh.md) | 繁體中文

## 問題

[Cordis 教程](../../../../docs/cordis-tutorial/index.md)的各個頁面都使用官方「powered by dsh」徽章，但交付的 CLI（命令列介面）既沒有用於在其他位置應用同樣署名的可複用指令，也沒有可顯式選擇加入的提供方。

## 決策

`@deepseek-ai/dsh-skill-badge` 是一個原生 Cordis 外掛程式，會在 `ctx.skills` 上註冊一個不可變的內建提供方。該提供方負責 `dsh-badge` 的摘要、指令正文和 PNG 資源基底；`dsh-tool-skill` 仍是面向模型的目錄與 loader 渲染的唯一歸屬方。

交付的 CLI 組合將 `skill-badge` 聲明為停用。啟用這個現有設定行就是顯式選擇加入；停用它的安裝實例不會公開任何徽章 skill（技能），也不會獲得任何模型可見內容。

該提供方使用排在項目、自訂及使用者檔案系統來源之後的內建 rank，因此使用者自有的 `dsh-badge` 定義可透過登錄檔的常規優先級約定覆蓋它。提供方釋放時，登錄檔擁有的 effect 會移除該貢獻。

## 曾考慮的替代方案

**透過 `dsh-skill-filesystem` 掛載隨包文件。** 否決，因為檔案系統發現、解析和監視會引入生命週期機制，而不可變的單一 skill 提供方並不需要這些機制。

## 後果

徽章指令和源 PNG 隨 DSH 一同納入版本管理，並透過以隨包目錄為基礎的資源基底解析。該提供方沒有設定面。包測試固定提供方生命週期和官方 PNG 的位元組內容；無金鑰的組裝應用快照則固定啟用後的目錄和已載入的 skill 正文。
