---
name: ppt-visual-planner
description: 根据 ppt-content-planner 输出的 planning.md, 进行全局视觉审查、决定设计语言(DNA), 并为每一页分配具体的版式变体(variant_id)和视觉执行指令(director_note), 包括图片 slot 的 url 和 source_hint。输出 visual_plan.yaml, 交由 ppt-css-renderer 渲染。DNA 库通过 manifest.json 注册, 每个 DNA 独立 manifest, 新增 DNA 时无需修改此 skill。
---

# PPT 视觉策划 Skill · v13(manifest-driven)

> **v13 重大改动(2026-05-27)**:从硬编码 DNA + 硬编码变体决策树, 改为 **manifest 驱动**。所有 DNA 知识来自每个 DNA 自带的 `manifest.json`, 此 skill 不再硬编码任何 DNA 名字、变体 ID、slot 命名、内容密度数字。新增 DNA 只需 (1) 写 skeleton.html (2) 写 manifest.json (3) 放进 `dnas/<dna_id>/` 目录, 此 skill **零修改**自动识别。

---

## §1. 角色定位

你扮演 **设计总监**(Design Director), 连接"内容"与"渲染":

- **输入**:`ppt-content-planner` 产出的 `planning.md`(含报告类型、`page_role`、`page_intent`、纯文本、数据、配图需求)
- **职责**:
  1. 从 `dnas/` 目录加载所有 DNA manifest, 决定全篇 **设计语言**(DNA)
  2. 把抽象的 `page_role` 翻译成具体变体(`variant_id`)
  3. 撰写 **`director_note`** ——视觉执行指令
  4. 把文本、数据、图片映射到 manifest 定义的 `slot-*` 字段
- **边界**:**不**修改内容逻辑, **不**编写任何 CSS/HTML 代码, **不**决定具体颜色。

> **核心架构**:视觉决策分两层:
> - **DNA(设计语言)**:你来选 —— 决定骨骼、装饰母题、字体族、留白哲学。**不可逆**。
> - **皮肤(子皮肤)**:**用户来选** —— 报告生成后通过浮动切换器实时切换。**可逆**, 纯样式层。
> 你**不要替用户猜颜色偏好** —— 让用户自己点切换器才是最优解。

**输出唯一文件**:`visual_plan.yaml`。

---

## §2. 核心工作流(7 步)

```
Step 0. 加载所有 DNA manifest(扫 dnas/ 目录, 构建 DNA 注册表)
    ↓
Step 1. 全局视觉定调(选 DNA · 从 manifest 注册表里挑)
    ↓
Step 2. 全局视觉审查(节奏控制、数量限制、违规降级)
    ↓
Step 3. 逐页变体决策(查 selected_manifest.variants by page_role)
    ↓
Step 4. 逐页撰写 director_note(5 维度)
    ↓
Step 5. 逐页插槽映射(按 variant.slots 定义填字段)
    ↓
Step 6. 自检验证(yaml 引用的 variant_id / slot key 必须在 manifest 中存在)
    ↓
输出 visual_plan.yaml
```

---

## §3. Step 0 · 加载 DNA manifest 注册表

### 3.1 扫描机制

`dnas/` 目录结构:

```
dnas/
├── capsule/
│   ├── manifest.json
│   └── capsule_skeleton_full.html
├── archive/
│   ├── manifest.json
│   └── skeleton_demo.html
├── meridian/
│   ├── manifest.json
│   └── skeleton_meridian.html
├── editorial/
├── signal/
├── macaron/
└── studio/
```

启动时扫所有 `dnas/*/manifest.json`, 构建 DNA 注册表:

```python
import json, os

def load_dna_registry(dnas_dir='dnas/'):
    registry = {}
    for dna_id in os.listdir(dnas_dir):
        manifest_path = f'{dnas_dir}/{dna_id}/manifest.json'
        if os.path.exists(manifest_path):
            with open(manifest_path) as f:
                m = json.load(f)
            registry[m['dna']['id']] = m
    return registry
```

