---
name: ppt-css-renderer
description: 将 visual_plan.yaml 的数据填入对应 DNA 骨架的变体 DOM 中, 按 manifest 的 skins 注入子皮肤切换器, 按 director_note 做允许范围内的布局微调, 挂载 Chart.js 图表与 .reveal 动画, 注入真实图片 URL(含 image_fit), 生成最终的 output.html。DNA 库通过 manifest.json 注册, 新增 DNA 时无需修改此 skill。
---

# PPT CSS 渲染器 Skill · v4(manifest-driven)

> **v4 重大改动(2026-05-27)**:从硬编码 path-A(Archive 9 主题写死)+ path-B(Meridian 3 子皮肤)双分支, 改为 **manifest 驱动统一 path-B**。所有 DNA 的渲染规则、slot 选择器、内容密度契约、图片占位 selector 都从 manifest.json 加载。新增 DNA 只需 (1) 写 skeleton.html (2) 写 manifest.json, 此 skill **零修改**。

---

## §1. 角色定位与边界

你扮演 **前端工程师 Agent**。能理解自然语言 `director_note` 的 LLM, 不是模板填空机。工作分三层:

1. **机械层**(必须精确):根据 `global.dna` 从 manifest 加载该 DNA 的所有元数据, 根据 manifest 中的 `_renderer.dom_selector` 从 skeleton 提取 `variant_id` 对应的 DOM, 把 `slots` 数据按 manifest 中的 slot 定义填入。
2. **解释层**(需要判断):阅读 `director_note` 五维指令, 在允许范围内把视觉意图落实到 scoped CSS override。
3. **工程层**(靠规范):挂载 Chart.js、`.reveal` 动画、做三层自检。

### 绝对禁止(红线)

- ❌ 修改 planner 写的任何文字(标题、正文、数字都不能改)
- ❌ 更改 visual-planner 选定的 `variant_id`
- ❌ 引入 manifest skins 外的新颜色(包括原生 CSS 颜色关键字)
- ❌ 添加 skeleton 中不存在的 DOM 结构类别
- ❌ 使用 `box-shadow`、`backdrop-filter`、内容区的 `linear-gradient`(只有封面/章节页背景层可用渐变)
- ❌ **删除 skeleton 自带的浮动皮肤切换器**(用户切换皮肤的入口)

### 允许的微调(`director_note` 解读)

- ✅ 改变 grid 比例(`grid-template-columns: 1.5fr 1fr`)
- ✅ 改变对齐(`align-items / justify-content / text-align`)
- ✅ 调 padding / margin / gap(在 `--space-*` 范围内)
- ✅ 给特定元素加 `.reveal` 和 `.delay-N`(N=1..5)
- ✅ 在 slot 内插入 `<br>` 换行、`<span class="accent-word">` 强调词(不新增信息)
- ✅ 在 canvas 上设 `data-chart-*` 属性
- ✅ 在 manifest 标注的图片占位容器内插入 `<img src="...">`, 可选加 `data-image-fit="contain|scale-down"`

---

## §2. 完整工作流(7 步)

```
读取 visual_plan.yaml
        ↓
0. 加载 manifest:从 dnas/<global.dna>/manifest.json 读取
   - 校验 DNA id 在 dnas/ 目录中存在
   - 读取 skeleton_file 路径、skins 列表、所有 variants 定义
        ↓
1. 构建 output.html 骨架:复制 manifest.dna._renderer.skeleton_file 的 <head> + <style>
   - 不写 data-theme(默认应用 manifest.skins 中 is_default: true 的 skin)
   - 保留骨架自带的浮动切换器 JS(用户运行时切换)
        ↓
2. 逐页提取:按 page.variant_id 查 manifest.variants[].id, 从 skeleton 提取
   _renderer.dom_selector 对应的 DOM 块(整个 .slide 元素)
        ↓
3. 逐页填槽:按 manifest.variants[].slots 定义
   - 纯文本/富文本 slot → 找 .slot-X 元素, 替换 innerHTML
   - 组合字段 → 按子字段填
   - 同质列表/重复列表 → 复制 / 删除 / 替换子元素
   - 图片 slot → 在容器内插入 <img>, 可选加 data-image-fit
   - 图表 slot → 设 data-chart-* 属性
        ↓
4. 逐页微调:按 director_note 写 scoped CSS(.slide[data-page="N"] 作用域)
        ↓
5. 追加 <script>(原样照抄骨架引擎)
        ↓
6. 做 §9 三层自检(契约层 / 视觉层 / 结构层)
```

