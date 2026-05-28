/**
 * LLM 代理 · 4 模型统一接口
 *
 * 4 个模型都用 OpenAI SDK 调用, 只换 baseURL + apiKey + model:
 *   - DeepSeek V3 (deepseek-chat)
 *   - 豆包 (doubao-pro-32k 或最新版)
 *   - Kimi (moonshot-v1-32k)
 *   - Qwen (qwen-plus 或最新版)
 *
 * 前端调用: POST /api/llm-proxy
 *   body: {
 *     model: "deepseek" | "doubao" | "kimi" | "qwen",
 *     messages: [...],     // OpenAI 格式
 *     temperature: 0.3,
 *     max_tokens: 4000,
 *     password: "team-password"   // 简单团队密码
 *   }
 *
 * 返回:
 *   { ok: true, content: "..." }
 *   或
 *   { ok: false, error: "..." }
 */

const OpenAI = require("openai");

// 4 模型配置(从环境变量读 API key + 默认参数)
const MODELS = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    displayName: "DeepSeek V3",
  },
  doubao: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "DOUBAO_API_KEY",
    defaultModel: "doubao-pro-32k",  // 部署时通过环境变量 DOUBAO_MODEL 覆盖
    displayName: "豆包 Pro",
  },
  kimi: {
    baseURL: "https://api.moonshot.cn/v1",
    apiKeyEnv: "KIMI_API_KEY",
    defaultModel: "moonshot-v1-32k",
    displayName: "Kimi",
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "QWEN_API_KEY",
    defaultModel: "qwen-plus",
    displayName: "通义千问 Plus",
  },
};

// 简单的内存级 IP 限速 (Netlify Functions cold start 会重置, 但能挡多数滥用)
const ipHits = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_PER_HOUR = 60;

function checkRateLimit(ip) {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  let hit = ipHits.get(ip);
  if (!hit || hit.resetAt < now) {
    hit = { count: 0, resetAt: now + oneHour };
    ipHits.set(ip, hit);
  }

  hit.count += 1;

  if (hit.count > RATE_LIMIT_PER_HOUR) {
    return {
      ok: false,
      retryAfter: Math.ceil((hit.resetAt - now) / 1000),
    };
  }
  return { ok: true };
}

exports.handler = async (event, context) => {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }

  // 1. 验密码
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "invalid_json" }),
    };
  }

  const requiredPassword = process.env.TEAM_PASSWORD;
  if (requiredPassword && body.password !== requiredPassword) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "wrong_password" }),
    };
  }

  // 2. IP 限速
  const ip =
    event.headers["x-forwarded-for"] ||
    event.headers["client-ip"] ||
    "unknown";
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return {
      statusCode: 429,
      body: JSON.stringify({
        ok: false,
        error: "rate_limit_exceeded",
        retryAfter: rate.retryAfter,
        limit: RATE_LIMIT_PER_HOUR,
        window: "1h",
      }),
    };
  }

  // 3. 验模型
  const modelKey = body.model;
  if (!modelKey || !MODELS[modelKey]) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        ok: false,
        error: "invalid_model",
        availableModels: Object.keys(MODELS),
      }),
    };
  }

  const config = MODELS[modelKey];
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "api_key_not_configured",
        envVar: config.apiKeyEnv,
        hint: `设置环境变量 ${config.apiKeyEnv} 后才能用 ${config.displayName}`,
      }),
    };
  }

  // 4. 调 LLM
  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: config.baseURL,
    });

    const modelOverride =
      process.env[`${modelKey.toUpperCase()}_MODEL`] || config.defaultModel;

    const response = await openai.chat.completions.create({
      model: modelOverride,
      messages: body.messages,
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens ?? 4000,
      // OpenAI 兼容: 部分模型支持 response_format json_object, 但不强求
      ...(body.response_format && { response_format: body.response_format }),
    });

    const content = response.choices?.[0]?.message?.content || "";
    const usage = response.usage || {};

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        ok: true,
        content,
        model: modelOverride,
        modelKey,
        displayName: config.displayName,
        usage,
      }),
    };
  } catch (err) {
    console.error(`LLM 调用失败 [${modelKey}]:`, err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "llm_call_failed",
        model: modelKey,
        message: err.message,
      }),
    };
  }
};
