# apps/web 瀏覽器 e2e

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這些測試在行程內啟動真實的 web 組合，並用真實 Chromium 透過真實 HTTP 驅動它。該 lane
的執行機制——模式、fixture、golden，以及與 `dsh web` 之間刻意保留的組合差異——記錄在
[`scaffold.ts`](scaffold.ts) 和
[瀏覽器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md)中。

## 這些是 Host 面的測試

它們在根 `tsconfig.host.json` 中做型別檢查，而不在 Client aggregate 中，因為它們直接讀取
Host 服務：`ctx.apiProxy`、Host 側 `SessionStore`、`ctx.sessionProjectionCache`。執行時期驅動
瀏覽器並不使一個文件成為 Client 程序的一部分——兩個 face 在相同的鍵上以不同服務合併 cordis
`Context`，因此單個程序無法同時看見兩者。把這些文件挪進 Client aggregate 會讓每一處
Host 服務訪問都無法編譯。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一個 Client 包——無論值還是類型——都會把它整個 TypeScript 工程、以及它引用的每個工程
拉進 **Host 建置圖**。這已經坑過本 lane 一次：四個 Client 消費端包引用了 `api/remotes` 的
Client face，而該 face 必須等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之後才能編譯，
於是 Host 建置階段變成在等一個由它自己產出的產物。

當某個場景需要 Client 持有的常數或純函式時，改為在此處映像檔一份，並緊挨著一條註解掉的
import 點明源模組。這樣漂移會表現為選擇器未命中或映像檔值過期——是響亮的失敗，絕不會是靜默
透過。`scaffold.ts` 按此規則映像檔歡迎聲明的 namespace、確認欄位、版本和被斷言的中文文案。

有兩類 Client import 是長期成立的。`assembled-boot.ts` 驅動 shell 本身，因此它從
`@deepseek-ai/dsh-client-web` import `AppWebEntry`、從
`@deepseek-ai/dsh-client-modules/client` import boot manifest 類型：啟動真實 shell 正是該
harness 的用途，且這兩個包本來就在 Host 圖中。另外，chat 場景從
`@deepseek-ai/dsh-client-runtime/client` import `conversationContextKey`，因為
`client/runtime` 經未拆分的 `directory-picker` 包可達，且不會再牽入別的東西。這種可達性是
偶然而非保證——一旦它離開該圖，就像其餘情形那樣映像檔該 helper。

沒有任何機制強制這條規則；靠 review 守住它。
