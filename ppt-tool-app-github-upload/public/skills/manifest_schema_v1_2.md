# DNA Manifest Schema · v1.2

> **本文档定位**:每个 DNA 的精确 schema。设计目标:**任何质量的大模型(包括 DeepSeek V3 / 豆包 lite / Kimi K2 等国产模型)拿到 manifest 后都能准确执行,不出现幻觉**。
>
> v1.1 → v1.2 的关键改动:从"描述性"改为"操作性"。每个 slot 加示例,加 fallback 规则,加 yaml 输出格式,加类型 schema 定义。

---

## 文档分层

```
顶部元数据(下划线前缀,工具消费):
  _usage             - LLM 使用本文档的指南
  _type_definitions  - slot 类型的精确定义
  _fallback_rules    - 超出范围怎么办
  _yaml_example      - 完整 yaml 输出示例

业务字段(中文,LLM 业务决策时直接看):
  dna                - DNA 元信息
  skins              - 皮肤注册
  variants           - 版式列表(核心)
```

---

## 顶层结构

```json
{
  "schema_version": "1.2",
  
  "_usage": { ... },              // LLM 怎么用这份 manifest
  "_type_definitions": { ... },    // slot 类型的精确定义
  "_fallback_rules": { ... },      // 超出范围怎么办
  "_yaml_example": { ... },        // 输出 yaml 的完整示例
  
  "dna": { ... },
  "skins": [ ... ],
  "variants": [ ... ]
}
```

---

## L0 · `_usage`(LLM 使用指南)

```json
"_usage": {
  "本文档作用": "描述 Capsule DNA 的全部 42 个 variant,供 visual-planner skill 决定每一页用哪个 variant",
  
  "消费方": [
    "visual-planner skill: 根据每页的 page_role 和内容特征, 在 variants 数组里挑一个最合适的 variant_id",
    "css-renderer skill: 拿到 variant_id 后, 通过 _renderer.dom_selector 在 skeleton 找 DOM 块, 按 slots 填内容"
  ],
  
  "选 variant 的标准步骤": [
    "1. 读 planning.md 里这一页的 page_role",
    "2. 在 variants 数组里筛选所有 page_role 匹配的 variant",
    "3. 对比每个候选 variant 的 '什么时候用' / '什么时候不用', 根据内容特征选最合适",
    "4. 检查 '数量约束', 确保内容项数符合 variant 容量",
    "5. 如不符合, 看 '什么时候不用' 找 fallback variant"
  ],
  
  "输出格式": "选定 variant 后, 按本 manifest 的 _yaml_example 格式输出 visual_plan.yaml",
  
  "禁止行为": [
    "不要编造 manifest 中不存在的 variant_id",
    "不要编造 manifest 中不存在的 slot key",
    "如果所有 variant 都不合适, 在 yaml 的 review_comments 里如实说明, 不要硬塞"
  ]
}
```

---

## L0 · `_type_definitions`(slot 类型精确定义)

