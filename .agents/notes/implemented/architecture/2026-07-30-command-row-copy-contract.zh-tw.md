# Agent Note: 命令條目文案分別由條目與 handler 負責

Status: implemented

[English](2026-07-30-command-row-copy-contract.md) | [简体中文](2026-07-30-command-row-copy-contract.zh.md) | 繁體中文

## 問題

Web 命令條目由一對落庫的[命令生命週期事件](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md)渲染出 `标题 · 摘要`：標題是由 `command/run` 重建的分派命令列（`/permission workspace-write`），摘要是 `command/done` 的原樣 `text`（`Permission preset: workspace-write.`）。兩半各自成文、互不知情，於是一行裡命令名出現兩次、參數也出現兩次——最糟的一例正是使用者每次用 Access chip 切換權限時得到的那一行。

## 決策

命令條目兩半的職責互不重疊，各自只按自己那一半來寫。

行標題就是裸命令名——沒有 `/`，也沒有參數。`/` 屬於編輯器的輸入文法，不屬於一條已落定的記錄；參數也不該由這一行來報告：摘要已經說清了這條命令做了什麼。對於 `command/run` 那一頁已滑出用戶端視窗的跨視窗節點，`GenericCommandCard` 仍保留 `命令` 兜底標題。

因此，命令 handler 的落定 `text` 絕不用命令自身的名字給自己的值加標籤——渲染它的介面已經說過一次了。`/permission` 返回 `preset workspace-write`，裸呼叫時返回 `current preset workspace-write (available: …)`，參數非法時返回 `unknown preset "bogus" (available: …)`。作為一行讀是 `permission · preset workspace-write`；作為獨立一句讀——TUI 把同一段 text 作為通知追加——它依然說明瞭當下生效的是哪個預設。

這條規則禁的是*標籤*，不是用詞。`Permission preset: workspace-write.` 之所以出局，是因為 `Permission preset:` 是給一個值加的題頭，而這個題頭正是標題本身。恰好含有命令名的領域名詞不是題頭，因此保留：`/plan` 仍返回 `Plan mode off.` 與 `Plan mode on. Use /plan off to leave.`（`plan · Plan mode off.` 說的是那個模式，句尾是一條指引，不是回聲），`/goal` 仍返回 `Goal cleared.`。真正被這條規則攔下的，是 handler 在自己的值前面寫出 `<命令名> <名词>：` 的那一類。

日誌本身未變：`command/run` 保留結構化的 `name`／`args` 拆分，因此更豐富的已註冊命令條目仍可從同一個節點渲染參數，無需第二條資料通道。

## 考慮過的替代方案

**保留分派命令列作標題，只縮短落定文案。** 參數仍會出現在分隔點兩側（`permission workspace-write · preset workspace-write`），而這正是被指出的重複。

**從摺疊行中去掉落定文案，而不是去掉參數。** 這顛倒了這一行的價值：持久記錄存在的意義就是結果，而錯誤文案將無處落腳。

**由這一行從落定文案裡剝掉開頭的命令名。** 呈現層會悄悄改寫 handler 寫就的文案，而任何換一種措辭表達結果的 handler 都會讓這套啟發式失效。

**徹底禁止命令名出現在自己的落定文案裡，並把 `/plan`、`/goal` 一並改寫。** 這種更寬的禁令代價大於收益：無論在行上還是作為獨立的 TUI 通知，`Plan mode off.` 與 `Goal cleared.` 都是這些結果最清楚的句子，而滿足「禁名字」所需的縮短形式（`off.`、`cleared.`）讀起來只是殘句。值得去掉的冗餘是題頭。

## 後果

每一條命令條目都變短了，而且這條規則可擴充：新命令的作者寫結果時無需知道由哪個介面渲染，任何介面也都不必再去重。代價是分派參數離開了摺疊行——命令仍在執行時，行上只有名字和 `执行中…`——以及「不加題頭」這條規則是靠評審執行的約定，而非閘門。`/permission` 的文案由 permission 包的命令測試釘住，裝配後的行文案由 [seeded-history](../../../../apps/web/tests/snapshots/seeded-history/command-row.expected.md) web 預期輸出釘住：由於 `/permission` 完全在 host 上執行，該預期輸出無需金鑰即可覆蓋一條真實的已落定命令條目。