---

## §3. manifest 加载与皮肤系统

### 3.1 manifest 加载

```python
import json
with open(f'dnas/{yaml["global"]["dna"]}/manifest.json') as f:
    manifest = json.load(f)

# 校验
assert manifest['schema_version'] == '1.2', '不支持的 manifest 版本'
assert 'variants' in manifest and len(manifest['variants']) > 0

# 索引化, 后续按 variant_id 快速查找
variants_by_id = {v['id']: v for v in manifest['variants']}
```

### 3.2 子皮肤系统(统一 path-B)

所有 DNA 现在统一为 path-B 模式:

- 视觉策划在 yaml 写 `dna: <id>`, **没有** skin / theme 字段
- 渲染器输出 HTML 根标签**不写** `data-theme`:

```html
<html lang="zh-CN">  <!-- 不写 data-theme, 默认应用 manifest.skins 中 is_default: true 的 skin -->
  <head>...</head>
  <body>
    ...全部页面...
    <!-- 骨架自带的浮动切换器 JS, 原样保留 -->
  </body>
</html>
```

用户运行时点浮动切换器, JS 写入 `<html data-theme="<skin_id>">`, 骨架内嵌的 `[data-theme="..."]` CSS 自动响应。

**渲染器不需要做任何主题相关的事**。

### 3.3 何时写 `:root` override(罕见)

只有以下情况:

- 客户临时要求用自己的品牌色(不用预设 skins)
- 在标准 skin 基础上微调单一 token

```html
<head>
  <style>
    html { --color-accent: #D6001C; }  /* 局部 override */
  </style>
</head>
```

**默认情况下不要写 `:root` override** —— 会破坏 path-B 后置切换机制。

### 3.4 Overlay / 对比度自适应

骨架已统一用 `color-mix(in srgb, var(--color-text-primary) X%, transparent)` 做透明叠色。深色/浅色 skin 切换时自动翻转。**渲染器不需要管这个**。

---

## §4. 骨架提取与 Slot 填充

### 4.1 提取规则

对每个 `page_N`:

```python
slide_dom = soup.select_one(variants_by_id[vid]['_renderer']['dom_selector'])
assert slide_dom, f'page {N} variant {vid}: dom_selector not found'
slide_dom['data-page'] = str(N)  # 加页面标识用于 director_note 作用域
```

提取时**不要**移除 `<div class="nav-label">` 和 `<div class="dev-tag">` —— 已被骨架 CSS `display: none` 隐藏, 保留便于调试。

### 4.2 Slot 填充按类型分发

读 manifest 的 `_type_definitions` 知道每种类型怎么填:

```python
slot_def = manifest['_type_definitions']

for slot_name, slot_value in yaml_page['slots'].items():
    slot_meta = variant['slots'].get(slot_name)
    assert slot_meta, f'page {N}: slot {slot_name} not in {vid}.slots'
    
    type_name = slot_meta['类型']  # 纯文本 / 富文本 / 组合字段 / 同质列表 / 重复列表 / 图片 / 图表
    
    if type_name == '纯文本':
        target = slide_dom.select_one(f'.{slot_name}')
        assert target, f'.{slot_name} not found in skeleton'
        target.string = slot_value
    
    elif type_name == '富文本':
        target = slide_dom.select_one(f'.{slot_name}')
        target.clear()
        target.append(BeautifulSoup(slot_value, 'html.parser'))
    
    elif type_name == '同质列表':
        container = slide_dom.select_one(f'.{slot_name}')
        # ... 复制模板子元素 N 次, 填入 list 项
    
    elif type_name == '重复列表':
        # 每项是对象, 按子字段填入对应子元素
        ...
    
    elif type_name == '图片':
        # 见 §6
        ...
    
    elif type_name == '图表':
        # 见 §5
        ...
```

