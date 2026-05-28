# PPT Tool · 项目总索引

> 最后更新:2026-05-27(Day 6 端到端测试完成,准备开始 Day 7 工具开发)
>
> **本文件是这个项目最重要的导航文件。任何会话开始时,先 view 这个文件能快速恢复全部上下文。**

---

## 📌 项目目标

做一个 manifest-driven 的 PPT 自动生成工具:

- 输入:一篇长文报告 + 简单需求(受众、页数)
- 输出:一份高质量 HTML PPT(1280×720,7 套 DNA 风格可选)
- 用户:个人 + 小团队(<10 人)
- 核心理念:**新增 DNA 零修改 skill** —— 只需写 manifest.json + skeleton.html

## 🗺️ 项目阶段路线

```
✅ P0 设计资产工程 (已完成, 7 周)
   ✅ 7 套 DNA 骨架 + 内嵌主题切换
   ✅ schema v1.2 (manifest 文档格式)
   ✅ 7 套 manifest.json (manifest-driven 核心)
   ✅ 3 个 skill 改造为 manifest-driven (v13 / v13 / v4)
   ✅ 端到端测试 (Capsule + Linear 3.0 报告,49/51 slot 成功)

🟡 P1 工具开发 (进行中, 4-5 天)  ← 当前
   ✅ Step A: 项目骨架 (netlify.toml + package.json + 7 套 DNA 资产)
   ✅ Step B: LLM 代理 (functions/llm-proxy.js, 4 模型统一)
   ✅ Step C: manifest loader (浏览器侧加载所有 DNA)
   ✅ Step D: renderer (浏览器侧 css-renderer)
   ✅ Step E: 开发预览页 (验证连通性) - dev.html
   ✅ Step F: 3 阶段工作流 UI 主流程
   ✅ Step G: 单页编辑面板
       - 根据 variant.slots 自动生成表单 (7 种 slot 类型全支持)
       - 重复列表 ★ featured 切换 (互斥)
       - 编辑后 300ms 节流重渲染 iframe
   ✅ Step F+: 全屏播放 + 诊断 + 一键修复  (上次完成)
       - fullscreen-preview.js (FullscreenPreview 类) + fullscreen-preview.css
         · Fullscreen API + 1280x720 等比缩放 + letterbox 黑边
         · 键盘 ← → 翻页, ESC / Home / End / Space / PageUp/Down 支持
         · 鼠标点击左 1/3 = 上一页, 右 1/3 = 下一页, 中间 = 切换 HUD
         · HUD 显示页码 + 操作提示, 2s 不动自动淡出
       - diagnostics.js (Diagnostics 类) + diagnostics.css
         · 5 种扫描: 横向溢出 / 纵向溢出 / 元素重叠 / 空 slot 显示 demo / 列表项数不符
         · 12px 容差避免 line-height 误判
         · 点击 issue 跳到对应页
       - auto-fix.js (AutoFix 类) - 安全修复
         · shrink-font: 0.95em 温和缩小
         · shrink-text (clamp): 0.96em
         · z-index: 给文本更多的元素上浮
         · 关键保护: yaml 未填的 slot 不缩字号 (避免破坏设计师精心的 demo 默认值)
         · 撤销机制: 注入 <style data-autofix>, 可移除还原

   ✅ Step F++: 图片直接上传替换  ← 本次完成
       - image-uploader.js (ImageUploader util) + image-uploader.css
         · readFile(file) → base64 dataURL + 尺寸
         · compressImage(dataUrl, opts) - canvas resize + JPEG/PNG 输出
         · askCompressOrOriginal(file): 大于 500KB 弹框问压缩或原图
         · attachDragDrop(el, onFile): 拖拽上传 + dragover 视觉反馈
       - edit-panel.js 图片字段改写:
         · 空状态: 大拖拽区 ("拖拽图片到此处, 或 点击选择文件") + 备选 URL 输入
         · 已上传: 缩略图 + 文件名 + 尺寸/大小 + [替换][用URL][清空] + "已压缩"徽章
         · 拖到已上传区域也能替换
         · URL 直接粘贴模式
       - renderer.js _fillImage 改写:
         · 注入 img 前清掉 demo 占位 (.ui-mock-body / .placeholder-text / 文本节点)
         · 重复上传时替换 img.src 而非追加(支持反复替换)
       - 验证: 800×600 真实彩色图上传后, iframe 中 mockup 区被替换显示 UPLOADED IMAGE
       - 验证: 17.6MB 噪声大图弹压缩框 → 压缩到 1920×1280
       - 验证: 拖拽悬停时拖拽区变蓝实线边框 + 浅蓝背景
   ✅ Step H: localStorage 持久化  (上次完成)
       - storage.js (Storage util)
         · save / load / clear / getInfo / formatSavedAt
         · 大小限制: 4 MB 警告, 8 MB 上限
         · QuotaExceededError 错误捕获
       - pipeline.js 接入:
         · 启动检测有缓存 → 顶部黄色 banner "检测到未完成的工作"
         · Banner 显示 meta: "保存于 刚刚 · 阶段 3 · DNA: capsule · 7 页 · 0.01 MB"
         · [恢复] / [丢弃] / [×] 三个操作
         · saveEnabled 标志: banner 显示时禁用 save,防止 setStage('input') 覆盖缓存
         · 空白 state 不保存(避免占用 localStorage 一个无意义记录)
         · setStage / 编辑后 / beforeunload 都触发节流保存
       - 顶部新增 "+新建" 按钮: 清空缓存 + 重置 state + 回阶段 1
       - 完整测试: 编辑 → 刷新 → banner → 恢复 → state/UI/iframe 全部回来

   ✅ Step H+: 附件上传 (PDF/Word/PPT/MD/TXT)  (上次完成)
       - lib/doc-parser.js (DocParser util)
         · parseFile(file) 自动识别扩展名分发
         · PDF: pdf.js 提取每页 textContent
         · DOCX: mammoth.extractRawText 输出纯文本
         · PPTX: JSZip + 正则提取 <a:t> 标签内容, [幻灯片 N] 分块
         · MD/TXT: FileReader 直接读
         · 按需懒加载库 (首次用到 PDF 才载 pdf.js)
       - public/vendor/ 本地化依赖 (避免 CDN 阻断 + Netlify 部署直接可用)
         · pdf.min.mjs (426 KB) + pdf.worker.min.mjs (1.2 MB)
         · mammoth.browser.min.js (621 KB)
         · jszip.min.js (96 KB)
       - 阶段 1 UI:
         · 报告原文区上方加附件拖拽区(📎 拖文件到此, 或 点击选择)
         · 多文件上传, 同名替换
         · 每个附件 inline 显示: 📄 文件名 · 大小 · 页数/幻灯片数 · 字数 · 状态[解析中/已解析/❌] · [预览][移除]
         · [预览] 弹窗显示提取的全文(等宽字体)
       - state.attachments 数组持久化(text 一起存)
       - buildPlannerPrompt 拼接 "## 附件材料" 块
       - 阶段 1 → 2 验证: rawReport ≥ 100 字 或 附件总字数 ≥ 100 即可
       - 测试: txt + md + pdf (2 页) + docx (53字) + pptx (3 幻灯片) 全部解析成功

   ✅ Step I: 部署教程 + README + 配置样板  ← 本次完成
       - DEPLOY.md (14 KB) - 完整部署文档:
         · 1) 先决条件 (Node 18+ / Netlify 账号)
         · 2) 4 个 LLM 厂商申请教程 (DeepSeek / 豆包 / Kimi / Qwen)
         · 3) 本地试跑 (netlify dev + .env)
         · 4) 两条部署路径 (Netlify CLI 直部 / GitHub 联动)
         · 5) 环境变量配置 (必须/建议/可选 三个梯度)
         · 6) 部署后 /api/health 验证
         · 7) 给团队成员的使用说明 + 转 PDF 方法
         · 8) FAQ 8 个 (401密码 / 500timeout / localStorage 满 / PDF 解析 / 字体乱码 / 加 DNA / key 泄露 / 权限控制)
         · 9) 升级与维护 (新版本部署 / 成本监控 / 备份导出)
       - README.md - 项目首页:
         · 总览 + 截图
         · 特点 9 条 + 技术栈
         · 快速开始 + 项目结构
         · 7 套 DNA 风格定调表
       - .env.example - 环境变量样板 (含申请链接 + 注释)
       - .gitignore - 防止 .env / node_modules / 测试截图被提交
       - 验证: health.js handler 直跑 → models 状态正确返回
       - 验证: llm-proxy.js 三种错误路径 (401密码/400模型/500key) 全部正确响应

🎯 P1 完成 → 工具可立即部署生产环境

🔵 P2 优化迭代 (未开始, 视使用反馈)
   - 真实弱模型测试 (DeepSeek V3)
   - 7 套 DNA 回归测试
   - 修复 P0 已知小 bug (skeleton 命名 + featured 位置)
   - 视情况新增 DNA
```

