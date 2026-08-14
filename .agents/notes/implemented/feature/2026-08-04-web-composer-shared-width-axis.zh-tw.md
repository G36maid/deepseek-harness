# Agent Note: Web 輸入區共享寬度軸與控制行打磨

Status: implemented

[English](2026-08-04-web-composer-shared-width-axis.md) | [简体中文](2026-08-04-web-composer-shared-width-axis.zh.md) | 繁體中文

## 問題

Web 工作階段列的各個區域各自獨立設定尺寸：transcript（文字記錄）列、輸入卡片、todo/goal/queue 停靠卡片、ask-question/approval/plan-review 接管卡片各自硬編碼 max-width（736/752/776/800px 等變體）與各自的側邊內邊距。這些區域在全寬下彼此漂移幾個畫素，在窄視口下偏差更大——有的面板保留了到螢幕邊緣的間隙，有的卻貼邊。另外，輸入卡片的控制行沒有自適應行為——窄卡片下權限觸發器的文字標籤會擠壓整行；錨定在卡片上的浮層選單也可能渲染得比卡片更寬，越過其右邊緣。

## 決策

一個內容寬度變數控制整列。`--dsh-chat-content-width`（748px）聲明在 ConversationRoot 的 `.root` 上——transcript 與 composer 座位是兄弟子樹，聲明必須放在共同祖先上，CSS 自訂屬性才能透過繼承同時到達兩者。其他幾何全部由它推導：輸入卡片上限為 `content + 32px`（`--dsh-composer-card-max-width`），停靠卡片從卡片寬度中減去四個停靠 inset（4 × 8px）正好回到內容寬度，接管卡片直接使用內容寬度。窄視口不變式以結構而非數值表達：內容寬度的區域每側 pad `calc(var(--dsh-composer-side-clearance) + 16px)`，而輸入卡片只留裸 clearance（16px），因此「輸入卡片 = 內容 + 32px」在任意視口寬度下都成立，而不只是在上限處。

卡片內的控制行是一個 `container-type: inline-size` 容器，權限觸發器在 460px 容器查詢下收起文字標籤（保留圖示 + 下拉箭頭）。查詢刻意匿名：CSS modules 按模組雜湊 `container-name`，InputBar 樣式表裡聲明的名字永遠無法匹配 PermissionSelect 樣式表裡寫的查詢——兩個雜湊後的名字悄然不同，查詢永不觸發。只有帶模式圖示的觸發器才收起（`:has(.triggerIcon)`）；沒有圖示的宿主自訂模式保留文字作為其唯一標識。

錨定在卡片上的浮層選單（slash 選單、command popupSelect）鉗制到錨點寬度（`max-width: min(<design cap>, 100%)`），過長的行以省略號截斷而不是溢位卡片。Tooltip 氣泡在鉗制中保留 12px 的視口邊緣安全距離（ui-primitives Tooltip）。

## 考慮過的替代方案

**保留各區域獨立寬度，手工對齊數值。** 否決：本次改動消除的漂移正是手工對齊常數的殘留；未來任何寬度調整都需要五處協同編輯，且沒有任何機制強制這組關係。

**把變數聲明在 `.composerStack` 上。** 嘗試後否決：接管面板在 composer 座位中是 stack 的兄弟節點，transcript 更是完全不同的子樹，變數根本到不了它們；共同祖先（`.root`）是唯一正確的家。

**用命名容器查詢實作標籤收起。** 經實測否決：CSS modules 按模組作用域化 `container-name`，跨模組名字永不匹配，查詢是死的。匿名查詢解析到最近的祖先容器，在這裡沒有歧義（該行是唯一的容器）。

**用 JS ResizeObserver 實作標籤收起。** 否決：容器查詢是聲明式的，無需監聽器生命週期，而 460px 閾值無論哪種方案都是設計選擇。

## 後果

修改列寬現在是一行編輯，比例關係由構造保證——736 → 748 的重調已經驗證了這一點。代價是間接性：五個區域的寬度不再能從各自的樣式表直接讀出，需要沿變數鏈追到 ConversationRoot。容器查詢收起增加了一個約束：InputBar 的行必須保持為尺寸容器；刪掉那條聲明會靜默停用權限觸發器的自適應行為。匿名查詢也意味著未來若在行與觸發器之間出現第二個容器，它會截獲該查詢——屆時查詢必須遷移，或避免中間容器。