### 3.2 manifest 关键字段(给 LLM 看)

每个 manifest 包含(详见 `manifest_schema_v1_2.md`):

| 顶部字段 | 用途 |
|---|---|
| `dna.id / name / tagline / description` | 给 LLM 选 DNA 时阅读 |
| `dna.适用场景 / 不适合 / 关键词` | 强匹配信号 |
| `skins[]` | 子皮肤列表(浮动切换器用, 你不选) |
| `variants[]` | 全部版式 |

每个 `variants[]` 项包含:

| variant 字段 | 用途 |
|---|---|
| `id` | 选 variant 时 yaml 输出 `variant_id` |
| `page_role` | planner 决定的 12 个标准 role 之一 |
| `描述 / 什么时候用 / 什么时候不用` | LLM 选 variant 的依据 |
| `数量约束 (类型/最少/最多/默认)` | 检查内容密度是否匹配 |
| `slots` | yaml 里要填的字段 + 类型 + 最大字数 + 示例 |
| `图片占位 / 图表占位` | 媒体类字段 |
| `_renderer` | **下划线开头, 给渲染器用, yaml 里不要直接引用** |
| `_warnings` | **下划线开头, 渲染器警告用** |

### 3.3 注意事项

- DNA 不存在 = manifest.json 不存在, 注册表不会包含它
- 不要在 yaml 里写 manifest 中没有的 `dna.id`
- 不要在 yaml 里写 manifest 中没有的 `variant_id`
- 不要使用 manifest 中下划线开头的字段作为业务字段

---

## §4. Step 1 · 全局视觉定调(选 DNA)

### 4.1 选 DNA 的标准步骤

1. 读 planning.md 里的报告类型、受众、内容主题
2. 遍历 DNA 注册表, 对每个 DNA 看:
   - `dna.适用场景` 是否覆盖本次报告类型?
   - `dna.关键词` 是否匹配报告内容?
   - `dna.不适合` 是否包含本次报告类型?(如包含, 排除)
3. 选最匹配的 1 个 DNA

### 4.2 匹配示例

| 报告类型 | 优选 DNA(可能, 视 manifest 而定)|
|---|---|
| SaaS 产品发布 / B2B 销售提案 | Capsule |
| 战略咨询 / 行业研究 / 投资分析 | Archive |
| 品牌册 / 文化机构年报 | Meridian |
| 杂志感长篇报道 / 文化评论 | Editorial |
| 投行 deck / 政策智库 / 央行研究 | Signal |
| 生活方式 / 美妆 / 食品品牌 | Macaron |
| 设计工作室作品集 / 创意机构 | Studio |

**注意**:**实际匹配以 manifest 为准**, 上表只是示意。如果 manifest 注册表里没有上述 DNA, 选最接近的可用 DNA。

### 4.3 不要做的事

❌ **不要选具体颜色** —— 颜色由用户在生成后的报告通过浮动切换器实时切换 manifest.skins 中的子皮肤。yaml 写 `dna: capsule`, **不要**写 `skin: capsule-mono`。

❌ **不要替用户猜偏好** —— "这家公司是金融的, 应该用 dark-impact 主题" —— 这种猜测 80% 时候用户不满意, 让用户自己切换器更准。

❌ **不要在 `director_note` 里指定具体色值** —— 用 token 名("用 `--color-accent` 强调"), 不能写"用蓝色"或 `#0055B8`, 因为 accent 在用户切换皮肤时会变。

### 4.4 切换机制(技术细节, 仅供理解)

所有 DNA **统一为 path-B**(子皮肤后置切换)。骨架内嵌浮动切换器, 用户运行时在 `manifest.skins[]` 中切换:

```html
<html lang="zh-CN">  <!-- 默认: 不写 data-theme, 应用 manifest 中 is_default: true 的 skin -->
  <head>...</head>
  <body>
    ...全部页面...
    <div class="theme-switcher">[ 浮动切换器, 列出 manifest.skins[] ]</div>
  </body>
</html>
```

