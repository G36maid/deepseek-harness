# Agent Note: 在 API Key 進入 HTTP header 之前校驗其格式

Status: implemented

[English](2026-08-06-api-key-format-validation.md) | [简体中文](2026-08-06-api-key-format-validation.zh.md) | 繁體中文

## 問題

一個含有 HTTP header value 無法承載的字元的 API Key，曾被每個設定入口接受，直到構造請求時才失敗——離引發它的那個欄位已經很遠。

把含 emoji、中日韓文字或全形標點的 Key 粘進 Web 模型設定頁，保存會報成功。首個輪次隨即失敗，報錯為 `Cannot convert argument to a ByteString because the character at index 7 has a value of 55357 which is greater than 255`——其中的下標與碼點是 UTF-16 內部細節，不附帶任何可執行動作，卻洩露了 Key 中某一個字元的碼點。`llm-deepseek` 之所以產出這句，是因為 `fetch` 在 [adapter.ts](../../../../packages/llm/llm-deepseek/src/adapter.ts) 的 `try` 內部構造 `Bearer` header，而那個 `catch` 把一切失敗都標為 `TRANSPORT`；該標籤又在 `DEFAULT_RETRYABLE_CODES` 之中，於是一個永久且確定的故障還會被重試三次。

同樣的輸入在 `llm-pi-ai` 上更糟。它的探測路徑在 [discovery.ts](../../../../packages/llm/llm-pi-ai/src/discovery.ts) 裡用裸 `fetch` 構造同一個 header，並把一切失敗包裝成 `could not reach <url>`，於是一個本機的 Key 故障被報成網路不可達。這條探測在保存之前就夠得著：`ProviderEditor` 把使用者輸入的 `keyDraft` 直接放進探測請求，所以「取得模型清單」按鈕會在任何東西落盤之前就把非法 Key 寄出去。

空白字元能透過每一道檢查。`ProviderEditor` 判的是 `keyDraft.length`，於是三個空格構成的 Key 會被存下，隨後以 `Bearer` 加若干空格去認證。兩個配接器都不檢查來自憑據或環境的 Key——而那正是 Models 頁寫入的路徑，也就是使用者真正走的路徑。

## 決策

一條規則定義什麼是合法 Key：**trim 之後非空，且每個字元都落在 `[\x21-\x7E]`**——可列印 ASCII，不含空格。

這一個斷言覆蓋了所有已報告的輸入：空值、首尾空白、中間空白、C0 控制字元、emoji、中日韓文字、全形標點。它同時正是造成 ByteString 失敗的那條約束，所以這些故障收斂於同一個定義，而不是兩個恰好相關的修復。

第二條更窄的規則用於識別整行貼上的環境變數：匹配 `^[A-Z][A-Z0-9_]*=[^=]` 或首尾成對引號的輸入會被拒絕。把前綴限定為全大寫可以讓真實 Key 與之絕緣——`sk-` 這類形態會在連字元處中斷識別符號匹配——而要求分隔符之後必須是非 `=` 字元，則讓 base64 的 padding 也與之絕緣。它報出的是與非法字元相同的那條格式失敗，而不是自己的一句：讀到它的人下一步動作完全一樣，因此單列一句只會點出一個原因，卻不改變該怎麼做。

### 不變數屬於每一層，啟發式屬於人所在的那一層

字元集規則是不變數。非 ASCII 字元對任何提供方都**不可能**在 header value 中傳輸，因此在瀏覽器、在各個 resolver、在每一次憑據讀取上執行它，是結構上的一致而非約定上的一致。

形狀規則是對人如何貼上的猜測，因此**只在瀏覽器中執行**。`llm-pi-ai` 前面掛著 OpenAI、Anthropic 以及任意手工聲明的閘道，本倉庫並不掌握它們的 Key 格式；若這條規則執行在 resolver 中，一個簽發形如 `TENANT1=abc` 的閘道會讓使用者被徹底鎖死、無路可走——設定頁拒絕它，手寫的 `.env` 在學取時同樣被拒。把啟發式限制在貼上動作發生的那一層，環境變數便始終是那條出路。

### 「沒有 Key」是一種設定狀態，不是缺失

規則作用於*已提供*的值；至於究竟有沒有提供，由各個呼叫方自行判斷。

**未點名憑據。** 省略 `apiKeyEnv` 的 pi-ai profile 可以在 harness 持有的憑據路徑之外鑒權。[provider.ts](../../../../packages/llm/llm-pi-ai/src/provider.ts) 中的 `routeAuth` 保留內建 catalog 提供方自身的鑒權，正是為了讓提供方原生的 ambient 發現繼續工作；而該 catalog 附帶的 `openai-codex` 透過 OAuth 鑒權。`namesCredential` 承載這一區分；省略不是需要校驗的值。

**Web UI 中留空的輸入框。** 即便某個提供方的 Key 已經存好，該輸入框也是空著打開的——`keyStored` 的文案寫的是「已設定——輸入新值以替換」——所以留空意味著*保持已儲存的值*。`ProviderEditor` 在草稿為空時完全跳過 `credentials.set`，這一點保持不變：留空絕不攔截提交，否則改一個 base URL 都得重新輸一遍 Key。