## 📁 完整目录结构

```
/home/claude/
├── ppt_tool/                         # P0 设计资产 (已完成的产物)
│   ├── INDEX.md                      # 本文件 ← 一切的起点
│   ├── manifest_schema_v1_2.md
│   ├── dnas/                         # 7 套 DNA (每套自包含)
│   │   ├── capsule/{manifest.json, skeleton.html}
│   │   ├── archive/
│   │   ├── meridian/
│   │   ├── editorial/
│   │   ├── signal/
│   │   ├── macaron/
│   │   └── studio/
│   ├── skeletons/                    # skeleton 备份(扁平,方便引用)
│   ├── skills_new/                   # 3 个 skill 最新版
│   │   ├── ppt-content-planner-v13.md
│   │   ├── ppt-visual-planner-v13.md
│   │   └── ppt-css-renderer-v4.md
│   ├── auto_extract.py / generate_manifest.py / run_batch.py
│   ├── render_full.py
│   └── test_e2e/                     # Day 6 端到端测试产物
│
└── ppt-tool-app/                     # P1 工具开发 (进行中)
    ├── netlify.toml                  # Netlify 配置
    ├── package.json                  # 依赖
    ├── functions/                    # Netlify Functions (serverless 后端)
    │   ├── llm-proxy.js              # 4 模型统一代理 (DeepSeek/豆包/Kimi/Qwen)
    │   └── health.js                 # 健康检查 /api/health
    ├── public/                       # 静态前端
    │   ├── index.html                # 入口页(目前是连通性测试页)
    │   ├── app.js                    # 主逻辑
    │   ├── styles.css
    │   ├── lib/
    │   │   ├── manifest-loader.js    # 浏览器侧 DNA 加载器
    │   │   └── renderer.js           # 浏览器侧 css-renderer (跟 render_full.py 等价)
    │   ├── dnas/                     # 7 套 DNA 资产 (从 ppt_tool/dnas 复制)
    │   └── skills/                   # 3 个 skill prompt 文本 (拼到 system prompt)
    └── preview_dev.png               # 开发预览页截图
```

