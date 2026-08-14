# dsh-atomic-write

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

零相依性的原子文件替換，供絕不允許在磁碟上留下不完整、被符號連結劫持或權限過寬內容的文件型儲存共用：使用者設定文件（`dsh-settings-file`）與憑據儲存（`dsh-credentials-local`）。

## 介面面

```ts
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

declare const text: string
declare const render: (previous: string) => string

await writeFileAtomic('/home/u/.dsh/settings.yaml', text, { mode: 0o600 })

// Read-modify-write against the same file from several processes.
await withFileLock('/home/u/.dsh/settings.yaml', async () => {
  await writeFileAtomic('/home/u/.dsh/settings.yaml', render(text), { mode: 0o600 })
})
```

`writeFileAtomic` 提交一份已經渲染好的字串。約定按故障利用它的先後順序列出：

- **獨佔建立暫存檔**（`wx` + 隨機後綴）：open 拒絕跟隨預先埋在可猜測臨時路徑上的符號連結。
- **全新 inode 攜帶 `mode` 走完 rename**：替換權限過寬的舊文件時直接收窄，不存在 chmod 競態。`mode` 為必填，讓權限決策始終可見於每個呼叫點（與所有新建 inode 一樣受行程 umask 影響）。
- **`rename` 替換的是符號連結目標本身**，絕不寫穿到其指向的文件。
- **同目錄兄弟文件**保證 rename 落在同一檔案系統上，交換保持原子。
- 自動建立父目錄；任何失敗都會移除暫存檔並重新拋出該失敗；讀取方只會觀察到舊內容或完整的新內容。

`withFileLock` 跨行程序列化同一文件的寫入方，服務於單靠原子提交無法保證安全的讀-渲染-提交迴圈。鎖是以 `wx` 建立的同目錄 `<filename>.lock`，因此讀取方從不參與競爭；等待方按指數退避，逾時即失敗而非無限阻塞。競爭者絕不移除現有鎖：鎖齡無法區分已經崩潰的所有者與被暫停但仍存活的寫入方。

## 模型體驗

無：本包是純檔案系統原語，此處沒有任何內容會到達模型請求。

#### KV Cache 影響

無；此處沒有任何內容會進入請求前綴。

## 已知限制與暫緩事項

- **原子但不保證持久**——不對文件或其所在目錄做 `fsync`，因此崩潰後可能觀察到 rename 被回退。此處的文件型儲存在啟動時重新讀取並重新發布，把持久性留作呼叫方的策略。
- **僅支持字串內容**——在有消費端需要之前，不提供 `Buffer` 或流式形態。
- **殘留鎖需要操作者復原**——行程持鎖退出時可能留下同級鎖定檔。後續寫入方逾時也不會刪除它；操作者只有在確認沒有寫入方仍擁有該鎖後才會移除。文件存續時間本身不能安全證明它已無人持有。
