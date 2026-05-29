/**
 * renderer.js · 浏览器侧 css-renderer
 *
 * 跟 ppt_tool/render_full.py 等价, 但用 DOM API 而非 BeautifulSoup
 *
 * 主入口:
 *   render(visualPlan, dnaId) → string (完整 output.html)
 *
 * 内部流程:
 *   1. 加载 manifest + skeleton
 *   2. 提取 skeleton 的 <head>(主题切换 CSS / 字体 / 引擎 JS)
 *   3. 对每个 page, 按 variant_id 在 skeleton 找对应 .slide DOM
 *   4. 按 slot 类型分发填充: 纯文本 / 富文本 / 同质列表 / 重复列表 / 组合字段 / 图片
 *   5. 拼装成完整 HTML 字符串
 */

class CssRenderer {
  constructor(registry) {
    this.registry = registry || window.MANIFEST_REGISTRY;
  }

  /**
   * 主入口
   * @param {Object} visualPlan - visual_plan.yaml 解析后的对象
   * @param {string} dnaId - 默认从 visualPlan.global.dna 取, 也可显式传
   * @returns {string} 完整 HTML 字符串
   */
  render(visualPlan, dnaId = null) {
    dnaId = dnaId || visualPlan.global.dna;
    const manifest = this.registry.getManifest(dnaId);
    const skeletonHtml = this.registry.getSkeleton(dnaId);

    if (!manifest) throw new Error(`DNA ${dnaId} not found in registry`);
    if (!skeletonHtml) throw new Error(`Skeleton for ${dnaId} not loaded`);

    // 用 DOMParser 解析 skeleton
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(skeletonHtml, "text/html");

    // 输出文档 = skeleton 复制一份
    const outputDoc = parser.parseFromString(skeletonHtml, "text/html");
    // 移除所有原始 .slide(我们会重新生成填充后的)
    outputDoc.querySelectorAll(".slide").forEach((s) => s.remove());

    // 索引化 variants
    const variantsById = {};
    manifest.variants.forEach((v) => (variantsById[v.id] = v));

    const stats = { pages: 0, fills: 0, failed: [] };
    const generatedSlides = []; // 收集生成的 slide, 最后统一放入干净容器

    for (const page of visualPlan.pages) {
      const vid = page.variant_id;
      const variant = variantsById[vid];
      if (!variant) {
        stats.failed.push({ page: page.slide, reason: `variant ${vid} not in manifest` });
        continue;
      }

      // 从 source 找该 variant 的 .slide
      const srcSlide = sourceDoc.querySelector(
        variant._renderer.dom_selector
      );
      if (!srcSlide) {
        stats.failed.push({
          page: page.slide,
          reason: `dom_selector ${variant._renderer.dom_selector} not found`,
        });
        continue;
      }

      // 深拷贝
      const newSlide = srcSlide.cloneNode(true);
      newSlide.setAttribute("data-page", String(page.slide));

      // 清除 slide 内部的开发标记(dev-tag / variant-tag / slide-index 等), 这些不该出现在最终 PPT
      // slide-index 是 skeleton 写死的 variant 代号或假页码(如 "COV-MERIDIAN · 01" / "01 / 58"), 对用户 PPT 无意义
      newSlide
        .querySelectorAll(".dev-tag, .variant-tag, .nav-label, .slide-tag, .variant-label, .slide-index")
        .forEach((el) => el.remove());

      // 填 slots
      for (const [slotName, slotValue] of Object.entries(page.slots || {})) {
        const slotDef = variant.slots?.[slotName];

        // 图片占位
        if (!slotDef) {
          const imgMatch = (variant["图片占位"] || []).find(
            (ip) => ip["yaml key"] === slotName
          );
          if (imgMatch) {
            if (this._fillImage(newSlide, slotName, slotValue, imgMatch)) {
              stats.fills++;
            } else {
              stats.failed.push({ page: page.slide, slot: slotName, type: "image" });
            }
          }
          continue;
        }

        const type = slotDef["类型"];
        let success = false;

        if (type === "纯文本") {
          success = this._fillText(newSlide, slotName, slotValue, false);
        } else if (type === "富文本") {
          success = this._fillText(newSlide, slotName, slotValue, true);
        } else if (type === "同质列表" && Array.isArray(slotValue)) {
          success = this._fillHomogeneousList(newSlide, slotName, slotValue, variant);
        } else if (type === "重复列表" && Array.isArray(slotValue)) {
          success = this._fillRepeatingList(newSlide, slotName, slotValue, variant);
        } else if (type === "组合字段" && typeof slotValue === "object") {
          success = this._fillComposite(newSlide, slotName, slotValue);
        }

        if (success) {
          stats.fills++;
        } else {
          stats.failed.push({ page: page.slide, slot: slotName, type });
        }
      }

      generatedSlides.push(newSlide);
      stats.pages++;
    }

    // 清空 body, 只放入生成的 slide (彻底杜绝 skeleton 的游离元素 / dev-tag / 注释 / script 残留)
    const body = outputDoc.body;
    while (body.firstChild) body.removeChild(body.firstChild);
    for (const slide of generatedSlides) {
      body.appendChild(slide);
    }

    // 输出
    const htmlString =
      "<!DOCTYPE html>\n" + outputDoc.documentElement.outerHTML;
    return { html: htmlString, stats };
  }