## 📊 7 套 DNA 总览

| DNA | 适用场景 | variants | skins | manifest 大小 |
|---|---|---|---|---|
| **Capsule** | SaaS 产品发布 / B2B 销售提案 | 42 | 3 | 78 KB |
| **Archive** | 战略咨询 / 行业研究 / 投资分析 | **61** | **9** | 92 KB |
| **Meridian** | 品牌册 / 文化机构年报 / MUJI 风 | **61** | 3 | 112 KB |
| **Editorial** | 杂志感长篇报道 / 文化评论 | 42 | 3 | 63 KB |
| **Signal** | 投行 deck / 政策智库 / 央行研究 | 42 | 3 | 49 KB |
| **Macaron** | 生活方式 / 美妆 / 食品品牌 | 42 | 3 | 49 KB |
| **Studio** | 设计工作室作品集 / 创意机构 | 40 | 3 | 50 KB |
| **总计** | | **330** | **27** | **493 KB** |

## 🧩 12 个标准 page_role(封闭集合)

`cover / outline / chapter_break / climax / support / comparison / gallery / insight / timeline / process / framework / closing`

planner 必须严格使用这 12 个值之一。visual-planner 据此在 manifest 中筛 variant。

## 🔑 7 种 slot 类型(封闭枚举)

`纯文本 / 富文本 / 组合字段 / 同质列表 / 重复列表 / 图片 / 图表`

