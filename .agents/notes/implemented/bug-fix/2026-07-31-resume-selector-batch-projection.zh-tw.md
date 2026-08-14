# Agent Note: 復原選擇器只摺疊標題

Status: implemented

[English](2026-07-31-resume-selector-batch-projection.md) | [简体中文](2026-07-31-resume-selector-batch-projection.zh.md) | 繁體中文

## 問題

打開 TUI `/resume` 選擇器時，會在一個無界 `Promise.all` 中對每個列出的工作階段呼叫一次 `sessionQuery.readSession()`。每次呼叫都會在 `SessionCorpus.load()` 內部重新列出整個持久化儲存（O(N²) 次清單查詢）、讀取並解壓縮完整日誌、透過 `Session` 構造函式對每個事件做重播驗證，並將 header 和事件深克隆多達三次——而這一切只為推導一行選擇器條目的標題、最近活動時間、最後一個 `turn/end` 標籤、提供方/模型路由和目標階段。在真實儲存上（185 個工作階段、壓縮後 87 MB、約 35.3 萬個事件），選擇器需要數十秒才能打開，且開銷隨日誌總大小而非工作階段數量成長。

## 決策

選擇器行除標題外不摺疊任何內容，行內其餘資訊全部來自元資料：

- 標題來自投影系統：`session-title` 已註冊 `title` 投影單元，因此即時行讀取登錄檔快照，持久化行讀取持久 checkpoint 行（`sessionProjectionCache.cachedSnapshot`，零 I/O），只有沒有可用 checkpoint 的行才付出一次 `coldSnapshot`——checkpoint 加 `readFrom` 尾部摺疊，並寫回使下次掃描零 I/O。冷讀取受 TUI `resumeScanConcurrency` 設定約束。未掛載快取的組合回退到一次對日誌的有界 `readTitleSnapshots` 批次讀取；兩條路徑都把單行失敗隔離為停用的「Unreadable session」回退。
- 活動時間戳從不讀取日誌：即時工作階段取記憶體中最後一個事件的時間；持久化工作階段對選填 `sessionPersistence.locate()` 命名的產物做 stat（mtime），當後端定位不到按工作階段的產物（SQLite）或 stat 失敗時回退到 header 的建立時間。任何追加都會移動 mtime，因此僅僅一次 pickup 邊界也會讓瀏覽過的工作階段上浮——這是元資料時間戳的代價，予以接受。
- 行內不再有最後輪次標籤、提供方/模型路由和目標階段列。路由可用性改由 Enter 時的預檢強制：預檢透過 `readSession` 完整讀取並回放驗證選中的那一份日誌後才移交。

選擇器 overlay 在 `/resume` 分發時同步打開，早於掃描結帳：`undefined` 候選集渲染「Loading sessions…」載入佔位符，選擇器從第一幀起就擁有終端機輸入，Enter 提示工作階段仍在載入，Escape 取消。關閉 overlay 會透過查詢方法接受的 `AbortSignal` 中止掃描；忽略訊號的後端的遲到結帳由過時性檢查丟棄。掃描完成後透過 `setCandidates`（同時清除過時的仍在載入錯誤）換入行資料，不替換 overlay；排在正在關閉的前任之後的排隊啟用會在構造時直接收到已掃描的集合；清單查詢、標題與 mtime 共用同一個 catch，因此任何掃描失敗都會關閉 overlay 並報告通知，而不會讓載入佔位符懸置。

session-query 與 session-persistence 的任何介面都未改變。隨附的 TUI 組合新增投影登錄檔、storage 與投影快取行（映像檔 web overlay，共用同一 `storages` 根，因此任一介面寫入的 checkpoint 都服務兩者）；對既有儲存的首次掃描仍會各讀取一次日誌以播種 checkpoint，之後的每次掃描都只讀元資料。

## 備選方案

**透過通用批次投影（`projectSessions`）保留每行的路由/輪次/目標列。** 先實作後否決：它仍在每次 `/resume` 時解壓縮並解析全部日誌，瀏覽開銷依舊是 O(日誌總位元組數)，且為單一消費端擴大了 session-query 公開 API。該公開約定已回退；`readTitleSnapshots` 繼續使用內部 `projectMany`，保持不變。

**只修復 `SessionCorpus.load()` 內部的 O(N²) 清單查詢。** 作為主要修復被否決：在大日誌上，按候選行執行的完整解壓縮、重播驗證和三重克隆纔是主要開銷。`load()` 中的冗餘預清單查詢仍是一個候選清理項，但涉及錯誤語義。

**透過 `listSnapshots`/`SessionRecord` 暴露最後修改時間。** 從 seam 角度最乾淨，但要觸碰持久化約定、兩個後端和查詢記錄形狀，而 TUI 已能用 `locate()` 加一次 stat 得到同樣的資訊。若出現第二個需要元資料活動時間的消費端再引入。

**專門的持久化標題索引或 TUI 本機標題快取。** 否決：session-projection 快取本身就是自有的持久 checkpoint 系統，並已帶失效約定（`stateVersion`、身份綁定、日誌收縮錨定）；掛載它優於再造一套平行快取。

## 後果

打開 `/resume` 只執行一次清單查詢、每個持久化行一次 stat，標題讀取在 checkpoint 就緒後只觸碰 checkpoint 行和日誌尾部——O(工作階段數) 的元資料開銷，而非 O(日誌總位元組數)；無快取的回退路徑仍是一次有界標題掃描。行內只顯示標題、時間戳、狀態和 id；路由問題以 Enter 時預檢錯誤的形式出現，而不再是停用行；重播會失敗的工作階段由預檢而非清單階段攔截。瀏覽後放棄的工作階段會因 pickup 的 mtime 上浮。TUI 測試中的偽造 `sessionQuery` 服務在 `listSessions`/`readSession` 之外提供 `readTitleSnapshots`，測試 harness 會轉發選填的 `locate`。由於選擇器立即接管焦點，啟動第二次掃描需要先關閉當前 overlay——掃描期間輸入的第二個 `/resume` 會落入搜尋欄位，這正是預期的輸入捕獲行為。
