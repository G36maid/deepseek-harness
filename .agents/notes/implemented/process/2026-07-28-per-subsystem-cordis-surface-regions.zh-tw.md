# Agent Note: 按子系統生成的 cordis-surface 區塊

Status: implemented

[English](2026-07-28-per-subsystem-cordis-surface-regions.md) | [简体中文](2026-07-28-per-subsystem-cordis-surface-regions.zh.md) | 繁體中文

## 問題

一個子系統的文件過去分散在三個歸屬：手寫的 subsystems 頁面（介紹、資料結構、動詞）、平鋪生成的 `docs/cordis-catalog/services.md` 中屬於它的 `ctx.<key>` 切片，以及平鋪的 `docs/cordis-catalog/events.md` 中屬於其事件作用域的切片。shell.md 的讀者必須再打開兩份文件，才能看到該頁面正在描述的服務介面與事件；除了手工維護的連結，沒有任何機制把這三個檢視表聯絡在一起。平鋪目錄還遊離在雙語語料之外（生成輸出只有英文，故被排除在配對之外），因此，這套參考內容完全沒有中文入口。

[生成式目錄決策](../../archived/process/2026-06-20-generated-cordis-catalog.md)本身（從原始碼生成、`@mode` 標籤交叉校驗、失敗關閉的類型連結覆蓋、`ts cordis-catalog` 圍欄）不在質疑之列；改變的只是生成輸出「落在哪裡」。

## 決策

`gen-cordis-catalog.ts` 把每個子系統的服務與事件參考注入到該子系統自己的頁面內部，置於 `<!-- BEGIN GENERATED cordis-surface … -->` / `<!-- END GENERATED cordis-surface -->` 標記之間；平鋪的 services/events 目錄隨之刪除。現在，每個子系統由一個頁面同時承載介紹、資料結構和生成的接線介面參考。

- **人工維護、例外時明確報錯的劃分。** `SERVICE_PAGE` 把發現的每個 `ctx.<key>` 對映到恰好一個頁面；`EVENT_SCOPE_PAGE` 對映每個事件作用域。生成器在兩個方向上都會直接報錯（既有被發現卻未對映的服務或作用域，也有已對映但遍歷不再發現的鍵或作用域），因此，劃分不會與原始碼中的介面範圍脫節。獨立的 AST 掃描讀取 `packages/*/*/src/**` 下每一個 `declare module 'cordis'` merge 塊，為投影在服務與事件兩側的盲區兜底：投影渲染不了的已聲明 Context key 或 Events 成員必須在 `SERVICE_WALK_EXEMPTIONS`/`EVENT_WALK_EXEMPTIONS` 中帶著點名理由，過時豁免直接報錯，且投影渲染的一切也必須對掃描可見（掃描約定歸[事件兜底決定](../architecture/2026-08-09-cordis-event-walk-backstop.md)所有）；教會投影渲染介面類型條目的後續工作由 `TODO(cordis-catalog-interface-services)` 標記。
- **區塊在配對兩側按位元組一致。** 生成器把同一份英文區塊位元組寫入 `foo.md` 和 `foo.zh.md`，是對「圍欄程式碼區塊在配對兩側逐位元組一致」這一既有規則的延伸。`verify-translation-pairing` 新增了專門的區塊一致性檢查（標記文法歸 `translation-pairing.ts` 中的 `partitionGeneratedRegions` 所有），能精確點名出現分歧或格式錯誤的區塊；整篇文件的結構簽章仍會把區塊內容再覆蓋一遍。
- **帶防護的配對自動記錄。** 一次改變區塊位元組的重新生成會讓每個被觸及的配對失去同步，因此生成器會自行重新記錄配對的 `.i18n.yaml`，但僅限本次寫入完全限定在區塊內的情況：兩側記錄的 blob hash 必須與寫入前的位元組相符，且兩側剝離區塊後的內容必須沒有變化。人工行文若有漂移，記錄就保持過時，配對閘門因此仍會強制走正常翻譯流程；全新的配對絕不自動記錄（那歸作者經評審的 `--write` 所有）。這樣 `.i18n.yaml` 保持為純粹的 `git hash-object` 值：不引入任何「剝離後 hash」的語義變化。
- **繼承層搬了家，而非消亡。** vendor 的 `ctx` 成員與 `internal/*`/loader/hmr/timer 事件渲染到 `docs/cordis-api/inherited.md`，緊鄰遷移後的 Cordis 核心 API 頁面（`docs/cordis-catalog/core/` → `docs/cordis-api/`）。框架表面落在框架自己的歸屬之下；harness 頁面仍是倉庫自有的詞彙。
- **頁內連結。** 簽名的 `Types:` 行連結到兄弟頁面（`core.md`、`shell.md`）；若某個類型的主要頁面就是正在渲染的頁面，該類型會從該行去掉，而不是連結到自身。頁面用 `#cordis-surface` 或 `#ctx<key>--<class>` 錨點引用自己的區塊：每個生成標題前都有一個顯式 `<a id>`，攜帶 GitHub slug（即平鋪目錄時期的歷史錨點），因此這些片段在 GitHub 與 VitePress 站點上解析一致——後者自帶的 slugger 對含大量標點的標題會得出不同結果。