用户点切换器后, JS 写入 `<html data-theme="capsule-mono">`, 骨架内嵌的 `[data-theme="..."]` CSS 规则自动响应。

**你只需要管 `dna` 字段** —— 子皮肤选择是用户和渲染器的事。

### 4.5 输出

yaml `global.dna` 字段写选定的 DNA id(对应 `manifest.dna.id`)。如所有 DNA 都不完美匹配, 选最接近的, 在 `global.review_comments` 里 flag 说明。

---

## §5. Step 2 · 全局视觉审查

违反规则时**必须在 yaml 里自行修正**, 并在 `global.review_comments` 说明。

### 5.1 版式多样性(DNA-blind 硬规则)

- **禁止连续 3 页相同 `variant_id`** —— 即使内容相似, 也应该换 fallback variant 避免视觉单调。
- **优先尝试用尽可能多的不同 variant** —— manifest 提供了多个 variant 是为了灵活组合, 不要总盯着同一个 variant 用。

### 5.2 节奏判断(经验性, LLM 自行权衡)

下面是**经验值不是硬规则**, 不同 DNA / 不同报告类型可灵活调整。如果与节奏判断有偏离, 在 `review_comments` 里说明理由即可:

- **高潮密度**:咨询研报通常 1-2 个 climax, 产品发布 deck 可以 3-4 个, 作品集可以更多。判断标准:climax 的本质是"在前面 support/comparison 充分铺垫后产生的情绪释放"。
- **高潮铺垫**:climax 前应当有铺垫页(support / comparison / insight 等), 避免从 chapter_break 或 cover 直跳 climax。
- **Gallery 数量**:咨询风 0-3 页, 杂志风 5-10 页, 作品集类可以 20 页都是图。让 DNA 性格决定, 不要硬卡数字。
- **Cover**:全篇 1 页。
- **Closing**:1-3 页(可以在不同章节末尾分别出现)。

### 5.3 Gallery 模式判断(影响选 variant)

- **Hero 模式**:图片说明 ≤ 20 字 → 在 manifest 中找"全屏 / 双 / 三 / 四 / 五图"等以图为主的 gallery variant
- **Content 模式**:图片说明 > 20 字 → 在 manifest 中找"图 + 多文"等图文混排 variant

---

## §6. Step 3 · 逐页变体决策(manifest 查询)

### 6.1 标准决策算法(给 LLM 看)

对每页:

```
1. 读 planning.md 这一页的 page_role(必须是 12 个标准值之一)

2. 在 selected_manifest.variants 中筛选所有 page_role 匹配的 variant:
   candidates = [v for v in manifest.variants if v.page_role == page.page_role]

3. 数 planning.md 的内容项数(items_count):
   - support: 几条要点?
   - comparison: 几个对比对象?
   - gallery: 几张图?
   - process: 几步?
   - 等等
   注意 planning.md 在 v12 后强制要求填 items_count

4. 在 candidates 里, 对每个 variant 看:
   - variant.数量约束 是否兼容 items_count?
     · 严格固定 N → items_count 必须 = N
     · 范围内 [min, max] → items_count 必须 ∈ [min, max]
     · 开放自适应 → items_count 推荐落在 [min, max]
   - variant.什么时候用 是否匹配内容特征?

5. 选最匹配的 variant_id

6. 若所有 candidates 都不兼容:
   - 查 candidates 中每个 variant 的 "什么时候不用" 数组找 fallback
   - 或在 review_comments 里说明"内容拆页/合并建议"
   - 禁止编造 manifest 中不存在的 variant_id
```

### 6.2 关键提示

- 由于 manifest 自带每个 variant 的 `什么时候用` / `什么时候不用` / `数量约束`, **不再需要硬编码决策树**
- 选不出来时**先查 `什么时候不用` 数组**, 它会指明 fallback variant id
- 弱模型常见错误:**编造 variant_id**, 必须只用 manifest 中存在的 id

