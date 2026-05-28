/**
 * edit-panel.js · 单页编辑面板
 *
 * 职责:
 *   1. 给定 visualPlan + selectedPageIdx, 渲染右侧编辑表单
 *   2. 每种 slot 类型生成不同 UI
 *   3. 用户编辑时, 直接修改 visualPlan.pages[i].slots 引用
 *   4. 节流回调通知主流程重渲染 iframe
 *
 * 用法:
 *   const ep = new EditPanel(rootEl, {
 *     manifest: ...,
 *     onSlotsChange: (pageIdx) => { ... },
 *     onAiRewrite: (pageIdx) => { ... },
 *   });
 *   ep.renderForPage(visualPlan, pageIdx);
 */

class EditPanel {
  constructor(rootEl, options) {
    this.root = rootEl;
    this.manifest = options.manifest;
    this.onSlotsChange = options.onSlotsChange || (() => {});
    this.onAiRewrite = options.onAiRewrite || (() => {});
    this.currentPlan = null;
    this.currentPageIdx = -1;
    this._changeTimer = null;
  }

  updateManifest(manifest) {
    this.manifest = manifest;
  }

  renderForPage(visualPlan, pageIdx) {
    this.currentPlan = visualPlan;
    this.currentPageIdx = pageIdx;
    
    const page = visualPlan.pages[pageIdx];
    if (!page) {
      this.root.innerHTML = '<p class="ep-empty">该页不存在</p>';
      return;
    }
    
    const variant = this._findVariant(page.variant_id);
    if (!variant) {
      this.root.innerHTML = `<p class="ep-empty">variant ${page.variant_id} 不在 manifest 中</p>`;
      return;
    }
    
    // 构建表单
    const html = `
      <div class="ep-header">
        <div class="ep-meta">
          <span class="ep-pageno">第 ${page.slide || pageIdx + 1} 页</span>
          <span class="ep-variant">${this._esc(page.variant_id)}</span>
          <span class="ep-role">${this._esc(page.page_role || '')}</span>
        </div>
        <p class="ep-variant-desc">${this._esc((variant['描述'] || '').substring(0, 80))}</p>
      </div>
      
      <div class="ep-actions">
        <button class="ghost small ep-ai-rewrite" type="button">✨ AI 重写本页</button>
      </div>
      
      <div class="ep-fields">
        ${this._renderFields(page, variant)}
      </div>
    `;
    
    this.root.innerHTML = html;
    this._wireEvents();
  }
  
  // ===== 字段渲染 =====
  
  _renderFields(page, variant) {
    const slots = variant.slots || {};
    const slotValues = page.slots || {};
    let html = '';
    
    // 普通 slot
    for (const [slotName, slotDef] of Object.entries(slots)) {
      const value = slotValues[slotName];
      const type = slotDef['类型'];
      html += this._renderField(slotName, slotDef, value);
    }
    
    // 图片占位 (在 manifest 的 "图片占位[]" 中, 不是 slots)
    for (const ip of (variant['图片占位'] || [])) {
      const slotName = ip['yaml key'];
      const value = slotValues[slotName];
      html += this._renderImageField(slotName, ip, value);
    }
    
    return html || '<p class="ep-empty">该 variant 无可编辑字段</p>';
  }
  
