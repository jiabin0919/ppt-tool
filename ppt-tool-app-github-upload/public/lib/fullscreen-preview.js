/**
 * fullscreen-preview.js · 全屏播放预览
 *
 * 用法:
 *   const fp = new FullscreenPreview({
 *     getHtml: () => state.generatedHtml,
 *     getTotalPages: () => state.visualPlan.pages.length,
 *     getCurrentPageIdx: () => state.selectedPageIdx,
 *     setCurrentPageIdx: (idx) => { ... },
 *   });
 *   fp.enter();   // 进入全屏
 *   fp.exit();    // 退出
 *
 * 交互:
 *   - 键盘 ← → 翻页, ESC 退出
 *   - 鼠标点击左 1/3 = 上一页, 右 1/3 = 下一页
 *   - 中间 1/3 = 显示/隐藏底部页码提示
 */

class FullscreenPreview {
  constructor(options) {
    this.opts = options;
    this.container = null;
    this.iframe = null;
    this.curPageIdx = 0;
    this._keyHandler = null;
    this._fsChangeHandler = null;
    this._resizeHandler = null;
    this._mouseTimer = null;
  }

  enter() {
    if (this.container) return; // already in fullscreen

    this.curPageIdx = this.opts.getCurrentPageIdx() || 0;
    const totalPages = this.opts.getTotalPages();

    // 创建全屏容器
    const container = document.createElement('div');
    container.className = 'fp-container';
    container.innerHTML = `
      <div class="fp-stage">
        <iframe class="fp-iframe" title="全屏预览"></iframe>
      </div>
      <div class="fp-zone fp-zone-left" data-action="prev"></div>
      <div class="fp-zone fp-zone-right" data-action="next"></div>
      <div class="fp-zone fp-zone-center" data-action="toggleUI"></div>
      <div class="fp-hud">
        <div class="fp-hud-pagenum">
          <span class="fp-cur">1</span>
          <span class="fp-sep">/</span>
          <span class="fp-total">${totalPages}</span>
        </div>
        <div class="fp-hud-hint">← → 翻页 · ESC 退出</div>
      </div>
    `;
    document.body.appendChild(container);

    this.container = container;
    this.iframe = container.querySelector('.fp-iframe');

    // 注入 HTML
    this.iframe.srcdoc = this.opts.getHtml();

    // 等 iframe load 后滚到当前页
    this.iframe.addEventListener('load', () => {
      setTimeout(() => this._scrollToPage(this.curPageIdx), 100);
      this._fitStage();
    });

    // 键盘
    this._keyHandler = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this._prev();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this._next();
      } else if (e.key === 'Escape') {
        // Fullscreen API 会自动响应 ESC, 但我们也手动处理(以防非全屏 fallback)
        if (!document.fullscreenElement) this.exit();
      } else if (e.key === 'Home') {
        e.preventDefault();
        this._goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        this._goTo(this.opts.getTotalPages() - 1);
      }
    };
    document.addEventListener('keydown', this._keyHandler);

    // 鼠标点击区域翻页
    container.querySelectorAll('.fp-zone').forEach(zone => {
      zone.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'prev') this._prev();
        else if (action === 'next') this._next();
        else if (action === 'toggleUI') this._toggleHud();
      });
    });

    // 全屏状态变化(用户按 ESC 或 F11)
    this._fsChangeHandler = () => {
      if (!document.fullscreenElement) {
        this.exit();
      }
    };
    document.addEventListener('fullscreenchange', this._fsChangeHandler);

    // 窗口 resize 时重新 fit
    this._resizeHandler = () => this._fitStage();
    window.addEventListener('resize', this._resizeHandler);

    // 鼠标移动时显示 HUD, 2 秒后淡出
    container.addEventListener('mousemove', () => {
      container.classList.add('fp-hud-visible');
      if (this._mouseTimer) clearTimeout(this._mouseTimer);
      this._mouseTimer = setTimeout(() => {
        container.classList.remove('fp-hud-visible');
      }, 2000);
    });
    // 初始显示
    container.classList.add('fp-hud-visible');
    this._mouseTimer = setTimeout(() => {
      container.classList.remove('fp-hud-visible');
    }, 3000);

    // 进入浏览器全屏
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('[fullscreen] requestFullscreen 失败, fallback 到容器全屏', err);
      });
    }

    this._updateHud();
  }

  exit() {
    if (!this.container) return;

    document.removeEventListener('keydown', this._keyHandler);
    document.removeEventListener('fullscreenchange', this._fsChangeHandler);
    window.removeEventListener('resize', this._resizeHandler);
    if (this._mouseTimer) clearTimeout(this._mouseTimer);

    this.container.remove();
    this.container = null;
    this.iframe = null;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // 通知主流程同步当前页
    if (this.opts.setCurrentPageIdx) {
      this.opts.setCurrentPageIdx(this.curPageIdx);
    }
  }

  // ===== 内部 =====

  _prev() {
    this._goTo(this.curPageIdx - 1);
  }

  _next() {
    this._goTo(this.curPageIdx + 1);
  }

  _goTo(idx) {
    const total = this.opts.getTotalPages();
    if (idx < 0) idx = 0;
    if (idx >= total) idx = total - 1;
    if (idx === this.curPageIdx) return;
    this.curPageIdx = idx;
    this._scrollToPage(idx);
    this._updateHud();
  }

  _scrollToPage(idx) {
    if (!this.iframe || !this.iframe.contentDocument) return;
    try {
      const doc = this.iframe.contentDocument;
      const slides = doc.querySelectorAll('.slide');
      if (slides[idx]) {
        slides[idx].scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    } catch (e) {
      // 跨域或 iframe 未 load
    }
  }

  _updateHud() {
    if (!this.container) return;
    const cur = this.container.querySelector('.fp-cur');
    if (cur) cur.textContent = String(this.curPageIdx + 1);
  }

  _toggleHud() {
    this.container.classList.toggle('fp-hud-visible');
  }

  // 计算 iframe 缩放, 让 1280×720 适配视口
  _fitStage() {
    if (!this.container) return;
    const stage = this.container.querySelector('.fp-stage');
    const containerW = window.innerWidth;
    const containerH = window.innerHeight;
    
    const scaleW = containerW / 1280;
    const scaleH = containerH / 720;
    const scale = Math.min(scaleW, scaleH);
    
    // 用 transform 缩放整个 stage (1280×720), 并居中
    stage.style.width = '1280px';
    stage.style.height = '720px';
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    stage.style.position = 'absolute';
    stage.style.left = '50%';
    stage.style.top = '50%';
    stage.style.transformOrigin = 'center';
  }
}

window.FullscreenPreview = FullscreenPreview;
