# skill/：skill（技能）能力家族

[English](README.md) | 繁體中文

本家族發現可複用的 agent（代理）指令，並透過與提供方無關的目錄和 loader 將其公開給模型。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`skill/`](skill/README.md) | 定義 skill 提供方註冊和尋找 | `ctx.skills` |
| [`skill-badge/`](skill-badge/README.md) | 貢獻選填的內建 dsh 徽章 skill | 註冊到 `ctx.skills` |
| [`skill-filesystem/`](skill-filesystem/README.md) | 從本機檔案系統發現 skill | 註冊到 `ctx.skills` |
| [`tool-skill/`](tool-skill/README.md) | 發布 skill 目錄和麵向模型的 loader | 註冊到 `ctx.tools` |

該能力位於核心控制主幹之外，可以使用本機、嵌入式或遠端提供方，而無需更改面向模型的約定。

子系統參考——發現優先級、目錄快照、`skill` 載入器——見 [docs/subsystems/skills.md](../../docs/subsystems/skills.md)。
