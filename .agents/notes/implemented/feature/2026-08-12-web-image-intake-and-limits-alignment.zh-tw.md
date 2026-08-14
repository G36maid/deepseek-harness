# Agent Note：整頁圖片拖放、上限投影預檢與縮略圖平鋪

狀態：implemented

[English](2026-08-12-web-image-intake-and-limits-alignment.md) | [简体中文](2026-08-12-web-image-intake-and-limits-alignment.zh.md) | 繁體中文

## 問題

issue #2248 的第二步對齊，接在[附件展示 note](2026-08-11-web-attachment-display-alignment.md) 之後（其附件欄、toast 與原子元件包的決策繼續有效；本 note 取代其中歷史畫廊幾何與燈箱 backdrop 的具體規格）。與 DeepSeek Chat 相比剩下的差距：圖片只能拖到 composer 卡片上——拖到聊天記錄區會讓瀏覽器直接導覽到文件；燈箱關閉鈕是裸 `×` 文字字元（button 不繼承字體，且該字形的墨跡在行框中心之上，因此明顯偏斜），backdrop 用 `color-mix(label-primary 74%)`，dark 下反轉成刺眼的白色蒙層；一則訊息的多張圖各自以最大 240px 的塊豎著堆疊，因為畫廊容器本身被釘在 240px；用戶端完全不執行也不展示圖片限額——使用者可以攢 50 張圖，直到提交後收到原始的 `attachment-error (TOO_MANY_IMAGES)` toast，眼看附件欄清空又回滾。

## 決策

**整頁拖放。** InputBar 在 document 上綁定 `dragenter`/`dragover`/`dragleave`/`drop`（enter/leave 深度計數、視口邊緣與 `dragend` 復位、按 `Files` 類型門控使文字拖拽保留原生 textarea 路徑），並渲染 `ui-attachment` 新增的 `DropOverlay` 原子元件：經 body portal、不接收指針事件的全視口層（DeepSeek Chat DragMask 的視覺——白色 70% 加 10px 模糊，dark 為 `rgba(39,39,48,0.7)`，插畫、標題、上限行），`disabled` 變體宣告鎖定或忙碌的 composer。指針惰性是承重的：拖拽事件繼續命中下方頁面，深度計數永遠看不到遮罩自己。document 級監聽狀態是安全的，因為 composer-bar slot 為 `kind: 'single'`。

**燈箱。** 關閉鈕換成 `ui-primitives` 的 `IconCloseOutline16`（Modal 的先例——在 viewBox 內置中的 SVG 不相依性字體度量）。backdrop 用共享的對話框遮罩（`--dsw-alias-bg-mask-1` 加 `--dsw-mask-blur`，兩個主題都是黑基色），畫在獨立的兄弟圖層上，因為 `backdrop-filter` 畫在容器上會把預覽圖自己也模糊掉。

**歷史縮略圖（DeepSeek Chat 規則）。** 一則訊息僅有的一張圖長邊 240px、展示比例鉗制在 [0.25, 4]，`cover` 裁切，特別高的圖錨定頂部、特別寬的錨定左側，從不放大；多張圖渲染為固定 64px 方塊，單個可換行的橫排（10px 間距，使用者訊息靠右對齊）。assistant 連續的 `image` 塊合併進同一個畫廊，平鋪而不是各佔一行。