## 曾考慮的替代方案

- **平鋪目錄與區塊並存、兩者都生成**：否決。每次 JSDoc 編輯都會產生雙份 diff 噪音，而本次變更本要消除的分散狀況（一個子系統、三份文件）也將延續。
- **整頁歸生成器所有、手寫介紹放進片段文件**：否決。敘述性行文佔每個現有頁面的大部分，應當留在被評審的文件本身；標記只需增加一條文法規則，同時還能讓作者繼續編輯真實文件。
- **本機化區塊（生成器同時輸出中文）**：推遲，與 i18n README 中針對其餘生成文件的長期備注同屬一個狀態：教會生成器輸出中文意味著要翻譯原始碼 JSDoc，而那是本次變更並不需要的機制。zh 頁面裡的英文區塊，與「英文 JSDoc 出現在逐位元組一致的圍欄程式碼區塊內」這一既有現狀相符。
- **在 `.i18n.yaml` 中對剝離區塊後的內容做 hash**：否決。記錄將不再是文件的 `git hash-object`，這會破壞「還原上次確認文字」的性質，也會破壞每個自行重算 hash 的消費端。

## 後果

- 一個子系統的完整說明集中在一個頁面上：`docs/subsystems/<name>.md`（及其配對文件）承載介紹、資料結構／動詞，以及生成的服務／事件介面參考；`docs/cordis-catalog/` 不復存在。
- 新的服務或事件作用域無法在未記錄、未對映的狀態下落地：在 `SERVICE_PAGE`/`EVENT_SCOPE_PAGE` 點名其所屬頁面之前，生成器一直失敗，而且該頁面必須已經存在，並在兩個語言側都帶有標記。
- 原始碼 JSDoc 變更後的重新生成會觸及兩種語言的受影響頁面，外加（當寫入限定在區塊內時）它們的配對記錄：一份機械、可評審的 diff。行文編輯仍然要走翻譯流程，因為自動記錄防護會拒絕它們。
- 網站的子系統導覽列出每個頁面（每個 locale 38 條路由：35 個已翻譯配對，加上仍為英文映像檔的 goal/terminal/commands 三頁），取代兩個平鋪目錄導覽項；Cordis API 一節新增 `inherited.md`。
- `packages/typert/generator/tests/cordis-catalog-contract.spec.ts` 固定區塊渲染器（`renderPageRegion`）、同頁連結去除規則，以及例外時明確報錯的 JSDoc 與類型連結校驗；`scripts/translation-pairing.spec.ts` 固定標記文法與 blob hash 原語；`scripts/gen-cordis-catalog-record.spec.ts` 證明自動重錄守衛拒絕每一種非法狀態（過時記錄、格式錯誤或鍵被改名的伴隨記錄、多餘條目、行文漂移、記錄缺失、快照缺失）。
