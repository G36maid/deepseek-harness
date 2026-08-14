# Agent Note: dispose 階梯歸其消費端所有，而非 subprocess seam

Status: implemented

[English](2026-07-27-dispose-ladder-to-consumer.md) | [简体中文](2026-07-27-dispose-ladder-to-consumer.zh.md) | 繁體中文

## 問題

`SubprocessHandle.dispose(graces)` 與 `SubprocessDisposeGraces` 把一整套拆卸*策略*——等待 stdin EOF、再 SIGTERM、再 SIGKILL，每一層由呼叫方提供的時間窗約束——放在了一個其餘動詞均為單一機制的 seam 上。它始終只有一個消費端（ACP（Agent Client Protocol）subagent 後端）；bash 走 `terminate()` 與服務拆卸，LSP 主機執行自己的協議優先關閉流程。然而每個未來後端都必須實作該階梯才能滿足介面，實作包也僅為階梯的層級時限背上了 `dsh-timeout` 相依性。

## 決策

階梯移入其唯一消費端。`dsh-subagent-acp` 擁有 `disposeAcpChild(child, eofGraceMs)`，完全建置在 seam 的公開動詞之上：關閉 `stdin`，以 `eofGraceMs` 約束一次 `waitForExit`，隨後呼叫 `terminate()`（其 SIGTERM→spec 寬限期→SIGKILL 升級已擁有訊號定時器），再無界等待 `waitForExit()`，由子行程責任方證明整棵行程樹已經退出。seam 保留 `kill`／`terminate`／`waitForExit`——機制而非策略——而 `waitForExit(signal?)` 恰是消費端階梯在協作層確認行程樹真正退出所需的完全靜止探針，無需從終止寬限期再派生一個定時器。seam 的控制代碼少了一個方法和一個匯出介面。

## 曾考慮的替代方案

**把階梯作為便利方法留在控制代碼上。**否決：一個每個 Service Provider 都必須實作的 Service Definition 方法不是便利，而是約定的一部分——而這一個把某一消費端的協作模式（stdin EOF 打頭）當作行程詞彙來編碼。seam 自己的 README 早已不得不加註「相依性其他訊號才能完全靜止的子行程需要自己的第一階」，這本身就是承認該階梯是策略。

**把階梯移到共享輔助包。**否決：只有一個消費端。當第二個具有相同 stdin EOF 協作模式的行程外後端出現時，可以再把 `disposeAcpChild` 提升為共享程式碼；現在抽取只會重造 `dsh-subagent-subprocess`——本次變更刪掉的那個單一用途庫。

## 後果

買到的：Service Definition 少了一個方法和一個類型；Service Provider 只欠四個動詞，不欠拆卸策略；協作式 EOF 時間窗與調節它的 ACP 設定欄位住在一起，而終止時間窗與最終的整樹退出等待僅由子行程責任方擁有。代價：未來想要 EOF 打頭拆卸的後端需針對這些動詞寫約 20 行（或直接搬 ACP 的輔助函式）；階梯的層級測試位於 ACP 套件，Service Definition 套件轉而釘住階梯所組合的動詞（升級前有界 `waitForExit` 返回假，升級後無界等待整棵行程樹退出），而非組合後的策略。