  _renderField(slotName, slotDef, value) {
    const type = slotDef['类型'];
    const desc = slotDef['描述'] || '';
    const maxLen = slotDef['最大字数'] || '';
    
    const labelHtml = `
      <div class="ep-field-label">
        <strong>${this._esc(slotName)}</strong>
        <span class="ep-type-tag">${this._esc(type)}</span>
        ${maxLen ? `<span class="ep-max">最多 ${maxLen} 字</span>` : ''}
      </div>
      ${desc ? `<p class="ep-desc">${this._esc(desc)}</p>` : ''}
    `;
    
    if (type === '纯文本') {
      return `
        <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="text">
          ${labelHtml}
          <input type="text" class="ep-input" value="${this._esc(value || '')}">
        </div>
      `;
    }
    
    if (type === '富文本') {
      return `
        <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="rich">
          ${labelHtml}
          <textarea class="ep-input ep-input-rich" rows="2">${this._esc(value || '')}</textarea>
          <p class="ep-hint">支持: &lt;em&gt; &lt;strong&gt; &lt;br&gt; &lt;span class="accent-word"&gt;</p>
        </div>
      `;
    }
    
    if (type === '组合字段') {
      return this._renderCompositeField(slotName, slotDef, value);
    }
    
    if (type === '同质列表') {
      return this._renderHomogeneousList(slotName, slotDef, value);
    }
    
    if (type === '重复列表') {
      return this._renderRepeatingList(slotName, slotDef, value);
    }
    
    if (type === '图表') {
      return `
        <div class="ep-field ep-field-disabled" data-slot="${this._esc(slotName)}" data-type="chart">
          ${labelHtml}
          <p class="ep-hint">图表编辑下个版本上线。修改请下载 HTML 后手动改 yaml。</p>
        </div>
      `;
    }
    
    return `
      <div class="ep-field ep-field-disabled" data-slot="${this._esc(slotName)}">
        ${labelHtml}
        <p class="ep-hint">未支持的字段类型: ${this._esc(type)}</p>
      </div>
    `;
  }
  
  _renderCompositeField(slotName, slotDef, value) {
    value = value || {};
    const subFields = slotDef['子字段'] || {};
    
    let inner = '';
    // 用 manifest 定义的 子字段 keys 优先, 不在的从 value 推
    const allKeys = [...new Set([...Object.keys(subFields), ...Object.keys(value)])];
    
    for (const subKey of allKeys) {
      const subDef = subFields[subKey] || {};
      const subVal = value[subKey] ?? '';
      inner += `
        <div class="ep-sub">
          <label>${this._esc(subKey)}${subDef['描述'] ? ` · ${this._esc(subDef['描述'])}` : ''}</label>
          <input type="text" class="ep-input ep-sub-input" 
                 data-sub="${this._esc(subKey)}" value="${this._esc(subVal)}">
        </div>
      `;
    }
    
    return `
      <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="composite">
        <div class="ep-field-label">
          <strong>${this._esc(slotName)}</strong>
          <span class="ep-type-tag">组合字段</span>
        </div>
        <div class="ep-composite">${inner}</div>
      </div>
    `;
  }
  
  _renderHomogeneousList(slotName, slotDef, value) {
    value = Array.isArray(value) ? value : [];
    const items = value.map((v, i) => `
      <div class="ep-li" data-idx="${i}">
        <input type="text" class="ep-input ep-li-input" value="${this._esc(v)}">
      </div>
    `).join('');
    
    return `
      <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="list-homo">
        <div class="ep-field-label">
          <strong>${this._esc(slotName)}</strong>
          <span class="ep-type-tag">同质列表 · ${value.length} 项</span>
        </div>
        <div class="ep-list">${items}</div>
      </div>
    `;
  }
  
