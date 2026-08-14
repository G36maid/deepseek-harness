# attachment/：持久附件能力族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

持久二進位附件 seam 及其本機檔案系統實作。兩者均為產品包。

| 包 | 角色 | ctx 鍵 |
|---|---|---|
| `attachment/` | 不可變附件引用、圖片限制和儲存服務 | `ctx.attachments` |
| `attachment-local/` | `DSH_HOME` 下的私有內容尋址儲存 | （註冊至 `ctx.attachments`） |

未傳送的瀏覽器草稿刻意位於這項能力之外。只有使用者提交提示詞，或提供方配接器提交結構化模型輸出時，位元組才進入持久儲存。
