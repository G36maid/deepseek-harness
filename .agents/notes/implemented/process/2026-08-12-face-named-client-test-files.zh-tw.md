# Agent Note: 用檔名標明 client 測試的編譯面

Status: implemented

[English](2026-08-12-face-named-client-test-files.md) | [简体中文](2026-08-12-face-named-client-test-files.zh.md) | 繁體中文

## 問題

`packages/client/*/tests/` 同時存放兩個編譯面的測試。多數覆蓋某個 Client 包的瀏覽器半邊，屬於 `tsconfig.client.json`；少數覆蓋拆分包的 Host 半邊——載體的 node 半邊 spec——只能在 `tsconfig.host.json` 裡型別檢查，因為觸及 Host 原始碼的 Host 面 spec 需要那些文件所在的 Host 工程。

檔名不說明一個測試覆蓋哪一面，兩個聚合就無法按模式劃分這個目錄。host 聚合整體排除 `packages/client/**`，Client 聚合收下全部，於是 Host 面 spec 留在了 Client 程序裡。它們隨之需要 Client 聚合引用 `packages/client/connection/tsconfig.host.json`——一個 Client 設定進入拆分包的 Host 面，而 `constraints` 的工程引用規則拒絕這條邊。

沒有命名規則時另有兩條出路，且都更差。在 host 聚合裡用 `files` 把那四個文件鑿回來，與同一個文件裡的整體排除自相矛盾，且每新增一個 Host 面 spec 就要加一條。放行這條跨面引用則削弱了那條把兩套 `Context` 合併隔開的規則。

## 決策

`packages/client` 下的測試文件在檔名裡說明自己覆蓋哪一面：

| 後綴 | 面 | 數量 |
|---|---|---|
| `*.client.spec.ts` / `*.client.spec.tsx` | Client | 232 |
| `*.client.ts` / `*.client.tsx`（共用輔助文件、fixture） | Client | 5 |
| `*.host.spec.ts` | Host | 4 |

兩組後綴互斥——誰都不是對方的後綴——因此每個聚合各保留一條寬的測試 glob，並排除對面：

- `tsconfig.client.json` include `packages/client/*/tests/**/*.{ts,tsx}`，exclude `packages/client/*/tests/**/*.host.spec.ts`。
- `tsconfig.host.json` 經其倉庫級 `packages/*/*/tests/**/*.ts` 到達同一目錄，exclude `packages/client/*/src/**` 以及四條 `*.client.*` 模式。

這建立在 `exclude` 過濾 `include` 結果之上：兩者同時命中時，文件留在程序外。沒有文件被兩個聚合約時點名，兩個聚合都不需要 `files` 條目或跨面工程引用。`verify-md-links` 與 `constraints` 的工程引用規則原樣透過，載體不需要任何例外。

`packages/client` 下新增的測試必須帶面名後綴。不帶後綴的文件會被 host 聚合的包級 glob 命中，並靜默地把 Client 原始碼拖進 Host 程序。

## 本次改名清單

- 232 個 Client 面 spec，從 `*.spec.{ts,tsx}` 改為 `*.client.spec.{ts,tsx}`。
- 5 個 Client 面輔助文件，從 `*.{ts,tsx}` 改為 `*.client.{ts,tsx}`：`connection/tests/fake-api`、`runtime/tests/fake-api`、`runtime/tests/event-script`、`ui-conversation/tests/chat-snapshot-fixture`、`ui-tool/tests/tool-details-render`。
- `packages/client/connection/tests/` 下 4 個 Host 面 spec，從 `*.spec.ts` 改為 `*.host.spec.ts`：`api-request-trust`、`http-bridge`、`node-half`、`websocket-downlink`。
- 2 個 snapshot 文件，跟隨各自 spec 改名，內容未變。

`scripts/rescope-vendor.ts` 的精確編輯表點名了其中三個 spec，那些路徑隨之移動。

## 考慮過的替代方案

**只給 Host 面文件加 `*.host.spec.ts` 後綴，Client 側不動。** 第一次嘗試就是這樣，而它行不通：`.host.spec.ts` 同樣以 `.spec.ts` 結尾，於是 host 聚合對 `*.spec.ts` 的排除把它一並吞掉，`include` 也贏不回來。讓兩條模式互不相交，靠的正是兩面都命名。

**把 Host 面文件命名為 `*.host-spec.ts`，脫離 `.spec.ts` 慣例。** 不動 Client 側即與 `*.spec.ts` 不相交，但為了一個設定細節離開了倉庫的測試命名慣例和 vitest 的發現模式。

**把 Host 面 spec 移到 `tests/host/` 子目錄，按路徑劃分。** 用 glob 同樣可行，但它把一個包的測試拆到兩個目錄，瀏覽 `tests/` 的讀者不再一眼看到它們在一起。

**保留對 `packages/client/**` 的排除，用 `files` 把 Host 面 spec 鑿回來。** `files` 不受 `exclude` 過濾，所以確實能拿到它們——代價是同一個文件一邊斷言該目錄屬於另一個聚合、一邊列出這條斷言的例外，且每個 Host 面 spec 都要加一條。

## 後果

這條規則的成本是每個 client 測試檔名多一個後綴，買到的是一次機械劃分：一個聚合的成員資格由檔名推出，而不是由一份清單決定。`constraints` 裡那條禁止跨面引用的規則保持全部強度——沒有包獲得豁免。

Host 程序現在在 `packages/client` 下看到 11 個文件（4 個 Host 面 spec，以及經工程引用解析到的載體 Host 面聲明），而在排除按模式、檔名卻不按模式的狀態下漏進來的是 60 個。

vitest 經 `**/*.spec.{ts,tsx}` 仍能發現每個改名後的文件，因此測試設定沒有變化；完整 client 套件跑 235 個文件、3181 個用例。knip 各 workspace 的 `tests/**/*.spec.{ts,tsx}` entry 模式同理匹配新名字。

這條規則留下的失敗模式是新增一個不帶後綴的測試：它會在 Host 程序裡針對 Client 原始碼透過型別檢查，而不是顯式報錯。