**解析得到的值只含空白。** 兩個配接器都將其視為非法，因為它無法為請求鑒權。在瀏覽器中，這同樣是欄位級失敗：欄位是人剛剛敲過字的地方，靜默丟棄他敲進去的內容永遠不是正確答案。

因此 `normalizeApiKey` 接受 `string`，而絕非 `string | undefined`。

### 規則住在哪裡

`normalizeApiKey` 是 `dsh-llm` Service Definition 的一個模組，與已經承擔共享 header 交易的 [attribution.ts](../../../../packages/llm/llm/src/attribution.ts) 並列。兩個配接器都相依性該 seam 且都需要這條規則，因此它擁有兩個當前消費端而非一個預設消費端。它返回 trim 後的值，或一個原因（`empty`、`illegalCharacters`）。

兩個配接器同樣都需要那句完全相同的「拒絕一個已儲存憑據」的診斷，差別僅在包名前綴。`LlmError` 聲明在 Service Definition 的 `index.ts` 中，因此 `assertUsableApiKey(raw, pkg, ref)` 就住在它旁邊，兩個配接器都不再各留一份。斷言模組本身保持零相依性：把 `LlmError` 引入 `api-key.ts` 會與 `index.ts` 對它的再匯出成環。

用戶端無法引入其中任何一個：client 包只 reference client 包，因此 `packages/client/ui-settings-models` 在自己的 `apiKey.ts` 中映像檔這個斷言並持有本機化文案，正如 `validateDeepSeekModels` 映像檔 host 側的 `catalogModel` schema。兩側在註釋中互相指名。

### 各處分別做什麼

| 位置 | 行為 |
|---|---|
| `dsh-llm` | 擁有 `normalizeApiKey`、`assertUsableApiKey` 與 `INVALID_CREDENTIAL_CODE`，後者刻意不進 `DEFAULT_RETRYABLE_CODES`。 |
| `llm-deepseek` `resolveApiKey` | 歸一化憑據 seam 或環境返回的值，以 `INVALID_CREDENTIAL` 拒絕，訊息指明模型設定頁，絕不回顯 Key。 |
| `llm-pi-ai` `resolveApiKey` | 歸一化憑據與環境路徑。不指定任何憑據的 profile 仍返回 `undefined`，ambient 與 OAuth 路由不受影響。 |
| `llm-pi-ai` `discoverModels` | 在構造 header 之前歸一化，使非法 Key 成為憑據故障而非端點不可達。不帶 Key 的探測保持未鑒權。 |
| `ui-settings-models` | 映像檔字元集規則，加入形狀啟發式，在探測與 `credentials.set` 之前 trim `keyDraft`，並修正 `stringAt` 的空值判斷。留空的輸入框仍是可以提交的空操作；只含空白的輸入框則是欄位級失敗。提交**與端點探測**同時受攔截，因此被拒絕的金鑰不會白花一次往返去換取欄位上已經寫明的答案；失敗呈現在欄位上，與既有的 `modelFailure` 模式一致。 |

`ProviderEditor` 同時服務 DeepSeek 與 pi-ai 兩種版面配置，因此一處用戶端改動覆蓋兩個提供方。`CustomProviderCard` 為手工聲明的路由承載同一套判定。

`credentials-local` 刻意不動。它儲存各類憑據，而可列印 ASCII 是 HTTP header 的約束而非憑據儲存的約束；它既有的、拒絕任何 dotenv 樣式都無法表示的值的行為保持原樣。

## 曾考慮的替代方案

**由 client 與 host 共享一個校驗模組。** 被 source plane 版面配置否決：client 包只 reference client 包外加 `vendor/cordis` 與 `runtime-diagnostics/invariants`，把它放寬到夠得著 host 包會撞上這一分割本就要隔開的兩份 `Context` 合併。在兩側各映像檔一行斷言並各配一份測試，是此處的既定形態。

**在 `llm-deepseek` 與 `llm-pi-ai` 中各留一個拋錯 helper。** 最初的計畫正是各留一份，差別僅在訊息中的包名前綴，並配一個重複偵測豁免來放行這一對。在實作之前即被否決：`LlmError` 聲明在 Service Definition 中，因此該包完全可以自己擁有這句診斷，而那裡的一個豁免恰恰會掩蓋它本要遮掩的重複。

**在配接器的 `catch` 中嗅探 `TypeError`。** 這只是事後歸類 ByteString 失敗，header 構造本身仍無防護。它相依性 Node 錯誤訊息的措辭，因而會隨執行時期版本靜默失效；它也幫不到 `llm-pi-ai`——後者的請求 header 構造在 pi-ai SDK 內部。在交出 Key 之前就拒絕，則對兩個配接器與探測路徑同時有效。

**在 `credentials-local.set` 中執行。** 它能一次性攔住所有寫入方，包括手工編輯的文件。它落敗於該提供方儲存各種類型的憑據，而一條源自 HTTP header 編碼的規則並不屬於它。