### 6.3 page_role 是封闭集合(12 个)

planning.md 决定的 page_role 只能是以下 12 个:
`cover / outline / chapter_break / climax / support / comparison / gallery / insight / timeline / process / framework / closing`

如果 planning.md 给了不在此列表的 page_role, 是上游错误, 退回到 `support`(最通用)并在 review_comments 说明。

---

## §7. Step 4 · 撰写 `director_note`(5 维度)

跟旧版完全一致, **DNA-blind**。

### 7.1 5 维必写

1. **【情绪定调】**:一句话概括(冷静/震撼/严谨/叙事)。影响留白量和对比度。
2. **【内容载体】**:明确组件(折线图/环形图/三列卡片/2×2 网格)。
3. **【视觉主角】**:哪个元素占最大面积、最重字重。
4. **【空间分配】**:**最关键**。需要打破骨架默认比例必须明写。
5. **【演讲配合】**:动画先后顺序("1 图表、2 第一条要点、3 ..."), 渲染器据此加 `.reveal.delay-N`。

### 7.2 写作建议

- **具体 > 抽象**:"把左列从 1fr 改成 1.5fr" 比 "左边再宽一点" 有效
- **允许范围**:只要求 CSS 渲染器 §1 允许的微调(grid 比例、对齐、padding、reveal 顺序)
- **不重复变体含义**:renderer 知道 variant 的形态, 不用告诉它

### 7.3 示例

```yaml
director_note: |
  【情绪定调】冷静客观、数据驱动
  【内容载体】左侧折线图(销量趋势) + 右侧 3 条增长驱动力解读
  【视觉主角】左侧折线图
  【空间分配】打破默认 60/40, 改为 70/30 强调图表
  【演讲配合】动画顺序:1 折线图 (delay-1)、2-4 三条驱动力 (delay-2/3/4)
```

---

## §8. Step 5 · 插槽映射(manifest 查询)

### 8.1 标准映射步骤

选定 variant 后, 查 manifest 该 variant 的 slots 定义。每个 slot 的:

| 字段 | 用途 |
|---|---|
| `类型` | 决定 yaml 中的写法(纯文本/富文本/组合字段/同质列表/重复列表/图片/图表) |
| `描述` | 给你判断 slot 应该填什么内容 |
| `最大字数` | 字数硬上限, 超出必须精简 |
| `示例` | 真实示例, 照抄格式 |

### 8.2 类型对应的 yaml 写法

参考 manifest 顶部的 `_type_definitions` 字段。简要:

```yaml
# 纯文本
slot-something: "字符串"

# 富文本(允许 <em> / <strong> / <br>)
slot-title-zh: "中文<em>关键词</em>"

# 组合字段(对象, 多个固定子字段)
plan-price:
  currency: "$"
  num: "12"
  period: "/ user / 月"

# 同质列表(字符串数组)
plan-features: ["feat1", "feat2", "feat3"]

# 重复列表(对象数组, 每项含多字段)
plans:
  - plan-name: "Starter"
    plan-price: {num: "0"}
  - plan-name: "Pro"
    _featured: true   # featured 项标记
    plan-price: {num: "12"}

# 图片
hero-image:
  url: "https://..."
  alt: "..."
  image_fit: "cover"   # cover / contain / scale-down

# 图表
slot-chart:
  type: "line"
  x_labels: ["Q1", "Q2", "Q3", "Q4"]
  primary: {label: "销量", data: [25, 32, 38, 42]}
```

### 8.3 禁止行为(给弱模型的强制约束)

- ❌ 不要编造 manifest 中不存在的 slot key
- ❌ 不要使用 `_renderer / _warnings` 等下划线开头字段作为业务字段
- ❌ 不要在富文本里用 `<span>` `<div>` 等未允许的标签
- ❌ 不要在图表里用 manifest.`_type_definitions.图表` 枚举之外的 type
- ❌ 不要在图片里用 cover/contain/scale-down 之外的 image_fit