  // === 填充策略 ===

  _fillText(slide, slotName, value, isRich) {
    const target =
      slide.querySelector(`.${slotName}`) ||
      slide.querySelector(`.slot-${slotName}`);
    if (!target) return false;

    // 检查内部有没有嵌套的其他 slot 元素(如 slot-value 里嵌 slot-unit)
    const nestedSlots = target.querySelectorAll('[class*="slot-"]');

    if (isRich) {
      if (nestedSlots.length > 0) {
        // 富文本但有嵌套 slot: 只替换最前面的文本节点, 保留嵌套子元素
        this._setLeadingText(target, String(value), true);
      } else {
        target.innerHTML = String(value);
      }
    } else {
      if (nestedSlots.length > 0) {
        // 纯文本但有嵌套 slot: 只改直接文本节点, 不动子 slot 元素
        this._setLeadingText(target, String(value), false);
      } else {
        target.textContent = String(value);
      }
    }
    return true;
  }

  // 替换元素的"前导文本"(第一个文本节点), 保留后面的子元素
  // 用于 <div class="slot-value">175<span class="slot-unit">万</span></div> 这种嵌套
  _setLeadingText(el, text, isRich) {
    // 找第一个直接文本节点
    let firstText = null;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        firstText = node;
        break;
      }
    }
    if (firstText) {
      if (isRich && /<[a-z]/i.test(text)) {
        // 富文本含标签: 用一个临时 span 承载, 插在第一个子元素前
        const tmp = el.ownerDocument.createElement("span");
        tmp.innerHTML = text;
        firstText.remove();
        el.insertBefore(tmp, el.firstChild);
      } else {
        firstText.textContent = text;
      }
    } else {
      // 没有直接文本节点: 插到最前面
      const textNode = el.ownerDocument.createTextNode(text);
      el.insertBefore(textNode, el.firstChild);
    }
  }

  _fillImage(slide, slotName, value, phInfo) {
    const selector = phInfo.selector || `.${slotName}`;
    const target = slide.querySelector(selector);
    if (!target || typeof value !== "object" || !value.url) return false;

    // 清掉容器内的 demo 占位元素(常见 class):
    // - .ui-mock-body / .ui-mock-bar (capsule)
    // - .img-placeholder
    // - 直接文本节点(demo 占位文字如 "[ MOCKUP ]")
    // 但保留 img 自身(如果已经存在的话, 替换 src)
    const placeholderSelectors = [
      '.ui-mock-body', '.ui-mock-bar', '.ui-mock-dots',
      '.img-placeholder', '.image-placeholder',
      '.mockup-placeholder', '.placeholder-text',
    ];
    placeholderSelectors.forEach(sel => {
      target.querySelectorAll(sel).forEach(el => el.remove());
    });
    // 清掉直接文本节点
    Array.from(target.childNodes).forEach(node => {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        node.remove();
      }
    });

    // 如果已经有 img(用户改了图), 替换 src 而非追加
    let img = target.querySelector(':scope > img');
    if (!img) {
      img = target.ownerDocument.createElement("img");
      target.appendChild(img);
    }
    img.src = value.url;
    img.alt = value.alt || "";

    const fit = value.image_fit || phInfo["默认 image_fit"] || "cover";
    if (fit !== "cover") {
      target.setAttribute("data-image-fit", fit);
    } else {
      target.removeAttribute("data-image-fit");
    }
    return true;
  }

  _findListContainer(slide, slotName, variant) {
    // 优先 1: .{slot_name} 直接是容器
    const direct = slide.querySelector(`.${slotName}`);
    if (direct) {
      // 找容器内第一个有非 slot- class 的子元素
      for (const child of direct.children) {
        const classes = Array.from(child.classList);
        const nonSlot = classes.find((c) => !c.startsWith("slot-"));
        if (nonSlot) {
          return { container: direct, itemClass: nonSlot };
        }
      }
      return { container: direct, itemClass: null };
    }

    // 优先 2: 用 _renderer.items_dom_selector
    const itemsSel = variant._renderer?.items_dom_selector;
    if (itemsSel) {
      const items = slide.querySelectorAll(itemsSel);
      if (items.length > 0) {
        const parent = items[0].parentElement;
        const itemClass = items[0].classList[0];
        return { container: parent, itemClass };
      }
    }

    return null;
  }

  _fillHomogeneousList(slide, slotName, valueList, variant) {
    const found = this._findListContainer(slide, slotName, variant);
    if (!found || !found.container) return false;

    const { container, itemClass } = found;

    let existing;
    if (itemClass) {
      existing = container.querySelectorAll(`.${itemClass}`);
    } else {
      existing = Array.from(container.children).filter((el) =>
        ["LI", "DIV", "SPAN"].includes(el.tagName)
      );
    }

    if (existing.length === 0) return false;

    const templateHTML = existing[0].outerHTML;

    // 清空所有同类项
    existing.forEach((el) => el.remove());

    // 重建
    for (const value of valueList) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = templateHTML;
      const item = wrapper.firstElementChild;
      item.innerHTML = String(value);
      container.appendChild(item);
    }
    return true;
  }

  _fillRepeatingList(slide, slotName, valueList, variant) {
    const found = this._findListContainer(slide, slotName, variant);
    if (!found || !found.container) return false;

    const { container, itemClass } = found;

    let existing;
    if (itemClass) {
      existing = container.querySelectorAll(`.${itemClass}`);
    } else {
      existing = Array.from(container.children).filter((el) =>
        ["DIV", "LI", "TR"].includes(el.tagName)
      );
    }

    if (existing.length === 0) return false;

    const templateHTML = existing[0].outerHTML;
    existing.forEach((el) => el.remove());

    for (const itemData of valueList) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = templateHTML;
      const item = wrapper.firstElementChild;

      // 清除 demo featured class
      item.classList.remove("featured");
      if (itemData._featured) {
        item.classList.add("featured");
      }

      // 填子字段
      for (const [subKey, subValue] of Object.entries(itemData)) {
        if (subKey === "_featured") continue;

        const subTarget =
          item.querySelector(`.${subKey}`) ||
          item.querySelector(`.slot-${subKey}`);
        if (!subTarget) continue;

        if (typeof subValue === "string") {
          subTarget.innerHTML = subValue;
        } else if (Array.isArray(subValue)) {
          // 嵌套列表(如 r-items)
          this._fillNestedList(subTarget, subValue);
        } else if (typeof subValue === "object" && subValue !== null) {
          // 嵌套组合字段
          this._fillCompositeInline(subTarget, subValue);
        }
      }

      container.appendChild(item);
    }
    return true;
  }

  _fillNestedList(container, valueList) {
    const existing = Array.from(container.children).filter((el) =>
      ["LI", "DIV", "SPAN"].includes(el.tagName)
    );
    if (existing.length === 0) return;

    const templateHTML = existing[0].outerHTML;
    existing.forEach((el) => el.remove());

    for (const value of valueList) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = templateHTML;
      const item = wrapper.firstElementChild;

      if (typeof value === "string") {
        item.innerHTML = value;
      } else if (typeof value === "object" && value !== null) {
        // 项是对象(如 r-items 的 {marker, text})
        for (const [k, v] of Object.entries(value)) {
          const t =
            item.querySelector(`.${k}`) ||
            item.querySelector(`.slot-${k}`);
          if (t) t.innerHTML = String(v);
        }
      }
      container.appendChild(item);
    }
  }

  _fillComposite(slide, slotName, valueObj) {
    const container = slide.querySelector(`.${slotName}`);
    if (!container) return false;
    return this._fillCompositeInline(container, valueObj);
  }

  _fillCompositeInline(container, valueObj) {
    for (const [k, v] of Object.entries(valueObj)) {
      const t =
        container.querySelector(`.${k}`) ||
        container.querySelector(`.slot-${k}`);
      if (!t) continue;
      t.innerHTML = String(v);
    }
    return true;
  }
}

window.CssRenderer = CssRenderer;
