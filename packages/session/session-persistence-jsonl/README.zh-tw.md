# @deepseek-ai/dsh-session-persistence-jsonl

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

JSONL 持久工作階段儲存後端：`SessionPersistence` 的一個具體實作（`dsh-session-persistence` seam）。每個工作階段有一個僅附加的邏輯 JSONL 日誌，默認儲存為 `.jsonl.zstd`；停用壓縮時使用原始 `.jsonl`。

## 磁碟版面配置

```
<root>/
  --<normalized-cwd>--/          # readable project directory (or _no-cwd/)
    <encoded-id>/                # session-owned directory
      session.jsonl.zstd         # default: checksummed header frame + append frames
      session.jsonl              # only with compression: 'none'
```

- 第一個邏輯行是不可變的 `SessionHeader`，標記為 `{ type: 'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`。`delegationDepth` 在磁碟上必需，頂層工作階段為 `0`；缺失或無效值會拒絕日誌。`agentPreset` 必須持久化，因為它決定了被復原工作階段的工具與提示詞——復原成另一套組裝，就會重播模型已無法據以行動的歷史。後續每個邏輯行是一條儲存記錄；`assistant/chunk` 事件絕不丟棄，且 `seq` 在解碼日誌中保持連續（`events[i].seq === i`）。
- 儲存記錄是原樣 `SessionEvent` JSON，或在 `packChunks` 已啟用且連續段符合條件時寫入的**打包區塊行**（`text-chunks` / `reasoning-chunks` / `tool-call-chunks`；像 header 的 `session` 一樣不帶斜槓，因此行 tag 不會與事件類型混淆）：一行保存至少 3 個連續同 block `assistant/chunk` delta 事件，`seq0`/`time0` 和各成員的 `dt` 間隔精確重建每個成員的 `seq`/`time`。無損 codec 位於 `@deepseek-ai/dsh-session`（`packChunkRuns`/`decodeStorageRecord`），並使用精確形態 allowlist：任何未識別內容原樣儲存。讀取與版面配置無關：`load` 始終解碼行，因此打包、非打包和混合文件載入結果一致。
- 項目目錄保留規範化 cwd 的可讀形式，便於導覽，並限制在檔案系統元件上限內。分隔符替換和截斷刻意有損，因此規範化相同的 cwd 字串共享項目目錄；工作階段 id 仍選擇不同工作階段目錄。在不區分大小寫的檔案系統上，只有檔案系統規範化將兩種寫法解析到同一 transcript（文字記錄）時，身分驗證才接受備選路徑寫法。設定根仍由部署控制：可以是項目本機、共享、臨時或集中式。[項目工作階段目錄決策](../../../.agents/notes/implemented/architecture/2026-07-24-project-session-directories.md) 記錄這項取捨。
- 工作階段 id 是未驗證的帶品牌類型的字串，因此在使用前單射轉義為一個安全路徑段（無遍歷、無衝突）。結果目錄保留給其他工作階段自有產物；發現只讀取固定 transcript 檔名。

## 設定

| 鍵 | 類型 | 說明 |
|---|---|---|
| `root` | `string`（必需） | 所有工作階段文件的根目錄。**無預設值**：`process.cwd()` 預設值會隨行程 cwd 變更（bash 呼叫、子行程）而分散文件。現有根必須是可讀目錄；缺失根在第一次實體化時建立。 |
| `packChunks` | `boolean`（默認 `true`） | 將符合條件的 delta 區塊連續段寫為打包行（在真實程式設計工作階段上測得邏輯日誌約小 60%）。設為 `false` 可用於每事件一行診斷；無論該寫入側開關如何，都能讀取打包行。 |
| `compression` | `'zstd' \| 'none'` | 默認 `'zstd'`；`'none'` 保留換行分隔 UTF-8 文字。 |
| `preparedSessionCacheSize` | 正整數（默認 `5`） | 冷歷史檢查後保留、供復原複用的未發布工作階段數量上限。 |
| `writeBatchMaxDelayMs` | 正整數（默認 `200`） | 空閒的活動事件佇列收到待寫入事件後開啟的固定合併視窗。後續事件不會重設視窗；flush 與 teardown 會繞過它。該值不限制事件迴圈、序列化操作或後端延遲。最大值為 Node 計時器上限 `2_147_483_647` ms。 |

`locate(meta)` 返回已解析項目/工作階段目錄內固定 transcript 的 `{ kind: 'jsonl', path }`。它不執行檔案系統 I/O：可以在目錄或文件存在前返回目標，現有文件也只包含最近一次 flush 完成的前綴。

## 物理編碼

默認產物是獨立 [Zstandard frame](../../../.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md) 的標準拼接：一個僅包含 header 行的帶 checksum frame，後跟每個持久 append 批次一個帶 checksum frame。後端使用 Node 內建 Zstandard API 和默認壓縮等級，不提供等級開關。清單只讀取並驗證 header frame。`compression: 'none'` 在原始表示中保留相同邏輯行。

一個根只屬於一種編碼。啟動發現和定向尋找會拒絕相反 suffix，錯誤會命名不相容產物，並指示呼叫方選擇匹配 mode 或獨立根。平鋪 `<project>/<id>.jsonl*` 產物也會被拒絕，而不是忽略。不提供遷移、混合根回退或雙寫。

## 持久性與崩潰語義

