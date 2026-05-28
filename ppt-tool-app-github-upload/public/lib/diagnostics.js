/**
 * diagnostics.js · PPT 质量诊断扫描器
 *
 * 输入: iframe contentDocument, 当前 page 的 manifest variant 信息
 * 输出: 问题清单 [{level, page, slot, type, message, element, ...}]
 *
 * 扫描项:
 *   - text-overflow: 文字被截断 (clamp 触发)
 *   - overflow: 容器溢出 (scrollHeight > clientHeight)
 *   - overlap: 元素重叠遮挡 (绝对定位的两个元素 bounding box 相交)
 *   - empty: slot 为空但不该空
 *   - count-mismatch: 列表项数与 variant.数量约束不符
 *
 * 严重程度:
 *   - error  : 必须修(slot 完全显示不出来 / 数据丢失)
 *   - warning: 应该修(文字截断 / 溢出)
 *   - info   : 可以改善(密度异常)
 */

class Diagnostics {
  constructor(options) {
    this.registry = options.registry || window.MANIFEST_REGISTRY;
  }

  /**
   * 扫描整个 PPT (iframe contentDocument)
   * @param {Document} doc - iframe.contentDocument
   * @param {Object} visualPlan - 当前 visual_plan
   * @param {string} dnaId
   * @returns {Array<Issue>}
   */
  scanAll(doc, visualPlan, dnaId) {
    if (!doc) return [];
    const manifest = this.registry.getManifest(dnaId);
    if (!manifest) return [];

    const variantsById = {};
    manifest.variants.forEach(v => (variantsById[v.id] = v));

    const allIssues = [];
    const slides = doc.querySelectorAll('.slide');
    
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const pageData = visualPlan.pages[i];
      if (!pageData) continue;
      const variant = variantsById[pageData.variant_id];
      if (!variant) continue;

      const issues = this.scanPage(slide, pageData, variant, i + 1);
      allIssues.push(...issues);
    }
    return allIssues;
  }

  /**
   * 扫描单页
   */
  scanPage(slideEl, pageData, variant, pageNum) {
    const issues = [];

    issues.push(...this._scanTextOverflow(slideEl, pageData, variant, pageNum));
    issues.push(...this._scanContainerOverflow(slideEl, pageData, variant, pageNum));
    issues.push(...this._scanEmptySlots(slideEl, pageData, variant, pageNum));
    issues.push(...this._scanCountMismatch(slideEl, pageData, variant, pageNum));
    issues.push(...this._scanOverlap(slideEl, pageData, variant, pageNum));

    return issues;
  }

  // === 文本溢出 (line-clamp 被触发 + scrollWidth > clientWidth) ===
  _scanTextOverflow(slide, pageData, variant, pageNum) {
    const issues = [];
    
    // 找所有 slot-* 元素
    const slotEls = slide.querySelectorAll('[class*="slot-"]');
    
    for (const el of slotEls) {
      // 找出第一个 slot- class
      const slotClass = Array.from(el.classList).find(c => c.startsWith('slot-'));
      if (!slotClass) continue;
      
      const text = el.textContent || '';
      if (!text.trim()) continue;
      
      // 测试 1: scrollWidth > clientWidth(横向溢出, 8px 容差)
      if (el.scrollWidth > el.clientWidth + 8) {
        issues.push({
          level: 'warning',
          page: pageNum,
          slot: slotClass,
          type: 'text-horizontal-overflow',
          message: `横向溢出: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
          textPreview: text.substring(0, 40),
          element: el,
          fixHint: 'shrink-font',
        });
      }
      
      // 测试 2: scrollHeight > clientHeight + line-clamp 触发
      // 12px 容差: 避免 line-height 计算的小数误差被误判 (104px 字体 + 1.15 line-height 容易产生 ±11px 差)
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      const isClamped = style.webkitLineClamp && style.webkitLineClamp !== 'none';
      if (el.scrollHeight > el.clientHeight + 12) {
        if (isClamped) {
          issues.push({
            level: 'warning',
            page: pageNum,
            slot: slotClass,
            type: 'text-clamped',
            message: `文本被 line-clamp 截断 (${style.webkitLineClamp} 行)`,
            textPreview: text.substring(0, 40),
            element: el,
            fixHint: 'shrink-text',
          });
        } else {
          issues.push({
            level: 'warning',
            page: pageNum,
            slot: slotClass,
            type: 'text-vertical-overflow',
            message: `纵向溢出: scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`,
            textPreview: text.substring(0, 40),
            element: el,
            fixHint: 'shrink-font',
          });
        }
      }
    }
    return issues;
  }

  // === 容器溢出 (.slide 本身或主要 container) ===
  _scanContainerOverflow(slide, pageData, variant, pageNum) {
    const issues = [];
    
    // slide 自身溢出(超过 1280×720)
    if (slide.scrollWidth > slide.clientWidth + 1 || slide.scrollHeight > slide.clientHeight + 2) {
      issues.push({
        level: 'error',
        page: pageNum,
        slot: null,
        type: 'slide-overflow',
        message: `整页溢出: ${slide.scrollWidth}×${slide.scrollHeight} 超出 ${slide.clientWidth}×${slide.clientHeight}`,
        element: slide,
        fixHint: 'reduce-content',
      });
    }
    return issues;
  }

  // === 空 slot ===
  _scanEmptySlots(slide, pageData, variant, pageNum) {
    const issues = [];
    
    // manifest 定义的 slots, yaml 没填的(或填了空)
    for (const [slotName, slotDef] of Object.entries(variant.slots || {})) {
      const value = (pageData.slots || {})[slotName];
      const isEmpty = value == null || 
                      (typeof value === 'string' && !value.trim()) ||
                      (Array.isArray(value) && value.length === 0) ||
                      (typeof value === 'object' && !Array.isArray(value) && 
                       Object.keys(value).length === 0);
      
      if (isEmpty) {
        // 检查 DOM 中对应元素是否显示了 demo 默认值
        const target = slide.querySelector(`.${slotName}`);
        const demoText = target ? (target.textContent || '').trim() : '';
        if (demoText.length > 0) {
          issues.push({
            level: 'info',
            page: pageNum,
            slot: slotName,
            type: 'slot-empty-showing-demo',
            message: `该 slot yaml 未填, 显示 skeleton 默认值`,
            textPreview: demoText.substring(0, 40),
            element: target,
            fixHint: 'fill-yaml',
          });
        }
      }
    }
    return issues;
  }

  // === 列表项数不符 manifest.数量约束 ===
  _scanCountMismatch(slide, pageData, variant, pageNum) {
    const issues = [];
    
    for (const [slotName, slotDef] of Object.entries(variant.slots || {})) {
      const type = slotDef['类型'];
      if (type !== '同质列表' && type !== '重复列表') continue;
      
      const yamlVal = (pageData.slots || {})[slotName];
      if (!Array.isArray(yamlVal)) continue;
      
      const yamlCount = yamlVal.length;
      const expected = slotDef['项数'];
      
      if (typeof expected === 'number') {
        if (yamlCount !== expected) {
          issues.push({
            level: yamlCount === 0 ? 'info' : 'warning',
            page: pageNum,
            slot: slotName,
            type: 'count-mismatch',
            message: `${slotName}: yaml 给 ${yamlCount} 项, manifest 期望严格 ${expected}`,
            element: null,
            fixHint: 'adjust-count',
            actual: yamlCount,
            expected: expected,
          });
        }
      } else if (typeof expected === 'string' && expected.includes('-')) {
        const [min, max] = expected.split('-').map(s => parseInt(s, 10));
        if (yamlCount < min || yamlCount > max) {
          issues.push({
            level: 'warning',
            page: pageNum,
            slot: slotName,
            type: 'count-mismatch',
            message: `${slotName}: yaml 给 ${yamlCount} 项, manifest 期望 ${min}-${max}`,
            element: null,
            fixHint: 'adjust-count',
            actual: yamlCount,
            expected,
          });
        }
      }
    }
    return issues;
  }

  // === 元素重叠遮挡 ===
  _scanOverlap(slide, pageData, variant, pageNum) {
    const issues = [];
    
    // 找出所有绝对定位的 slot-* 或主要语义元素
    const slotEls = Array.from(slide.querySelectorAll('[class*="slot-"]'))
      .filter(el => {
        const text = (el.textContent || '').trim();
        if (!text) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return false;
        // 只检查有内容的元素
        return true;
      });
    
    // 两两比较 bounding box
    for (let i = 0; i < slotEls.length; i++) {
      for (let j = i + 1; j < slotEls.length; j++) {
        const a = slotEls[i];
        const b = slotEls[j];
        
        // 跳过父子关系
        if (a.contains(b) || b.contains(a)) continue;
        
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        
        const overlap = !(
          rectA.right < rectB.left ||
          rectA.left > rectB.right ||
          rectA.bottom < rectB.top ||
          rectA.top > rectB.bottom
        );
        
        if (!overlap) continue;
        
        // 计算重叠面积
        const overlapW = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
        const overlapH = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
        const overlapArea = overlapW * overlapH;
        const minArea = Math.min(rectA.width * rectA.height, rectB.width * rectB.height);
        const ratio = overlapArea / minArea;
        
        // 只报告超过 20% 的重叠(轻微相邻不算)
        if (ratio > 0.2) {
          const slotA = Array.from(a.classList).find(c => c.startsWith('slot-')) || '?';
          const slotB = Array.from(b.classList).find(c => c.startsWith('slot-')) || '?';
          issues.push({
            level: ratio > 0.5 ? 'error' : 'warning',
            page: pageNum,
            slot: `${slotA} × ${slotB}`,
            type: 'overlap',
            message: `元素重叠: ${slotA} 与 ${slotB} 重叠 ${Math.round(ratio * 100)}%`,
            element: [a, b],
            fixHint: 'z-index',
            overlapRatio: ratio,
          });
        }
      }
    }
    return issues;
  }
}

window.Diagnostics = Diagnostics;
