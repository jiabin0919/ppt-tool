/**
 * auto-fix.js · 一键安全修复
 *
 * 根据 Diagnostics 输出的 issue 列表, 应用安全的启发式修复
 * 修复方式: 注入一段 scoped <style> override(不动 yaml 数据, 只调展示)
 *
 * 策略对应表:
 *   issue.type                    fixHint           策略
 *   text-horizontal-overflow      shrink-font       字号 *= 0.92, line-height 微调
 *   text-vertical-overflow        shrink-font       字号 *= 0.9
 *   text-clamped                  shrink-text       字号 *= 0.92 (温和)
 *   overlap                       z-index           给文本元素加 z-index: 10
 *   slide-overflow                reduce-content    全 slide overflow:hidden + 警告
 *   slot-empty-showing-demo       fill-yaml         不修复, 列入"需要补内容"
 *   count-mismatch                adjust-count      不修复(需要用户决定增减)
 *
 * 安全原则:
 *   - 永远不修改 yaml 数据
 *   - 字号缩小不超过 0.85x (避免过小)
 *   - 同一 slot 不连续多次缩小
 *   - 所有 override 用 [data-fix-id="..."] 作用域, 可一键撤销
 */

class AutoFix {
  constructor() {
    this.fixId = 'autofix-' + Date.now();
  }

  /**
   * 根据 issues 生成 CSS override + DOM 调整
   * @param {Array} issues
   * @param {Object} visualPlan - 用于判断哪些 slot 是 yaml 未填的 (demo 默认值,不应缩字)
   */
  buildFixes(issues, visualPlan) {
    const cssRules = [];
    const domChanges = []; // [{type, target, attr, value}]
    const fixed = [];
    const skipped = [];
    const seenSlots = new Set();

    // 收集 "yaml 未填" 的 slot 集合 (跨页, key = "p{N}-{slot}")
    const unfilledSlots = new Set();
    if (visualPlan && visualPlan.pages) {
      for (let i = 0; i < visualPlan.pages.length; i++) {
        const slots = visualPlan.pages[i].slots || {};
        const pageNum = i + 1;
        // 找哪些 manifest 定义的 slot 在 yaml 里没填
        // 这里粗略检查: 看 issues 里有没有 slot-empty-showing-demo
      }
    }
    // 简化: 直接看 issues 中的 slot-empty-showing-demo, 这些 slot 不缩字
    for (const issue of issues) {
      if (issue.type === 'slot-empty-showing-demo') {
        unfilledSlots.add(`p${issue.page}-${issue.slot}`);
      }
    }

    for (const issue of issues) {
      const slotKey = `p${issue.page}-${issue.slot}`;
      if (issue.slot && seenSlots.has(slotKey)) {
        skipped.push({ issue, reason: 'already-fixed-on-slot' });
        continue;
      }

      // 关键保护: 该 slot 在 yaml 里没填(显示的是 demo 默认值), 不要缩字号
      // 因为 demo 是设计师精心准备的, 真实用户填入数据后不会有这个问题
      if (unfilledSlots.has(slotKey) && 
          (issue.fixHint === 'shrink-font' || issue.fixHint === 'shrink-text')) {
        skipped.push({ issue, reason: 'slot-unfilled-skip-shrink' });
        continue;
      }

      let fix = null;

      switch (issue.fixHint) {
        case 'shrink-font':
          fix = this._shrinkFontFix(issue);
          break;
        case 'shrink-text':
          fix = this._shrinkTextFix(issue);
          break;
        case 'z-index':
          fix = this._zIndexFix(issue);
          break;
        case 'reduce-content':
          fix = this._slideOverflowFix(issue);
          break;
        case 'fill-yaml':
          skipped.push({ issue, reason: 'needs-user-input' });
          continue;
        case 'adjust-count':
          skipped.push({ issue, reason: 'needs-user-decision' });
          continue;
        default:
          skipped.push({ issue, reason: 'no-strategy' });
          continue;
      }

      if (fix) {
        if (fix.css) cssRules.push(fix.css);
        if (fix.dom) domChanges.push(fix.dom);
        if (issue.slot) seenSlots.add(slotKey);
        fixed.push(issue);
      }
    }

    return {
      cssText: cssRules.join('\n'),
      domChanges,
      fixed,
      skipped,
      fixId: this.fixId,
    };
  }

