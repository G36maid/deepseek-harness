# Agent Note: First-run readiness reads every provider, and the setup card closes

Status: implemented

[English](2026-08-12-onboarding-reads-every-provider.md) | [简体中文](2026-08-12-onboarding-reads-every-provider.zh.md) | 繁體中文

## Problem

首次使用引導步驟與 Models 頁都只向一個描述全部提供方的聯接快照提出了同一個問題——`deepseek-official` 的憑據存了嗎？兩個缺陷由這一次讀取而來。

設定了別的提供方（某個 pi-ai 閘道、某條自建路由）、根本不打算用 DeepSeek 官方端點的使用者，會在每一個空白工作階段上被全屏憑據提示接管，而其背後輸入框裡早已選好了一個可用模型。除了存入一把 DeepSeek 金鑰，他們做什麼都結束不了它——因為該步驟的就緒投影從不看他們已經配好的那一行。

在 Models 頁上，同一次讀取每次進入都會把 DeepSeek 設定卡片展開在他們面前，而這張卡片關不掉：它由行資料渲染而來，沒有任何本機狀態可供「取消」翻轉，因此那顆取消按鈕不產生任何可見效果。更糟的是，它與行內編輯卡／新增卡／自訂聲明卡共用同一個關閉回呼，而該回調會無條件清空那三個狀態——於是取消一張它們一個都不擁有的卡片，反而丟棄了新增卡裡的草稿，自己卻仍然開著。

## Decision

一個謂詞回答兩處介面真正需要的事實。`providerUsable(row)` 在路由已註冊進配接器登錄檔（`entry.active`）、且其解析後 profile 所指名的憑據已儲存時為真；不指名任何引用的 profile 走提供方自己的認證路徑，沒有 settings 地址的存活路由亦然，因此二者都不欠這個頁面一把金鑰。

`onboardingReadiness`（原名 `deepSeekReadiness`，該名稱已不再描述它讀取的內容）只要聯接中有任意一行可用，就返回 `provider-ready`。只有二者皆無的使用者才會走到官方 DeepSeek 尋找，那部分保持不變：它是這條提示唯一能為其提供金鑰輸入框的路由。這道門檻吸收了舊投影攜帶的兩個診斷——`settings-unavailable` 與 `credential-ref-unavailable`——因為二者描述的都是新門檻現在判為可用的活躍路由；對使用者而言結果本就一致（該步驟不渲染直接完成）。

`needsSetup(row, anyUsable)` 接受同一個事實，因此設定卡片僅代表首次執行姿態。當另有可觸達的提供方時，DeepSeek 就是一行帶缺失金鑰點的普通行，距離同一張卡片只有一次「編輯」點擊。

現在每一類卡片各自擁有自己的關閉回呼。`closeSetup` 把該提供方記入元件本機的 `dismissedSetup` 集合，別的一概不碰；`closeEditor` 繼續清空它那些卡片所擁有的三個狀態。兩者都經由同一個 `announceSaved` 助手完成保存後的重載。關閉狀態屬於查看態，與展開的編輯卡和新增卡一樣：對仍處於首次執行姿態的使用者，重載會復原該姿態。

## Alternatives considered

- **從模型目錄（`llm.models`）而非聯接推導就緒狀態。** 它最直接地回答「使用者有沒有能對話的東西」，但會在一個已經持有聯接的介面上多花每提供方一次列舉往返，而且某個提供方列舉的瞬時失敗會讓引導重新彈出。
- **在 `providerUsable` 中要求 `row.configured`。** 它讀起來更嚴格，卻會恰好排除部署透過 `cordis.yml` 掛載、沒有可設定提供方聲明的那些路由——它們是正在提供模型、只是這個頁面設定不了的存活路由。使一個提供方可用的是註冊，不是可設定性。
- **只加關閉狀態，保留卡片自動展開。** 那隻修好取消按鈕，別的什麼都沒修：已有可用提供方的使用者每次進入 Models 仍會被塞一張 DeepSeek 表單，那是同一個誤讀的安靜版本。
- **把關閉狀態持久化到 settings。** 一個「別再問 DeepSeek」的持久標志，是關於首次執行狀態的第二個事實，可能與聯接互相矛盾。憑據本身已經永久結束該姿態，而這個頁面上其他每一張卡片都是工作階段內的。

## Consequences

引導現在會因為 DeepSeek 路由一無所知的理由而結束，因此該步驟的名字是最後一處把它和那個配接器綁在一起的東西；未來若有一個步驟能提供不止一條可設定路由，替換掉的會是提示本身，而非就緒投影。收窄後的診斷聯合意味著無法解析的 `llm-deepseek` settings 地址會被報為 `provider-ready` 而非它自己的理由——使用者可見行為不變，Models 頁仍是診斷介面。

## Testing

包內測試針對四種聯接狀態釘住 `providerUsable`，並針對新門檻與每一個存留的診斷釘住 `onboardingReadiness`；分區測試覆蓋首次執行姿態、普通行姿態，以及在新增卡保住草稿的同時摺疊設定卡片的那次取消。`onboarding-usable-provider` web e2e 泳道透過真實協議重放整個場景：兩張卡片都開著時取消、改配 `minimax-cn`、重載，然後不再出現接管——並附一份關閉後狀態的 aria golden。