**上限對齊並投影。** 預設值為每則訊息 20 張、單圖 5 MiB、總量 100 MiB（`attachment-local`），HTTP 載體上限提為唯一共享的 `DEFAULT_MAX_REQUEST_BODY_BYTES = 160 MiB`（http-bridge，原先是兩個獨立的 32 MiB 字面量），以滿足載入時的容量斷言（總量 × 4/3 加餘量 ≈ 134.3 MiB）。消費級產品集中在 10 到 20 個附件（ChatGPT 10、Gemini 10、Claude 20；DeepSeek Chat 的 50 是例外），且視覺模型一張圖約 1300 到 4800 token，因此 50 張圖可在一則訊息中填滿 200k 上下文。默認單圖上限採用 5 MiB，可適用於分別採用 5 MiB 或 10 MiB 上限的 Anthropic 路由；僅使用較大上限路由的部署可以覆蓋該值。512 MiB 總量無法透過當前傳輸，因為 base64 進 JSON 需要一個超過 V8 約 512 MiB 字串上限的單個 JSON 字串。限額以 `imageLimits` 工作階段投影到達用戶端。它是每次啟動恆定的單元（`apply` 返回同一狀態引用，因此只靠基線攜帶、不存在變更幀），由 **apiproxy** 而非 attachment Service Definition 註冊：`dsh-llm` 相依性 `dsh-attachment`（`ImageBlock` → `ImageAttachmentRef`），seam 包引用 `dsh-session-projection`（其圖譜經 `dsh-session` 到達 `dsh-llm`）會閉合 project-reference 環，而該值描述的每訊息數量與總量規則本來就是 proxy 自己的准入檢查。`SessionProjectionMap` 合併放在 proxy 的 sessions 協議文件裡，每個用戶端程序都經載體的類型再匯出包含它。

**加入預檢與錯誤文案。** 兩種加入手勢匯合到 InputBar 的一個 `intakeImages` 包裝：在 `addImages` 之前按投影檢查數量、單圖位元組與總位元組，違規的一批整體拒收（DeepSeek Chat 語義）並立刻彈出點名上限的橫幅——不再有提交時的回滾戲碼。宿主檢查保留，兜底繞過 composer 的呼叫方。橫幅文案遵循使用者定下的一條原則：使用者能解決的原因（模型不支持視覺、數量、大小、解析度、格式——格式改為正面列出支持清單而不是回顯被拒的 MIME 類型）用點明出路的產品句子；使用者無法解決的原因（base64 損壞、引用丟失、讀取失敗）摺疊為一條保留原因碼的傳送失敗句子，因為產品當前面向開發者，可上報的碼好過死衚衕。非附件錯誤碼保留原文加錯誤碼的展示。

## 備選方案

**在 attachment Service Definition 構造函式裡註冊投影單元。** 天然的 seam 歸屬，也是第一版實作——被相依性圖（上述環）和一個測試基建互動否決：基類構造函式呼叫 `ctx.inject` 使得 spec 中直接構造的 store 觸發全域性 invariant 宿主，後者往同一 root 重複掛載 `attachments` 服務。

**燈箱用 `--dsw-alias-bg-mask-photo`（0.88 黑、主題恆定、無人使用）。** 設計系統的照片查看器 token，也可能是 dsweb 燈箱實際的蒙層；使用者選擇與 settings 對話框遮罩一致（`bg-mask-1` 加模糊）——兩者都能修復 dark 反轉。

**在 `apply.ts` 的 `addImages` inject 裡預檢。** seam 純度上的位置，因管線成本否決：投影倉沒有暴露給 inject 工廠的非 React 面，而 InputBar 已經以慣用方式消費投影，且是兩種手勢的唯一呼叫方。

**用 `host.describe` 欄位代替投影。** 與工作階段無關且更便宜，但要經注入 prop 鏈而非 `useProjection` 送達，而投影的鍵缺席語義（"未組合 attachment 服務 → 不預檢"）是白拿的。

## 後果

拖到視窗任何位置都能進附件欄，超限加入在手勢發生的那一刻就以點名上限的文案失敗，歷史圖片像 DeepSeek Chat 一樣平鋪。載體的默認請求體預算擴大約 5 倍，並且仍是單請求駐留記憶體上界（橋把請求體整體緩衝；已記錄在 connection README 的限制節）。fixture 傳輸用硬編碼的默認數字映像檔該投影——改設定的部署會與 fixture 模式的文案分叉，對 keyless 演示通道可接受。畫廊左右切換、燈箱縮放與下載、非圖片文件卡片仍然推遲（#2248）。
