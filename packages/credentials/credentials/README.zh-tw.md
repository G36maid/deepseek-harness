# dsh-credentials

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

憑據 Service Definition（`ctx.credentials`）。一條準則，三個推論：

**設定只攜帶對機密的引用，絕不攜帶機密本身。** settings 分節或 `cordis.yml` 條目寫 `apiKeyEnv: DEEPSEEK_API_KEY`，引用背後的值存放在憑據提供方處。於是設定文件可以放心同步、放心算繪進設定介面；`describe()` 無需持有值就能回答「設定了嗎、來自哪層、能否寫入」；輪換機密不觸碰任何設定檔。

**消費端按操作解析。** `resolve(ref)` 在每個操作開始時呼叫（LLM（大型語言模型）配接器每次模型請求解析一次），絕不跨操作快取——正是這次讀取讓改過的憑據無需重新啟動任何外掛程式就作用於下一次請求。

**空的儲存值等於不存在。** 處處如此：`resolve` 跳過它，`describe` 報告未設定。空白永遠不會偽裝成已設定的機密。

## 介面

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')            // POSIX shell identifier, branded
const hit = await ctx.credentials.resolve(ref)           // { value, source } | undefined
const info = await ctx.credentials.describe(ref)         // { configured, source?, writable } — never the value
await ctx.credentials.set(ref, 'sk-…')                   // rejects while a read-only source shadows the ref
await ctx.credentials.unset(ref)                         // no-op when absent; same shadowing rule
```

`credentials/updated (ref)` 在提供方管理的來源發生已提交變更後觸發——`set`、`unset` 或在儲存中觀察到的外部編輯。行程環境變數的變化不可觀測，永不觸發。消費端不需要該事件（它們按操作重新解析）；它服務於設定介面刷新「已設定」徽標。它的聲明住在 client-safe 的 `./types` 子路徑出口，與其點名的 `CredentialRef` 類型同處一處（包根繼續 re-export 該類型），於是 Host 編譯面之外的消費端讀到的正是 Host 發射的那一份簽名，而不必再寫一遍。

`set`/`unset` 的遮蔽規則有意採用明確報錯的方式：當只讀來源（本機提供方中即當前行程環境）正在提供該引用時，寫入會表面成功而解析仍返回遮蔽值——seam 選擇直接拒絕，並透過 `describe().writable` 讓介面提前把該引用算繪為只讀。

## 提供方

[`dsh-credentials-local`](../credentials-local/README.md) 把繼承的行程環境疊加在其受管 `$DSH_HOME/.credentials.yaml` 文件之上，並以啟動器的項目和使用者 `.env` 層作為後備。該 seam 的介面為 keyring、輔助命令和 KMS 後端提供方預留了擴充空間；遠端設定提供方永遠不必攜帶機密。

## 模型體驗

經由消費它的 LLM 配接器間接生效：解析出的值為配接器的提供方請求授權，所有模型可見介面都由配接器負責。

#### KV Cache 影響

無直接失效；憑據絕不進入請求前綴。

## 已知限制與暫緩事項

- **不提供枚舉**——seam 只回答被問到的引用；設定介面從 settings schema 得知引用集合，`list()` 沒有當前消費端。
- **引用限定為環境變數形狀**——在有提供方需要更豐富的尋址方式前，保持單一扁平的 POSIX 識別符號命名空間。
- **行程環境變化不可見**——不可能為其發事件；介面只能在自身導覽時重新讀取 `describe()`。
