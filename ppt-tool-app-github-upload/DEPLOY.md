# 部署教程 · PPT Tool

把这个工具部署到你自己的 Netlify 上,40 分钟左右能跑通。

读完你会得到:
- 一个 `https://your-name.netlify.app` 的服务地址
- 4 个 LLM 模型可选(任选其一即可)
- 团队密码保护 + 每 IP 每小时 60 次的限速
- 可继续迭代和升级

---

## 目录

1. [先决条件](#1-先决条件)
2. [拿到至少一个 LLM API Key](#2-拿到至少一个-llm-api-key)
3. [本地试跑(强烈建议)](#3-本地试跑强烈建议)
4. [正式部署](#4-正式部署)
5. [配置环境变量](#5-配置环境变量)
6. [部署后验证](#6-部署后验证)
7. [日常使用](#7-日常使用)
8. [常见问题](#8-常见问题)
9. [升级与维护](#9-升级与维护)

---

## 1. 先决条件

需要安装好:

- **Node.js 18 或更高版本** — 检查:`node -v`
- **npm**(随 Node.js 安装) — 检查:`npm -v`
- **Git**(可选,GitHub 路径需要) — 检查:`git --version`

需要注册:

- **Netlify 账号** — https://app.netlify.com/signup(免费,GitHub/邮箱都行)
- **至少 1 个 LLM 厂商账号**(下一节详述)

---

## 2. 拿到至少一个 LLM API Key

工具支持 4 个 OpenAI 兼容的模型,任选 1 个就能跑(配置多个,用户可在界面切换)。下面按"上手友好度"排序。

### 选项 A · DeepSeek V3(推荐入门)

**优点**:便宜(¥1/百万 tokens 级别)、稳定、中文不错。

**步骤**:
1. 注册 https://platform.deepseek.com/
2. 充值(最低 ¥10 起,够跑几百次完整流程)
3. 进 **API Keys** → 创建一个,复制保存

记下:`DEEPSEEK_API_KEY=sk-xxxxxxxx`

### 选项 B · 豆包(火山引擎)

**优点**:字节自家模型,中文质量好,公司常采购。

**步骤**:
1. 注册 https://www.volcengine.com/
2. 进 **方舟控制台** → 开通"豆包大模型"服务
3. 创建 **API Key**,复制
4. 进 **在线推理 → 模型推理 → 端点列表**,创建一个 endpoint(选 doubao-pro-32k 或最新版本),记下 endpoint ID(形如 `ep-202508xxxxxx-xxxxx`)

记下:
- `DOUBAO_API_KEY=xxxxxxxx`
- `DOUBAO_MODEL=ep-202508xxxxxx-xxxxx`(火山引擎不像别家直接填模型名,要填 endpoint ID)

### 选项 C · Kimi(月之暗面)

**步骤**:
1. 注册 https://platform.moonshot.cn/
2. 充值
3. **API Key 管理** → 创建,复制

记下:`KIMI_API_KEY=sk-xxxxxxxx`

### 选项 D · 通义千问(阿里百炼)

**步骤**:
1. 注册 https://bailian.console.aliyun.com/
2. 开通"百炼"服务,新用户通常有免费额度
3. **API Key 管理** → 创建,复制

记下:`QWEN_API_KEY=sk-xxxxxxxx`

### 建议

- **第一次部署**:只配 DeepSeek 就够,几块钱跑通流程,确认满意再加。
- **生产用**:至少配 2 个,某家挂了或限速了能切换。

---

## 3. 本地试跑(强烈建议)

部署前先在本地跑一遍,出错好排查。

### 3.1 准备代码

```bash
# 解压你拿到的 ppt-tool-app-day7-step-attach.tar.gz
tar xzf ppt-tool-app-day7-step-attach.tar.gz
cd ppt-tool-app

# 安装依赖
npm install
```

### 3.2 装 Netlify CLI

```bash
npm install -g netlify-cli

# 验证
netlify --version
```

### 3.3 本地环境变量

在项目根创建 `.env` 文件(**不要提交到 git**):

```bash
# 至少填一个 API key
DEEPSEEK_API_KEY=sk-你的-deepseek-key

# 可选:其他模型
# DOUBAO_API_KEY=...
# DOUBAO_MODEL=ep-202508xxxxxx-xxxxx
# KIMI_API_KEY=sk-...
# QWEN_API_KEY=sk-...

# 可选:团队密码(本地试可以留空)
# TEAM_PASSWORD=your-team-secret
```

### 3.4 启动本地服务

```bash
netlify dev
```

正常看到:

```
◈ Netlify Dev ◈
◈ Server now ready on http://localhost:8888
```

打开浏览器:`http://localhost:8888`

### 3.5 本地完整流程测试

1. 在"报告原文"框粘 1000-2000 字测试报告,或上传一个 PDF/Word
2. 右上模型选 **DeepSeek V3**
3. 密码框留空(本地没设 `TEAM_PASSWORD`)
4. 点 **生成内容规划 →**
5. 等 30-60 秒,进入阶段 2 看到 planning 摘要
6. 点 **生成 PPT →**,等 60-120 秒
7. 进入阶段 3,左侧 7 张缩略图,中间预览,右侧编辑面板
8. 试一下:全屏播放 ⛶ / 诊断 🔍 / 编辑面板改字 / 下载 HTML

跑完一次约 ¥0.5 - ¥2(看模型)。

---

## 4. 正式部署

两条路径选一条。新手用 A,以后想持续迭代用 B。

### 路径 A · Netlify CLI 直接部署(15 分钟)

```bash
# 在项目根目录
cd ppt-tool-app

# 登录 Netlify
netlify login
# 浏览器弹出授权页, 点 Authorize

# 创建一个新站点 + 部署
netlify deploy --build

# 第一次会问:
# - "Create a new site": 选 Yes
# - "Team": 选你的 team
# - "Site name": 起个名字, 比如 ppt-tool-yourname (会变成 ppt-tool-yourname.netlify.app)

# 等 1-2 分钟, 看到 Draft URL: https://abc123--ppt-tool-yourname.netlify.app
# 在浏览器打开试一下, 然后:

netlify deploy --build --prod
# 这次会发布到正式域名
```

完成后你会拿到一个 `https://ppt-tool-yourname.netlify.app` 的地址。

> ⚠️ 但这时 API key 还没设,所以 LLM 调用会失败。继续看 [第 5 节](#5-配置环境变量)。

### 路径 B · GitHub → Netlify 仓库联动(20 分钟,但可持续 CI)

```bash
# 1. 创建一个 GitHub 仓库 (private 即可)
# https://github.com/new 创建一个空仓库, 比如叫 ppt-tool

# 2. 把代码推上去
cd ppt-tool-app
git init
git add .
git commit -m "initial: ppt tool"
git branch -M main
git remote add origin https://github.com/你的用户名/ppt-tool.git
git push -u origin main

# 3. 在 Netlify 网页:
# https://app.netlify.com/start → "Import from Git"
# → 选 GitHub → 授权 → 选 ppt-tool 仓库
# → Build settings:
#    Build command: (留空)
#    Publish directory: public
#    Functions directory: functions
# → Deploy site
```

之后每次 `git push`,Netlify 自动重新部署。

---

## 5. 配置环境变量

不管 A 还是 B 路径,都要去 Netlify 网页配置环境变量。

### 5.1 进入站点设置

打开 https://app.netlify.com,点你的站点 → **Site configuration** → **Environment variables** → **Add a variable**。

### 5.2 必须设置的变量

| Key | Value | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | `sk-xxx...` | 你的 DeepSeek key |

**至少 1 个**就行。配多个就有多个模型可选:

| Key | Value |
|---|---|
| `DOUBAO_API_KEY` | `xxx...` |
| `DOUBAO_MODEL` | `ep-202508xxxxx-xxxxx`(火山引擎 endpoint ID) |
| `KIMI_API_KEY` | `sk-...` |
| `QWEN_API_KEY` | `sk-...` |

### 5.3 强烈建议设置

| Key | Value | 说明 |
|---|---|---|
| `TEAM_PASSWORD` | `自己起一个,如 linear-2026-spring` | 不设就是公网谁都能用,会被薅 |

### 5.4 可选:覆盖默认模型版本

不同厂商会出新版本(比如 `qwen-plus-2025-09`),改一下就能切:

| Key | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek 用 chat 端点即可 |
| `DOUBAO_MODEL` | `doubao-pro-32k` | **火山引擎必须填 endpoint ID** 而不是模型名 |
| `KIMI_MODEL` | `moonshot-v1-32k` | 用 128k 更稳:`moonshot-v1-128k` |
| `QWEN_MODEL` | `qwen-plus` | 可换 `qwen-max` |

### 5.5 重新部署让变量生效

在 Netlify 网页 → **Deploys** → **Trigger deploy** → **Deploy site**。

环境变量是部署时注入到 Functions 进程的,改了之后必须重新部署才生效。

---

## 6. 部署后验证

### 6.1 健康检查

浏览器打开:

```
https://你的站点.netlify.app/api/health
```

正确应该返回 JSON:

```json
{
  "ok": true,
  "service": "ppt-tool-app",
  "version": "0.1.0",
  "models": {
    "deepseek": "configured",
    "doubao": "missing",
    "kimi": "missing",
    "qwen": "missing"
  },
  "teamPasswordEnabled": true,
  "rateLimit": { "perHour": 60, "window": "1h", "scope": "per-ip" }
}
```

确认:
- `models.<你设置的模型>` 是 `configured`
- 没设的是 `missing`(正常)
- `teamPasswordEnabled: true`(设了密码的话)

### 6.2 完整流程跑一遍

打开主页 `https://你的站点.netlify.app`:

1. 顶部右上输入你的 `TEAM_PASSWORD`
2. 模型选你配的(比如 DeepSeek V3)
3. 复制一个真实报告(1000-3000 字)到原文框,或上传一个 PDF
4. 点 **生成内容规划 →**
5. 等 30-60 秒看到阶段 2 大纲
6. 点 **生成 PPT →**,等 60-120 秒
7. 进入阶段 3,验证:
   - 缩略图列表显示
   - iframe 渲染了 PPT
   - 编辑面板可以改文字
   - 全屏 ⛶ 能进入演示模式
   - 诊断 🔍 能扫描问题
   - 下载 HTML 能拿到完整 PPT 文件

跑完一次成本约 ¥1-3。

### 6.3 如果出错怎么排查

按从大到小顺序:

- **页面打不开** → 检查 Netlify Deploy 日志
- **健康检查 404** → 检查 `netlify.toml` 是否被部署进去
- **健康检查 ok 但模型 missing** → 环境变量名拼错,或没重新部署
- **生成时 401** → `TEAM_PASSWORD` 不匹配
- **生成时 429** → 触发了限速,等 1 小时或减少调用
- **生成时 500** → 看 Netlify Functions 日志(网页 → Functions → llm-proxy → Recent invocations → 看错误堆栈)

---

## 7. 日常使用

### 7.1 给团队成员的简易说明

> 我们的 PPT 工具地址:`https://ppt-tool-xxx.netlify.app`
>
> 密码:`linear-2026-spring`(找 @你 拿)
>
> 用法:
> 1. 粘报告或上传 PDF/Word/PPT 附件
> 2. 选模型(DeepSeek 最便宜,豆包中文更润)
> 3. 等 1-2 分钟生成结构,再 1-2 分钟生成完整 PPT
> 4. 在阶段 3 改字/换图
> 5. 下载 HTML(可以直接用浏览器打开演示,或用 Chrome 打印成 PDF)
>
> 限制:每个 IP 每小时最多 60 次。如果触发请等下一小时。

### 7.2 把 PPT 转 PDF / PPTX

下载的是 HTML 文件。要 PDF:

- Chrome 打开 → 打印 → 目标"另存为 PDF" → 纸张大小选 16:9(自定义 1280×720 像素)

要传统 PPTX:目前没做直接导出,可以:
- 用 HTML 在浏览器里看,Cmd+P 导 PDF
- 或截图每页,粘到 PPT 软件里

---

## 8. 常见问题

<details>
<summary><b>Q1: 健康检查 200 但调用时 401 wrong_password</b></summary>

A: Netlify 环境变量改了之后**必须 Trigger deploy 重新部署**,只改不发布不生效。
</details>

<details>
<summary><b>Q2: 生成 PPT 阶段卡很久后 500 timeout</b></summary>

A: Netlify Functions 单次执行默认 10s 上限(免费版),visual-planner 输出有时超过。两种解法:

1. 升级 Netlify 到 Pro($19/月),Functions 上限延长到 26s
2. 换更快的模型(DeepSeek 通常比豆包快)

或者临时:在阶段 2 减少页数(设置里写"页数:8-10 页")让 LLM 输出更短。
</details>

<details>
<summary><b>Q3: 上传大附件提示 "存储接近上限"</b></summary>

A: localStorage 浏览器单 origin 上限 5-10MB。base64 嵌入的图片如果太多会满。
- 上传大图时,选择"压缩"而不是"原图"
- 阶段 3 的图片字段:用 URL 模式而非上传(图床用法)
- 点顶部 "+新建" 清掉旧工作再开新的
</details>

<details>
<summary><b>Q4: 上传 PDF 后字数 0,解析失败</b></summary>

A: 两种常见原因:

1. PDF 是扫描图片不是文字层(没法 OCR,工具只读取文字层)
2. PDF 加密了

解决:用其他工具(Adobe / WPS)把 PDF 转成 Word 再上传。
</details>

<details>
<summary><b>Q5: 生成的 PPT 中文字符乱码</b></summary>

A: skeleton.html 已经引入了 Noto Sans SC 等中文字体(Google Fonts),如果你部署的网络环境屏蔽了 Google Fonts:

1. 用自带中文字体的浏览器看(Mac Safari / 国内 Edge)
2. 或编辑 `public/dnas/*/skeleton.html`,把 fonts.googleapis.com 替换成国内字体 CDN(如 `https://fonts.font.im`)
</details>

<details>
<summary><b>Q6: 想增加新 DNA(新视觉风格)</b></summary>

A: 现有架构支持纯资产添加,**不用改任何 skill 代码**:

1. 设计一个新 skeleton.html(自动布局所有 variants 在一个文件)
2. 写对应的 manifest.json(描述每个 variant 的 slot 类型/页面角色)
3. 放进 `public/dnas/your-dna-id/` 即可

详见 P0 文档:`PPT_TOOL_INDEX.md` 中"如何新增 DNA"段落。
</details>

<details>
<summary><b>Q7: API key 泄露怎么办</b></summary>

A: 立刻去对应厂商控制台撤销那个 key,重新生成一个新的,在 Netlify 环境变量里替换,Trigger deploy。

LLM 厂商基本都按用量计费,泄露后不及时撤可能被人盗刷数千元。
</details>

<details>
<summary><b>Q8: 想给团队加更细的权限控制</b></summary>

A: 当前只有一个共享团队密码。要更细可以:

1. 改 `functions/llm-proxy.js`,把 `TEAM_PASSWORD` 改成多用户(键值对 `USER_xxx_PASSWORD`)
2. 或者加 Netlify Identity(SSO),前端登录后拿 token 调 API
3. 真要企业级:套一层 Cloudflare Access / SSO
</details>

---

## 9. 升级与维护

### 9.1 升级到新版本

如果以后我发了新版:

```bash
# 路径 A (CLI 直部):
cd ppt-tool-app
# 解压新版覆盖旧 public/ functions/ lib/ 等
netlify deploy --build --prod

# 路径 B (Git 联动):
cd ppt-tool-app
git pull   # 拉新代码
git push   # 推到 GitHub, Netlify 自动重部
```

### 9.2 监控成本

LLM API 是花钱的。建议:

- 每个厂商控制台都设置消费上限/告警
- 给 Netlify 站点开 Analytics 看流量
- 阶段 1 用 DeepSeek(便宜)出大纲,阶段 2 重要场合换豆包(质量更好)

### 9.3 备份

工具本身是无状态的,数据都在用户浏览器的 localStorage。要导出用户数据:

```javascript
// 用户在浏览器 console 跑这个
copy(localStorage.getItem('ppt-tool:state'))
// 然后粘到 .json 文件
```

要导入(还原工作):

```javascript
localStorage.setItem('ppt-tool:state', '<粘 JSON 内容>')
// 刷新页面, banner 会出现, 点恢复
```

---

## 10. 反馈与协作

发现 bug / 提需求 / 想改:

- 看 `PPT_TOOL_INDEX.md` 了解项目结构
- skill 在 `public/skills/`(改完不用重新部署,前端 fetch 加载)
- 视觉风格在 `public/dnas/`(同样)
- 前端逻辑在 `public/lib/`(同样)
- 后端代理在 `functions/`(改了要重新部署)

加 DNA 是最低成本的扩展 — 不动一行 JS 就能让 PPT 多一种风格。

---

**祝部署顺利。如果一切顺利,40 分钟内你应该能看到一个真实生成的 PPT。**
