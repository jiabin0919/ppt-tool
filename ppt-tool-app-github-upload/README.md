# PPT Tool

把一份报告 / PDF / Word 文档,自动转成专业 PPT,1 分钟内完成。

```
报告 → planning.md → visual_plan.yaml → output.html (1280×720)
            ↓              ↓                ↓
       content-planner  visual-planner  css-renderer
```

7 套精心设计的视觉风格(DNA),330 个变体(variant),覆盖封面 / 大纲 / 数据图表 / 时间线 / 流程 / 收尾等 12 种页面角色。

## 截图

3 阶段工作流:**输入报告 → 确认结构 → 预览编辑**

![阶段 3 预览编辑](docs/screenshot-stage3.png)

## 特点

- **零硬编码** — 加新 DNA 只要写 1 份 manifest + 1 份 skeleton,不动一行 skill 代码
- **多模型** — DeepSeek / 豆包 / Kimi / Qwen 任选,OpenAI 兼容统一接口
- **附件上传** — PDF / Word / PPT 自动解析提取文本,不用手动复制
- **图片直传** — 上传本地图片即时替换 mockup,可选压缩
- **单页编辑** — 改字 / 切 featured / AI 重写本页,实时同步预览
- **全屏播放** — Fullscreen API,← → 翻页,1280×720 等比缩放
- **质量诊断** — 扫描文字溢出 / 元素重叠 / 列表项数不符,一键安全修复
- **持久化** — localStorage 自动保存,刷新不丢工作
- **纯前端** — 静态站 + 4 个 Netlify Functions,部署零基础设施

## 技术栈

- 前端:vanilla JS(没框架),Tailwind-like 自写样式
- 后端:Netlify Functions(Node 18) + OpenAI SDK
- 文档解析:pdf.js / mammoth / JSZip(本地化在 `public/vendor/`)
- 持久化:localStorage(单 origin 5-10 MB)

## 快速开始

### 本地试跑

```bash
npm install
npm install -g netlify-cli

# 创建 .env 文件,填一个 LLM key:
echo 'DEEPSEEK_API_KEY=sk-你的key' > .env

netlify dev
# 浏览器开 http://localhost:8888
```

### 部署到 Netlify

```bash
netlify login
netlify deploy --build --prod
# 之后在 Netlify 网页设置环境变量
```

详细步骤见 **[DEPLOY.md](./DEPLOY.md)**。

## 项目结构

```
ppt-tool-app/
├── public/                    # 静态前端 (Netlify publish 目录)
│   ├── index.html             # 主页 (3 阶段工作流)
│   ├── pipeline.js            # 主状态机
│   ├── lib/                   # 各功能模块
│   │   ├── manifest-loader.js # DNA 加载
│   │   ├── renderer.js        # css-renderer (浏览器侧)
│   │   ├── llm-client.js      # LLM 调用 + mock
│   │   ├── doc-parser.js      # PDF/Word/PPT 解析
│   │   ├── image-uploader.js  # 图片上传 + 压缩
│   │   ├── edit-panel.js      # 单页编辑面板
│   │   ├── fullscreen-preview.js # 全屏播放
│   │   ├── diagnostics.js     # 质量诊断扫描
│   │   ├── auto-fix.js        # 一键安全修复
│   │   └── storage.js         # localStorage 持久化
│   ├── dnas/                  # 7 套 DNA 资产
│   │   ├── capsule/{manifest.json, skeleton.html}
│   │   ├── archive/...
│   │   └── (5 套其他风格)
│   ├── skills/                # planner / visual-planner / renderer 三个 skill
│   └── vendor/                # 本地化的 pdf.js / mammoth / jszip
├── functions/
│   ├── llm-proxy.js           # 4 模型统一代理 + 密码 + 限速
│   └── health.js              # /api/health 健康检查
├── netlify.toml               # Netlify 部署配置
├── package.json
├── DEPLOY.md                  # 完整部署教程
└── INDEX.md                   # 项目总索引(P0 设计 + P1 实现)
```

## 7 套 DNA 风格

| ID | 风格定调 | 用法 |
|---|---|---|
| `capsule` | SaaS 产品发布,胶囊圆角 + 紫色品牌 | 产品发布会、roadmap |
| `archive` | 学术档案,衬线字 + 米色 | 研究报告、白皮书 |
| `meridian` | 编辑设计感,大字 + 极简 | 战略复盘、深度分析 |
| `editorial` | 杂志风,网格秩序 | 季度回顾、行业洞察 |
| `signal` | 监控仪表盘,密度+精确 | 数据汇报、运营指标 |
| `macaron` | 柔和马卡龙色,亲切 | 团队文化、对外品宣 |
| `studio` | 工作室档案,黑白对比 | 设计师作品、项目复盘 |

每套含 40-61 个 variant + 3-9 个 skin 变体,共 **330 variants / 27 skins**。

## 命令行版本

也有 Python 版本能本地批量生成(不需要部署):

```bash
python render_full.py raw_report.md --dna capsule --out output.html
```

需要先有 `visual_plan.yaml`(可由 LLM 跑 3 个 skill 得到)。详见 `INDEX.md`。

## 协议

私有,内部使用。

## 反馈

发 PR 或 issue。新增 DNA 强烈欢迎,只需要 1 份 manifest + 1 份 skeleton。