```json
"_type_definitions": {
  "纯文本": {
    "格式": "字符串, 不含任何 HTML 标签",
    "示例": "下一代的项目协作方式",
    "禁止": ["<em>...</em>", "<br>", "**markdown**"]
  },
  
  "富文本": {
    "格式": "字符串, 允许以下 HTML 标签",
    "允许的标签": {
      "<em>...</em>": "用品牌色(紫)高亮关键词",
      "<strong>...</strong>": "加粗强调",
      "<br>": "换行(只在标题类 slot 用)"
    },
    "示例": "下一代的<em>项目协作</em>方式。",
    "禁止": ["其他 HTML 标签如 <span>", "嵌套 HTML", "markdown 语法如 **..** 或 [..]"]
  },
  
  "组合字段": {
    "格式": "JSON 对象, 有多个固定子字段",
    "示例": {
      "currency": "$",
      "num": "12",
      "period": "/ user / 月"
    },
    "说明": "每个子字段在 variant 的 slots 定义里都有详细说明, 必须按定义填"
  },
  
  "同质列表": {
    "格式": "JSON 数组, 每项是字符串(纯文本或富文本, 按 slot 定义)",
    "示例": ["无限成员 + 项目", "完整 AI Assist", "API + Webhooks"],
    "说明": "用于一组同类型的简单项, 如 feature 清单"
  },
  
  "重复列表": {
    "格式": "JSON 对象数组, 每项是一个对象, 含多个子字段",
    "示例": [
      {"plan-name": "Starter", "plan-price": {"num": "0"}},
      {"plan-name": "Pro", "plan-price": {"num": "12"}, "_featured": true}
    ],
    "说明": "用于一组异质项目, 每项含多字段。featured 项用 _featured: true 标记"
  },
  
  "图片": {
    "格式": "JSON 对象, 含 url 和 fit",
    "示例": {
      "url": "https://example.com/dashboard.png",
      "alt": "Linear 3.0 dashboard",
      "image_fit": "cover"
    },
    "image_fit 枚举值": {
      "cover": "填满容器, 居中裁切, 不变形 - 适合摄影 / 风景 / 抽象艺术",
      "contain": "完整显示, 周围 padding - 适合产品图 / logo / 比例不规则的图",
      "scale-down": "不放大失真, 居中显示 - 适合截图 / 小尺寸资产"
    },
    "url 留空时": "用骨架默认渐变背景"
  },
  
  "图表": {
    "格式": "JSON 对象, 含 type 和 data",
    "示例": {
      "type": "line",
      "x_labels": ["Q1", "Q2", "Q3", "Q4"],
      "primary": {"label": "销量", "data": [25, 32, 38, 42]}
    },
    "type 枚举值 (封闭)": ["line", "bar", "bar-line-combo", "doughnut", "pie"],
    "禁止": ["不要用枚举外的类型, 如 scatter / radar / area, 渲染器没桥接会画空白"]
  }
}
```

---

## L0 · `_fallback_rules`(超出范围怎么办)

```json
"_fallback_rules": {
  "内容项数 > 最多": {
    "处理": "拆成两页, 第二页用相同 variant",
    "示例": "用户给 6 个 feature, S-A 只接受 3 个 → 拆成 2 页 S-A, 每页 3 个"
  },
  
  "内容项数 < 最少": {
    "处理": "查 variant 的 '什么时候不用' 字段, 跟随建议",
    "示例": "用户给 1 档定价, CMP-X 要求严格 3 档 → CMP-X 的 '什么时候不用' 说 '1 档 → 用 CLO-X'"
  },
  
  "找不到匹配 page_role 的 variant": {
    "处理": "退到 page_role = support (最通用), 在 review_comments 里说明",
    "禁止": "不要编造 variant_id"
  },
  
  "用户内容跟所有 variant 都不匹配": {
    "处理": "在 yaml 的 review_comments 里如实说明",
    "禁止": "不要硬塞内容到不合适的 variant"
  },
  
  "字数超过 slot 最大字数": {
    "处理": "尝试精简内容到限制内, 不要截断显示",
    "底线": "不能为了塞内容而违反字数限制"
  }
}
```

---

## L0 · `_yaml_example`(完整 yaml 输出示例)

