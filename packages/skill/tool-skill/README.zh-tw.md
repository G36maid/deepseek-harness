# @deepseek-ai/dsh-tool-skill

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 skill（技能）目錄和 `skill` 工具。

需要 `ctx.agents`、`ctx.tools` 和 `ctx.skills`（`inject: ['agents', 'tools', 'skills']`）。

## 目錄生命週期

每次符合條件的 `agent/pre-step`，該外掛程式都會使用呼叫工作階段的 cwd 呼叫 `ctx.skills.snapshot()`，將 pre-step 中止訊號轉發到發現流程，應用 `skill` 工具的精確可見性，並按順序渲染 `name` 和 `description` 條目。如果先前不存在目錄且該檢視表非空，外掛程式會向下遊 `enter` 決策新增初始的持久使用者角色 `<system-reminder>`。目錄訊息只包含這些摘要；skill 正文、路徑、來源、提供方和 `whenToUse` 提示仍位於目錄之外。

每條目錄訊息都攜帶 `skill-catalog` 來源，也就是 `catalog` 形態的上下文。它的 `entries` 精確記錄本次發布的 `name` 與 `description` 對，替換目錄另帶 `update`。digest 覆蓋這些持久條目，而不是渲染後的正文，因此 `<system-reminder>` 包裝不會影響是否需要重新發布，消費端也不需要重新解析 `<available_skills>` 塊。外掛程式從後向前掃描持久工作階段事件且不複製，並以最新一條仍可見且可讀的 `skill-catalog` 訊息作為比較基線；不可讀和外來的記錄都會跳過。digest 變化時，下游 `enter` 決策會收到一條包含完整替換目錄的持久使用者角色訊息；空替換會顯式停用較早的名稱。如果已無目錄可見，但歷史中存在可識別目錄，則說明壓縮（compaction）已將其遮蔽，下一次完整觀察會重新建立當前目錄。提供方快照不完整時，外掛程式不會發送任何內容，並會保留最後一次完整的模型檢視表，在下一次 pre-step 重試。若不存在先前目錄且當前檢視表為空，則不需要 tombstone。

如果最初沒有模型可呼叫 skill，則省略目錄；如果該 agent（代理）的工具檢視表排除了隨附的 `skill` 工具，或解析出同名的作用域內遮蔽項，也會省略目錄。身份比對針對本外掛程式所註冊的那個定義，而非按自身名字回查，因此本外掛程式既可全域性掛載，也可掛在單個 agent 的組裝內——在後者中 `register()` 只註冊到該 agent 的層中。可見性變更參與 digest 計算，使提示詞指引、模型可見 schema 和可執行分派保持對齊。

`catalogDescriptionMaxLength` 控制規範化後的目錄描述，渲染時會對其執行 XML 轉義。其預設值是 `500`，且必須是不小於 `3` 的整數，以便為截斷省略號保留空間。[skill 目錄熱刷新 Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-skill-catalog-hot-refresh.md) 負責定義持久初始目錄和替換目錄的生命週期。

## 工具：`skill`

| 參數 | 類型 | 說明 |
|---|---|---|
| `name` | string（必填） | 可用 skill 清單中精確的 kebab-case skill 名稱。 |

執行使用呼叫 agent 的 `session.header.cwd`，使結果隨工作區變化的提供方能夠解析出勝出的 skill。成功呼叫返回規範形式的 `{ name, provider, resourceBase?, content }`，其中不包含目錄排名和提供方內部機制；其 Native 渲染器會生成一個文字結果，其中包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>`。

資源指引只會根據 `resourceBase` 解析指令顯式引用的路徑或 URL；指令碼、參考資料和資源文件按需載入，結果不會列舉 skill 目錄。本機提供方可以提供目錄，而遠端或嵌入式提供方可以提供 URL 或不透明載入指引。

無法解析的名稱會報告 skill 未知或已不可用。無效名稱和 `invocation.modelInvocable` 為 `false` 的 skill 會產生不同的錯誤結果。`invocation.userInvocable` 不限制這個面向模型的介面。

工具執行不會新增合成上下文訊息。新載入的結果已作為工具結果記錄，並在下一個模型步驟可用，無需重複正文。只有目錄投影會新增替換摘要。

## 模型體驗

### 工作階段目錄

#### 模型看到的內容

如果存在模型可呼叫 skill，且可見的正是這個 `skill` 工具，agent 會在第一個請求之前收到下方目錄範本，其中包含每個已排序 skill 的一條隨資料而定的條目。該目錄是一條持久的使用者角色訊息。後續成員關係、描述或可見性的變化會使用同一個 `<available_skills>` 信封追加完整替換；刪除所有 skill 時，會追加一個空信封，並明確指示不得使用舊名稱。範本的結尾一句是防止雙重載入的規則：使用者顯式的手勢邊界（下文的 pre-step 監聽器）會把同一份 `renderSkillContent` 輸出（共享自 `@deepseek-ai/dsh-skill`）內聯注入，目錄則告訴模型遵循該塊，而不是再經工具重新載入該 skill；替換目錄範本的兩個分支——包括清空後的目錄——都攜帶同一句話。

##### Skill 目錄範本

```markdown
<system-reminder>
A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>
- `<name>`: <normalized-and-capped-description>
</available_skills>

