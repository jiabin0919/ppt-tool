# 部署教程 · 零本地环境版

**适用人群**:你的电脑无法安装 Node.js / 不想折腾命令行 / 用平板或老电脑 / 公司 IT 禁止装软件。

整个流程**只用浏览器**,不装任何东西,40 分钟左右搞定。

---

## 整体思路

```
你的 tar.gz 文件
     ↓ 浏览器上传
GitHub 网页(代码托管)
     ↓ 网页授权
Netlify 网页(自动部署)
     ↓ 设置环境变量
拿到 https://xxx.netlify.app 真实地址
```

**所有操作都在网页里完成**,不开任何终端。

---

## 第 1 步:解压 tar.gz(5 分钟)

下载我给你的 `ppt-tool-app-FINAL.tar.gz`。

**Mac**:双击就能解压成 `ppt-tool-app/` 文件夹。

**Windows**:用 7-Zip(免费) → 右键 → 7-Zip → 解压到当前文件夹。  
或用 WinRAR / Bandizip 都行。

**没装解压工具**:在线解压网站 https://extract.me/  
拖 tar.gz 上去 → 下载解压后的 zip。

解压后你应该看到这个文件夹结构:

```
ppt-tool-app/
├── public/
├── functions/
├── netlify.toml
├── package.json
├── DEPLOY.md
├── README.md
├── .env.example
└── .gitignore
```

---

## 第 2 步:申请一个 LLM API Key(10 分钟)

任选一个就够,推荐 **DeepSeek**(最便宜)。

1. 打开 https://platform.deepseek.com/sign_up
2. 用手机号 / 邮箱 / GitHub 注册
3. 注册后送 ¥10 体验额度(够跑 100+ 次完整 PPT)
4. 进 **左侧菜单 → API Keys → 创建 API Key**
5. 命名比如 `ppt-tool`,点创建
6. **复制 key**(形如 `sk-xxxxxxxxxxxxxxx`),**只显示一次**,保存到记事本

> 注意:这个 key 等于你的钱包密码,**不要发到任何聊天/微信/截图**。

如果你要用其他模型(豆包/Kimi/通义),申请方式参见 DEPLOY.md 第 2 节。

---

## 第 3 步:把代码上传到 GitHub(10 分钟)

### 3.1 注册 / 登录 GitHub

打开 https://github.com,免费注册。

### 3.2 创建新仓库

1. 右上角 **+** → **New repository**
2. Repository name:`ppt-tool`(随便起)
3. **Private**(私有,推荐 — 你的 prompt skill 是你的资产)
4. **不勾**任何 .gitignore / README(我们已经有了)
5. 点 **Create repository**

### 3.3 上传代码

新仓库页面有一个按钮 **"uploading an existing file"**(蓝色链接)。

如果没看到那个链接,点 **Add file** → **Upload files**。

把第 1 步解压出来的 `ppt-tool-app/` 文件夹**里面所有文件和子文件夹**全选,拖到 GitHub 网页的上传区。

> 注意:是拖 `ppt-tool-app/` **文件夹里面的内容**,不是文件夹本身。  
> 拖完后你应该在 GitHub 网页看到 `public/`, `functions/`, `package.json` 等。

等几分钟上传完(vendor/ 里有几个大文件 1-2 MB,加起来约 2.5 MB)。

页面下方:
- **Commit message**:`initial commit`
- 选 **Commit directly to the main branch**
- 点 **Commit changes**

仓库现在长这样:
```
你的仓库/
├── public/
├── functions/
├── netlify.toml
├── package.json
├── DEPLOY.md
└── ...
```

---

## 第 4 步:Netlify 网页部署(5 分钟)

### 4.1 注册 Netlify

打开 https://app.netlify.com/signup,**用 GitHub 登录最方便**(自动授权)。

### 4.2 联动仓库

登录后:

1. 点顶部 **Add new site** → **Import an existing project**
2. 选 **Deploy with GitHub**
3. 第一次会要求授权 Netlify 访问 GitHub,点 **Authorize**
4. 列表里选你刚创建的 `ppt-tool` 仓库

### 4.3 部署配置

会进入配置页面,大部分不用动,确认这几个:

| 字段 | 值 |
|---|---|
| Branch to deploy | `main` |
| Base directory | (留空) |
| Build command | (留空) |
| Publish directory | `public` |
| Functions directory | `functions` |

> Netlify 应该会自动从 `netlify.toml` 读出这些,但你检查一下 `Publish directory` 是 `public` 而不是别的。

点 **Deploy ppt-tool**(或类似按钮)。

### 4.4 等部署完成

Netlify 会显示进度,通常 1-3 分钟。

完成后,顶部会给你一个地址,形如:

```
https://wonderful-name-123456.netlify.app
```

> 想改名字?Site configuration → Change site name → 改成 `ppt-tool-yourname` 之类的。

---

## 第 5 步:配置环境变量(5 分钟)— 关键步骤

部署成功了,但**还不能用**,因为还没填 LLM API key。

### 5.1 进入环境变量设置

在 Netlify 站点页面:

**Site configuration**(左侧菜单)→ **Environment variables** → **Add a variable**

### 5.2 添加必须的 key

点 **Add a variable**,填:

| Key | Value |
|---|---|
| `DEEPSEEK_API_KEY` | `sk-xxx...`(第 2 步保存的那个) |

点 **Create variable**。

### 5.3 设置团队密码(强烈建议)

再点一次 **Add a variable**:

| Key | Value |
|---|---|
| `TEAM_PASSWORD` | 自己起一个,比如 `my-team-2026-spring` |