**讓形狀啟發式也在 resolver 中執行。** 更對稱，且能攔住直接寫進 `.env` 的整行環境變數。因上文所述的鎖死風險而否決：resolver 中的一次誤判會讓使用者無路可走，瀏覽器中的一次誤判則仍留有環境變數這條路。

**在保存時探測提供方以證明 Key 可用。** 它能關掉最初報告的那件事——保存報成功、首個輪次才失敗。因超出範圍而否決，且在當時的程式碼上無法建成：對 pi-ai 恰好自帶 catalog 的那些提供方，`discoverModels` 會在任何網路呼叫之前短路到內建 catalog，因而對 Key 什麼都驗證不了；而 DeepSeek 卡片根本沒有探測。驗證器的價值在於分清「Key 被拒」與「無法連通」，而這正是本次改動讓其變得可靠的區分；先建驗證器只會得到一個分不清自身結果的驗證器。同類產品也不在保存時驗證，因此保存時的阻斷式網路呼叫會是一個意外行為，而非一處缺失。

## 後果

格式錯誤的 Key 在持有它的那個欄位上就被拒絕；格式錯誤的已儲存 Key 以 `INVALID_CREDENTIAL` 失敗，訊息指明修復位置且不含 Key 的任何片段。由於該 code 位於 `DEFAULT_RETRYABLE_CODES` 之外，一個確定性的憑據故障不再被當作瞬時傳輸抖動重試三次。`llm-pi-ai` 的探測把非法 Key 報為憑據故障，而非端點不可達。

形狀啟發式可能拒絕一個真實的 Key。匹配任意「全大寫識別符號接 `=`」會比預期覆蓋面更寬：一個以 padding 結尾的全大寫 base64 Key（`ABCD==`）會命中它並不像的賦值形態。要求分隔符之後必須是非 `=` 字元即可排除 padding——base64 的 padding 只出現在末尾。剩下的形態（大寫名稱、一個 `=`、然後是值）是已知提供方不會簽發的，且該規則只在瀏覽器中執行，因此仍撞上它的使用者可透過環境變數設定該憑據。殘留代價是對一個尚無人報告過的 Key 給出一次令人困惑的拒絕。

限定為可列印 ASCII 比傳輸本身的要求更嚴：header value 是可以承載 `\x80`–`\xFF` 的。放行 latin-1 會讓 `é` 透過並換回一個語焉不詳的 401，而不是一次本機的、有解釋的拒絕，因此從嚴是刻意的。若某個提供方簽發 latin-1 的 Key，這條規則需要放寬。

字元集斷言存在兩份，每個 source plane 一份。版面配置禁止共享它；兩側各自帶測試並在註釋中指名其孿生體。

早先版本已存下的 Key 會經 `resolveApiKey` 讀取，因此一個非法的既存值將從解析時開始失敗，而非到請求時才失敗。診斷變好了，但對當前正持有這類值的人而言，失敗點提前了。

把這件事做錯的最大代價，會是把「未指定」當成「非法」：一條施加到 `undefined` 上的規則會打斷每一條相依性 ambient 發現或 OAuth 鑒權的路由，而一個會攔截提交的空輸入框，則會讓改動任何其他設定都必須重新輸入 Key。這兩點都由測試釘住，而不是僅仰賴謹慎。

## 測試

`packages/llm/llm/tests/api-key.spec.ts` 以整張輸入表驅動 `normalizeApiKey` 與 `assertUsableApiKey`——空值、純空白、帶首尾空白、含中間空格、C0 控制字元、emoji、中日韓文字、全形、latin-1，以及可列印 ASCII 的邊界字元——並釘住一次拒絕攜帶 `INVALID_CREDENTIAL` 且不含 Key 的任何部分。

`packages/llm/llm-deepseek/tests/` 在 `dynamic-config.spec.ts` 中經真實憑據 seam（而非 stub）端到端覆蓋已儲存憑據路徑。`packages/llm/llm-pi-ai/tests/` 覆蓋探測路徑，包括不帶 Key 的探測不會發出 `authorization` 標頭。

`packages/client/ui-settings-models/tests/` 以同一張表加上形狀用例釘住 `apiKeyFailure`，並驅動兩張卡片：留空的輸入框可提交且不寫入憑據、只含空白的輸入框在欄位上失敗、非法或被包裹的 Key 同時攔截提交與探測、帶首尾空白的 Key 在 `credentials.set` 與探測之前被 trim，以及手工聲明的路由可以完全不帶 Key 建立。

使用者可見的終態則釘在它真正被組裝的位置：`examples/headless-agent/tests/headless.snapshot.ts` 讓 one-shot 應用在一個 HTTP 標頭無法承載的已存金鑰下執行，複用其 missing-credential 兄弟場景的同一套無金鑰 composition，並記錄該輪次以 `INVALID_CREDENTIAL` 結束、訊息可操作且既不含金鑰也不含 `ByteString` 字樣。包級測試無法證明這一點，而 web e2e 只覆蓋了瀏覽器那一半。