### 4.3 重复列表 + featured_index

重复列表项里可能有 `_featured: true` 标记, 该项需加 `.featured` class:

```python
items = slot_value  # list of dicts
container = slide_dom.select_one(f'.{slot_name}')
template = container.select_one('.item')  # 第一个子元素作模板
template_html = str(template)
container.clear()

for i, item_data in enumerate(items):
    item_dom = BeautifulSoup(template_html, 'html.parser')
    # 填入子字段
    for sub_key, sub_value in item_data.items():
        if sub_key == '_featured' and sub_value:
            item_dom.select_one('*')['class'] = item_dom.select_one('*').get('class', []) + ['featured']
            continue
        sub_target = item_dom.select_one(f'.{sub_key}')
        if sub_target:
            sub_target.append(BeautifulSoup(str(sub_value), 'html.parser'))
    container.append(item_dom)
```

### 4.4 强调词规则(富文本可用标签)

manifest 中 `_type_definitions.富文本.允许的标签` 是封闭枚举:

| 标签 | 用途 |
|---|---|
| `<em>...</em>` | 主题 accent 色强调 |
| `<strong>...</strong>` | 加粗 |
| `<br>` | 换行 |
| `<span class="accent-word">` | 强调词 |
| `<span class="outline-word">` | 空心描边字 |
| `<span class="unit">` | 数字后单位 |

**禁止**:除此之外的所有 HTML 标签。yaml 里如出现, 渲染器要清洗。

---

## §5. Chart.js 数据契约

### 5.1 Canvas 属性

```html
<canvas class="slot-chart"
  data-chart-type="..."
  data-chart-primary='{...}'
  data-chart-secondary='{...}'
  data-chart-x-labels='[...]'></canvas>
```

### 5.2 支持类型(封闭枚举)

来自 manifest 的 `_type_definitions.图表.type 枚举值`:

| `data-chart-type` | 属性 |
|---|---|
| `line` | primary, x-labels, 可选 fill |
| `bar` | primary, x-labels, 可选 ghost |
| `bar-line-combo` | primary 走柱 + secondary 走线 + x-labels |
| `doughnut` | primary.data + primary.labels |
| `pie` | 同 doughnut |

> **⚠ 必读**:这 5 个是骨架 JS `initChart()` 函数**全部**支持的类型。其他 Chart.js 原生类型(`scatter / radar / area / stacked-bar`)**都没被骨架桥接**, 设了画布会空白且不报错。
>
> **多条线对比**:用 `bar-line-combo`(主线柱+对比线)或 `line`(只能一条)。
> **堆叠柱**:用 `bar`, 汇总成单一系列。

### 5.3 YAML 写法

```yaml
slot-chart:
  type: "bar-line-combo"
  primary:
    label: "销量(万辆)"
    data: [25, 32, 38, 42, 50, 58]
  secondary:
    label: "渗透率(%)"
    data: [15, 20, 28, 35, 42, 50]
  x_labels: ["Q1","Q2","Q3","Q4","Q5","Q6"]
```

渲染器序列化成 `data-chart-*` 属性(属性值单引号, JSON 内双引号)。

### 5.4 配色

自动从 `:root` 读: `primary → --color-accent`、`secondary → --color-signal`、坐标 → `--color-text-secondary`、网格 → `--color-border`。皮肤切换时颜色自动变。

---

## §6. 图片注入

### 6.1 机制(DNA-blind)

manifest 中每个 variant 的 `图片占位[]` 列出本 variant 所有图片 selector。渲染器:

