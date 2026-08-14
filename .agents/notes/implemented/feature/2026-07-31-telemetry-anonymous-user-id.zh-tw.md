# Agent Note: 遙測匿名使用者 id（$DSH_HOME/.anonymous-user-id）與 OTel Resource 的 user.id

Status: implemented

[English](2026-07-31-telemetry-anonymous-user-id.md) | [简体中文](2026-07-31-telemetry-anonymous-user-id.zh.md) | 繁體中文

## 問題

session telemetry 已默認掛載（[默認掛載 Note](2026-07-31-web-telemetry-default-mount.md)），但 OTel Resource 只有 `service.name`/`service.version`，沒有任何使用者級標識——接收端無法按使用者聚合、無法數活躍使用者。此前唯一相關口徑是一條未實作的「hostname/本機 IP 雜湊派生 user.id」裁定。需要給 OTel 迴流一個語義乾淨的匿名使用者身份。

## 決策

`getOrCreateAnonymousUserId()` 返回 `$DSH_HOME/.anonymous-user-id`（`resolveDshHome` 解析，`$DSH_HOME` > `~/.dsh`）中的裸 UUID 行，首用生成隨機 UUID v4 並落盤；後端構造時把它作為 Resource 的 `user.id`（OTel semconv 標準使用者屬性）隨每批匯出攜帶一次。原始實作位於 `session-telemetry-otel`，因為當時不存在第二個真實消費端。`/feedback` 後來成為該消費端，因此[共享 id 決策](../architecture/2026-08-07-shared-feedback-telemetry-user-id.md)將所有權移交給 `@deepseek-ai/dsh-anonymous-user-id`，但不改變本 Note 記錄的儲存、匿名、並行與丟失語義。[直連 DeepSeek 請求身份](2026-08-11-deepseek-request-user-id-header.md)是同一 id 的第三個消費端。

| 裁定 | 取值 | 理由 |
|---|---|---|
| id 來源 | 隨機 UUID v4，絕不從 hostname/網路地址/git remote 派生 | 派生 id 可反查，「匿名」名不副實 |
| 儲存形態 | `.anonymous-user-id` 裸 UUID 行 + 換行，無 JSON 包裝 | 身份是獨立事實，不掛在某條遙測鏈路的文件命名/格式下 |
| 讀寫形態 | 同步 IO + 行程內按解析後文件路徑 memo | `OpenTelemetrySessionBackend` 構造函式是同步的（async 迫使外掛程式裝載改形）；一行程一次盤 IO，執行中刪文件不影響本行程 |
| 並行首啟 | `wx` 獨佔寫裁決，落敗方重讀勝者 id | 覆蓋常見並行（重讀撞進勝者建檔-寫入微秒窗仍可能導致該次執行中每個行程各持一個 id，下次啟動收斂到落盤值——遙測級後果，接受） |
| 丟失語義 | 文件被刪 → 下次啟動換新 id，接受丟失 | 匿名身份無復原價值；可復原性要求派生材料，與匿名衝突 |
| 寫失敗 | best-effort 返回記憶體 id | 遙測絕不因 home 只讀被阻塞 |
| 上報位置 | Resource 屬性，非逐條 attributes | 每批一次即夠接收端按 Resource 維度聚合；逐條注入要動 seam 約定且漲 wire 體積 |
| semconv 相依性 | 不引 `@opentelemetry/semantic-conventions` 包 | 一個字串常數不值一個相依性 |
| 落點 | `@deepseek-ai/dsh-anonymous-user-id`，由 OTel 後端、`/feedback` 與直連 DeepSeek 請求共享 | 消費端共用同一儲存契約，且不相依性匯出後端 |
| 單獨開關 | 無 | 任一消費端都可建立該身份；`DSH_TELEMETRY_DISABLED` 會停止遙測上報，但不會停用回饋確認或 DeepSeek 請求標頭 |

## 考慮過的替代方案

| 被拒 | 一句話理由 |
|---|---|
| hostname/IP 雜湊派生 id（此前口徑） | 可反查即非匿名；隨機 UUID 語義乾淨，使用者已裁定取代此前口徑 |
| user.id 放每條 record 的 attributes（Claude Code 形態） | 要動 session-telemetry seam 約定或逐條注入，wire 體積漲；Resource 每批一次已滿足聚合 |
| 在 `/feedback` 需要該 id 之前抽取共享包（初版實作） | 當時唯一的真實消費端是 OTel 後端；只有直接回饋需要同一個關聯 id 後，抽取才具備依據 |
| AppCLIEntry 讀好 id 經 config patch 注入 | 每個 surface 入口都要接線；config 裡傳執行時期事實與部署設定混淆 |
| 掛進 `@deepseek-ai/dsh-home-paths` | paths 是純路徑計算零 IO；帶持久化的身份能力會汙染包邊界 |

## 後果

- 一個 `$DSH_HOME` 在 OTel 迴流中是一個穩定使用者；不同 home 在構造上就是不同使用者，無跨 home 關聯機制。
- OTel 迴流、`/feedback` 與直連 DeepSeek 請求共享 `.anonymous-user-id`。
- 刪除 `.anonymous-user-id` 即重設身份（下次啟動生效）；home 不可寫時每行程各自持有一個記憶體 id 直至復原可寫。
- [默認掛載 Note](2026-07-31-web-telemetry-default-mount.md) 的身份 follow-up 中「匿名使用者 id」項由本決定關閉；hostname/surface 維度與脫敏規則、usage-metrics track 仍是待辦。