> 不设的话,工具公网暴露,谁知道你的地址都能用,会把你的 API 额度烧光。

### 5.4 重新部署让变量生效

**变量改了之后必须重新部署!**

左侧菜单 **Deploys** → 右上角 **Trigger deploy** → **Deploy site**。

等 1-2 分钟。

---

## 第 6 步:验证部署(5 分钟)

### 6.1 健康检查

浏览器打开:

```
https://你的-netlify-地址.netlify.app/api/health
```

应该看到 JSON 返回:

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
  ...
}
```

**关键检查**:
- ✅ `deepseek: "configured"` — key 配上了
- ✅ `teamPasswordEnabled: true` — 密码生效
- ❌ 如果 `deepseek: "missing"` → 回第 5 步,环境变量名拼错,或没 Trigger deploy

### 6.2 跑一次真实 PPT

打开主页:`https://你的-netlify-地址.netlify.app`

1. 右上输入第 5.3 步你设的密码
2. 模型选 **DeepSeek V3**
3. 在报告框粘一篇真实文章(1000-3000 字),或上传一个 PDF
4. 点 **生成内容规划 →**,等 30-60 秒
5. 进阶段 2,点 **生成 PPT →**,等 60-120 秒
6. 阶段 3 看到 PPT 渲染出来,试试改字 / 全屏 / 下载 HTML

这一次约花你 ¥0.5 - ¥1 的 API 费用。

---

## 以后怎么改代码?

零本地环境的限制:你没法本地编辑文件。但有 3 种方式继续修改:

### 方式 1:GitHub 网页直接编辑(适合小改动)

在 GitHub 仓库网页打开任何文件,右上角铅笔 ✏ 图标 → 修改 → **Commit changes**。  
Netlify 检测到 push,自动重新部署。

适合:改 README、改 prompt skill、改一两行代码。

### 方式 2:GitHub Codespaces(适合大改动,免费 60 小时/月)

在 GitHub 仓库右上角 **Code** → **Codespaces** → **Create codespace on main**。

会在浏览器里打开一个完整的 VS Code 编辑器 + 终端,可以直接跑 `netlify dev` 测试。

适合:你想反复改代码 + 测试。

### 方式 3:换台电脑装 Node 后用 git clone

未来你换电脑了,在那台机器上:
```bash
git clone https://github.com/你的用户名/ppt-tool.git
cd ppt-tool
npm install
netlify dev
```

---

## 常见问题

<details>
<summary><b>Q: 上传到 GitHub 时显示文件太大?</b></summary>

A: GitHub 单文件上限 100MB,vendor/ 里最大的 pdf.worker.min.mjs 才 1.2MB,正常没问题。  
如果你的 tar.gz 含了我的 node_modules/(不该有),会失败。我给你的 FINAL 包是不含 node_modules 的,直接用即可。
</details>

<details>
<summary><b>Q: Netlify 部署失败,日志显示找不到 openai?</b></summary>

A: Netlify 检测到 package.json 后会**自动跑 npm install**,所以你不用本地装。  
如果它不跑,看 Site configuration → Build & deploy → Build settings,确认 Build command 是空的(让 Netlify 走默认 npm ci)。
</details>

<details>
<summary><b>Q: 想加豆包/Kimi/Qwen 怎么办?</b></summary>

A: 跟第 5 步一样的 Add variable,key 名分别是:
- `DOUBAO_API_KEY` + `DOUBAO_MODEL`(火山引擎 endpoint ID,如 ep-xxx)
- `KIMI_API_KEY`
- `QWEN_API_KEY`

加完 → Trigger deploy → 主页右上模型下拉就能选。
</details>

<details>
<summary><b>Q: 我的 Netlify 地址能给别人用吗?</b></summary>

A: 能,只要他知道 `TEAM_PASSWORD`。整个工具就是为团队共享设计的。  
单 IP 每小时 60 次限速,如果团队大可以改 functions/llm-proxy.js 里的 `RATE_LIMIT_PER_HOUR`。
</details>

<details>
<summary><b>Q: Netlify 免费版够用吗?</b></summary>

A: 对个人/小团队完全够。免费版限制:
- 100 GB 带宽/月(几千次 PPT 生成够了)
- 125,000 Functions 调用/月(等于 6 万次完整流程)
- 单 Function 单次执行 10 秒(visual-planner 偶尔会超,出错就重试一次)

如果命中 10 秒上限频繁,升级 Pro($19/月)。
</details>

<details>
<summary><b>Q: 想换自定义域名?</b></summary>

A: Netlify 站点页面 → Domain management → Add custom domain。  
按提示在你的域名 DNS 里加 CNAME / A 记录指向 Netlify。免费送 HTTPS 证书。
</details>

---

## 完成清单

跑完上面 6 步,你应该有:

- ✅ GitHub 私有仓库 `ppt-tool`(代码托管)
- ✅ Netlify 站点 `https://xxx.netlify.app`(在线服务)
- ✅ DeepSeek API key 配在 Netlify 环境变量
- ✅ 团队密码保护
- ✅ `/api/health` 验证通过
- ✅ 跑通一次真实 PPT 生成

**整个过程你只开了浏览器,没碰任何命令行。**

---

## 下一步建议

1. **把团队密码告诉同事**,让他们也用
2. **观察 API 用量**,在 DeepSeek 控制台开消费告警
3. **想改 prompt** → 直接在 GitHub 网页编辑 `public/skills/*.md`,自动重新部署
4. **想加新 DNA** → 把新的 manifest.json + skeleton.html 上传到 `public/dnas/your-id/`,自动生效

祝部署顺利!
