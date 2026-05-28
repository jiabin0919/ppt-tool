/**
 * app.js · 开发预览页主入口
 *
 * 职责:
 *  1. 启动时加载 7 套 DNA, 渲染卡片
 *  2. 提供 3 个手动测试按钮:
 *     - 检查 /api/health
 *     - 调 /api/llm-proxy 试一次
 *     - (后续) 跑端到端测试
 */

(async function () {
  const $ = (id) => document.getElementById(id);

  // === 1. 启动加载 ===
  try {
    const result = await window.loadManifests();
    if (result.failed.length === 0) {
      $("dna-status").textContent = `DNA: ${result.loaded.length}/7 ✓`;
      $("dna-status").classList.add("ok");
    } else {
      $("dna-status").textContent = `DNA: ${result.loaded.length}/7 (${result.failed.length} 失败)`;
      $("dna-status").classList.add("err");
    }
    renderDnaGrid();
  } catch (err) {
    $("dna-status").textContent = "DNA: 加载失败";
    $("dna-status").classList.add("err");
    console.error(err);
  }

  // === 2. DNA 卡片渲染 ===
  function renderDnaGrid() {
    const list = window.MANIFEST_REGISTRY.getDnaList();
    const grid = $("dna-grid");
    grid.innerHTML = "";

    for (const dna of list) {
      const card = document.createElement("div");
      card.className = "dna-card";
      card.innerHTML = `
        <div class="dna-card-header">
          <div>
            <div class="dna-card-name">${escapeHTML(dna.name)}</div>
            <div class="dna-card-tagline">${escapeHTML(dna.tagline)}</div>
          </div>
        </div>
        <div class="dna-card-stats">
          <span>📐 ${dna.variantCount} variants</span>
          <span>🎨 ${dna.skinCount} skins</span>
        </div>
        <div class="dna-card-skins">
          ${dna.skins
            .map((s) => {
              const bg = s.color["底色"] || "#FAFAFA";
              const fg = s.color["品牌色"] || "#0A0A0A";
              return `
                <span class="skin-chip">
                  <span class="skin-swatch" style="background: ${bg}; border-color: ${fg}"></span>
                  ${escapeHTML(s.name)}${s.isDefault ? " ★" : ""}
                </span>
              `;
            })
            .join("")}
        </div>
      `;
      grid.appendChild(card);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // === 3. health check ===
  $("check-health").addEventListener("click", async () => {
    const out = $("health-output");
    out.textContent = "请求中...";
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      out.textContent = JSON.stringify(data, null, 2);
      $("health-status").textContent = data.ok ? "API: OK" : "API: 错误";
      $("health-status").classList.add(data.ok ? "ok" : "err");
    } catch (err) {
      out.textContent = "❌ " + err.message + "\n\n(本地预览时这个会失败,因为没有 Netlify Functions。部署后才能测试。)";
      $("health-status").textContent = "API: 不可达";
      $("health-status").classList.add("err");
    }
  });

  // === 4. LLM 测试调用 ===
  $("call-llm").addEventListener("click", async () => {
    const out = $("llm-output");
    const model = $("llm-model").value;
    const password = $("team-password").value;
    const prompt = $("llm-prompt").value;

    if (!prompt.trim()) {
      out.textContent = "请输入提示词";
      return;
    }

    out.textContent = `调用 ${model} 中...`;
    $("call-llm").disabled = true;

    try {
      const res = await fetch("/api/llm-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          password,
          messages: [
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        out.textContent =
          `[${data.displayName} · ${data.model}]\n\n${data.content}\n\n---\nusage: ${JSON.stringify(data.usage)}`;
      } else {
        out.textContent = "❌ " + JSON.stringify(data, null, 2);
      }
    } catch (err) {
      out.textContent = "❌ 调用失败: " + err.message;
    } finally {
      $("call-llm").disabled = false;
    }
  });

  // === 自动尝试 health(页面加载后)===
  setTimeout(() => $("check-health").click(), 500);
})();
