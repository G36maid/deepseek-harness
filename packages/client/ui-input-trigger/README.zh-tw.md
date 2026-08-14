# @deepseek-ai/dsh-client-ui-input-trigger

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

輸入觸發管線外掛程式：遊標處的 `/` 與 `@` 偵測（詞邊界 + guard tier 規則）、分組候選選單，以及把 pick 路由到已註冊 source。`ctx.inputTriggers` 擁有 source roster，並按工作階段 scope（`sessionOf`）各解析一個 `InputTriggerController`；對話接線層在 controller 上驅動 `track`／`arbitrate`／`onSpace`／`adjudicate`。同一個 controller 還暴露 `toggleSource`，供 chrome launcher 在一段合成 selection span 上只打開一個已註冊 source；所得候選仍走通常的選單、鍵盤仲裁、pick callback 與 scoped 輸入改寫。source 每次呼叫收到一個 `ClientSessionContext` 投影——工作階段始終由 agent（代理）支撐，因此投影只含工作階段身份。source 在它能觸達的每個工作階段 controller 中都會被預熱：scope 建立時 roster 中已有的 source 會在 controller 構造期間預熱，晚於此註冊的 source 由註冊動作本身預熱進每個仍存續的 controller。`lexicon` 名錄在預熱後仍會變化的 source 實作 `subscribeLexicon(session, listener)`；controller 每收到通知就重拉，並把聚合結果經其 `lexicon` 快照 store 發布。管線與命令無關：空格／回車裁決按註冊序輪詢選填的 `matchSpace`／`matchEnter` 掛鉤，第一個非 undefined 的應答勝出。

分層：`src/core/` 是純核心——`detectTrigger`、`menuReduce`／`seedGroups`／`MENU_CLOSED`、`exactMatch`，零 React／DOM／cordis；`src/client/service.ts` 是殼層，把核心接到選單快照 store、逐 hit 候選拉取（以 generation 把關、後繼請求經 `AbortSignal` 取代舊請求、失敗的 source 靜默丟棄並留一條 console 記錄）和三條 pick 路徑上。`src/types.ts` 與兩個 `contract.ts` 文件是凍結的跨包約定；變更需經主線程仲裁。

MenuView 把選單 store 渲染進 `conversation.input.overlay` slot（清單類，工作階段 scope），選單關閉期間渲染 null。鍵入式 trigger 會 seed 為該 trigger 註冊的所有 source；程序化 launcher 只 seed 所請求的 source，並在選單關閉或重新開始鍵入式 tracking 前，透過 controller 的 `launcher` 快照 store 發布該 source 名稱。分組按選填的 `InputTriggerSource.order` 排序（越小越靠前，默認 0，同值保持註冊序），組標題行經 `inputTriggers.menu` locale 命名空間本機化（未知 source 顯示其原名）；清單高度受限於 composer 上方的可用空間，指針落在選單與所在 composer 卡片之外即關閉選單。該 slot 由 ui-conversation 的組合器條目擁有（錨點、children 聲明、生命週期）；其 SlotMap 類型合併放在本包的 `src/client/slots.ts`，因為相依性方向（ui-conversation → ui-input-trigger）不允許反向的類型匯入。combobox 模式：焦點始終留在 textarea，行在 mousedown 時完成 pick，高亮由 `aria-activedescendant` 承載。

`/client` 匯出介面是外掛程式主體（`apply`／`inject`）、`InputTriggerService`、`MenuViewInjected` 與約定類型。MenuView 本身是內部實作——slot 註冊以閉包持有它。

## 模型體驗

無。觸發管線只是瀏覽器呈現——pick 產出 `CommandClaim`／`ReferenceInsert` 資料，其模型可見後果（宿主命令執行；插入的引用文字隨普通提示詞傳送）由負責消費這些資料的宿主包與輸入狀態機包負責。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **只有全域性 source 層**：工作階段 scope 的 source 註冊（逐工作階段遮蔽、類 ScopedLayers 機制）已有設計但未啟用；臺帳記錄著觸發條件（出現真實的逐工作階段 source 需求）。
- **`InputTriggerCandidate.icon` 以文字渲染**：MenuView 把該字串原樣放進圖示位；與設計系統圖示枚舉（iconFile 五變體家族）的接入將在該枚舉交付後完成。
- **overlay 的 SlotMap 合併歸屬與 slot 所有權分離**：唯一的 `conversation.input.overlay` 合併放在本包，而 ui-conversation 負責其錨點、children 聲明和生命週期，因為相依性方向是 ui-conversation → ui-input-trigger。
