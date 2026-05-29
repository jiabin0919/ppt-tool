/**
 * pipeline.js · 3 阶段工作流主流程
 *
 * State:
 *   currentStage: 'input' | 'outline' | 'preview'
 *   rawReport: string
 *   settings: {audience, pages, duration, special}
 *   model: string
 *   password: string
 *   planning: null | { framework, thesis, chapters, pages }
 *   selectedDna: null | string
 *   visualPlan: null | object (yaml 解析后)
 *   generatedHtml: null | string
 *   selectedPageIdx: number
 *
 * 流程:
 *   1. 用户在阶段 1 填报告 → 点 "生成内容规划"
 *      → llmCall(content-planner skill, raw report)
 *      → 解析返回的 planning.md → state.planning
 *      → 切到阶段 2
 *
 *   2. 阶段 2 显示 planning 摘要 + 逐页 outline + 选 DNA
 *      → 点 "生成 PPT"
 *      → llmCall(visual-planner skill, manifest of selectedDna, planning)
 *      → 解析返回的 visual_plan.yaml → state.visualPlan
 *      → renderer.render(visualPlan, selectedDna) → state.generatedHtml
 *      → 切到阶段 3
 *
 *   3. 阶段 3 显示 iframe + 缩略图 + 编辑面板(下版本)
 */