```yaml
# visual-planner 输出的 visual_plan.yaml 必须严格符合以下格式

global:
  dna: "capsule"                # 必填, 跟 manifest.dna.id 一致
  total_pages: 22               # 必填
  review_comments: |            # 选填, 全局审查说明
    全篇 22 页, 使用 18 个不同 variant
    高潮控制: 1 个 climax (P06 · CLX-A)
    Gallery: 4 个 (P08 H1, P09 GC-B, P11 H3, P12 CASE-C)

pages:
  # 页面示例 1 · cover
  - slide: 1
    variant_id: "COV-A"         # 必须是 manifest.variants[].id 中的一个
    page_role: "cover"          # 必须是 manifest.variants[].page_role 中的一个
    director_note: |
      【情绪定调】发布会开场, 庄重 + 有期待感
      【内容载体】3 pill 徽章 + 104px 大字标题 + 副标
      【视觉主角】slot-title (大字标题)
      【空间分配】骨架默认
      【演讲配合】slot-title 先出 (delay-1), 副标和底部信息 (delay-2)
    slots:
      slot-title: "下一代的<em>项目协作</em>方式。"
      slot-subtitle: "3 个全新模块、12 项性能优化、1 套全新界面。"
      badge-row:
        - "★ Spring Release · 2026"
        - "v3.0 · NEW"
        - "● LIVE"
      bottom-bar-left: "linear.app/release/3.0"
      bottom-bar-right: "2026.03.15 · SAN FRANCISCO"

  # 页面示例 2 · 重复列表(pricing)
  - slide: 18
    variant_id: "CMP-X"
    page_role: "comparison"
    director_note: |
      【情绪定调】清晰 / 商业化
      【内容载体】3 列 plan card (中间 featured)
      【视觉主角】中间 Pro 档
      【空间分配】骨架默认
      【演讲配合】中间 Pro 先出 (delay-1), 左右 Starter / Enterprise (delay-2/3)
    slots:
      slot-title: "选一个适合<em>你团队</em>的方案。"
      pr-eyebrow: "→ SIMPLE, TRANSPARENT PRICING"
      plans:
        - plan-name: "Starter"
          plan-price:
            currency: "$"
            num: "0"
            period: "/ user / 月"
          plan-desc: "个人项目和小团队入门, 无限期免费"
          plan-features:
            - "最多 10 个成员"
            - "基础项目管理"
            - "社区支持"
          plan-cta: "免费开始"
        - plan-name: "Pro"
          _featured: true              # 重复列表里的 featured 项标记
          plan-price:
            currency: "$"
            num: "12"
            period: "/ user / 月"
          plan-desc: "成长型团队, 完整功能 + AI 助手"
          plan-features:
            - "无限成员 + 项目"
            - "完整 AI Assist"
            - "API + Webhooks"
            - "优先技术支持"
          plan-cta: "14 天免费试用"
        - plan-name: "Enterprise"
          plan-price:
            num: "Custom"
          plan-desc: "大型组织, 定制部署 + 企业安全"
          plan-features:
            - "Pro 全部功能"
            - "SSO + SCIM + SAML"
            - "SOC 2 + 私有部署"
          plan-cta: "联系销售"

  # 页面示例 3 · gallery + 图片
  - slide: 8
    variant_id: "H1"
    page_role: "gallery"
    director_note: |
      【情绪定调】展示产品本体的"高光时刻"
      【内容载体】全屏 dashboard mockup
      【视觉主角】产品截图本体
      【空间分配】图片占满
      【演讲配合】图片 (delay-1) → caption (delay-2)
    slots:
      slot-caption: "这就是新版的<em>主界面</em>。"
      g-eyebrow: "— Product hero · full screen"
      h1-mock:
        url: "https://example.com/dashboard.png"
        alt: "Linear 3.0 主 dashboard"
        image_fit: "cover"
```

---

## L1 · `dna`(DNA 元信息)

字段说明跟 v1.1 一致,新增:

```json
"dna": {
  "id": "capsule",                    // 英文 slug, 全局唯一
  "name": "Capsule SaaS",             // 中文展示名
  "tagline": "...",                   // 一句话定位
  "description": "...",               // LLM 选 DNA 时阅读
  "适用场景": [...],
  "不适合": [...],
  "关键词": [...],
  
  "_renderer": {                      // 工具消费的渲染配置
    "skeleton_file": "capsule_skeleton_full.html",
    "preview_image": "capsule_all42_wall.png"
  },
  
  "总 variant 数": 42,
  "schema_version": "1.2",
  "创建时间": "2026-05-26",
  "版本": "1.0"
}
```

---

## L2 · `skins`(皮肤注册)

```json
"skins": [
  {
    "id": "capsule-light",
    "name": "浅紫 · Linear 风",
    "is_default": true,
    "色块预览": { "底色": "#FAFAFA", "正文色": "#18181B", "品牌色": "#5E5CE6" }
  },
  ...
]
```

跟 v1.1 一致,无改动。

---

## L3 · `variants`(核心 · 每个版式)

### 完整新格式