```python
img_placeholders = variants_by_id[vid].get('图片占位', [])
for ph in img_placeholders:
    yaml_key = ph['yaml key']
    selector = ph.get('selector') or f'.{yaml_key}'
    default_fit = ph['默认 image_fit']  # cover / contain / scale-down
    n = ph['数量']
    
    yaml_value = yaml_page['slots'].get(yaml_key)
    if not yaml_value:
        continue  # url 留空 → 保留骨架默认渐变
    
    # 支持单图 (dict) 和多图数组
    images = yaml_value if isinstance(yaml_value, list) else [yaml_value]
    targets = slide_dom.select(selector)
    assert len(targets) == n, f'page {N}: skeleton has {len(targets)} {selector}, expected {n}'
    
    for i, (img_data, target_el) in enumerate(zip(images, targets)):
        if not img_data.get('url'):
            continue
        img_tag = soup.new_tag('img', src=img_data['url'], alt=img_data.get('alt', ''))
        target_el.append(img_tag)
        fit = img_data.get('image_fit', default_fit)
        if fit != 'cover':
            target_el['data-image-fit'] = fit
```

### 6.2 YAML Schema

```yaml
some-image-key:
  url: "https://picsum.photos/seed/topic/1280/720"  # 必填(留空则不注入)
  alt: "alt 文本"
  image_fit: "cover"   # cover / contain / scale-down(必须是 _type_definitions.图片.image_fit 枚举值之一)
```

### 6.3 image_fit 行为

- `cover`(默认):`object-fit: cover`, 填满容器、居中裁切
- `contain`:`object-fit: contain` + 16px padding + neutral surface 底色
- `scale-down`:`object-fit: scale-down` + 更多 padding

### 6.4 图片来源策略

| 来源 | 用法 |
|---|---|
| 用户上传 | yaml 写本地路径 / 用户提供 URL |
| picsum.photos(免费) | `https://picsum.photos/seed/<关键词>/1280/720` |
| Unsplash API(需 key) | 后端 `/photos/random?query=...` |
| 图生 Agent | 按 yaml 的 `source_hint` 生成 |
| 骨架默认渐变 | 不注入任何 url |

**渲染器不负责生成/检索图片**, 只按 yaml 注入。

---

## §7. director_note 解读

| 维度 | 典型指令 | CSS 落实 |
|---|---|---|
| **【情绪定调】** | "深沉张力、留白极致" | `.slide[data-page="N"] { padding: var(--space-3xl); }`; 标题 `letter-spacing: -0.04em` |
| **【内容载体】** | "左侧环形图 + 右侧要点" | 选 `chart-type: doughnut`; slot 填入正确 |
| **【视觉主角】** | "主角是左边图表" | 加 `order: -1`; 主角加 `.reveal.delay-1` |
| **【空间分配】** | "7:3 极端比例" | `.layout-grid { grid-template-columns: 7fr 3fr; }` |
| **【演讲配合】** | "图表先出、文字 1-2-3 依次" | 图表 `.reveal.delay-1`、文字 `.delay-2/3/4` |

### 三原则

1. **最小干预**:director_note 没明说的, 保持骨架默认
2. **Scope 隔离**:override 必须用 `.slide[data-page="N"]` 前缀
3. **红线不可突破**:即使要求也不执行 §1 红线动作; 冲突时 HTML 注释说明跳过原因

---

## §8. 动画引擎

骨架末尾 `<script>` 已做:DOMContentLoaded 后加 `js-ready` → `IntersectionObserver` 监听 `.reveal` + `canvas[data-chart-type]` → Chart.js 配色从 token 读 → `prefers-reduced-motion` 兼容。

**渲染器**:原样照抄, 只需给该动的元素加 `.reveal` 和 `.delay-N`。

---

## §9. 生成后自检(强制 3 层)

> **核心原则**:没跑过浏览器截图的 PPT 不算完成。没加 assertion 的 DOM 替换不算安全。用 regex 改 HTML 不允许。

### §9.A · 实现契约(前置条件)

**1. 禁止 regex 改 HTML**

用 `BeautifulSoup(html, 'html.parser')` 做 DOM 提取与替换。

```python
# ❌ 禁止
p = re.sub(r'<div class="evidence-area">.*?</div>', new_html, p, flags=re.DOTALL)

# ✅ 正确
soup = BeautifulSoup(skeleton_html, 'html.parser')
area = soup.select_one('.slot-evidence-area')
assert area, 'page 5: slot-evidence-area not found in skeleton'
area.clear()
for item_data in yaml['slot-evidence-area']:
    area.append(build_evidence_item(item_data))
```

