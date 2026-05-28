/**
 * llm-client.js · 浏览器侧 LLM 调用封装
 *
 * 用法:
 *   const result = await llmCall({
 *     model: 'deepseek',
 *     password: 'xxx',
 *     systemPrompt: '...',
 *     userPrompt: '...',
 *     temperature: 0.3,
 *     maxTokens: 8000,
 *   });
 *   // result: { ok, content, usage } 或 { ok: false, error, ... }
 *
 * 本地开发时(没有 Netlify Functions),会返回模拟响应,方便 UI 调试
 */

const LLM_PROXY_URL = "/api/llm-proxy";

async function llmCall({
  model,
  password,
  systemPrompt,
  userPrompt,
  messages, // 可选: 直接传 messages 数组, 优先于 systemPrompt+userPrompt
  temperature = 0.3,
  maxTokens = 8000,
  responseFormat,
}) {
  const msgs = messages || [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: userPrompt },
  ];

  const isLocal = window.location.hostname === "localhost" ||
                  window.location.hostname === "127.0.0.1";

  try {
    const res = await fetch(LLM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        password,
        messages: msgs,
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat,
      }),
    });

    if (!res.ok) {
      // 本地 server 没有 Functions, 会返回 404/405 等
      if (isLocal) {
        console.warn("[llm-client] /api/llm-proxy returned", res.status, "→ 用 mock 响应");
        return mockResponse(systemPrompt, userPrompt, messages);
      }
      // 生产: 返回错误给上层
      let errBody = {};
      try { errBody = await res.json(); } catch (e) {}
      return {
        ok: false,
        error: errBody.error || `http_${res.status}`,
        message: errBody.message || res.statusText,
        status: res.status,
      };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    if (isLocal) {
      console.warn("[llm-client] fetch 失败, 用 mock 响应:", err.message);
      return mockResponse(systemPrompt, userPrompt, messages);
    }
    return {
      ok: false,
      error: "network_error",
      message: err.message,
    };
  }
}

/**
 * 本地开发用 mock 响应,让 UI 在没有真实 LLM 时也能演示流程
 *
 * 判断逻辑用 systemPrompt 中的 skill 名 (而不是 userPrompt), 因为
 * userPrompt 两个 skill 都会包含 "planning.md", 无法区分
 */