  _renderRepeatingList(slotName, slotDef, value) {
    value = Array.isArray(value) ? value : [];
    
    const items = value.map((item, i) => {
      const isFeatured = item._featured === true;
      const subKeys = Object.keys(item).filter(k => k !== '_featured');
      const subInputs = subKeys.map(k => {
        const v = item[k];
        if (typeof v === 'string') {
          return `
            <div class="ep-sub">
              <label>${this._esc(k)}</label>
              <input type="text" class="ep-input ep-rl-sub" data-sub="${this._esc(k)}" value="${this._esc(v)}">
            </div>
          `;
        }
        if (Array.isArray(v)) {
          // 嵌套同质列表(只读显示, 复杂编辑下版本)
          return `
            <div class="ep-sub">
              <label>${this._esc(k)} <span class="ep-hint-inline">(${v.length} 项, 下版本可编辑)</span></label>
              <div class="ep-readonly">${this._esc(v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' · '))}</div>
            </div>
          `;
        }
        if (typeof v === 'object' && v !== null) {
          // 嵌套组合字段, 展开
          const sub2Keys = Object.keys(v);
          const sub2Inputs = sub2Keys.map(sk => `
            <div class="ep-sub-nested">
              <label>${this._esc(sk)}</label>
              <input type="text" class="ep-input ep-rl-sub-nested" 
                     data-sub="${this._esc(k)}" data-sub2="${this._esc(sk)}" 
                     value="${this._esc(v[sk] || '')}">
            </div>
          `).join('');
          return `
            <div class="ep-sub">
              <label>${this._esc(k)} <span class="ep-hint-inline">(嵌套字段)</span></label>
              <div class="ep-nested-group">${sub2Inputs}</div>
            </div>
          `;
        }
        return '';
      }).join('');
      
      return `
        <div class="ep-item ${isFeatured ? 'featured' : ''}" data-idx="${i}">
          <div class="ep-item-header">
            <span class="ep-item-no">${i + 1}</span>
            <button type="button" class="ep-featured-toggle" data-idx="${i}" title="切换 featured">
              ${isFeatured ? '★' : '☆'}
            </button>
            <span class="ep-item-summary">${this._summarize(item)}</span>
          </div>
          <div class="ep-item-body">${subInputs}</div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="list-rep">
        <div class="ep-field-label">
          <strong>${this._esc(slotName)}</strong>
          <span class="ep-type-tag">重复列表 · ${value.length} 项</span>
        </div>
        <div class="ep-list ep-list-rep">${items}</div>
      </div>
    `;
  }
  
  _renderImageField(slotName, phInfo, value) {
    value = value || {};
    const isArray = Array.isArray(value);
    
    if (isArray) {
      // 多图字段
      const items = value.map((img, i) => `
        <div class="iu-image-field" data-img-idx="${i}">
          <div class="ep-sub">
            <label>图 ${i + 1}</label>
            ${this._renderImageDropZone(img, i)}
          </div>
        </div>
      `).join('');
      return `
        <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="image-list">
          <div class="ep-field-label">
            <strong>${this._esc(slotName)}</strong>
            <span class="ep-type-tag">图片 × ${value.length}</span>
          </div>
          <div class="ep-img-list">${items}</div>
        </div>
      `;
    }

    return `
      <div class="ep-field" data-slot="${this._esc(slotName)}" data-type="image">
        <div class="ep-field-label">
          <strong>${this._esc(slotName)}</strong>
          <span class="ep-type-tag">图片</span>
        </div>
        <div class="iu-image-field">
          ${this._renderImageDropZone(value, null)}
          <div class="ep-sub">
            <label>alt 文本(可选)</label>
            <input type="text" class="ep-input ep-img-alt" value="${this._esc(value.alt || '')}" placeholder="图片描述,SEO 与无障碍用">
          </div>
          <div class="ep-sub">
            <label>image_fit</label>
            <select class="ep-input ep-img-fit">
              <option value="cover" ${value.image_fit === 'cover' || !value.image_fit ? 'selected' : ''}>cover (填满,裁切多余)</option>
              <option value="contain" ${value.image_fit === 'contain' ? 'selected' : ''}>contain (完整,留白)</option>
              <option value="scale-down" ${value.image_fit === 'scale-down' ? 'selected' : ''}>scale-down (小图不放大)</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  _renderImageDropZone(value, listIdx) {
    const url = (value && value.url) || '';
    const hasImage = !!url;
    const isDataUrl = url.startsWith('data:');
    const meta = value && value._meta ? value._meta : null;
    
    const idxAttr = listIdx != null ? `data-list-idx="${listIdx}"` : '';
    
    if (hasImage) {
      // 已有图: 显示缩略图 + 信息 + 操作
      const sizeStr = meta?.size ? window.ImageUploader.formatSize(meta.size) : '';
      const dimStr = meta?.width ? `${meta.width}×${meta.height}` : '';
      const fileName = meta?.name || (isDataUrl ? '(已上传)' : url.substring(0, 32));
      const compressedBadge = meta?.compressed ? '<span class="iu-badge">已压缩</span>' : '';
      
      return `
        <div class="iu-preview" ${idxAttr}>
          <div class="iu-preview-row">
            <img class="iu-thumb" src="${this._esc(url)}" alt="">
            <div class="iu-preview-info">
              <div class="iu-preview-name">${this._esc(fileName)}${compressedBadge}</div>
              <div class="iu-preview-meta">${dimStr}${sizeStr ? ' · ' + sizeStr : ''}</div>
            </div>
          </div>
          <div class="iu-preview-actions">
            <button type="button" class="iu-action-btn iu-replace">替换</button>
            <button type="button" class="iu-action-btn iu-edit-url" title="改用 URL">用 URL</button>
            <button type="button" class="iu-action-btn danger iu-clear">清空</button>
          </div>
          <input type="file" class="iu-hidden-input" accept="image/*">
        </div>
      `;
    }
    
    // 空状态:拖拽区 + 上传按钮 + URL 输入
    return `
      <div class="iu-drop-zone iu-drop-zone-empty" ${idxAttr}>
        <span class="iu-icon">⬆</span>
        <div class="iu-text">
          <strong>拖拽图片到此处</strong>,或 <span class="iu-link">点击选择文件</span><br>
          <span style="color:#A3A3A3">支持 JPG/PNG/GIF/WebP</span>
        </div>
        <input type="file" class="iu-hidden-input" accept="image/*">
      </div>
      <div class="iu-url-row">
        <input type="text" class="iu-url-input ep-img-url" value="" placeholder="或直接粘贴图片 URL...">
      </div>
    `;
  }
  
  // ===== 事件绑定 =====
  
  _wireEvents() {
    // AI 重写
    const aiBtn = this.root.querySelector('.ep-ai-rewrite');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this.onAiRewrite(this.currentPageIdx));
    }
    
    // 各字段编辑
    this.root.querySelectorAll('.ep-field').forEach(field => {
      const slot = field.dataset.slot;
      const type = field.dataset.type;
      
      if (type === 'text' || type === 'rich') {
        const input = field.querySelector('.ep-input');
        input.addEventListener('input', (e) => {
          this._updateSlot(slot, e.target.value);
        });
      }
      
      if (type === 'composite') {
        field.querySelectorAll('.ep-sub-input').forEach(input => {
          input.addEventListener('input', (e) => {
            const sub = e.target.dataset.sub;
            this._updateCompositeSubField(slot, sub, e.target.value);
          });
        });
      }
      
      if (type === 'list-homo') {
        field.querySelectorAll('.ep-li-input').forEach(input => {
          input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.closest('.ep-li').dataset.idx, 10);
            this._updateListHomo(slot, idx, e.target.value);
          });
        });
      }
      
      if (type === 'list-rep') {
        // featured 切换
        field.querySelectorAll('.ep-featured-toggle').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            this._toggleFeatured(slot, idx);
            this.renderForPage(this.currentPlan, this.currentPageIdx); // 重渲染 panel
          });
        });
        // 子字段编辑
        field.querySelectorAll('.ep-rl-sub').forEach(input => {
          input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.closest('.ep-item').dataset.idx, 10);
            const sub = e.target.dataset.sub;
            this._updateRepListItem(slot, idx, sub, e.target.value);
          });
        });
        // 嵌套子字段
        field.querySelectorAll('.ep-rl-sub-nested').forEach(input => {
          input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.closest('.ep-item').dataset.idx, 10);
            const sub = e.target.dataset.sub;
            const sub2 = e.target.dataset.sub2;
            this._updateRepListItemNested(slot, idx, sub, sub2, e.target.value);
          });
        });
      }
      
      if (type === 'image') {
        this._wireImageField(field, slot, null);
        // alt / fit
        const alt = field.querySelector('.ep-img-alt');
        const fit = field.querySelector('.ep-img-fit');
        if (alt) alt.addEventListener('input', () => this._updateImage(slot, { alt: alt.value }));
        if (fit) fit.addEventListener('change', () => this._updateImage(slot, { image_fit: fit.value }));
      }
      
      if (type === 'image-list') {
        field.querySelectorAll('.iu-image-field').forEach((subField) => {
          const idx = parseInt(subField.dataset.imgIdx, 10);
          this._wireImageField(subField, slot, idx);
        });
      }
    });
  }

  // 给图片字段(单图或列表中一张)绑定上传/拖拽/URL/替换/清空
  _wireImageField(fieldRoot, slot, listIdx) {
    const updateValue = (newVal) => {
      if (listIdx != null) {
        // 列表中的某张
        this._updateImageListItem(slot, listIdx, newVal);
      } else {
        // 单图
        this._updateImage(slot, newVal);
      }
      // 重新渲染整个面板, 因为图片字段从空状态切到已上传状态 UI 差很多
      // 但避免抖动: 只重渲染当前 field
      this._rerenderFieldOnly(slot, listIdx);
    };
    
    const handleFile = async (file) => {
      try {
        const result = await window.ImageUploader.askCompressOrOriginal(file);
        if (!result) return; // 取消
        
        updateValue({
          url: result.dataUrl,
          _meta: {
            name: result.name,
            size: result.size,
            width: result.width,
            height: result.height,
            compressed: result.compressed,
          },
        });
      } catch (err) {
        console.error('[edit-panel] 图片处理失败:', err);
        alert('图片处理失败: ' + err.message);
      }
    };
    
    // 1. 拖拽区点击 → 触发 file picker
    const dropZone = fieldRoot.querySelector('.iu-drop-zone-empty');
    if (dropZone) {
      const fileInput = dropZone.querySelector('.iu-hidden-input');
      dropZone.addEventListener('click', (e) => {
        // 别点到 URL 输入框时触发
        if (e.target.closest('.iu-url-row')) return;
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = ''; // reset 让下次能再选同一文件
      });
      
      // 拖拽
      window.ImageUploader.attachDragDrop(dropZone, handleFile);
      
      // URL 输入
      const urlInput = fieldRoot.querySelector('.ep-img-url');
      if (urlInput) {
        urlInput.addEventListener('input', (e) => {
          // 不重渲染, 只更新 value
          if (listIdx != null) {
            const slots = this._getPageSlots();
            if (!Array.isArray(slots[slot])) slots[slot] = [];
            if (!slots[slot][listIdx]) slots[slot][listIdx] = {};
            slots[slot][listIdx].url = e.target.value;
            slots[slot][listIdx]._meta = null;
            this._notify();
          } else {
            const slots = this._getPageSlots();
            if (typeof slots[slot] !== 'object' || !slots[slot] || Array.isArray(slots[slot])) slots[slot] = {};
            slots[slot].url = e.target.value;
            slots[slot]._meta = null;
            this._notify();
          }
        });
        // URL 输入后回车或失焦时重渲染字段(切到 preview 模式)
        urlInput.addEventListener('blur', () => {
          if (urlInput.value.trim()) this._rerenderFieldOnly(slot, listIdx);
        });
      }
      return;
    }
    
    // 2. 已上传状态: 替换 / URL / 清空 按钮
    const preview = fieldRoot.querySelector('.iu-preview');
    if (preview) {
      const fileInput = preview.querySelector('.iu-hidden-input');
      const replaceBtn = preview.querySelector('.iu-replace');
      const urlBtn = preview.querySelector('.iu-edit-url');
      const clearBtn = preview.querySelector('.iu-clear');
      
      replaceBtn?.addEventListener('click', () => fileInput.click());
      fileInput?.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = '';
      });
      
      // 拖到已上传区域也能替换
      window.ImageUploader.attachDragDrop(preview, handleFile);
      
      urlBtn?.addEventListener('click', () => {
        // 切到 URL 输入模式: 清空当前 value
        updateValue({ url: '', _meta: null });
      });
      
      clearBtn?.addEventListener('click', () => {
        updateValue({ url: '', _meta: null });
      });
    }
  }
  
  // 重新渲染整个 panel(图片字段切换状态时用)
  // 简化: 整页重渲染(field 数量不多, 性能可接受)
  _rerenderFieldOnly(slot, listIdx) {
    if (this.currentPlan && this.currentPageIdx >= 0) {
      this.renderForPage(this.currentPlan, this.currentPageIdx);
    }
  }
  
  // ===== state 修改方法(直接修改 visualPlan 引用) =====
  
  _getPageSlots() {
    const page = this.currentPlan.pages[this.currentPageIdx];
    if (!page.slots) page.slots = {};
    return page.slots;
  }
  
  _updateSlot(slot, value) {
    this._getPageSlots()[slot] = value;
    this._notify();
  }
  
  _updateCompositeSubField(slot, sub, value) {
    const slots = this._getPageSlots();
    if (typeof slots[slot] !== 'object' || slots[slot] === null) slots[slot] = {};
    slots[slot][sub] = value;
    this._notify();
  }
  
  _updateListHomo(slot, idx, value) {
    const slots = this._getPageSlots();
    if (!Array.isArray(slots[slot])) slots[slot] = [];
    slots[slot][idx] = value;
    this._notify();
  }
  
  _updateRepListItem(slot, idx, sub, value) {
    const slots = this._getPageSlots();
    if (!Array.isArray(slots[slot])) slots[slot] = [];
    if (!slots[slot][idx]) slots[slot][idx] = {};
    slots[slot][idx][sub] = value;
    this._notify();
  }
  
  _updateRepListItemNested(slot, idx, sub, sub2, value) {
    const slots = this._getPageSlots();
    if (!Array.isArray(slots[slot])) slots[slot] = [];
    if (!slots[slot][idx]) slots[slot][idx] = {};
    if (typeof slots[slot][idx][sub] !== 'object' || slots[slot][idx][sub] === null) {
      slots[slot][idx][sub] = {};
    }
    slots[slot][idx][sub][sub2] = value;
    this._notify();
  }
  
  _toggleFeatured(slot, idx) {
    const slots = this._getPageSlots();
    if (!Array.isArray(slots[slot])) return;
    if (!slots[slot][idx]) return;
    slots[slot][idx]._featured = !slots[slot][idx]._featured;
    // 一项设 featured 时, 其他都清(featured 互斥)
    if (slots[slot][idx]._featured) {
      for (let i = 0; i < slots[slot].length; i++) {
        if (i !== idx && slots[slot][i]) slots[slot][i]._featured = false;
      }
    }
    this._notify();
  }
  
  _updateImage(slot, patch) {
    const slots = this._getPageSlots();
    if (typeof slots[slot] !== 'object' || slots[slot] === null || Array.isArray(slots[slot])) {
      slots[slot] = {};
    }
    Object.assign(slots[slot], patch);
    this._notify();
  }
  
  _updateImageListItem(slot, idx, patch) {
    const slots = this._getPageSlots();
    if (!Array.isArray(slots[slot])) slots[slot] = [];
    if (!slots[slot][idx] || typeof slots[slot][idx] !== 'object') slots[slot][idx] = {};
    Object.assign(slots[slot][idx], patch);
    this._notify();
  }
  
  // 节流通知主流程: 300ms 后重渲染
  _notify() {
    if (this._changeTimer) clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => {
      this.onSlotsChange(this.currentPageIdx);
    }, 300);
  }
  
  // ===== util =====
  
  _findVariant(variantId) {
    if (!this.manifest) return null;
    return this.manifest.variants.find(v => v.id === variantId);
  }
  
  _summarize(item) {
    // 找一个有意义的字段做摘要
    const candidateKeys = ['m-label', 'm-value', 'f-title', 'r-quarter', 'r-title',
                            'view-tag', 'role-title', 'member-name', 'plan-name',
                            'ba-tag', 'note-title', 'caption-title'];
    for (const k of candidateKeys) {
      if (item[k]) return String(item[k]).substring(0, 30);
    }
    // 退化: 拿第一个字符串字段
    for (const [k, v] of Object.entries(item)) {
      if (k === '_featured') continue;
      if (typeof v === 'string') return v.substring(0, 30);
    }
    return '(无标题)';
  }
  
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
}

window.EditPanel = EditPanel;
