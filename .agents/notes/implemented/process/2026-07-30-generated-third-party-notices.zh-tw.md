# Agent Note: 生成的第三方聲明

Status: implemented

[English](2026-07-30-generated-third-party-notices.md) | [简体中文](2026-07-30-generated-third-party-notices.zh.md) | 繁體中文

## 問題

本倉庫開源需要披露所相依性的第三方軟體及各自的授權條款。這份披露必須完整，必須隨相依性變化保持為真，還必須給出讀者用得上的資訊：哪些包最終會進到使用者機器上，哪些只用於建置和測試。

手寫清單無法長期滿足其中任何一條。約一百行從各 manifest（中繼資料清單）推匯出來的包名與授權條款標識，只要有相依性新增、移除或換用授權條款就會悄悄失真，而沒有任何檢查會察覺。

## 決策

[`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md) 由 [`scripts/gen-third-party-notices.ts`](../../../../scripts/gen-third-party-notices.ts) 依據各工作區 manifest、`vendor/README.md`、`pyproject.toml` 與 `pnpm-workspace.yaml` 生成。根 README 雙語兩側都從「授權條款」一節鏈到該文件。

**新鮮度會得到維護，而非僅靠校驗。** 只要暫存了生成器的任一輸入——任何 manifest、工作區聲明、根鎖定檔、`vendor/README.md`、某個 `pyproject.toml`、生成器自身，或持有建置期 pin 的指令碼——pre-commit 任務就會重新生成該文件並將其暫存，改相依性的人不必事後再折返跑一次生成器。已提交的位元組隨後由 [`scripts/gen-third-party-notices.spec.ts`](../../../../scripts/gen-third-party-notices.spec.ts) 斷言，而測試 lane 本就會跑這個文件——這項校驗不增加閘門行程、不佔調度位、也不新增 CI 步驟。需要單獨校驗時，`pnpm run verify-third-party-notices` 仍然可用。

有一處觸發缺口是接受而非繞過的：lefthook 只檢視磁碟上存在的文件，因此**刪除** manifest 不會觸發任何任務，移除一個包會落到測試 lane 的斷言上。重構暫存文件清單以納入刪除的做法不成立——無論怎麼給清單，lefthook 都會拿工作樹過濾一遍。這個場景正由斷言兜底。

文件默認只披露**直接**相依性。完整的 npm 閉包連同鎖定版本已記錄在 `pnpm-lock.yaml`（`pnpm licenses list` 可渲染），Python 閉包記錄在 `python/sdk/uv.lock`；再用散文謄一遍只會得到一份更差的副本。唯一明確披露的傳遞相依性，是 `@anthropic-ai/claude-agent-sdk` 透過 `optionalDependencies` 聲明的官方 Claude 平臺載荷集合，因為這些包承載隨產品分發的 Claude Code 可執行文件，而非普通的庫實作細節。

**分層依據是聲明方所在區域，而非 manifest 欄位名。** 只要 `DEV_ONLY_AREAS` 之外的任一 manifest——即根 manifest、`packages/test-support/`、`packages/test-support/client-runtime/`、`website/`、`examples/`、`native/` 之外——在 `dependencies` 或 `optionalDependencies` 裡點名某個包，它就是執行時期相依性。單看欄位名在兩個方向上都會出錯：測試支撐包把 `vitest` 寫在 `dependencies` 裡卻並不交付它；而根目錄的原始碼執行指令碼透過 `tsx` 執行，根本沒有任何 manifest 把它聲明為執行時期相依性，只能由生成器顯式標記。

執行時期層刻意覆蓋**所有可掛載的外掛程式**，而不止 CLI、Web UI 與 Python 執行時期默認載入的那些。從原始碼執行時期，使用者可以透過 `cordis.yml` 掛載任何外掛程式包；因此，`@modelcontextprotocol/sdk` 與 OpenTelemetry 系列即使沒有任何默認裝配引入，也會觸達真實使用者。對法務披露而言，披露不足纔是代價更高的那個方向。

manifest 集合由根 `pnpm-workspace.yaml` 聲明的 `packages:` 成員派生，其中包括 Landlock 工作區及其公開包，因此新增成員區域在聲明當天就會被讀取，而不必等誰想起來去補一份清單。授權條款與倉庫地址取自根工作區已安裝的 pnpm store 和包本機連結場；某個包兩處都解析不到時直接失敗，而不是留下空單元格。`OVERRIDES` 收錄已發布 manifest 答不上來的包：用 Rust 建置、發布時省略 `license` 欄位的 npm 可執行包，以及 `modelcontextprotocol/servers` 系列——該倉庫正處在 MIT 向 Apache-2.0 的重新許可過程中，實際條款按貢獻逐條而定。執行時期相依性的授權條款若不在寬鬆清單內即為硬失敗：交付 copyleft 是一項分發決策，不該被一次重新生成悄悄吸收。被原始碼收編的包會與 `vendor/README.md` 交叉核對，出現非 MIT 即報錯；`pnpm-workspace.yaml` 的 `patchedDependencies` 列入執行時期表格，因為 pnpm 在安裝期就會打上這些修補程式——交付產物攜帶的是改動過的 `@earendil-works/pi-tui` 與 `node-pty`，修補程式文件本身就是改動的完整記錄。

項目所有者另行授權分發每個官方 `@anthropic-ai/claude-agent-sdk` 版本，以及該版本透過 `optionalDependencies` 聲明的官方 Claude Code CLI 與平臺載荷。生成器將其表示為一項精確匹配直接包身份的例外，而非寬鬆授權條款覆蓋項：`SEE LICENSE IN README.md` 與 `SEE LICENSE IN LICENSE.md` 仍歸類為非寬鬆，所有無關的非寬鬆執行時期相依性仍以默認拒絕方式失敗。存在該 SDK 時，生成器會讀取其已安裝 manifest，拒絕不符合官方 SDK 載荷前綴的選填包身份，推導當前 SDK、CLI 與載荷版本，核驗已安裝宿主載荷的身份、版本和聲明授權條款欄位，並在單獨的聲明章節中渲染 SDK 聲明的完整載荷集合。版本、聲明授權條款和載荷集合發生變化時無需新的身份授權，但仍須經過常規的相依性、鎖定檔、相容性、條款和聲明評審。

## 測試

斷言新鮮度的同一個 spec 也用 fixture（測試前置資料）manifest 釘住分層規則，覆蓋促成該規則的兩個場景：測試支撐包的 `dependencies` 條目，以及沒有任何應用掛載的外掛程式包。它還把各解析器釘在那些原本會讓某個包無聲消失的形態上：不再覆蓋全部收編目錄的 `vendor/README.md` 表、含 extras 的相依性陣列（`"httpx[http2]"`）、完全不帶版本的相依性、作者自取名字的 `[dependency-groups]` 表，以及任何硬編碼清單都不含的工作區成員區域。這些都是靜默漏報路徑——正是披露文件最擔不起的失敗方式。

Claude 分發測試證明：只有精確匹配的直接 SDK 身份會繞過通常的非寬鬆執行時期拒絕；該繞過不會改變授權條款分類；載荷集合來自 SDK manifest，而非版本或平臺允許清單。SDK 身份錯誤、載荷缺失或存在無關的選填包身份時，測試都會失敗。

## 考慮過的替代方案

**保留手寫文件，發版時人工過一遍。** 用肉眼審閱上百行推導資料，恰恰是生成器能做對的活；而且在兩次發版之間，文件自稱「列出全部直接相依性」這句話無人驗證。

**用專門的 `doc-sync`（文件同步閘門）校驗。** 倉庫裡其他生成產物都是這麼把關的，本次改動最初也是這個形態。但它要在本已冗長的矩陣裡再佔一個閘門行程和一個調度位；更糟的是，它唯一的失敗方式，就是在別人推完一個無關的相依性升級幾分鐘後，通知對方回去重跑一次生成器。改為提交時重新生成消除了這次打斷，而把斷言放進測試 lane 本就會跑的 spec 裡，則以零額外 CI 成本保住了這項保證。

**列出完整傳遞閉包。** 閉包有數千個包，鎖定檔裡已帶精確版本，鋪開只會淹沒讀者真正要評估的直接相依性。文件轉而指向鎖定檔與 `pnpm licenses list`。

**按 manifest 欄位分層（`dependencies` 與 `devDependencies`）。** 機械上最省事，但在真實資料上兩個方向都會出錯，理由見上文分層段落。

**只按已交付裝配的可達性分層**（`apps/*` 加 `python/sdk-runtime`）。這樣得到的執行時期層更緊湊，但會把 MCP 用戶端與 OpenTelemetry 匯出器判為僅開發用途——而執行已安裝倉庫的使用者完全可以掛載它們。這會低估披露，對法務通告來說錯在了更危險的一側。

**將 Claude SDK 條款視為寬鬆條款，或新增可複用的非寬鬆允許清單。** 兩種方案都會誤述上游聲明，並讓無關執行時期相依性繼承從未授予它的授權。這項窄例外只匹配官方直接 SDK 身份；其選填載荷身份僅作為該 SDK 聲明的資料被接受，並繼續明確歸類為非寬鬆。

**把披露文件做成雙語對。** 其他根文件都是成對的，但這份文件是上游包名、SPDX 標識與網址構成的表格，可翻譯的只有寥寥幾段章節導語。`scripts/translation-pairing.ts` 的發現範圍限定在 `README*`、`.agents/notes/**`、`docs/**` 與 `python/**`，根目錄下的非 README 文件在構造上就不屬於雙語語料；雙語入口由 README 對承擔。

## 後果

此後改動相依性時，重新生成的披露文件會隨同一個提交入庫。觸及 manifest 的提交多付一次生成器執行——約一秒；其餘提交不受影響。若停用掛鉤提交，代價推遲為一次測試 lane 失敗，其報錯會指明補救命令。

生成器需要已安裝的相依性樹，因此比純原始碼生成器更重；發布元資料不可用的新包需要補一條 `OVERRIDES`，而不是默默渲染出空白授權條款。這兩類失敗都會明確報錯並指出補救方式。

分層規則是編碼在一個常數裡的策略。若新增了不參與交付的工作區區域——第二層測試基礎設施、另一個站點——就要同步擴充 `DEV_ONLY_AREAS`，否則其相依性會被當作執行時期相依性披露出去。

Claude 身份例外刻意比其啟用的載荷披露範圍更窄。升級 SDK 無需新的所有者授權，但如果已安裝的 SDK 未公開自身版本、CLI 版本和至少一個官方平臺載荷，或當前宿主載荷與 SDK 聲明不符，重新生成就會失敗。維護者仍須評審發生變化的條款與相容性；生成器會阻止授權悄然擴大到其他包。