```json
{
  "id": "CMP-X",
  "page_role": "comparison",
  "描述": "3 档 Pricing 对比 · 3 列 plan(name + price + desc + ✓ features + CTA),中间 featured 紫色边框 + ★ MOST POPULAR 浮出徽章",
  "什么时候用": "Starter / Pro / Enterprise 三档定价对比,中间档强推荐",
  "什么时候不用": [
    "档位数 = 2 → 用 CMP-Y(双档定价)",
    "档位数 = 1 → 用 CLO-X(单档强调 CTA)",
    "档位数 ≥ 4 → 拆两页(每页 ≤3 档)"
  ],
  
  "_renderer": {                           // 给 css-renderer 用的元数据
    "dom_selector": ".variant-cmp-x-capsule",
    "items_dom_selector": ".plan",         // 渲染器用的, LLM 不要拿来当 slot key
    "items_count": 3
  },
  
  "数量约束": {
    "类型": "严格固定",                     // 枚举: "严格固定" / "范围内" / "开放自适应"
    "数量": 3,
    "支持自适应": false                     // 数量是否随内容多少自动调整视觉
  },
  
  "slots": {
    "slot-title": {
      "类型": "富文本",
      "描述": "顶部居中主标题",
      "最大字数": 30,
      "示例": "选一个适合<em>你团队</em>的方案。"
    },
    "pr-eyebrow": {
      "类型": "纯文本",
      "描述": "标题上方的 mono 小标签",
      "最大字数": 40,
      "示例": "→ SIMPLE, TRANSPARENT PRICING"
    },
    "plans": {
      "类型": "重复列表",
      "项数": 3,
      "featured_index": 1,                  // 0-based, 第 2 项 featured
      "每项字段": {
        "plan-name": {
          "类型": "纯文本",
          "最大字数": 16,
          "示例": "Pro"
        },
        "plan-price": {
          "类型": "组合字段",
          "子字段": {
            "currency": { "类型": "纯文本", "最大字数": 4, "示例": "$" },
            "num": { "类型": "纯文本", "最大字数": 8, "示例": "12" },
            "period": { "类型": "纯文本", "最大字数": 20, "示例": "/ user / 月" }
          }
        },
        "plan-desc": {
          "类型": "纯文本",
          "最大字数": 50,
          "示例": "成长型团队,完整功能 + AI 助手"
        },
        "plan-features": {
          "类型": "同质列表",
          "项数": "3-6",
          "示例": ["无限成员 + 项目", "完整 AI Assist", "API + Webhooks", "优先技术支持"]
        },
        "plan-cta": {
          "类型": "纯文本",
          "最大字数": 16,
          "示例": "14 天免费试用"
        }
      }
    },
    "pr-footnote": {
      "类型": "纯文本",
      "描述": "底部小字说明",
      "最大字数": 50,
      "示例": "— 14 天免费试用 · 无需信用卡 · 随时取消"
    }
  },
  
  "图片占位": [],
  "图表占位": [],
  
  "_warnings": {                            // 渲染器警告(下划线前缀 = LLM 业务决策不直接用)
    "用了 transform_rotate": false,
    "用了 mix_blend_mode": false,
    "PowerPoint 导出安全": true,
    "_action": "如果 PowerPoint 导出安全=false, 渲染器应给用户弹窗警告该 variant 导出 PPTX 时可能失真"
  }
}
```

### 字段详解

#### `id` / `page_role` / `描述`

跟 v1.1 一致。

#### `什么时候用` / `什么时候不用`

- **`什么时候用`**:字符串,一句话描述适用场景。LLM 选 variant 时读这个判断匹配。
- **`什么时候不用`**:**数组**,每项是一个具体的不适用场景 + fallback variant_id。**必须给具体的 fallback,不要写模糊的"换别的"。**

#### `_renderer`(给 css-renderer 用)

```json
"_renderer": {
  "dom_selector": "...",              // variant 的 DOM 块根选择器
  "items_dom_selector": "...",        // 项的子选择器(用于校验)
  "items_count": N                     // 项数(从 skeleton 实际抽取)
}
```

**LLM 选 variant 和写 yaml 时不要直接引用这些字段**,它们是渲染器内部用的。

#### `数量约束`