唯一例外:提取 `<head>` 和 `<script>` 块可以用 regex(文本块, 不做结构编辑)。

**⚠ BS4 陷阱 · 必读**:`frag.children` 是 live iterator, `append(c)` 会让下一轮迭代跳过元素。必须先 `list()` snapshot:

```python
# ❌ Silent bug
for c in frag.children:
    target.append(c)

# ✅ 正确
for c in list(frag.children):
    target.append(c)
```

这个 bug 表现:`<span class="unit">万辆</span>` 整个 span 消失、`CROSSING THE<br>BORDER` 变 `CROSSING THEBORDER`。

**2. Fail-loud assertion(禁止 silent failure)**

每个"按 yaml 找 skeleton 元素"的操作都必须断言能找到:

```python
node = slide_dom.select_one(f'.{slot_name}')
assert node, f'page {n} variant {vid}: .{slot_name} not found'
```

图片 URL 注入前验证目标存在:

```python
img_cells = slide_dom.select(img_selector)
assert len(img_cells) == yaml_img_count, \
    f'page {n}: yaml gave {yaml_img_count} images but DOM has {len(img_cells)} cells'
```

**3. 替换有效性断言**

每次对 DOM 做内容替换后, 对比 hash 确认真的改了:

```python
before = hash(str(slide_dom))
# ... 替换 ...
after = hash(str(slide_dom))
assert before != after, f'page {n}: replacement left DOM unchanged'
```

**4. 内容密度断言(从 manifest 加载, 不再硬编码)**

```python
def check_contract(slide_dom, vid, yaml_data, manifest):
    """运行时从 manifest 加载契约, 不硬编码"""
    variant = next(v for v in manifest['variants'] if v['id'] == vid)
    constraint = variant.get('数量约束', {})
    items_sel = variant['_renderer'].get('items_dom_selector')
    
    if not items_sel:
        return  # 无重复元素
    
    dom_count = len(slide_dom.select(items_sel))
    
    if constraint['类型'] == '严格固定':
        expected = constraint['数量']
        assert dom_count == expected, \
            f'variant {vid}: skeleton has {dom_count} {items_sel}, contract requires exactly {expected}'
    elif constraint['类型'] == '范围内':
        min_n, max_n = constraint['最少'], constraint['最多']
        assert min_n <= dom_count <= max_n, \
            f'variant {vid}: skeleton has {dom_count}, contract requires {min_n}-{max_n}'
    
    # 跨检 yaml 的项数
    for slot_name, slot_def in variant['slots'].items():
        if slot_def.get('类型') in ('同质列表', '重复列表'):
            yaml_items = yaml_data.get(slot_name, [])
            if isinstance(yaml_items, list) and yaml_items:
                项数 = slot_def.get('项数')
                if isinstance(项数, int):
                    assert len(yaml_items) == 项数, \
                        f'{vid}.{slot_name}: yaml 给了 {len(yaml_items)} 项, 期望 {项数}'
                # 项数为字符串如 "3-5", 检查范围
                elif isinstance(项数, str) and '-' in 项数:
                    min_n, max_n = map(int, 项数.split('-'))
                    assert min_n <= len(yaml_items) <= max_n, \
                        f'{vid}.{slot_name}: {len(yaml_items)} 项不在 {项数} 范围'
```

这把"变体选错"从 **视觉呈现后才发现** 提前到 **渲染开始前就报错**。

### §9.B · 视觉 QA(强制最终验证)

`output.html` 写盘后, **必须**用 headless 浏览器截图每页, 逐页肉眼对照:

```python
from playwright.sync_api import sync_playwright
import pathlib
pathlib.Path('qa_shots').mkdir(exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.goto(f'file://{abspath("output.html")}', wait_until='networkidle')
    page.wait_for_timeout(3000)  # fonts + Chart.js + .reveal 动画
    for n in range(1, total_pages + 1):
        slide = page.query_selector(f'.slide[data-page="{n}"]')
        assert slide, f'page {n} not rendered'
        slide.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        slide.screenshot(path=f'qa_shots/p{n:02d}.png')
    browser.close()
```