详见 `manifest_schema_v1_2.md` 的 `_type_definitions` 字段。

## 🎯 P1 工具开发关键决策(已确认)

| 项 | 决策 | 备注 |
|---|---|---|
| 部署 | Netlify | 静态前端 + Functions |
| 模型 | 4 选 1(用户切换) | DeepSeek V3 / 豆包 / Kimi / Qwen |
| 模型 API | OpenAI 兼容 | 用 OpenAI SDK,baseURL 切换 |
| 访问控制 | 团队密码 + IP 限速 | 不做账户系统 |
| 持久化 | localStorage | 不做服务端数据库 |
| 工作流 | 3 阶段 | 输入 → outline 确认 → 背景生成 → 预览编辑 |
| 单页编辑 | 文本直接 + AI 重生 | 两种模式 |
| 性能档位 | 经济/标准两档 | 经济=只一次生成,标准=支持迭代 |
| 直连 API | 不要 Claude/OpenAI | 仅国内可访问的 4 个 |

## ✅ Day 6 端到端测试结果(2026-05-27)

- 输入:Linear 3.0 报告(1500 字)
- DNA:Capsule
- 输出:13 页 HTML(135 KB)
- self-check 10/10 项通过
- slot 填充:**49/51 成功(96.1%)**
- 失败 2 个:P1 bottom-bar(skeleton 命名 bug,已记录)
- 视觉对照:全部 13 页正常显示真实数据

## 🐛 已知小 bug(可放进 backlog,不影响架构)

1. **Capsule COV-A bottom-bar 命名不一致**
   - skeleton 里 `<div class="bottom-bar">` 内的两个 `<span>` 没有 class
   - manifest 定义了 `bottom-bar-left` 和 `bottom-bar-right`
   - 修复:给 skeleton 加 class(5 分钟改动)

2. **render_full.py featured 位置错位**
   - yaml 第 0 项标 `_featured: true`,实际渲染时 featured 紫色卡到了第 1 项
   - 原因:渲染器清空 demo 时少清掉了 demo 的 featured class
   - 修复:进入清空时主动剥离 featured 类

3. **render_full.py CLX-D BEFORE 块 desc 没渲染**
   - 子字段定位的边角情况
   - 修复:复查重复列表的子字段查找逻辑

## 📝 历史会话记录

之前 Day 1-6 的工作历史摘要保存在压缩 summary 中,完整详细对话在:
- `/mnt/transcripts/2026-05-27-08-54-18-ppt-skill-manifest-rewrite-day6.txt`(本次会话)

## 🚀 当前任务进度:Day 7 工具开发(第 1 天)

**已完成**:
- Step A: 项目骨架(`ppt-tool-app/`,目录结构 + netlify.toml + package.json)
- Step B: LLM 代理(`functions/llm-proxy.js`,4 模型统一,含密码 + IP 限速)+ 健康检查
- Step C: manifest loader(`public/lib/manifest-loader.js`,浏览器侧加载 7 套 DNA)
- Step D: css-renderer(`public/lib/renderer.js`,跟 render_full.py 功能等价)
- Step E: 开发预览页(`public/index.html`,验证连通性)
  - ✅ 7/7 DNA 加载成功
  - ✅ 7 张 DNA 卡片正确渲染(展示 variants 数 / skins 数 / 色块预览)
  - ✅ skin chips 显示默认 ★ 标记
  - ✅ UI 简洁清晰(见 `preview_dev.png`)

**下一步**(明天)Step F:3 阶段工作流 UI

设计:
- 阶段 1 输入页:左侧报告原文输入框 + 受众 / 页数 / 特殊要求,右侧"生成 outline"按钮
- 阶段 2 outline 确认页:显示 planning.md 解析后的章节结构,用户可改章节标题、加减页、改 page_role
- 阶段 3 预览页:显示完整渲染的 13 页缩略图,点任意页进单页编辑模式
