# settings/：使用者設定能力族

[English](README.md) | 繁體中文

該包族透過註冊的命名空間與可替換儲存提供方解析使用者可編輯設定。

| 包 | 職責 | ctx key |
|---|---|---|
| [`settings/`](settings/README.md) | 定義命名空間註冊、分層解析與提交 | `ctx.settings` |
| [`settings-file/`](settings-file/README.md) | 在本機文件中儲存設定並觀察外部編輯 | 註冊到 `ctx.settings` |

子系統參考——命名空間、owner scope、解析順序、熱提交——見 [docs/subsystems/settings.md](../../docs/subsystems/settings.md)。
