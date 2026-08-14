# @deepseek-ai/dsh-client-ui-model-selection

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

模型選擇外掛程式（瀏覽器側）：**兩個入口共用一份工作階段級目錄**，由 `ModelDirectoryResolver`（`ctx.modelDirectories`）持有。對於普通工作階段，`/model` popupSelect 貢獻項（經 `ctx.commandUi` 註冊）與 composer 的具名 `conversation.input.model` slot 都透過同一個 `ModelDirectory` 實例，經 `session.models` 載入工作階段的建議目錄，並經 `session.selectModel` 提交。緊湊型 composer 觸發器會打開兩級 Model/Effort 選單：模型仍按提供方分組，所選具體模型則提供由其配接器持有的推理強度名稱、說明和預設值。`/model` 應用所選模型的默認推理強度，composer 隨後可以選擇任一已公佈的推理強度。

Host 報告的 `ModelSelection` 是唯一的選擇事實，其中包含提供方、模型與推理（reasoning）強度；但只有當該提供方／模型對仍在已公佈分組中時才會回顯。目錄行缺席時，可路由的選擇保持不變，但觸發器會提示 `Select model`；系統不會合成過時行，且在使用者選擇已公佈的模型之前不會顯示 Effort 行。目錄載入與選擇共享一個代次計數器，舊回應不會覆蓋新結果；連線重設會丟棄所有常駐目錄投影，並在顯示前重新拉取 Host 復原的選擇。各提供方的元資料取得失敗會內聯列出，同時可用分組仍選填擇；選擇失敗會保留先前的選擇和目錄。

當宿主報告沒有配接器服務該工作階段的路由（`session.models.routable`）時，本外掛程式經 `ctx.conversation.blocks` 註冊一個 composer 阻塞塊，輸入框隨之停用並顯示本外掛程式自己的文案；復原後無需重新載入即自動清除。它只跟隨 `routable`：`null`（首次載入之前，或載入失敗之後）絕不阻斷，否則一個慢的宿主就會鎖死一個本來可用的 composer；目錄成員關係同樣不阻斷，因為一條仍在服務、只是不再公佈該模型的路由不在分組裡，卻完全可用。觸發器自己的 `Select model` 回退仍然覆蓋那種情形——那是顯示，不是閘門。

目錄按工作階段惰性解析（`ctx.modelDirectories.directoryFor(sessionId)`），隨工作階段作用域一並 dispose（資源釋放）。已尋址 subagent 工作階段不公開任一入口，其目錄會拒絕載入、選擇與重新連線刷新，因為綁定到 agent（代理）的普通模型 RPC 會在直接 parent 繼續執行路徑之外啟用持久化 child 歷史。

每一份常駐目錄都會直接在轉發的 owner 事件 `llm/adapters-updated` 與 `settings/document-updated` 上重拉。因此提供方拓撲、提供方目錄與默認選擇都能收斂，Host 與 client runtime 無需再派生一個單獨的模型變更別名。

`/client` 匯出面為外掛程式本體（`apply`/`inject`）、`ModelDirectoryResolver`、`ModelDirectory` 及其狀態形狀、slot 注入面類型。

## 模型體驗

間接影響。兩個入口都透過僅供普通工作階段使用的 `session.selectModel` RPC 提交完整的 `ModelSelection`；Host 會在下一次提示詞組裝邊界對其進行快照，因此後續請求採用所選提供方、模型與推理強度，而執行中的步驟保留已組裝選擇。只有當現有請求標頭記錄一次實際採用該選擇的請求後，選擇才會持久化；選單互動不會新增提示詞內容。

#### KV Cache 影響

切換路由可能減少提供方側後續請求的快取複用，或使其失效；提示詞前綴本身不受影響。

## 已知限制與暫緩事項

- **無建立期或已尋址 subagent 選擇**——兩個入口都要求既有普通工作階段的 agent；沒有可納入工作階段建立的草稿階段模型選擇，subagent 繼續執行也有意不公開獨立的模型選擇約定。
- **目錄名僅供呈現**——選擇與持久化使用提供方／模型／推理強度 id；目錄查詢或確切模型元資料查詢失敗的提供方以不選填失敗行列出，重新載入前保持原樣。
- **不能任意輸入推理強度**——composer 僅提供確切模型由配接器公佈的推理強度；配接器沒有推理元資料時不顯示 Effort 行。