function mockResponse(systemPrompt, userPrompt, messages) {
  const sp = systemPrompt || messages?.find(m => m.role === "system")?.content || "";
  const up = userPrompt || messages?.find(m => m.role === "user")?.content || "";
  
  // 用 frontmatter "name: ppt-xxx" 精确匹配 (避免 description 里相互提到对方导致误判)
  // visual-planner 优先判断 (description 里也提到 content-planner, 但 name 字段是唯一的)
  if (sp.includes("name: ppt-visual-planner")) {
    return {
      ok: true,
      mocked: true,
      content: MOCK_VISUAL_PLAN_YAML,
      model: "mock",
      modelKey: "mock",
      displayName: "Mock · visual-planner",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
  }
  
  if (sp.includes("name: ppt-content-planner")) {
    return {
      ok: true,
      mocked: true,
      content: MOCK_PLANNING_MD,
      model: "mock",
      modelKey: "mock",
      displayName: "Mock · planner",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
  }
  
  // 通用 mock
  return {
    ok: true,
    mocked: true,
    content: "(本地 Mock 响应)\n\n这是 mock 内容。部署到 Netlify 后会调用真实 LLM。\n\n[调试] systemPrompt 前 80 字符: " + sp.substring(0, 80),
    model: "mock",
    displayName: "Mock(本地)",
    usage: {},
  };
}

// 简化的 mock 数据,用 Linear 3.0 报告做样例
const MOCK_PLANNING_MD = `# 报告 · PPT 内容规划

## 基本信息
- 受众:管理层
- 页数:10 页
- 演讲时长:20 分钟

## 全局内容规划

### 叙事框架
选择:框架 A(结论先行)
理由:管理层时间紧,先听结论后看依据

### 核心论点
v3 已交付 AI 原生工具的"主流跨越临界点"基础架构

### 章节结构
| 章节 | 页码 | 叙事任务 |
|------|------|---------|
| 1. 数据 | 1-3 | 用 142K MAU + 3.2× speed 建立"已成功"认知 |
| 2. 新模块 | 4-6 | 介绍 3 大新模块,聚焦 AI Assist |
| 3. Roadmap | 7-10 | 公开 2026 4 季度计划 |

## 逐页内容规划

### 第 1 页
**叙事目标**:仪式感建立

\`\`\`yaml
slide: 1
page_role: "cover"
page_intent: "建立发布会仪式感"
content_elements:
  main_title: "下一代的项目协作方式"
  subtitle: "Linear 3.0 Spring Release"
\`\`\`

### 第 2 页
**叙事目标**:数据锚定

\`\`\`yaml
slide: 2
page_role: "climax"
content_elements:
  main_title: "v3 已上线 90 天 · 关键指标"
  items_count: 5
\`\`\`

### 第 3 页
**叙事目标**:具体化抽象

\`\`\`yaml
slide: 3
page_role: "climax"
content_elements:
  main_title: "同样的任务,差 5 倍"
  items_count: 2
\`\`\`

### 第 4 页
**叙事目标**:介绍新模块

\`\`\`yaml
slide: 4
page_role: "chapter_break"
content_elements:
  chapter_title: "让 AI 帮你看见你看不见的事"
\`\`\`

### 第 5 页
**叙事目标**:3 大模块并列

\`\`\`yaml
slide: 5
page_role: "support"
content_elements:
  main_title: "3 个新模块"
  items_count: 3
\`\`\`

### 第 6 页
**叙事目标**:Roadmap 公开

\`\`\`yaml
slide: 6
page_role: "process"
content_elements:
  main_title: "2026 4 季度要交付的事"
  items_count: 4
\`\`\`

### 第 7 页
**叙事目标**:致谢

\`\`\`yaml
slide: 7
page_role: "closing"
content_elements:
  main_title: "THANKS"
\`\`\`
`;

const MOCK_VISUAL_PLAN_YAML = `global:
  dna: "capsule"
  total_pages: 7
  review_comments: |
    7 页, 7 个不同 variant

pages:
  - slide: 1
    variant_id: "COV-A"
    page_role: "cover"
    director_note: |
      【情绪定调】发布会开场
    slots:
      slot-title: "下一代的<em>项目协作</em>方式"
      slot-subtitle: "Linear 3.0 Spring Release"

  - slide: 2
    variant_id: "CLX-A"
    page_role: "climax"
    director_note: |
      【情绪定调】数据建立认知
    slots:
      slot-title: "v3 已上线 <em>90 天</em> · 关键指标"

  - slide: 3
    variant_id: "CLX-D"
    page_role: "climax"
    director_note: |
      【情绪定调】前后对比
    slots:
      slot-title: "同样的任务, <em>差 5 倍</em>"

  - slide: 4
    variant_id: "CB-A"
    page_role: "chapter_break"
    director_note: |
      【情绪定调】章节切换
    slots:
      slot-chapter-num: "02"
      slot-chapter-title: "让 AI 帮你<em>看见</em>你看不见的事"

  - slide: 5
    variant_id: "S-A"
    page_role: "support"
    director_note: |
      【情绪定调】3 模块并列
    slots:
      slot-title: "3 个<em>新模块</em>"

  - slide: 6
    variant_id: "PRC-A"
    page_role: "process"
    director_note: |
      【情绪定调】Roadmap 公开
    slots:
      slot-title: "2026 年, 我们要交付<em>这 4 件事</em>"

  - slide: 7
    variant_id: "CLO-D"
    page_role: "closing"
    director_note: |
      【情绪定调】致谢
    slots:
      slot-title: "THANKS <em>FOR<br>WATCHING</em>"
`;

window.llmCall = llmCall;
