# credentials/：憑據引用

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

憑據能力家族將引用解析與提供方分離：

| 包 | 角色 | ctx 鍵 |
|---|---|---|
| [`credentials/`](credentials/README.md) | 憑據引用 seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | 環境與本機文件提供方 | 註冊 `ctx.credentials` |

設定攜帶引用而非機密值。消費端在其操作邊界解析這些引用；變更、優先級與儲存語義由子級 README 負責。

子系統參考——`CredentialRef`、按操作解析、對 UI 安全的 `CredentialInfo`、提供方層——見 [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md)。
