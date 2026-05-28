/**
 * 健康检查 · GET /api/health
 *
 * 返回:
 *  - 部署版本号
 *  - 各模型 API key 是否已配置 (不暴露 key 本身)
 *  - 团队密码是否已启用
 *  - 时间戳
 */

const MODELS = ["deepseek", "doubao", "kimi", "qwen"];

exports.handler = async (event) => {
  const status = {};
  for (const m of MODELS) {
    const envVar = `${m.toUpperCase()}_API_KEY`;
    status[m] = process.env[envVar] ? "configured" : "missing";
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      ok: true,
      service: "ppt-tool-app",
      version: "0.1.0",
      time: new Date().toISOString(),
      models: status,
      teamPasswordEnabled: !!process.env.TEAM_PASSWORD,
      rateLimit: {
        perHour: 60,
        window: "1h",
        scope: "per-ip",
      },
    }),
  };
};