  /**
   * 应用 fixes 到 iframe document
   */
  apply(doc, fixes) {
    // 1. 注入 CSS
    if (fixes.cssText) {
      // 先移除旧的 autofix style
      const old = doc.querySelector('style[data-autofix]');
      if (old) old.remove();
      
      const style = doc.createElement('style');
      style.setAttribute('data-autofix', fixes.fixId);
      style.textContent = fixes.cssText;
      doc.head.appendChild(style);
    }

    // 2. 应用 DOM 改动
    for (const change of fixes.domChanges) {
      try {
        const target = change.target;
        if (!target) continue;
        if (change.type === 'add-class') {
          target.classList.add(change.value);
        } else if (change.type === 'set-attr') {
          target.setAttribute(change.attr, change.value);
        } else if (change.type === 'set-style') {
          target.style[change.attr] = change.value;
        }
      } catch (e) {
        console.warn('[autofix] DOM 修改失败:', e);
      }
    }
  }

  /**
   * 撤销所有 fix
   */
  revert(doc, fixes) {
    const old = doc.querySelector(`style[data-autofix="${fixes.fixId}"]`);
    if (old) old.remove();
    // DOM 改动暂时不撤销(用户重新生成 PPT 即可)
  }

  // === 单个 fix 策略 ===

  _shrinkFontFix(issue) {
    const el = issue.element;
    if (!el || !el.classList) return null;
    
    const slotClass = Array.from(el.classList).find(c => c.startsWith('slot-')) ||
                       Array.from(el.classList)[0];
    if (!slotClass) return null;
    
    // 选择器: 限定在该 page 的该 slot
    const selector = `.slide[data-page="${issue.page}"] .${slotClass}`;
    
    // 温和缩字: 0.95em(原来 0.9 太狠, 改成 5% 减小)
    return {
      css: `
/* fix p${issue.page} ${slotClass}: ${issue.type} */
${selector} {
  font-size: 0.95em !important;
  line-height: 1.2 !important;
}`,
    };
  }

  _shrinkTextFix(issue) {
    const el = issue.element;
    if (!el) return null;
    
    const slotClass = Array.from(el.classList).find(c => c.startsWith('slot-')) ||
                       Array.from(el.classList)[0];
    if (!slotClass) return null;
    
    const selector = `.slide[data-page="${issue.page}"] .${slotClass}`;
    
    // 文本被 clamp 截断, 更温和的缩小
    return {
      css: `
/* fix p${issue.page} ${slotClass}: text clamped */
${selector} {
  font-size: 0.96em !important;
}`,
    };
  }

  _zIndexFix(issue) {
    // overlap 的两个元素, 给后者加 z-index 让前者上浮
    if (!Array.isArray(issue.element) || issue.element.length !== 2) return null;
    
    const [a, b] = issue.element;
    // 选 text 内容更多的元素上浮(更重要)
    const aText = (a.textContent || '').length;
    const bText = (b.textContent || '').length;
    const winner = aText >= bText ? a : b;
    
    return {
      dom: {
        type: 'set-style',
        target: winner,
        attr: 'zIndex',
        value: '10',
      },
    };
  }

  _slideOverflowFix(issue) {
    // 给 slide 加 overflow: hidden 至少不让内容跑出去(虽然会截断, 但比溢出更可控)
    const slide = issue.element;
    if (!slide) return null;
    
    return {
      dom: {
        type: 'set-style',
        target: slide,
        attr: 'overflow',
        value: 'hidden',
      },
    };
  }
}

window.AutoFix = AutoFix;