(async function () {
  const $ = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => document.querySelectorAll(sel);

  // ===== state =====
  const state = {
    currentStage: 'input',
    rawReport: '',
    attachments: [],  // [{name, size, type, text, pageCount?, slideCount?, wordCount, status, error?}]
    settings: { audience: '', pages: '', duration: '', special: '' },
    model: 'deepseek',
    password: '',
    planning: null,
    selectedDna: null,
    visualPlan: null,
    generatedHtml: null,
    selectedPageIdx: 0,
  };

  // ===== util =====
  function showToast(message, type = '', duration = 2400) {
    const toast = $('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, duration);
  }

  function showLoading(msg = '加载中…') {
    $('loading-message').textContent = msg;
    $('loading-overlay').hidden = false;
  }
  function hideLoading() {
    $('loading-overlay').hidden = true;
  }

  // ===== 阶段切换 =====
  function setStage(stage) {
    state.currentStage = stage;
    qsa('.stage').forEach(el => {
      el.hidden = el.dataset.stage !== stage;
    });
    qsa('.stage-dot').forEach(el => {
      const s = el.dataset.stage;
      el.classList.toggle('active', s === stage);
      el.classList.toggle('done', stageOrder.indexOf(s) < stageOrder.indexOf(stage));
    });
    window.scrollTo(0, 0);
    // 切换 stage 时也存一下
    if (window.Storage) scheduleSave(500);
  }

  const stageOrder = ['input', 'outline', 'preview'];

  // ===== 启动: 加载 manifest =====
  await window.loadManifests();

  // 给 DNA selector 填选项
  const dnaSelect = $('dna-selector');
  const dnaList = window.MANIFEST_REGISTRY.getDnaList();
  for (const d of dnaList) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} · ${d.tagline}`;
    dnaSelect.appendChild(opt);
  }
  // 默认选 Capsule
  if (dnaList.find(d => d.id === 'capsule')) {
    dnaSelect.value = 'capsule';
    state.selectedDna = 'capsule';
  } else if (dnaList.length > 0) {
    state.selectedDna = dnaList[0].id;
  }
  dnaSelect.addEventListener('change', e => {
    state.selectedDna = e.target.value;
    scheduleSave();
  });

  // ===== 持久化 =====
  let saveTimer = null;
  let saveEnabled = true;  // 启动时若显示了 banner 会暂时禁用
  
  function buildPersistedState() {
    // 不存 password 和 generatedHtml(后者可重建)
    // 附件:文本不大就一起存,大附件提示用户重新上传
    const persistedAttachments = (state.attachments || [])
      .filter(a => a.status === 'ok')
      .map(a => ({
        name: a.name,
        size: a.size,
        type: a.type,
        text: a.text,
        wordCount: a.wordCount,
        pageCount: a.pageCount,
        slideCount: a.slideCount,
        status: 'ok',
      }));
    
    return {
      currentStage: state.currentStage,
      rawReport: state.rawReport,
      attachments: persistedAttachments,
      settings: state.settings,
      model: state.model,
      selectedDna: state.selectedDna,
      planning: state.planning,
      visualPlan: state.visualPlan,
      selectedPageIdx: state.selectedPageIdx,
    };
  }
  
  function saveNow() {
    if (!saveEnabled) {
      console.log('[storage] save disabled (banner showing or restore in progress)');
      return { ok: false, disabled: true };
    }
    const payload = buildPersistedState();
    
    // 完全空白的 state 不保存(避免占用 localStorage 一个无意义的空白记录)
    if (isEmptyState(payload)) {
      return { ok: false, empty: true };
    }
    
    const result = window.Storage.save(payload);
    if (!result.ok) {
      console.warn('[storage] save failed:', result);
      if (result.error === 'too_large' || result.error === 'QuotaExceededError') {
        showToast('存储空间不足: ' + (result.message || '请删除部分上传图片'), 'error', 4000);
      }
      return result;
    }
    if (result.near_limit) {
      showToast(`存储接近上限 (${(result.size/1024/1024).toFixed(1)} MB / 4 MB)`, '', 3000);
    }
    return result;
  }
  
  function isEmptyState(s) {
    return (!s.rawReport || !s.rawReport.trim()) &&
           !s.planning &&
           !s.visualPlan &&
           (!s.attachments || s.attachments.length === 0) &&
           !s.settings?.audience &&
           !s.settings?.pages &&
           !s.settings?.special;
  }
  
  function scheduleSave(delay = 1500) {
    if (!saveEnabled) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }
  
  // 关闭浏览器时强制保存
  window.addEventListener('beforeunload', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveNow();
  });
  
  // 应用恢复的 state
  function restoreState(saved) {
    Object.assign(state, {
      currentStage: saved.currentStage || 'input',
      rawReport: saved.rawReport || '',
      attachments: saved.attachments || [],
      settings: saved.settings || { audience: '', pages: '', duration: '', special: '' },
      model: saved.model || 'deepseek',
      selectedDna: saved.selectedDna || state.selectedDna,
      planning: saved.planning || null,
      visualPlan: saved.visualPlan || null,
      selectedPageIdx: saved.selectedPageIdx || 0,
    });
    
    // 回填 UI
    $('raw-report').value = state.rawReport;
    $('setting-audience').value = state.settings.audience || '';
    $('setting-pages').value = state.settings.pages || '';
    $('setting-duration').value = state.settings.duration || '';
    $('setting-special').value = state.settings.special || '';
    $('model-selector').value = state.model;
    if (state.selectedDna) dnaSelect.value = state.selectedDna;
    renderAttachmentList();  // 渲染恢复的附件列表
    
    // 切到对应 stage
    if (state.currentStage === 'outline' && state.planning) {
      renderOutlineStage();
      setStage('outline');
    } else if (state.currentStage === 'preview' && state.visualPlan && state.selectedDna) {
      // 重新渲染 HTML
      try {
        const renderer = new window.CssRenderer(window.MANIFEST_REGISTRY);
        const result = renderer.render(state.visualPlan, state.selectedDna);
        state.generatedHtml = result.html;
        renderPreviewStage();
        setStage('preview');
        requestAnimationFrame(() => fitPreviewIframe());
        // 恢复到之前选的页
        if (state.selectedPageIdx > 0) {
          setTimeout(() => selectPage(state.selectedPageIdx), 600);
        }
      } catch (err) {
        console.error('[restore] preview rebuild failed:', err);
        setStage('input');
      }
    } else {
      setStage('input');
    }
  }
  
  // 启动: 检测有无缓存
  const cacheInfo = window.Storage.getInfo();
  if (cacheInfo.hasSaved) {
    saveEnabled = false;  // 防止 setStage('input') 覆盖缓存
    showRestoreBanner(cacheInfo);
  }
  
  function showRestoreBanner(info) {
    const banner = $('restore-banner');
    const meta = $('rb-meta');
    const summary = info.summary || {};
    const parts = [];
    parts.push(`保存于 ${window.Storage.formatSavedAt(info.savedAt)}`);
    if (summary.stage) {
      const stageNames = { input: '阶段 1', outline: '阶段 2', preview: '阶段 3' };
      parts.push(stageNames[summary.stage] || summary.stage);
    }
    if (summary.dna) parts.push(`DNA: ${summary.dna}`);
    if (summary.pageCount > 0) parts.push(`${summary.pageCount} 页`);
    parts.push(`${info.sizeMB} MB`);
    meta.textContent = parts.join(' · ');
    banner.hidden = false;
    
    $('btn-restore').addEventListener('click', () => {
      const saved = window.Storage.load();
      if (saved?.state) {
        saveEnabled = true;  // 恢复后重新开启 save
        restoreState(saved.state);
        banner.hidden = true;
        showToast('已恢复到上次工作', 'success');
      } else {
        saveEnabled = true;
        showToast('恢复失败', 'error');
      }
    }, { once: true });
    
    $('btn-discard').addEventListener('click', () => {
      if (confirm('丢弃后无法恢复,确定?')) {
        window.Storage.clear();
        saveEnabled = true;
        banner.hidden = true;
        showToast('已清空缓存', '', 2000);
      }
    }, { once: true });
    
    $('rb-close-btn').addEventListener('click', () => {
      // 用户暂时关闭 banner,但不丢弃 — 保持 save 禁用直到用户主动选择
      // 但我们其实应该让他继续工作时也能存,先保留之前的 save 状态
      // 简化:关闭按钮 = "稍后决定",保留 saveEnabled = false 不变(避免覆盖)
      banner.hidden = true;
      showToast('保留缓存,但不会自动保存新工作', '', 3500);
    }, { once: true });
  }
  
  // "新建工作" 按钮
  $('btn-new-work').addEventListener('click', () => {
    if (state.rawReport || state.planning || state.visualPlan) {
      if (!confirm('当前工作将被清空(已保存的缓存也会删除),确定开始新工作?')) {
        return;
      }
    }
    window.Storage.clear();
    saveEnabled = true;  // 新建后启用 save (即使之前 banner 在,也覆盖)
    // 重置 state
    state.rawReport = '';
    state.attachments = [];
    state.settings = { audience: '', pages: '', duration: '', special: '' };
    state.planning = null;
    state.visualPlan = null;
    state.generatedHtml = null;
    state.selectedPageIdx = 0;
    // 清 UI
    $('raw-report').value = '';
    $('setting-audience').value = '';
    $('setting-pages').value = '';
    $('setting-duration').value = '';
    $('setting-special').value = '';
    renderAttachmentList();  // 清空附件列表 UI
    // 关 banner 如果还在
    $('restore-banner').hidden = true;
    setStage('input');
    showToast('已新建工作', 'success', 2000);
  });

  // 初始 stage
  setStage('input');

  // ===== 附件管理 =====
  
  async function addAttachment(file) {
    // 同名替换
    state.attachments = state.attachments.filter(a => a.name !== file.name);
    
    const entry = {
      name: file.name,
      size: file.size,
      type: (file.name.split('.').pop() || '').toLowerCase(),
      text: '',
      wordCount: 0,
      status: 'parsing',
    };
    state.attachments.push(entry);
    renderAttachmentList();
    
    try {
      const result = await window.DocParser.parseFile(file);
      // 把解析结果合并进 entry
      Object.assign(entry, result, { status: result.error ? 'error' : 'ok' });
      renderAttachmentList();
      scheduleSave(2000);
      
      if (result.error) {
        showToast(`解析失败: ${result.error}`, 'error', 4000);
      } else {
        const pages = result.pageCount ? `${result.pageCount} 页` : 
                      result.slideCount ? `${result.slideCount} 幻灯片` : '';
        showToast(`已解析 ${file.name}: ${pages ? pages + ', ' : ''}${result.wordCount} 字`, 'success');
      }
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      renderAttachmentList();
      showToast('解析失败: ' + err.message, 'error', 4000);
    }
  }
  
  function removeAttachment(name) {
    state.attachments = state.attachments.filter(a => a.name !== name);
    renderAttachmentList();
    scheduleSave(1000);
  }
  
  function renderAttachmentList() {
    const list = $('attach-list');
    if (!list) return;
    list.innerHTML = '';
    
    for (const att of state.attachments) {
      const icon = {
        pdf: '📄',
        docx: '📝',
        pptx: '📊',
        md: '📑',
        markdown: '📑',
        txt: '📃',
      }[att.type] || '📎';
      
      const statusText = {
        parsing: '解析中…',
        ok: '已解析',
        error: '❌ ' + (att.error || '失败'),
      }[att.status] || '';
      
      const sizeStr = window.DocParser.formatSize(att.size);
      const metaParts = [sizeStr];
      if (att.pageCount) metaParts.push(`${att.pageCount} 页`);
      if (att.slideCount) metaParts.push(`${att.slideCount} 幻灯片`);
      if (att.wordCount) metaParts.push(`${att.wordCount} 字`);
      
      const item = document.createElement('div');
      item.className = `attach-item ${att.status}`;
      item.innerHTML = `
        <span class="attach-item-icon">${icon}</span>
        <div class="attach-item-info">
          <div class="attach-item-name">${escapeHTML(att.name)}</div>
          <div class="attach-item-meta">${metaParts.join(' · ')}</div>
        </div>
        <span class="attach-item-status">${statusText}</span>
        ${att.status === 'ok' ? `<button class="attach-item-preview" data-name="${escapeHTML(att.name)}">预览</button>` : ''}
        <button class="attach-item-remove" data-name="${escapeHTML(att.name)}">移除</button>
      `;
      list.appendChild(item);
    }
    
    // 绑定按钮
    list.querySelectorAll('.attach-item-remove').forEach(b => {
      b.addEventListener('click', () => removeAttachment(b.dataset.name));
    });
    list.querySelectorAll('.attach-item-preview').forEach(b => {
      b.addEventListener('click', () => previewAttachment(b.dataset.name));
    });
  }
  
  function previewAttachment(name) {
    const att = state.attachments.find(a => a.name === name);
    if (!att) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'attach-preview-overlay';
    overlay.innerHTML = `
      <div class="attach-preview-box">
        <div class="attach-preview-header">
          <h3>${escapeHTML(att.name)} · 解析结果</h3>
          <button class="ghost small">关闭</button>
        </div>
        <div class="attach-preview-text">${escapeHTML(att.text || '(空)')}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const close = () => overlay.remove();
    overlay.querySelector('button').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }
  
  // 绑定附件区
  const attachDrop = $('attach-drop');
  const attachInput = $('attach-input');
  
  if (attachDrop && attachInput) {
    attachDrop.addEventListener('click', (e) => {
      // 别在 file input 自身点击时再触发
      if (e.target.tagName !== 'INPUT') attachInput.click();
    });
    
    attachInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) addAttachment(f);
      e.target.value = '';
    });
    
    // 拖拽
    const enter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachDrop.classList.add('dragover');
    };
    const leave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachDrop.classList.remove('dragover');
    };
    const drop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachDrop.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) addAttachment(f);
    };
    attachDrop.addEventListener('dragover', enter);
    attachDrop.addEventListener('dragenter', enter);
    attachDrop.addEventListener('dragleave', leave);
    attachDrop.addEventListener('drop', drop);
  }

  // ===== 阶段 1: 输入 → outline =====
  $('btn-to-outline').addEventListener('click', async () => {
    // 收集输入
    state.rawReport = $('raw-report').value.trim();
    state.settings.audience = $('setting-audience').value.trim();
    state.settings.pages = $('setting-pages').value.trim();
    state.settings.duration = $('setting-duration').value.trim();
    state.settings.special = $('setting-special').value.trim();
    state.model = $('model-selector').value;
    state.password = $('password-input').value;

    // 至少要有一种内容来源:rawReport >= 100 字 或 已成功解析的附件
    const okAttachments = state.attachments.filter(a => a.status === 'ok' && a.text);
    const totalAttachmentChars = okAttachments.reduce((sum, a) => sum + (a.text?.length || 0), 0);
    
    if (state.rawReport.length < 100 && totalAttachmentChars < 100) {
      showToast('请提供报告原文(≥100 字)或上传附件', 'error');
      return;
    }
    
    // 仍解析中的附件提示
    const parsing = state.attachments.filter(a => a.status === 'parsing');
    if (parsing.length > 0) {
      showToast(`还有 ${parsing.length} 个附件解析中, 请稍候`, 'error');
      return;
    }

    showLoading('调用 content-planner 生成内容规划…');

    try {
      // 取 content-planner skill
      const skillRes = await fetch('/skills/content-planner.md');
      const skillText = await skillRes.text();

      // 构造 prompt
      const userPrompt = buildPlannerPrompt(state);

      const result = await llmCall({
        model: state.model,
        password: state.password,
        systemPrompt: skillText + '\n\n---\n\n注意:用户已提供受众和页数等信息,直接进入阶段二全局规划和阶段三逐页规划,不需要再问 3 个问题。' +
          '直接输出完整 planning.md,从 "# 报告 · PPT 内容规划" 开始,以 "## 逐页内容规划" 的最后一页结束。',
        userPrompt,
        temperature: 0.4,
        maxTokens: 12000,
        onProgress: (fullText) => {
          showLoading(`正在生成内容规划… 已写 ${fullText.length} 字`);
        },
      });

      if (!result.ok) {
        showToast('生成失败: ' + (result.error || 'unknown'), 'error', 4000);
        console.error(result);
        return;
      }

      // 解析 planning.md
      state.planning = parsePlanning(result.content);
      if (!state.planning || !state.planning.pages || state.planning.pages.length === 0) {
        showToast('解析 planning.md 失败,可能 LLM 输出格式不对', 'error', 4000);
        console.error('Planning content:', result.content);
        return;
      }

      renderOutlineStage();
      setStage('outline');

      if (result.mocked) {
        showToast('提示:本地环境使用 mock 数据 · 部署后调真实 LLM', '', 4000);
      } else {
        showToast(`生成完成 · 共 ${state.planning.pages.length} 页`, 'success');
      }
    } catch (err) {
      showToast('错误: ' + err.message, 'error', 4000);
      console.error(err);
    } finally {
      hideLoading();
    }
  });

  // ===== 阶段 2: outline → preview (并发分批 + 实时进度) =====
  // 全局并发控制状态
  let batchCancelled = false;
  let activeBatchPromises = [];

  $('btn-to-preview').addEventListener('click', async () => {
    if (!state.planning || !state.selectedDna) {
      showToast('请先选 DNA', 'error');
      return;
    }

    try {
      const skillRes = await fetch('/skills/visual-planner.md');
      const skillText = await skillRes.text();
      const manifest = window.MANIFEST_REGISTRY.getManifest(state.selectedDna);
      const allPages = state.planning.pages;
      const totalPages = allPages.length;

      // 并发参数(经验值, 后续可调)
      const CONCURRENCY = 4;
      const MAX_RETRY = 2;

      // 初始化占位 visualPlan: 每页一个占位项
      state.visualPlan = {
        global: { dna: state.selectedDna, total_pages: totalPages },
        pages: allPages.map((p, i) => ({
          slide: i + 1,
          variant_id: '?',
          page_role: p.page_role || '?',
          _status: 'pending', // pending / loading / ok / error
          _planning: p, // 保留 planning 数据供生成时用
          slots: {},
        })),
      };

      // 提前进入阶段 3, 让用户看到进度
      const renderer = new window.CssRenderer(window.MANIFEST_REGISTRY);
      state.generatedHtml = '<html><body><div style="padding:40px;color:#888;font-family:sans-serif">正在生成 PPT,请稍候…</div></body></html>';
      renderPreviewStage();
      setStage('preview');
      requestAnimationFrame(() => fitPreviewIframe());

      // 顶部进度条
      showProgressBar(0, totalPages);
      batchCancelled = false;

      // 单页生成函数
      const generateOnePage = async (pageIdx) => {
        if (batchCancelled) return { skipped: true };
        const planningPage = allPages[pageIdx];
        // 标记 loading
        markPageStatus(pageIdx, 'loading');

        const userPrompt = buildVisualPlannerPromptBatch(state, manifest, [planningPage], totalPages);

        let lastErr = null;
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
          if (batchCancelled) return { skipped: true };
          const result = await llmCall({
            model: state.model,
            password: state.password,
            systemPrompt: skillText,
            userPrompt,
            temperature: 0.3,
            maxTokens: 2500, // 单页, token 上限低
          });
          if (result.ok) {
            const parsed = parseYaml(result.content);
            if (parsed && parsed.pages && parsed.pages[0]) {
              return { ok: true, page: parsed.pages[0] };
            }
            lastErr = { error: 'parse_failed', content: result.content };
          } else {
            lastErr = result;
            // 致命错误不重试
            if (['wrong_password', 'api_key_not_configured', 'invalid_model'].includes(result.error)) {
              return { ok: false, error: result.error, message: result.message };
            }
          }
          if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 500));
        }
        return { ok: false, ...lastErr };
      };

      // 并发池: 限制同时跑的请求数
      const queue = Array.from({ length: totalPages }, (_, i) => i);
      let completed = 0;
      let failed = 0;
      const workers = [];

      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
          while (queue.length > 0 && !batchCancelled) {
            const pageIdx = queue.shift();
            const result = await generateOnePage(pageIdx);
            if (batchCancelled) return;

            if (result.skipped) continue;
            if (result.ok) {
              // 把生成的页填回 state.visualPlan
              const realPage = { ...result.page, slide: pageIdx + 1, _status: 'ok' };
              state.visualPlan.pages[pageIdx] = realPage;
              completed++;
              markPageStatus(pageIdx, 'ok', realPage);
              rerenderIframeIncrementally();
              // 如果这页是当前选中的, 刷新编辑面板
              if (state.selectedPageIdx === pageIdx && editPanel) {
                editPanel.renderForPage(state.visualPlan, pageIdx);
              }
            } else {
              failed++;
              state.visualPlan.pages[pageIdx]._status = 'error';
              state.visualPlan.pages[pageIdx]._error = result.message || result.error || 'unknown';
              markPageStatus(pageIdx, 'error');
            }
            updateProgressBar(completed + failed, totalPages, completed, failed);
          }
        })());
      }

      await Promise.all(workers);

      // 完成
      hideProgressBar();

      if (batchCancelled) {
        showToast(`已暂停 · 已生成 ${completed}/${totalPages} 页`, '', 4000);
      } else if (failed > 0) {
        showToast(`生成完成 · ${completed} 成功, ${failed} 失败(点击失败页可重试)`, '', 5000);
      } else {
        showToast(`✓ ${totalPages} 页全部生成成功`, 'success');
      }

      // 整体重渲染一次
      rerenderIframeIncrementally();
      scheduleSave(1000);
    } catch (err) {
      hideProgressBar();
      showToast('错误: ' + err.message, 'error', 4000);
      console.error(err);
    }
  });

  // 增量重渲染(只重新渲染所有已 ok 的页)
  function rerenderIframeIncrementally() {
    if (!state.visualPlan) return;
    // 过滤出已成功的页, 用 renderer 渲染
    const okPages = state.visualPlan.pages.filter(p => p._status === 'ok' || (!p._status && p.variant_id && p.variant_id !== '?'));
    if (okPages.length === 0) return;
    try {
      const renderer = new window.CssRenderer(window.MANIFEST_REGISTRY);
      const renderPlan = {
        global: state.visualPlan.global,
        pages: okPages.map((p, i) => ({ ...p, slide: i + 1 })),
      };
      const r = renderer.render(renderPlan, state.selectedDna);
      state.generatedHtml = r.html;
      const iframe = $('preview-iframe');
      if (iframe) iframe.srcdoc = r.html;
    } catch (e) {
      console.warn('增量渲染失败:', e);
    }
  }

  // 标记某页状态(更新缩略图视觉)
  function markPageStatus(pageIdx, status, pageData) {
    const items = qsa('.thumb-item');
    const item = items[pageIdx];
    if (!item) return;
    item.classList.remove('status-pending', 'status-loading', 'status-ok', 'status-error');
    item.classList.add('status-' + status);
    if (pageData) {
      // 更新 variant_id 显示
      const vidEl = item.querySelector('.ti-vid');
      if (vidEl) vidEl.textContent = pageData.variant_id || '?';
      const roleEl = item.querySelector('.ti-role');
      if (roleEl) roleEl.textContent = pageData.page_role || '';
    }
    // 失败页: 加 title 显示原因
    if (status === 'error') {
      const errMsg = state.visualPlan?.pages[pageIdx]?._error || '生成失败';
      item.title = '点击重试 · ' + errMsg;
    } else {
      item.removeAttribute('title');
    }
  }

  // 重试单页(失败页点击触发)
  async function retryPage(pageIdx) {
    if (!state.visualPlan || !state.planning) return;
    const planningPage = state.planning.pages[pageIdx];
    if (!planningPage) return;

    const skillRes = await fetch('/skills/visual-planner.md');
    const skillText = await skillRes.text();
    const manifest = window.MANIFEST_REGISTRY.getManifest(state.selectedDna);
    const totalPages = state.planning.pages.length;

    markPageStatus(pageIdx, 'loading');
    showToast(`重试第 ${pageIdx + 1} 页…`, '', 2000);

    const userPrompt = buildVisualPlannerPromptBatch(state, manifest, [planningPage], totalPages);
    const MAX_RETRY = 2;
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      const result = await llmCall({
        model: state.model, password: state.password,
        systemPrompt: skillText, userPrompt,
        temperature: 0.3, maxTokens: 2500,
      });
      if (result.ok) {
        const parsed = parseYaml(result.content);
        if (parsed && parsed.pages && parsed.pages[0]) {
          const realPage = { ...parsed.pages[0], slide: pageIdx + 1, _status: 'ok' };
          state.visualPlan.pages[pageIdx] = realPage;
          markPageStatus(pageIdx, 'ok', realPage);
          rerenderIframeIncrementally();
          if (state.selectedPageIdx === pageIdx && editPanel) {
            editPanel.renderForPage(state.visualPlan, pageIdx);
          }
          showToast(`第 ${pageIdx + 1} 页已生成`, 'success', 2500);
          scheduleSave(1000);
          return;
        }
        lastErr = { error: 'parse_failed' };
      } else lastErr = result;
      if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 500));
    }
    // 重试也失败
    state.visualPlan.pages[pageIdx]._status = 'error';
    state.visualPlan.pages[pageIdx]._error = lastErr?.message || lastErr?.error || 'unknown';
    markPageStatus(pageIdx, 'error');
    showToast(`第 ${pageIdx + 1} 页仍失败: ${lastErr?.error || ''}`, 'error', 4000);
  }

  // 进度条 UI
  function showProgressBar(done, total) {
    let bar = $('gen-progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'gen-progress-bar';
      bar.className = 'gen-progress-bar';
      bar.innerHTML = `
        <div class="gpb-content">
          <div class="gpb-info">
            <span class="gpb-text">准备生成…</span>
            <span class="gpb-stats"></span>
          </div>
          <div class="gpb-track"><div class="gpb-fill"></div></div>
          <button class="gpb-cancel" type="button">暂停</button>
        </div>
      `;
      document.body.appendChild(bar);
      bar.querySelector('.gpb-cancel').addEventListener('click', () => {
        batchCancelled = true;
        bar.querySelector('.gpb-cancel').textContent = '暂停中…';
      });
    }
    bar.style.display = 'block';
    updateProgressBar(done, total, 0, 0);
  }
  function updateProgressBar(done, total, ok, failed) {
    const bar = $('gen-progress-bar');
    if (!bar) return;
    const pct = total ? Math.round(done / total * 100) : 0;
    bar.querySelector('.gpb-fill').style.width = pct + '%';
    bar.querySelector('.gpb-text').textContent = `生成中… ${done}/${total} 页`;
    const stats = bar.querySelector('.gpb-stats');
    if (failed > 0) stats.innerHTML = `<span class="gpb-ok">${ok} 成功</span> · <span class="gpb-fail">${failed} 失败</span>`;
    else stats.textContent = ok > 0 ? `${ok} 成功` : '';
  }
  function hideProgressBar() {
    const bar = $('gen-progress-bar');
    if (bar) bar.style.display = 'none';
  }

  // ===== 阶段返回按钮 =====
  qsa('[data-back-to]').forEach(btn => {
    btn.addEventListener('click', () => setStage(btn.dataset.backTo));
  });

  // ===== 下载 HTML =====
  $('btn-download').addEventListener('click', () => {
    if (!state.generatedHtml) {
      showToast('还没生成 HTML', 'error');
      return;
    }
    const blob = new Blob([state.generatedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ppt-${state.selectedDna}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ===== 重新生成 =====
  $('btn-regenerate').addEventListener('click', () => {
    setStage('outline');
  });

  // ===== 全屏预览 =====
  const fullscreenPreview = new window.FullscreenPreview({
    getHtml: () => state.generatedHtml,
    getTotalPages: () => state.visualPlan?.pages.length || 0,
    getCurrentPageIdx: () => state.selectedPageIdx,
    setCurrentPageIdx: (idx) => {
      state.selectedPageIdx = idx;
      // 退出全屏时同步主视图
      const thumbs = qsa('.thumb-item');
      if (thumbs[idx]) selectPage(idx);
    },
  });

  $('btn-fullscreen').addEventListener('click', () => {
    if (!state.generatedHtml) {
      showToast('还没生成 PPT', 'error');
      return;
    }
    fullscreenPreview.enter();
  });

  // ===== 诊断 =====
  let lastDiagnoseIssues = [];
  const diagnostics = new window.Diagnostics({ registry: window.MANIFEST_REGISTRY });

  $('btn-diagnose').addEventListener('click', () => {
    if (!state.visualPlan) {
      showToast('还没生成 PPT', 'error');
      return;
    }
    runDiagnostics();
  });

  function runDiagnostics() {
    const iframe = $('preview-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) {
      showToast('iframe 未准备好', 'error');
      return;
    }
    
    const issues = diagnostics.scanAll(doc, state.visualPlan, state.selectedDna);
    lastDiagnoseIssues = issues;
    
    renderDiagnosticsPanel(issues);
    
    // 启用一键修复按钮
    const fixableCount = issues.filter(i => 
      ['shrink-font', 'shrink-text', 'z-index', 'reduce-content'].includes(i.fixHint)
    ).length;
    $('btn-autofix').disabled = fixableCount === 0;
    
    showToast(`扫描完成: ${issues.length} 个问题 (${fixableCount} 个可自动修复)`, 
              issues.length === 0 ? 'success' : '');
  }

  function renderDiagnosticsPanel(issues) {
    const panel = $('diagnostics-panel');
    panel.hidden = false;
    
    const errors = issues.filter(i => i.level === 'error');
    const warnings = issues.filter(i => i.level === 'warning');
    const infos = issues.filter(i => i.level === 'info');
    
    const summary = $('dp-summary');
    if (issues.length === 0) {
      summary.innerHTML = `<span class="dp-count ok">✓ 一切正常</span>`;
    } else {
      summary.innerHTML = `
        ${errors.length ? `<span class="dp-count error">● ${errors.length} 错误</span>` : ''}
        ${warnings.length ? `<span class="dp-count warning">▲ ${warnings.length} 警告</span>` : ''}
        ${infos.length ? `<span class="dp-count info">ⓘ ${infos.length} 提示</span>` : ''}
      `;
    }
    
    const list = $('dp-list');
    if (issues.length === 0) {
      list.innerHTML = `<div class="dp-empty">🎉 没有发现问题</div>`;
    } else {
      list.innerHTML = issues.slice(0, 50).map(issue => `
        <div class="dp-issue ${issue.level}" data-page="${issue.page}">
          <div class="dp-issue-header">
            <span class="dp-issue-page">P${issue.page}</span>
            <span class="dp-issue-type">${escapeHTML(issue.type)}</span>
            <span class="dp-issue-slot">${escapeHTML(issue.slot || '')}</span>
          </div>
          <div class="dp-issue-message">${escapeHTML(issue.message)}</div>
          ${issue.textPreview ? `<div class="dp-issue-preview">"${escapeHTML(issue.textPreview)}"</div>` : ''}
        </div>
      `).join('');
    }
    
    // 点击 issue 跳到对应页
    list.querySelectorAll('.dp-issue').forEach(el => {
      el.addEventListener('click', () => {
        const page = parseInt(el.dataset.page, 10);
        if (page >= 1) selectPage(page - 1);
      });
    });
  }

  // 关闭诊断面板
  qs('.dp-close')?.addEventListener('click', () => {
    $('diagnostics-panel').hidden = true;
  });

  // ===== 一键修复 =====
  $('btn-autofix').addEventListener('click', () => {
    if (lastDiagnoseIssues.length === 0) {
      showToast('没有可修复的问题, 先点诊断', 'error');
      return;
    }
    
    const iframe = $('preview-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return;
    
    const autofix = new window.AutoFix();
    const fixes = autofix.buildFixes(lastDiagnoseIssues, state.visualPlan);
    autofix.apply(doc, fixes);
    
    showToast(`已修复 ${fixes.fixed.length} 个问题, 跳过 ${fixes.skipped.length} 个`, 'success', 3500);
    
    // 修复后重新扫描
    setTimeout(() => {
      runDiagnostics();
    }, 200);
  });

  // ===== 渲染阶段 2 (outline) =====
  function renderOutlineStage() {
    const p = state.planning;

    $('summary-framework').textContent = p.framework || '—';
    $('summary-thesis').textContent = p.thesis || '—';

    const chaptersHtml = (p.chapters || []).map(c =>
      `${c.name} (${c.range})`
    ).join('  ·  ') || '—';
    $('summary-chapters').textContent = chaptersHtml;

    const list = $('outline-list');
    list.innerHTML = '';
    for (let i = 0; i < p.pages.length; i++) {
      const page = p.pages[i];
      const item = document.createElement('div');
      item.className = 'outline-item';
      item.innerHTML = `
        <div class="ol-idx">P${page.slide || i + 1}</div>
        <div class="ol-role">${escapeHTML(page.page_role || '—')}</div>
        <div class="ol-title">${escapeHTML(page.main_title || page.page_intent || '(无标题)')}</div>
        <div class="ol-meta">${page.items_count ? `${page.items_count} 项` : ''}</div>
      `;
      list.appendChild(item);
    }
  }

  // ===== 阶段 3 (preview) =====
  let editPanel = null;  // 在 renderPreviewStage 时创建
  let rerenderTimer = null;
  
  function renderPreviewStage() {
    // 缩略图列表
    const thumbList = $('thumb-list');
    thumbList.innerHTML = '';
    for (let i = 0; i < state.visualPlan.pages.length; i++) {
      const p = state.visualPlan.pages[i];
      const item = document.createElement('div');
      item.className = 'thumb-item';
      // 初始状态: 如果有 _status, 加对应 class
      if (p._status) item.classList.add('status-' + p._status);
      item.innerHTML = `
        <span class="ti-idx">${p.slide || i + 1}</span>
        <span class="ti-vid">${escapeHTML(p.variant_id || '?')}</span>
        <span class="ti-role">${escapeHTML(p.page_role || '')}</span>
      `;
      item.addEventListener('click', () => {
        // 失败页: 点击重试; 其他: 选中预览
        if (item.classList.contains('status-error')) {
          retryPage(i);
        } else {
          selectPage(i);
        }
      });
      thumbList.appendChild(item);
    }

    // iframe 注入 HTML
    const iframe = $('preview-iframe');
    iframe.srcdoc = state.generatedHtml;

    // 初始化编辑面板
    if (!editPanel) {
      editPanel = new window.EditPanel($('edit-panel'), {
        manifest: window.MANIFEST_REGISTRY.getManifest(state.selectedDna),
        onSlotsChange: (pageIdx) => {
          // 节流重渲染整个 PPT (iframe srcdoc)
          if (rerenderTimer) clearTimeout(rerenderTimer);
          rerenderTimer = setTimeout(() => {
            rerenderIframe();
          }, 300);
          // 编辑也持久化(更长延迟避免频繁写盘)
          scheduleSave(2000);
        },
        onAiRewrite: (pageIdx) => {
          aiRewritePage(pageIdx);
        },
      });
    } else {
      editPanel.updateManifest(window.MANIFEST_REGISTRY.getManifest(state.selectedDna));
    }

    selectPage(0);
    iframe.addEventListener('load', () => {
      setTimeout(() => scrollIframeToPage(0), 200);
    });
  }
  
  // 重渲染 iframe (从 visualPlan 重新跑 renderer)
  function rerenderIframe() {
    if (!state.visualPlan) return;
    try {
      const renderer = new window.CssRenderer(window.MANIFEST_REGISTRY);
      const renderResult = renderer.render(state.visualPlan, state.selectedDna);
      state.generatedHtml = renderResult.html;
      const iframe = $('preview-iframe');
      // 保留当前滚动位置 (基于 page idx)
      const curIdx = state.selectedPageIdx;
      iframe.srcdoc = state.generatedHtml;
      // load 完成后滚到当前页
      iframe.addEventListener('load', function once() {
        setTimeout(() => scrollIframeToPage(curIdx), 150);
        iframe.removeEventListener('load', once);
      });
    } catch (err) {
      showToast('重渲染失败: ' + err.message, 'error');
      console.error(err);
    }
  }
  
  // AI 重写本页 (调 visual-planner 单页模式)
  async function aiRewritePage(pageIdx) {
    if (!state.visualPlan || !state.visualPlan.pages[pageIdx]) {
      showToast('页不存在', 'error');
      return;
    }
    const page = state.visualPlan.pages[pageIdx];
    
    showLoading(`AI 重写第 ${pageIdx + 1} 页…`);
    try {
      const skillRes = await fetch('/skills/visual-planner.md');
      const skillText = await skillRes.text();
      const manifest = window.MANIFEST_REGISTRY.getManifest(state.selectedDna);
      const variant = manifest.variants.find(v => v.id === page.variant_id);
      
      const userPrompt = `# 任务: 重写单页 visual_plan

## DNA
${state.selectedDna}

## 该页当前 yaml
\`\`\`yaml
${jsonToYamlSimple(page)}
\`\`\`

## variant 定义(仅本页用)
\`\`\`json
${JSON.stringify(variant, null, 2)}
\`\`\`

请保持 variant_id 不变, 重写 director_note + slots 的内容, 让本页更精彩。直接输出 yaml(从 "slide:" 开始), 不要 markdown 包裹。`;

      const result = await llmCall({
        model: state.model,
        password: state.password,
        systemPrompt: skillText,
        userPrompt,
        temperature: 0.5,
        maxTokens: 4000,
      });
      
      if (!result.ok) {
        showToast('AI 重写失败: ' + (result.error || ''), 'error', 4000);
        return;
      }
      
      const newPage = window.__pipeline.parseYaml(result.content);
      if (newPage && newPage.variant_id) {
        state.visualPlan.pages[pageIdx] = newPage;
        rerenderIframe();
        editPanel.renderForPage(state.visualPlan, pageIdx);
        showToast('重写完成', 'success');
      } else {
        showToast('AI 输出格式不对', 'error');
        console.error('AI 输出:', result.content);
      }
    } catch (err) {
      showToast('错误: ' + err.message, 'error');
      console.error(err);
    } finally {
      hideLoading();
    }
  }
  
  // 极简 obj → yaml (用于 prompt, 不要求完全标准)
  function jsonToYamlSimple(obj, indent = 0) {
    const ind = '  '.repeat(indent);
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'string') {
      // 多行字符串用 | 风格
      if (obj.includes('\n')) {
        return '|\n' + obj.split('\n').map(l => '  '.repeat(indent + 1) + l).join('\n');
      }
      // 含特殊字符的字符串加引号
      if (/[:#\-?*&!,\[\]{}|>%@`]/.test(obj) || obj.match(/^\s/) || obj.match(/\s$/)) {
        return '"' + obj.replace(/"/g, '\\"') + '"';
      }
      return obj;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      return '\n' + obj.map(item => {
        const itemYaml = jsonToYamlSimple(item, indent + 1);
        if (typeof item === 'object' && item !== null) {
          // 对象列表项
          return ind + '- ' + itemYaml.replace(/^\n*/, '').replace(/\n/g, '\n  ');
        }
        return ind + '- ' + itemYaml;
      }).join('\n');
    }
    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      return '\n' + entries.map(([k, v]) => {
        const vYaml = jsonToYamlSimple(v, indent + 1);
        return ind + k + ': ' + vYaml;
      }).join('\n');
    }
    return String(obj);
  }

  // 在 setStage('preview') 之后调一次, 此时 layout 才生效
  function fitPreviewIframe() {
    const wrap = qs('.preview-iframe-wrap');
    const frame = qs('.preview-iframe-frame');
    if (!wrap || !frame) return;
    
    const containerWidth = wrap.clientWidth - 32; // padding
    const containerHeight = wrap.clientHeight - 32;
    
    const scaleW = containerWidth / 1280;
    const scaleH = containerHeight / 720;
    const scale = Math.min(1, scaleW, scaleH);
    
    frame.style.transform = `scale(${scale})`;
    // 缩放后占位变小, 用 margin 补偿 (避免空白)
    frame.style.marginBottom = `-${720 * (1 - scale)}px`;
    
    console.log('[preview] fit scale:', scale, 'wrap:', containerWidth, 'x', containerHeight);
  }

  function selectPage(idx) {
    state.selectedPageIdx = idx;
    qsa('.thumb-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    $('preview-title').textContent = `第 ${idx + 1} 页`;
    scrollIframeToPage(idx);
    
    // 通知编辑面板渲染当前页
    if (editPanel) {
      editPanel.renderForPage(state.visualPlan, idx);
    }
  }

  function scrollIframeToPage(idx) {
    const iframe = $('preview-iframe');
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const slides = doc.querySelectorAll('.slide');
      if (slides[idx]) {
        // 用 instant 而非 smooth, 因为 iframe 刚 load 时 smooth 可能不生效
        slides[idx].scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    } catch (e) {
      // 跨域或还没 load 完, 忽略
    }
  }

  // ===== prompt builders =====

  function buildPlannerPrompt(state) {
    const settings = [
      state.settings.audience && `受众:${state.settings.audience}`,
      state.settings.pages && `页数:${state.settings.pages}`,
      state.settings.duration && `时长:${state.settings.duration}`,
      state.settings.special && `特殊要求:${state.settings.special}`,
    ].filter(Boolean).join('\n');

    // 拼附件文本
    const okAttachments = (state.attachments || []).filter(a => a.status === 'ok' && a.text);
    let attachmentsBlock = '';
    if (okAttachments.length > 0) {
      attachmentsBlock = '\n\n## 附件材料\n\n' + okAttachments.map((a, i) => {
        const tag = a.pageCount ? `${a.pageCount} 页` : 
                    a.slideCount ? `${a.slideCount} 幻灯片` : `${a.wordCount} 字`;
        return `### 附件 ${i + 1}: ${a.name} (${tag})\n\n${a.text}`;
      }).join('\n\n---\n\n');
    }

    const reportBlock = state.rawReport.trim()
      ? `## 报告原文\n\n${state.rawReport}`
      : (okAttachments.length > 0 
          ? '## 报告原文\n\n(用户没有提供独立报告原文,请基于下方上传的附件材料生成 PPT)'
          : '## 报告原文\n\n(无内容)');

    return `# 我要把以下报告做成 PPT

## 受众和需求
${settings || '受众:通用商业受众 / 页数:12-16 页 / 时长:20-25 分钟'}

${reportBlock}${attachmentsBlock}

---

请按 content-planner skill 的工作流程,直接产出完整的 planning.md(从 "# 报告 · PPT 内容规划" 标题开始)。不需要再问我任何问题。`;
  }

  // 分批版: 只为指定的几页生成 visual_plan (方案 Y)
  function buildVisualPlannerPromptBatch(state, manifest, batchPages, totalPages) {
    const dnaInfo = {
      id: manifest.dna.id,
      name: manifest.dna.name,
      tagline: manifest.dna.tagline,
    };
    const variantsSummary = manifest.variants.map(v => ({
      id: v.id,
      page_role: v.page_role,
      描述: v['描述'],
      什么时候用: v['什么时候用'],
      slots: Object.keys(v.slots || {}),
    }));

    // 该批页面的 planning 文本(只取这几页)
    const batchPlanningText = batchPages.map(p => {
      const slotsHint = p.content_elements ? JSON.stringify(p.content_elements, null, 2) : '';
      return `### 第 ${p.slide} 页\n` +
             (p.page_intent ? `叙事目标: ${p.page_intent}\n` : '') +
             (p.page_role ? `page_role: ${p.page_role}\n` : '') +
             (p.raw_block || slotsHint || JSON.stringify(p, null, 2));
    }).join('\n\n');

    const slideNums = batchPages.map(p => p.slide).join(', ');

    return `# 任务:为指定的几页选 variant + 生成 visual_plan.yaml(分批模式)

## DNA(已确定,不要重选)
\`\`\`json
${JSON.stringify(dnaInfo, null, 2)}
\`\`\`

## 该 DNA 的 variants 清单
\`\`\`json
${JSON.stringify(variantsSummary, null, 2)}
\`\`\`

## 本批要生成的页面(共 ${batchPages.length} 页,整份 PPT 共 ${totalPages} 页)

${batchPlanningText}

---

请只为上面列出的第 ${slideNums} 页生成 visual_plan:
1. DNA 已定为 ${dnaInfo.id},不要重选
2. 每页从 variants 清单挑 page_role 匹配的最合适 variant
3. 撰写 director_note
4. 按 variant 的 slots 定义,用页面内容填充每个 slot(slot 名必须和清单里的完全一致)
5. 每页的 slide 字段必须用上面给定的页码(${slideNums})

输出格式:从 "global:" 开始的纯 YAML,pages 数组只含本批 ${batchPages.length} 页。不要 markdown 代码块包裹,yaml 块内必须是纯 yaml。`;
  }

  function buildVisualPlannerPrompt(state, manifest) {
    // 只挑必要的 manifest 字段,避免过大
    const dnaInfo = {
      id: manifest.dna.id,
      name: manifest.dna.name,
      tagline: manifest.dna.tagline,
      适用场景: manifest.dna['适用场景'],
    };
    const variantsSummary = manifest.variants.map(v => ({
      id: v.id,
      page_role: v.page_role,
      描述: v['描述'],
      什么时候用: v['什么时候用'],
      什么时候不用: v['什么时候不用'],
      数量约束: v['数量约束'],
      slots: Object.keys(v.slots || {}),
    }));

    return `# 任务:为 planning.md 选 variant + 写 director_note + 生成 visual_plan.yaml

## DNA(已由上游确定)
\`\`\`json
${JSON.stringify(dnaInfo, null, 2)}
\`\`\`

## 该 DNA 的 variants 清单
\`\`\`json
${JSON.stringify(variantsSummary, null, 2)}
\`\`\`

## planning.md 原文

${state.planning.raw}

---

请按 visual-planner skill 的工作流程:
1. 不要重选 DNA(已定为 ${dnaInfo.id})
2. 为 planning.md 每页, 从 variants 清单里挑 page_role 匹配的最合适 variant
3. 撰写 director_note
4. 按每个 variant 的 slots 定义, 用 planning.md 的内容填充 slot

输出格式:从 "global:" 开始的 YAML 文本,不要有任何其他说明或 markdown 代码块包裹。如果非要用 markdown,只能在 yaml 块外做,yaml 块内必须是纯 yaml。`;
  }

  // ===== 解析器 =====

  /**
   * 解析 planning.md 文本
   * 提取: framework, thesis, chapters, pages (slide / page_role / main_title / items_count / page_intent)
   */
  function parsePlanning(md) {
    const result = {
      raw: md,
      framework: '',
      thesis: '',
      chapters: [],
      pages: [],
    };

    // 叙事框架
    const fwMatch = md.match(/##+\s*叙事框架[^\n]*\n+([^#]+)/);
    if (fwMatch) {
      const lines = fwMatch[1].trim().split('\n').filter(Boolean);
      result.framework = lines[0]?.replace(/^选择[::\s]*/, '').trim() || '';
    }

    // 核心论点
    const tMatch = md.match(/##+\s*核心论点[^\n]*\n+([^#]+)/);
    if (tMatch) {
      result.thesis = tMatch[1].trim().split('\n')[0];
    }

    // 章节结构 (table)
    const chMatch = md.match(/##+\s*章节结构[^\n]*\n+([^#]+)/);
    if (chMatch) {
      const lines = chMatch[1].trim().split('\n').filter(l => l.includes('|'));
      // 跳过 header 和 separator
      for (const line of lines.slice(2)) {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          result.chapters.push({ name: cells[0], range: cells[1] });
        }
      }
    }

    // 逐页规划: 找所有 "### 第 N 页" 块
    const pageBlocks = md.split(/^###\s+第\s*\d+\s*页/m);
    for (let i = 1; i < pageBlocks.length; i++) {
      const block = pageBlocks[i];
      const page = parsePlanningPage(block, i);
      if (page) result.pages.push(page);
    }

    // 兜底: 如果上面没解析到, 尝试找所有 ```yaml ``` 块
    if (result.pages.length === 0) {
      const yamlBlocks = md.match(/```yaml[\s\S]*?```/g) || [];
      for (const yb of yamlBlocks) {
        const yamlText = yb.replace(/```yaml\s*/, '').replace(/```\s*$/, '');
        const parsed = parseYaml(yamlText);
        if (parsed && parsed.slide) result.pages.push(parsed);
      }
    }

    return result;
  }

  function parsePlanningPage(block, idx) {
    const page = { slide: idx, raw_block: block.trim() };
    // page_intent
    const intentMatch = block.match(/\*\*叙事目标\*\*[::]?\s*[::]?\s*\n?([^\n]+)/);
    if (intentMatch) page.page_intent = intentMatch[1].trim();
    
    // yaml block
    const yamlMatch = block.match(/```yaml([\s\S]*?)```/);
    if (yamlMatch) {
      const parsed = parseYaml(yamlMatch[1]);
      if (parsed) {
        Object.assign(page, parsed);
        if (parsed.content_elements) {
          page.main_title = parsed.content_elements.main_title;
          page.items_count = parsed.content_elements.items_count;
        }
      }
    }
    
    return page;
  }

  /**
   * 极简 YAML 解析器(只处理 manifest 范围内的子集)
   *
   * 支持: 嵌套 dict / list / 字符串 / 数字 / boolean
   * 不支持: anchor / merge key / 复杂引号转义
   */
  function parseYaml(text) {
    try {
      // 用 js-yaml 的简化版,自己写
      // 但鉴于复杂度, 我们用一个简单递归下降解析器
      return yamlParseSimple(text);
    } catch (e) {
      console.error('parseYaml error:', e);
      return null;
    }
  }

  // 简单 YAML 解析器(支持嵌套 dict/list, 不支持高级特性)
  function yamlParseSimple(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
    
    function getIndent(line) {
      const m = line.match(/^( *)/);
      return m[1].length;
    }
    
    function parseValue(v) {
      v = v.trim();
      if (v === '') return null;
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (v === 'null' || v === '~') return null;
      if (/^-?\d+$/.test(v)) return parseInt(v, 10);
      if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
      // 去掉两侧的引号
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      return v;
    }
    
    // 递归
    function parseBlock(startLine, baseIndent) {
      // 先看第一个非空行是 list (-) 还是 dict (key:)
      let i = startLine;
      while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++;
      if (i >= lines.length) return [null, i];
      
      const indent = getIndent(lines[i]);
      if (indent < baseIndent) return [null, startLine];
      
      const isList = lines[i].trim().startsWith('- ') || lines[i].trim() === '-';
      
      if (isList) {
        const arr = [];
        while (i < lines.length) {
          const line = lines[i];
          if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
          const cur = getIndent(line);
          if (cur < indent) break;
          if (cur === indent && line.trim().startsWith('-')) {
            // 一个 list item
            const itemContent = line.trim().substring(1).trim();
            if (itemContent === '' || itemContent === '-') {
              // 这个 item 是嵌套 block
              const [child, next] = parseBlock(i + 1, indent + 2);
              arr.push(child);
              i = next;
            } else if (itemContent.includes(':') && !itemContent.startsWith('"') && !itemContent.startsWith("'")) {
              // item 是一个 inline dict, 第一个 key 在同行
              // 比如 "- name: Alice"  → 然后下面可能还有更多 key
              // 把 "- " 之后的内容当作一行 key:value 处理, 后续同 indent 的也属于这个 item
              const obj = {};
              const colonIdx = itemContent.indexOf(':');
              const k = itemContent.substring(0, colonIdx).trim();
              const v = itemContent.substring(colonIdx + 1).trim();
              if (v === '') {
                // 下面是 nested block
                const [child, next] = parseBlock(i + 1, indent + 2);
                obj[k] = child;
                i = next;
              } else {
                obj[k] = parseValue(v);
                i++;
              }
              // 继续读 itemIndent (indent + 2) 的后续 keys
              const itemIndent = indent + 2;
              while (i < lines.length) {
                const l2 = lines[i];
                if (l2.trim() === '' || l2.trim().startsWith('#')) { i++; continue; }
                const ci = getIndent(l2);
                if (ci < itemIndent) break;
                if (ci > itemIndent) {
                  // shouldn't happen
                  i++;
                  continue;
                }
                if (l2.trim().startsWith('-')) break;
                // key: value
                const stripped = l2.trim();
                const colon2 = stripped.indexOf(':');
                if (colon2 < 0) { i++; continue; }
                const k2 = stripped.substring(0, colon2).trim();
                const v2 = stripped.substring(colon2 + 1).trim();
                if (v2 === '' || v2 === '|' || v2 === '>') {
                  const [child, next] = parseBlock(i + 1, itemIndent + 2);
                  obj[k2] = v2 === '|' ? blockScalar(lines, i + 1, itemIndent + 2)[0] : child;
                  i = v2 === '|' ? blockScalar(lines, i + 1, itemIndent + 2)[1] : next;
                } else {
                  obj[k2] = parseValue(v2);
                  i++;
                }
              }
              arr.push(obj);
            } else {
              // item 是 scalar
              arr.push(parseValue(itemContent));
              i++;
            }
          } else {
            break;
          }
        }
        return [arr, i];
      } else {
        // dict
        const obj = {};
        while (i < lines.length) {
          const line = lines[i];
          if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
          const cur = getIndent(line);
          if (cur < indent) break;
          if (cur > indent) { i++; continue; }
          const stripped = line.trim();
          const colon = stripped.indexOf(':');
          if (colon < 0) { i++; continue; }
          const k = stripped.substring(0, colon).trim();
          const v = stripped.substring(colon + 1).trim();
          if (v === '' || v === '|' || v === '>') {
            if (v === '|') {
              const [blk, next] = blockScalar(lines, i + 1, indent + 2);
              obj[k] = blk;
              i = next;
            } else {
              const [child, next] = parseBlock(i + 1, indent + 2);
              obj[k] = child;
              i = next;
            }
          } else {
            obj[k] = parseValue(v);
            i++;
          }
        }
        return [obj, i];
      }
    }
    
    function blockScalar(lines, startLine, baseIndent) {
      // 收集所有缩进 >= baseIndent 的行,拼接
      const collected = [];
      let i = startLine;
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') {
          collected.push('');
          i++;
          continue;
        }
        if (getIndent(line) < baseIndent) break;
        collected.push(line.substring(baseIndent));
        i++;
      }
      // 去除尾部空行
      while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
      return [collected.join('\n'), i];
    }
    
    const [result] = parseBlock(0, 0);
    return result;
  }

  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 全局暴露 state(调试用)
  window.__pipeline = { state, setStage, parseYaml: yamlParseSimple, parsePlanning, fitPreviewIframe };

  // resize 时重新 fit iframe
  window.addEventListener('resize', () => {
    if (state.currentStage === 'preview') fitPreviewIframe();
  });

  console.log('[pipeline] ready, stage:', state.currentStage);
})();
