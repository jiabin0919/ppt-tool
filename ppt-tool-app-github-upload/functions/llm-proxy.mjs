/**
 * LLM 代理 (流式版) · 4 模型统一接口
 *
 * 关键改动 (相比旧版):
 *   - 用 Netlify 现代 function 格式 (export default + Request/Response)
 *   - 返回 ReadableStream 实现流式输出 (SSE)
 *   - 只要 LLM 首 token 在 10 秒内开始吐, 后续边流边生成不会超时
 *   - 这是解决 504 超时的核心
 *
 * 前端调用: POST /api/llm-proxy
 *   body: { model, messages, temperature, max_tokens, password, stream }
 *
 * 流式返回 (Content-Type: text/event-stream):
 *   data: {"type":"delta","content":"部分文字"}
 *   data: {"type":"done","usage":{...}}
 *   data: {"type":"error","error":"...","message":"..."}
 *
 * 非流式 (stream:false): 普通 JSON { ok, content, usage }
 */

import OpenAI from "openai";

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
    defaultModel: "doubao-pro-32k",
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

const ipHits = new Map();
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
    return { ok: false, retryAfter: Math.ceil((hit.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function jsonError(statusCode, payload) {
  return new Response(JSON.stringify({ ok: false, ...payload }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonError(405, { error: "method_not_allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonError(400, { error: "invalid_json" });
  }

  const requiredPassword = process.env.TEAM_PASSWORD;
  if (requiredPassword && body.password !== requiredPassword) {
    return jsonError(401, { error: "wrong_password" });
  }

  const ip =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("client-ip") ||
    "unknown";
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return jsonError(429, {
      error: "rate_limit_exceeded",
      retryAfter: rate.retryAfter,
      limit: RATE_LIMIT_PER_HOUR,
      window: "1h",
    });
  }

  const modelKey = body.model;
  if (!modelKey || !MODELS[modelKey]) {
    return jsonError(400, {
      error: "invalid_model",
      availableModels: Object.keys(MODELS),
    });
  }

  const config = MODELS[modelKey];
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return jsonError(500, {
      error: "api_key_not_configured",
      envVar: config.apiKeyEnv,
      hint: `设置环境变量 ${config.apiKeyEnv} 后才能用 ${config.displayName}`,
    });
  }

  const openai = new OpenAI({ apiKey, baseURL: config.baseURL });
  const modelOverride =
    process.env[`${modelKey.toUpperCase()}_MODEL`] || config.defaultModel;

  // === 非流式模式 ===
  if (body.stream === false) {
    try {
      const response = await openai.chat.completions.create({
        model: modelOverride,
        messages: body.messages,
        temperature: body.temperature ?? 0.3,
        max_tokens: body.max_tokens ?? 4000,
        ...(body.response_format && { response_format: body.response_format }),
      });
      const content = response.choices?.[0]?.message?.content || "";
      return new Response(
        JSON.stringify({
          ok: true,
          content,
          model: modelOverride,
          modelKey,
          displayName: config.displayName,
          usage: response.usage || {},
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    } catch (err) {
      console.error(`LLM 调用失败 [${modelKey}]:`, err);
      return jsonError(500, {
        error: "llm_call_failed",
        model: modelKey,
        message: err.message,
      });
    }
  }

  // === 流式模式 (默认) ===
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const completion = await openai.chat.completions.create({
          model: modelOverride,
          messages: body.messages,
          temperature: body.temperature ?? 0.3,
          max_tokens: body.max_tokens ?? 4000,
          stream: true,
          ...(body.response_format && { response_format: body.response_format }),
        });

        let usage = null;
        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) {
            send({ type: "delta", content: delta });
          }
          if (chunk.usage) usage = chunk.usage;
        }

        send({
          type: "done",
          model: modelOverride,
          modelKey,
          displayName: config.displayName,
          usage: usage || {},
        });
      } catch (err) {
        console.error(`LLM 流式调用失败 [${modelKey}]:`, err);
        send({
          type: "error",
          error: "llm_call_failed",
          model: modelKey,
          message: err.message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