- **綁定儲存身份。** 尋找要求可讀項目目錄中只有一個匹配工作階段目錄，然後驗證 header id 等於請求 id，且 header id/cwd 派生所選 transcript 路徑。清單應用同一路徑檢查，並拒絕重複 id。身份失敗發生在修復或 append 前。
- **延遲實體化。**`create(meta)` 不寫入；第一次 `append` 將編碼 header 和第一批寫入暫存檔並執行 `fsync`。POSIX 透過硬連結無覆蓋發布，並對父目錄 `fsync`。Windows 透過 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` 無覆蓋發布，並透過同一 write-through pattern 建立缺失目錄。已建立但從未 append 的工作階段不留下磁碟內容，不在 `list` 中。
- **僅附加。** 已 flush 事件絕不重寫。後續原始批次 append 行；壓縮批次 append 一個 frame。兩條路徑都執行 `fsync`，並在捕獲到寫入或同步失敗時回滾到之前位元組長度。
- **當機復原：保留有效尾部工作。**`load` 驗證每個完整壓縮 frame，並掃描解壓縮 JSONL。最後 frame 結構不完整時，讀取器保留其完整解碼記錄，從 frame 開頭截斷，並使用共享[持久化約定](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md) 需要的合成工具、步驟和輪次 closer 重新編碼這些記錄。原始 mode 從第一個不完整行截斷。已經存在卻沒有完整 header frame 的壓縮工件、完整 frame 中的 checksum/解壓縮失敗，或位於最後已提交的 `turn/end` 處或之前的缺陷都屬於損壞，會被拒絕。
- **非修改式檢查。**`inspect()` 返回不可變、平衡的邏輯檢視表，並可在記憶體中合成復原 closer，但不會截斷不完整尾部或更改輕量修訂。
- **連續 seq。**`append` 拒絕第一個 `seq` 不繼續已儲存日誌的批次，並拒絕無法 JSON 序列化的 `event.data`，同時命名違規事件類型。
- **輕量修訂。**`listSnapshots(signal?)` 使用 device、inode、size 和納秒時間戳標識日誌，避免解析完整日誌；該標識會在 append、修復、替換或儲存變更後改變。完整前綴讀取要求讀取位元組前後的身份一致，`readStoredRevision()` 使用同一身份校驗保留的 preparation，而不載入日誌。快照清單透過產物發現原樣轉發該訊號，並在每個 `stat` 前後檢查取消；由於檔案系統 `stat` 不可中斷，取消會等待活動呼叫完成，然後在不啟動另一次呼叫的情況下拒絕。

## 寫入路徑

外掛程式將凍結的工作階段事件複製到每個活動工作階段各自的 controller。第一個待處理事件會開啟設定的固定批次處理視窗，後續事件會加入但不會重設截止時間。視窗到期後會啟動一次持久化追加；該次寫入期間接納的事件會形成另一個獨立有界的後續批次。`session/flush` 會取消等待並排空當前與待處理批次。每工作階段遊標防止復原後的工作階段重新 append 已儲存事件，外掛程式載入時會為活動工作階段設定初始狀態。所屬後端實例序列化單工作階段操作；dispose（資源釋放）會在拆卸前排空每個保留的 controller。每個邏輯事件都會保留：批次處理只讓單個壓縮幀或一次原始 JSONL fsync 承載更多記錄。

## 模型體驗

### 復原的對話歷史

#### 模型看到的內容

JSONL 儲存不會向當前請求提供提示詞或 schema。載入會復原已儲存的表層歷史，並保留之前的請求 header 用於重建；新 loop 組合當前 envelope。復原會用 `TOOL_NOT_STARTED` 平衡沒有已持久化呼叫的 assistant 請求；已持久化呼叫無結果時則變為 `TOOL_OUTCOME_UNKNOWN`，它要求模型只重試只讀或冪等工作，並驗證可能的副作用或詢問使用者。原始 `assistant/chunk` 記錄不會重複生成訊息。

#### Token 影響

當前請求不會新增 token。復原後的 agent（代理）會因保留的歷史、當前 envelope，以及每個中斷呼叫中以引用形式加入的修復結果文字而消耗 token。

#### KV Cache 影響

JSONL 儲存不修改即時請求前綴。只有重建歷史、當前 envelope 和模型路由匹配時，復原 loop 才能重用提供方快取；崩潰修復結果僅附加。

## 已知限制與暫緩事項

- **只載入已設定編碼和當前 `SESSION_FORMAT_VERSION`（v0）**：更改壓縮需要獨立/全新根，或選擇殘留原始 mode；預發布格式沒有遷移。
- **平鋪文件儲存版面配置不載入**：載入前使用獨立根，或將預發布產物移入項目/工作階段目錄版面配置。
- **壓縮文件不能直接按行讀取**：使用後端載入；或在寫入新根前選擇 `compression: 'none'`，以便外部行 reader 使用。
- **不刪除工作階段文件**：日誌在 `root` 下累積，直到外部移除（seam 無刪除介面）。
- **每工作階段一個活動 writer**：append 和修復只在所屬後端實例內協調。在所有者完成完全靜止的 dispose 前，其他後端實例或行程不得寫入同一工作階段；初始同 id 發布仍透過 POSIX 無覆蓋硬連結或 Windows 無替換 write-through rename 保持衝突安全。
- **POSIX 實體化需要硬連結支持**：第一次 append 使用 `link()`，使同 id 競態失敗，而不覆蓋已提交日誌；Windows 使用無替換 write-through rename。