**截图后逐页视觉对照**:

- 对比 yaml.director_note.【视觉主角】, 屏幕上的主角是不是它?
- 图表有没有画出来(不是空 canvas)?
- 图片有没有加载(不是渐变占位, 如果 yaml 给了 url)?
- 没有超过 40% 面积的纯空白?
- 文字没有被截断?
- 默认 skin(`is_default: true`)是否应用(浏览器默认显示)?
- 浮动切换器是否在右下角?
- 数字/标题不是骨架 demo 的示例文字(常见的 silent failure 迹象)?

任一页过不了 → 诊断根因 → 修 builder → 重跑 → 重截图 → 直到全过。

### §9.C · 结构自检(7 项)

**1. 溢出**:`.slide` 1280×720, 长文本有 line-clamp, canvas 父有高度

**2. 数据完整性**:图表 `data-chart-primary` 合法 JSON; 非空 `slot-*` 填满; 空的 `slot-insight` 要么填、要么 `display: none`

**3. 对比度**:骨架 `color-mix()` 已自动化; override 必须用 `var(--color-*)` token, 禁写 `#xxx`

**4. page_role 合规**:climax ≤ 2 页; insight ≤ 3 行不混图表; chapter_break 正文 ≤ 2 行; `.slot-insight` 不得留空

**5. 字号**:相邻比 ≥ 1.5×; 正文 ≥ 14px; 同页 ≤ 3 级; 数字用 `--font-display`

**6. 整合**:单 HTML 文件; 只 1 个主题 override `:root`(放 `<style>` 末尾); `<script>` 原样照抄; 浮动切换器保留; **禁止在 override 里给 `.slide` 设 `display`** —— 每个 variant 有自己的 `display: grid/flex`, 覆盖就崩

**7. 图片**:yaml 有 url 的 img slot, 对应 HTML 必须有 `<img src="...">` 子元素; 有 `image_fit` 字段时容器加 `data-image-fit="..."`; url 为 null/空时不插入 img(保留骨架默认渐变); Hero 模式图注 ≤ 20 字

---

## §10. 常见错误

| 现象 | 根因 | 修复 |
|---|---|---|
| 图表空白 | canvas 父无高度或 Chart.js 未加载 | `<head>` 有 CDN; canvas 父需 `min-height` 或 `flex: 1` |
| 浮动切换器消失 | 渲染器误删了骨架 `<div class="theme-switcher">` | 保留骨架原 `<body>` 末尾的切换器 |
| 浅色 skin 文字看不见 | override 写了硬编码色 | 改用 `var(--color-*)` token |
| Gallery 显示空 | override 误清了骨架 `.img-*` 默认 background | 检查 override 没有覆盖 `.img-*` 的 background 属性 |
| 字体显示系统默认 | `<head>` 漏了 preload | 照抄骨架 `<head>` 的 fonts.googleapis.com 链接 |
| `_renderer` / `_warnings` 出现在输出 HTML | 误把 manifest 元字段也注入了 | 这些下划线字段是给本 skill 用的, 不要进 HTML |
| 内容数量与 DOM 不匹配 | yaml 给的项数不符合 manifest 数量约束 | 视觉策划应已经处理, 渲染器报 assertion 即可 |

---

## §11. 给弱模型的强制 self-check

输出 output.html 前最后一遍检查:

1. manifest 加载成功且 schema_version == 1.2
2. 所有 page 的 `variant_id` 在 manifest.variants 中存在
3. 所有 slot key 在对应 variant.slots 中定义
4. 富文本字段只用允许的 HTML 标签
5. 图表 type 在 5 个枚举值内
6. image_fit 是 cover / contain / scale-down 之一
7. 内容数量通过契约断言
8. 浮动切换器保留(不能删)
9. 没有引用 manifest 中下划线开头的字段作为业务字段
10. 视觉 QA 截图每页都通过肉眼对照
