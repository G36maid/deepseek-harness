# Agent Note: llm-pi-ai 的按模型推理聲明

Status: implemented

[English](2026-08-08-pi-ai-per-model-reasoning-declarations.md) | [简体中文](2026-08-08-pi-ai-per-model-reasoning-declarations.zh.md) | 繁體中文

## 問題

在聲明式提供方 catalog（[[2026-08-03-pi-ai-declared-provider-catalog]]，它刻意把推理排除在可設定欄位之外）之下，手工聲明的 pi-ai 路由，其模型物化出來就帶著 `reasoning: false`，於是 `getSupportedThinkingLevels` 短路成 `["off"]`：輸入框不為它們提供檔位選擇器，而路由級的 `reasoning` 預設值——當時 profile 僅有的推理旋鈕——讓發往這類模型的每個請求都在網路 I/O 之前以 `UNSUPPORTED_REASONING_EFFORT` 失敗。同一個路由級旋鈕對 catalog 路由來說也放錯了層級：同一提供方下各模型接受的檔位並不一致（deepseek 自帶 `[off, high, max]`，旁邊就是帶 `xhigh` 的 catalog 模型），單個路由級檔位怎麼設都會弄壞路由的一部分——這正是模型頁徹底停寫它的原因（#1860），而 `settings.yaml` 也因此沒有了任何按模型對齊檔位的辦法。

兩個相鄰的缺口讓問題雪上加霜。pi-ai 靠識別端點 URL 來決定推理的*協議方言*（`compat.thinkingFormat`、`compat.supportsReasoningEffort`），而私有閘道的 URL 什麼也說明不了——說 DeepSeek 方言的閘道只會收到 OpenAI 方言的請求，且沒有任何設定能更正它。另外，想動單個 catalog 模型，唯一的手段是 `models` 清單，而它會*替換*所服務的 catalog：收窄 `gpt-5` 的檔位，意味著要麼重述全部三十八個 openai 模型，要麼靜默丟掉三十七個。

## 決策

`PiAiModelProfile` 新增 `reasoningEfforts`：**每個鍵是選擇器提供的一個檔位，其值是分派在協議中傳送的拼寫**。該聲明會轉換為 pi-ai 的 `Model.reasoning` + `thinkingLevelMap`，七個檔位全部顯式決定——已聲明的檔位攜帶自己的協議值，未聲明的檔位一律固定為 `null`——因此 profile 作者永遠不需要瞭解 pi-ai 那條不對稱的默認規則（鍵缺席對五個基礎檔位意味著「支持」，對 `xhigh`/`max` 卻意味著「不支持」）。`off` 是唯一的三態鍵：不寫，選擇器不提供 Off，顯式請求 Off 會被拒絕（不點名檔位的請求仍會不帶參數地寄出，提供方保留自己的默認行為）；聲明而不給值，則提供 Off，分派什麼也不傳送（`deepseek` 方言傳送 `thinking: {type: "disabled"}`）；聲明並給值，該值就在協議中傳送。`false` 聲明一個不具備推理能力的模型；空聲明會被拒絕，而不是去猜。「停用」的拼寫取 `false` 而非 `{}`，因為 schemastery 會把缺席的字典物化成 `{}`——只有 `z.union([z.const(false), dict])` 才能讓缺席、停用與已聲明三態保持可區分；而裸寫的 `reasoningEfforts:`（YAML null）會不經校驗地從該 union 溜過去，因此解析對它顯式拒絕。

`compat.thinkingFormat` 與 `compat.supportsReasoningEffort` 變為兩級可設定——路由級（作為其模型的預設值）與模型級（逐欄位勝出）——解析順序為模型 → 路由 → 已安裝 catalog 條目 → pi-ai 按 URL 得出的猜測。兩者只存在於 `openai-completions` 上（pi-ai 也只在這一協議上為它們建了類型）：在其他協議的模型上設模型級開關會使解析失敗，路由級預設值會跳過這類模型，而完全沒有 completions 模型的路由則被拒絕。兩個 `chat-template` 格式因缺 `chatTemplateKwargs` 而繼續保持不開放。兩個枚舉都經 `Record<UpstreamUnion, true>` 漂移閘門釘在 pi-ai 的類型上，因此新增格式的 pi-ai 升級會編譯失敗，直到新成員被歸類（對照已發布的 0.84.1 tarball 驗證過：其 `thinkingFormat` 聯合類型相對釘住的 0.82.1 新增了 `baseten`）。

`modelOverrides` 就地重塑單個 catalog 模型而不替換所服務的集合：鍵 = catalog 模型 id，值 = 去掉 `id` 的 `models` 條目，物化時把覆蓋交給既有的條目路徑，因此容量、檔位、compat 與請求預設值語義完全一致。與忽略未知 id 的 Pi 自有設定層不同，凡是落不到任何地方的覆蓋都會被拒絕——與 `models` 清單並存、寫在手工聲明的路由上、點名未知模型，或在值裡夾帶 `id`（schema 會放行未知鍵，被夾帶的 id 會悄悄把模型改名）。

## 曾考慮的替代方案

- **把 `reasoning` + `thinkingLevelMap` 原樣透傳**（pi-ai 自家 radius 設定的形狀）。使用者以運維人員困惑為由否決：map 用 `null` 標記「不支持」的約定，加上不對稱的鍵缺席規則，意味著這份設定的含義取決於對 pi-ai 內部機制的瞭解；選定的形狀則讓鍵集合本身就是對外提供的全部。
- **裸檔位清單**（`reasoningEfforts: [off, high]`）。表達不了協議側改名，而 catalog 自己的 map 證明改名真實存在：1230 條已安裝 map 條目裡有 66 條不是恆等對映（`off→none`、`minimal→low`、`low→LOW`、`high→default`）。
- **用 `{}` 作為停用拼寫。** 無法實作：schemastery 會把缺席的字典物化成 `{}`，於是每個沒寫該欄位的模型都會被強制停用。
- **把這件事並進路由級的 `reasoning` 旋鈕。** 那個旋鈕是*默認選擇*，不是能力集合；它保留下來，而已聲明模型的檔位如今約束著它能選什麼。

## 後果

- 輸入框的檔位面板對手工聲明的模型直接可用，UI 零改動——`resolveModelInfo` 經 catalog 元資料所走的同一 seam 報告已聲明檔位（由 `declared-reasoning` web 場景釘住）。
- #1860 暫緩的缺口——模型接不住的路由級檔位會讓發往它的請求失敗——如今有了運維側補救：對齊該模型的 `reasoningEfforts`，或去掉路由預設值。
- 刻意不提供任何把單個 map 鍵或 compat 欄位交還給「catalog 原本怎麼說」的拼寫：這份聲明就是對外提供的全部，要保留某個 catalog 值就得重述它。README 記載了這一點。
- `verify-package-invariants` 原封未動：該功能新增的是設定解析，沒有新事件，也沒有可變的執行時期關係。