If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.
</system-reminder>
```

#### Token 影響

重複輸入成本隨 skill 數量和 `catalogDescriptionMaxLength` 成長；當清單為空或工具被隱藏或遮蔽時，不會發送初始目錄 token。每次實際目錄變更都會新增一條保留的完整替換訊息。

#### KV Cache 影響

初始持久目錄追加在現有可重用前綴之後。動態變更作為該目錄之後的僅附加歷史，因此較早的可重用 token 保持不變，每條新追加的目錄和後續輪次都會形成新的後綴。新建或復原的實例如果 digest 發生變化，可能會從新追加的目錄位置起影響快取重用。

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`skill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill)。

#### Token 影響

工具可見時，每次請求都有固定的 schema token 開銷。

#### KV Cache 影響

工具定義和可見性不變時，前綴穩定。遮蔽、限制或外掛程式生命週期變更可能從該 schema 起使重用失效。

### 工具結果

#### 模型看到的內容

成功呼叫使用下方結果範本，以及提供方管理的資源指引、目錄資源指引、URL 資源指引或不透明資源指引。

##### Skill 結果範本

```markdown
<skill_content name="<escaped-name>">
<skill_resources>
<resource-guidance>
</skill_resources>

<skill_instructions>
<provider-owned-instruction-body>
</skill_instructions>
</skill_content>
```

##### 提供方管理的資源指引

```markdown
Resources for this skill are managed by provider "<provider>".
Load referenced resources only as needed.
```

##### 目錄資源指引

```markdown
Base directory for this skill: <path>
Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
```

##### URL 資源指引

```markdown
Base URL for this skill: <url>
Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.
```

##### 不透明資源指引

```markdown
Resources for this skill: <description>
Load referenced resources only as needed.
```

#### Token 影響

已載入指令是取決於資料的工具結果 token，並在後續步驟中重新發送，直到壓縮；不會製作重複的 `agent.inject()` 副本。

#### KV Cache 影響

僅附加；新可見內容位於可重用請求前綴之後，不會使現有 KV Cache 條目失效。

### 工具錯誤

#### 模型看到的內容

無效或過時選擇會精確返回 `Error: invalid skill name "<name>"`、`Error: skill "<name>" is unknown or no longer available` 或 `Error: skill "<name>" is not available for model invocation`。提供方拋出的尋找文字取決於資料，並套用同一個 `Error: <message>` 包裝層。

#### Token 影響

只有失敗呼叫會新增這些已保留 token。

#### KV Cache 影響

僅附加；新可見內容位於可重用請求前綴之後，不會使現有 KV Cache 條目失效。

### 使用者顯式呼叫注入

#### 模型看到的內容

已認領使用者訊息中任意位置、以空白為界、指名工作區目錄中某個使用者可呼叫 skill 的 `/name` token，會把該 skill 的完整 `<skill_content>` 渲染（與上文結果範本完全相同的形態）作為 `user` 角色的指令上下文注入，追加在該步驟所有其他注入之後——背景在前，模型要著手處理的材料在最後。只掃描直接的使用者輸入，檢查在已載入定義上進行，未知名稱和使用者不可呼叫的名稱保持為普通行文。這是 `disable-model-invocation` skill 唯一的入口，目錄和 `skill` 工具永不暴露這類 skill；目錄的結尾一句會告訴模型遵循注入塊，而不是重新載入它。

#### Token 影響

每次手勢會把一份渲染後的 skill 正文作為注入上下文加進該輪次——尺寸與同一 skill 的工具結果相同，該成本會隨使用者請求必然產生，而非由模型自行決定。同一步驟內對同一 skill 的重複手勢只注入一次。

#### KV Cache 影響

僅附加；注入落在該步驟的訊息批次中、可重用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **目錄省略 `whenToUse`、來源和提供方元資料**：路由只基於名稱和有長度上限的描述；`whenToUse` 仍是提供方元資料，載入後的包裝層也不渲染它。
- **已載入指令正文沒有大小上限**：提供方可返回足以佔用大量下一步上下文的 skill；只有目錄描述會被截斷。
- **資源是指引，而非附件**：工具報告基礎目錄/URL/不透明提示，但既不列舉也不為模型取得引用文件。
- **載入是一次性文字**：遠端提供方緩慢或 skill 正文很大時，不提供部分內容、流式輸出或快取內容控制代碼。
- **目錄替換採用全量清單**：一個名稱或描述發生變化，就會追加當前所有可見摘要；這樣能顯式停用過時名稱，但 token 成本與目錄大小成正比。
- **正文不做版本化**：僅修改正文不會改變目錄 digest，也不會通知模型；後續工具呼叫會讀取提供方的當前內容，而先前工具結果仍是歷史事實。
