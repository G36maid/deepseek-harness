# @deepseek-ai/dsh-typert-protocol

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

該包提供不相依性編譯器的聲明，由業務包、生成的 Typert 產物、宿主閘道和用戶端 API 共享。它負責 Remote 服務基類、裝飾器、顯式綁定回退、可透過聲明合併擴充的協定對映、呼叫描述符、編解碼器和提供方約定；它不執行 TypeScript 分析，也不註冊具體 Cordis 服務。

## Remote 聲明

- `@Remote` 將公開實例方法標記為可在其註冊的 Cordis 服務上直接呼叫。
- `@RemoteScope(key)` 標記接收者選自合併聲明的作用域 Context 類型的方法。
- `TypertRemoteService` 將傳給 `super(ctx, serviceKey, options?)` 的 Cordis 鍵綁定到同一預設協定命名空間。
- `bindTypertRemote(this, serviceKey, options?)` 為無法繼承 `TypertRemoteService` 的服務提供同樣可見且凍結的綁定。
- `remoteMethods(service)` 返回按聲明順序排列、與內部狀態分離的快照，供 Gateway 的 SRC 回退路徑使用。

宿主方法透過將 `signal: AbortSignal` 聲明為最後一個參數來啟用協作式取消。`InvocationDescriptor.cancellation` 記錄這個保留的注入點；該訊號絕不會成為 JSON 參數或尋找欄位。SRC 識別末位參數名，嚴格生成還會校驗它是否具有全域性 `AbortSignal` 類型。

裝飾器初始化器將標記保存在以服務原型為鍵的模組私有 `WeakMap` 中。它們不會在構造函式上新增符號，也不會新增原型屬性、參數中繼資料或執行時期反射欄位。`TypertRemoteService` 會暴露與顯式輔助函式相同的公開只讀 `typertRemote` 綁定。

## Typert 協定

業務包擴充 `TypertLookupMap` 和 `TypertContextMap`，以關聯宿主對象或作用域 Context 與其協定身份。生成的產物擴充 `TypertRemoteMap`、`TypertRemoteScopeMap` 和 `TypertRemoteNamespaceMap`，使用戶端匯入後僅暴露選定的 Remote 方法。`InvocationDescriptor` 是供登錄檔、閘道和用戶端 Remote 使用的共享執行時期形式。

Host 裝配以轉發給消費端的 Host 事件擴充 `TypertRemoteEventSelection`，從而收窄 `ctx.remote.$on` 的鍵面；`TypertForwardableEvent` 陳述單向投遞根本能承載哪些形狀，把 Scope 化事件與有回傳值的事件排除在外。`TypertClientRemote` 承載該面的兩種角色：消費端經 `$on` 訂閱，持有 Host 幀 sink 的 Client 半經 `$dispatch` 交出幀。

尋找包與 Context 包同時負責該約定的兩側：聲明合併提供靜態關聯，執行時期提供方則向 `ctx.typert` 註冊身份解析。尋找提供方或宿主 Context 提供方提供穩定聲明與預設解析器，宿主組合可以另行設定同步或非同步解析器；策略拒絕可用 `TypertLookupFailure` 攜帶由邊界配接器擁有的失敗值。嚴格編解碼器攜帶生成的 schema；`src-json` 編解碼器標識約束更弱的原始碼啟動路徑。

## 模型體驗

無，因為該協定包聲明應用反射，不註冊任何面向模型的內容。

#### KV Cache 影響

無直接影響。

## 已知限制與暫緩事項

- 裝飾器標記僅包含方法名，以及直接呼叫或 Context 呼叫模式。參數、結果、尋找和 schema 反射需要 Typert 建置管線。
- Remote 裝飾器只接受具有字串名稱的公開、非靜態實例方法。SRC 執行無法表示重載簽名，以及包含解構參數、預設參數或剩餘參數的方法簽名。
