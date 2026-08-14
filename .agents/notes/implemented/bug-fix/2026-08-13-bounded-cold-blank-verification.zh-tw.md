# Agent Note: 有界驗證冷空白工作階段

Status: implemented

[English](2026-08-13-bounded-cold-blank-verification.md) | [简体中文](2026-08-13-bounded-cold-blank-verification.zh.md) | 繁體中文

## Problem

Web 工作階段樹會隱藏空白 Session，並把當前選中的空白項複用為 New Session。已附加 Session 可以從記憶體事件日誌派生空白狀態，但 `session.list` 通常不會載入每一份冷日誌。把所有已物化的冷 Session 都視為非空，會暴露舊版本留下的空 Session；反過來，把 projection cache 中的 `blank: true` 當成當前事實，則可能在日誌已經前進而 fail-soft cache 仍然過時時隱藏真實對話。

同一份冷清單還曾用 JSONL 工件的 mtime 作為 `updatedAt`。打開 Session 會追加 `session/end-seed`，因此即使沒有真人 prompt，單純拾起也會刷新 mtime，並把該 Session 提升到最近使用的對話之前。

## Decision

`dsh-host-apiproxy` 註冊 `sessionListMetadata` 投影，其中包含 `blank` 與 `lastPromptAt`。已附加摘要直接用同一組函式摺疊即時日誌。`blank` 只在 `turn/start` 時從 true 單調變為 false；`lastPromptAt` 只在來源 kind 為 `user` 的 `user/message` 上更新。

冷摘要信任快取的 `blank: false`，因為已包含 `turn/start` 的 checkpoint 前綴會始終保持非空。快取的 `blank: true` 和 cache miss 都無法證明當前日誌為空。當 persistence 透過 `locate()` 暴露物理工件，且其觀測大小不超過 `coldBlankProbeMaxBytes` 資格閾值（默認每個 Session 1 KiB）時，閘道呼叫 `readFrom(id, 0)`，從已存前綴摺疊精確清單元資料。超過閾值的文件、不提供位置的後端、已消失的工件和讀取失敗都產生 `blank: false`，讓 Session 保持可見。

`updatedAt` 取 `createdAt` 與 `lastPromptAt` 中較晚者。符合資格的工件讀取無需額外 I/O 即可提供精確 `lastPromptAt`；其他 cache miss 或過時 checkpoint 只會讓 Session 排得偏舊，而不會因無關的文件寫入被提升。每次非同步冷讀取後，閘道都會再次檢查即時 store；若另一請求期間已復原該 Session，則用已附加摘要替換冷結果。

## Alternatives considered

**信任快取的 `blank: true`。** 拒絕，因為 projection cache 有意允許持久日誌前進到 checkpoint 之後。首個 `turn/start` 之後若發生崩潰或 fail-soft 寫入失敗，真實對話就會被隱藏，用戶端還可能把它複用為 New Session。

**讀取每一份冷日誌。** 拒絕，因為清單延遲與 I/O 會隨所有已存對話的總位元組數成長。物理大小資格檢查只針對能夠低成本核驗的小型歷史工件，更大的未知項則向保持可見降級。該檢查有意不為“讓閾值與讀取原子化”單獨新增 persistence 操作：並行成長可能增加一次探測的讀取成本，但新增事件只會保持可見，或把空白結果改為非空。

**把空白狀態與最近時間存入權威 persistence index。** 暫緩，因為 JSONL 的首行不可變，需要增加帶有順序寫入要求的第二份持久工件；SQLite 則需要 schema 欄位。更廣泛的精確索引設計仍由[最後活動提案](../../proposed/architecture/2026-07-29-durable-last-activity-index.md)負責。

**繼續按 mtime 排序 JSONL。** 拒絕，因為 mtime 記錄包括拾起邊界在內的每一次工件寫入，而非最近真人 prompt；其錯誤方向會把未經操作的 Session 提升到清單開頭。

## Consequences

既有的小型空白 JSONL 工件無需相依性 projection cache 是否存在即可被隱藏，過時 cache 也無法隱藏已存的 `turn/start`。對於 cache 尚不能證明非空，且觀測物理大小在設定閾值內的每個 Session，冷清單可能讀取其工件。對默認交付的 Zstandard JSONL 後端，該閾值比較壓縮後的位元組數。

超過閾值的空白工件，以及來自不提供位置的後端的空白 Session 會保持可見。對於未被讀取的工件，缺失或延遲的最近時間 cache 會回退到 `createdAt`。這些都是保守降級：UI 可能多顯示一條空記錄，或把 Session 排得偏低，但不會隱藏真實對話，也不會因為單純打開而把工作階段提升到前面。

閘道自有投影是閘道 fiber 的 effect；解除安裝閘道會移除該 key。單元覆蓋固定了臨界大小資格、拒絕過時 true、複用單調 false、小日誌精確最近時間、即時附加競態、回退方向、真人 prompt 最近時間和 fiber 銷毀。無金鑰 Web snapshot 會啟動發行版的壓縮 JSONL 組合，在沒有 cache row 的情況下播種一份小型冷空白工件，並驗證側欄不展示它。