```json
"数量约束": {
  "类型": "严格固定" | "范围内" | "开放自适应",
  "数量": 3 (严格固定时)
       或
  "最少": 3, "最多": 6, "默认": 4 (范围内 / 开放自适应),
  "支持自适应": true | false,
  "CSS 变量": "--rows" | "--cols" (如果支持自适应)
}
```

#### `slots` 的字段

每个 slot 必须有:

| 字段 | 必填 | 说明 |
|---|---|---|
| `类型` | ✓ | 必须是 5 种枚举值之一(见 `_type_definitions`)|
| `描述` | ✓ | LLM 用来理解这个 slot 是干什么的 |
| `最大字数` | 纯文本 / 富文本必填 | 字数硬上限,超出必须精简 |
| `示例` | ✓ | 真实示例值,LLM 可参考格式 |

复杂类型加:

| 字段 | 用途 |
|---|---|
| `项数` | 同质列表 / 重复列表的数量(可以是数字或 "3-6" 这种范围) |
| `featured_index` | 重复列表中 featured 项的 0-based 索引,如 `1` 表示第 2 项 featured |
| `子字段` | 组合字段 / 重复列表的子字段定义 |
| `每项字段` | 重复列表里每个对象的字段定义 |

#### `图片占位`

```json
"图片占位": [
  {
    "selector": ".gcb-shot",            // 给渲染器(LLM 不用)
    "数量": 1,
    "默认 image_fit": "cover",          // 必须是 cover / contain / scale-down 之一
    "描述": "产品截图主体",
    "支持热点注释": true,                // 可选
    "热点数量": 4,                       // 可选, 如果支持注释
    "yaml key": "gcb-shot"              // LLM 在 yaml 里用的 key
  }
]
```

#### `图表占位`

```json
"图表占位": [
  {
    "yaml key": "slot-chart",
    "支持类型 (枚举)": ["line", "bar", "bar-line-combo", "doughnut", "pie"],
    "默认类型": "line"
  }
]
```

#### `_warnings`

```json
"_warnings": {
  "用了 transform_rotate": false,
  "用了 mix_blend_mode": false,
  "PowerPoint 导出安全": true,
  "_action": "渲染器看到 PowerPoint 导出安全=false 时, 给用户弹窗警告"
}
```

LLM 选 variant 时**不需要看 `_warnings`**(下划线前缀)。

---

## 校验脚本

校验规则跟 v1.1 一致,新增:

11. 所有 slot 类型必须在 `_type_definitions` 中定义
12. 所有 `image_fit` 必须是 cover/contain/scale-down 之一
13. 所有 `图表占位.支持类型` 必须是 5 个枚举值之一
14. 所有 `数量约束.类型` 必须是 3 个枚举值之一
15. 所有 `featured_index` 必须是 0-based 整数,在项数范围内

---

## v1.1 → v1.2 不兼容改动清单

| v1.1 字段 | v1.2 字段 | 改动 |
|---|---|---|
| `什么时候不用` (字符串) | `什么时候不用` (数组,每项 = 场景+fallback) | 强制结构化 |
| `内容数量.对象选择器` | `_renderer.items_dom_selector` | 标记给渲染器的 |
| `dom_selector` (顶层) | `_renderer.dom_selector` | 同上 |
| `内容数量.支持数量自适应` | `数量约束.支持自适应` | 简化名字 |
| `featured 项位置` (字符串) | `featured_index` (整数) | 强制整数 |
| `技术风险` | `_warnings` (含 _action) | 加 LLM 可读说明 |
| (无) | `示例` 字段 (所有 slot) | 必填 |
| `图片占位[].默认 fit` | `图片占位[].默认 image_fit` (enum) | 名字统一 + 枚举强制 |

---

## 版本演进

- v1.0:开放 page_role,术语化字段名(废弃)
- v1.1:封闭 12 page_role,中文化字段(描述性,弱模型可能幻觉)
- **v1.2(当前)**:**操作性强化**,加 `_usage` / `_type_definitions` / `_fallback_rules` / `_yaml_example` / 字段精确化 + 每 slot 加示例
- v2.x(预留):重大不兼容改动
