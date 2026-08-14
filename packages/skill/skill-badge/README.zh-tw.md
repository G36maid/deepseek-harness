# @deepseek-ai/dsh-skill-badge

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

選填的內建 skill（技能）提供方，向 `ctx.skills` 貢獻 `dsh-badge`。該 skill 提供官方「powered by dsh」Markdown 片段和隨包分發的 PNG，供無法可靠匯入遠端圖片的系統使用。

掛載該外掛程式即可啟用提供方。它沒有設定。隨附的 CLI（命令列介面）組合以 `disabled: true` 包含該外掛程式；使用者必須顯式啟用其 `skill-badge` 設定行，該 skill 才會進入目錄。

該提供方將隨包分發的 `assets/` 目錄作為 skill 資源基底公開。`dsh-badge.png` 是尺寸為 726×120 的源圖資源，消費端以 121×20 的尺寸渲染。

## 模型體驗

透過 `@deepseek-ai/dsh-tool-skill` 間接影響模型；該包會渲染目錄條目和所選 skill 的正文。

#### KV Cache 影響

該外掛程式默認停用，不會改變任何請求。啟用後，其目錄條目和任何已載入正文都會在各自插入點改變提供方的 KV 前綴。

## 已知限制與暫緩事項

- 該提供方只貢獻一個固定 skill，不提供執行時期自訂。
- 遠端 Markdown 使用 Shields.io；當目標環境無法可靠取得遠端圖片時，請使用隨包分發的 PNG。