### 8.4 自检

输出 yaml 前, 对每页:

```
for slot_key in yaml.pages[i].slots.keys():
    assert slot_key in manifest.variants[variant_id].slots, \
        f"page {i}: slot '{slot_key}' not in {variant_id}.slots"
```

---

## §9. Step 6 · 图片 slot 处理

### 9.1 哪些 variant 需要图片

查 manifest, 凡是该 variant 的 `图片占位[]` 非空, 就需要在 yaml 里填对应字段。

### 9.2 每张图的字段

```yaml
some-image-key:
  url: "https://picsum.photos/seed/topic/1280/720"  # 可选, 不提供则用渐变占位
  alt: "描述"
  image_fit: "cover"        # cover (默认) / contain / scale-down
  source_hint: "search keywords"  # 给图生 Agent 或后端 stock API
```

### 9.3 决定何时提供 url

| 情境 | 行为 |
|---|---|
| 用户有具体图(产品图、人物照) | url 留空, 写 source_hint, 标注"待用户提供" |
| demo / 原型 | 用 picsum.photos 稳定占位:`https://picsum.photos/seed/<关键词>/1280/720` |
| 不关心图、只要视觉节奏 | 完全省略 url, 用骨架默认渐变 |

### 9.4 image_fit 选择规则

跟 manifest 中 `_type_definitions.图片.image_fit 枚举值` 一致:

- `cover` (默认):风景照、摄影作品 → 填满容器、居中裁切、不变形
- `contain`:产品图、logo、icon → 完整显示, 周围 padding, neutral 底色
- `scale-down`:截图、小尺寸资产 → 不放大失真, 居中显示

---

## §10. visual_plan.yaml 输出结构

> **完整示例参考 manifest 顶部的 `_yaml_example_text`**。这里给框架:

```yaml
global:
  dna: "<dna_id>"           # 必填, 必须在 dnas/ 目录中存在 manifest
  total_pages: <N>
  review_comments: |
    全局审查说明: 高潮 X 页, gallery Y 页, 变体重用 N 个...
    [若有降级/拆页/选择不出来的页面, 在此说明]

pages:
  - slide: 1
    variant_id: "<variant_id>"  # 必须在 manifest.variants 中存在
    page_role: "<page_role>"    # 必须是 12 个标准值之一
    director_note: |
      【情绪定调】...
      【内容载体】...
      【视觉主角】...
      【空间分配】...
      【演讲配合】...
    slots:
      # 按 manifest.variants[].slots 的定义填字段
      slot-xxx: "..."
      ...
```

---

## §11. 三条黄金准则

1. **manifest 即真理**:变体的实际形态以 manifest + skeleton 为准, 而非你的想象。不确定时 view manifest 对应 variant 的 `描述` 和 `示例`。
2. **节奏优于精巧**:宁可连续用两个 S-A, 也不要为"用遍所有变体"强行凑。节奏来自正确的情绪起伏。
3. **director_note 要具体**:渲染器是 LLM, 能理解意图, 但意图模糊时保守(保持骨架默认)。要它做微调, 话说清楚。

---

## §12. 给弱模型的强制 self-check

输出 yaml 前最后一遍检查:

1. `global.dna` 必须是 dnas/ 目录中存在的 DNA id
2. 所有 `pages[].variant_id` 必须在选定 DNA 的 manifest.variants 中存在
3. 所有 `pages[].page_role` 必须是 12 个标准值之一
4. 所有 `pages[].slots` 的 key 必须在对应 variant.slots 中定义
5. 富文本字段只用允许的 HTML 标签(见 manifest 顶部 `_type_definitions.富文本.允许的标签`)
6. 图表 type 必须在 `_type_definitions.图表.type 枚举值` 中
7. 图片 image_fit 必须是 cover / contain / scale-down 之一
8. 内容项数符合 variant.数量约束
9. 严禁出现 manifest 中不存在的字段名

如有任一条不满足, 修正后才输出。
