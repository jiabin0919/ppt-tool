/**
 * image-uploader.js · 图片上传/压缩工具
 *
 * 功能:
 *   - readFile(file): 把 File 对象读为 base64 dataURL
 *   - compressImage(dataURL, opts): 用 canvas 压缩 (max width + JPEG quality)
 *   - askCompressOrOriginal(file): 弹框问用户压缩还是原图, 返回处理后的 dataURL
 *   - attachDragDrop(el, onFile): 给元素加拖拽上传支持
 *
 * 全局暴露: window.ImageUploader
 */

const ImageUploader = {
  /**
   * 把 File 对象读为 base64 dataURL
   * @returns {Promise<{dataUrl, name, size, type, width, height}>}
   */
  async readFile(file) {
    if (!file.type.startsWith('image/')) {
      throw new Error('不是图片文件: ' + file.type);
    }

    // 读为 dataURL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });

    // 获取宽高
    const { width, height } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = dataUrl;
    });

    return {
      dataUrl,
      name: file.name,
      size: file.size,
      type: file.type,
      width,
      height,
    };
  },

  /**
   * 用 canvas 压缩图片
   * @param {string} dataUrl
   * @param {{maxWidth?, maxHeight?, quality?, mimeType?}} opts
   * @returns {Promise<{dataUrl, size, width, height}>}
   */
  async compressImage(dataUrl, opts = {}) {
    const maxWidth = opts.maxWidth || 1920;
    const maxHeight = opts.maxHeight || 1920;
    const quality = opts.quality ?? 0.85;
    const mimeType = opts.mimeType || 'image/jpeg';

    // 解码
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片解码失败'));
      i.src = dataUrl;
    });

    // 计算目标尺寸(等比缩放, 短边不放大)
    let { naturalWidth: w, naturalHeight: h } = img;
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    const targetW = Math.round(w * scale);
    const targetH = Math.round(h * scale);

    // canvas 绘制
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    
    // 白底(JPEG 没透明)
    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);
    
    const outDataUrl = canvas.toDataURL(mimeType, quality);
    
    // 估算大小(base64 长度 * 0.75)
    const base64Body = outDataUrl.split(',')[1] || '';
    const estSize = Math.round(base64Body.length * 0.75);
    
    return {
      dataUrl: outDataUrl,
      size: estSize,
      width: targetW,
      height: targetH,
    };
  },

  /**
   * 弹框问用户压缩还是原图
   * @param {File} file
   * @returns {Promise<{dataUrl, size, width, height, name, compressed}>} 或 null (取消)
   */
  async askCompressOrOriginal(file) {
    const info = await this.readFile(file);
    
    // 小于 500KB 直接原图, 不问
    if (info.size < 500 * 1024) {
      return { ...info, compressed: false };
    }

    // 弹框
    const choice = await this._showDialog({
      fileName: info.name,
      sizeKB: Math.round(info.size / 1024),
      width: info.width,
      height: info.height,
    });

    if (choice === 'cancel') return null;

    if (choice === 'compress') {
      const compressed = await this.compressImage(info.dataUrl, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        // 透明 PNG / GIF 用 PNG 输出, 否则 JPEG
        mimeType: file.type === 'image/png' || file.type === 'image/gif' 
                  ? 'image/png' : 'image/jpeg',
      });
      return {
        dataUrl: compressed.dataUrl,
        size: compressed.size,
        width: compressed.width,
        height: compressed.height,
        name: info.name,
        compressed: true,
      };
    }
    
    // original
    return { ...info, compressed: false };
  },

  /**
   * 给元素加拖拽上传支持
   * @param {Element} el
   * @param {Function} onFile - (file: File) => void
   */
  attachDragDrop(el, onFile) {
    const enter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('dragover');
    };
    const leave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dragover');
    };
    const drop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        onFile(file);
      }
    };

    el.addEventListener('dragover', enter);
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);

    // 返回 detach 函数
    return () => {
      el.removeEventListener('dragover', enter);
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  },

  // === 内部: 弹框实现 ===
  _showDialog({ fileName, sizeKB, width, height }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'iu-dialog-overlay';
      overlay.innerHTML = `
        <div class="iu-dialog">
          <h3>选择图片处理方式</h3>
          <div class="iu-file-info">
            <div class="iu-file-name">${this._esc(fileName)}</div>
            <div class="iu-file-meta">${sizeKB} KB · ${width}×${height} px</div>
          </div>
          <p class="iu-hint">
            这张图比较大,嵌入 HTML 会显著增大文件。
            压缩后画质足够 PPT 使用,且文件小很多。
          </p>
          <div class="iu-options">
            <button class="iu-btn iu-btn-compress">
              <strong>压缩上传 (推荐)</strong>
              <span>最大边 1920px · JPEG 85%</span>
            </button>
            <button class="iu-btn iu-btn-original">
              <strong>原图上传</strong>
              <span>保留原始数据 · 文件更大</span>
            </button>
          </div>
          <button class="iu-btn-cancel">取消</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const cleanup = (val) => {
        overlay.remove();
        resolve(val);
      };

      overlay.querySelector('.iu-btn-compress').addEventListener('click', () => cleanup('compress'));
      overlay.querySelector('.iu-btn-original').addEventListener('click', () => cleanup('original'));
      overlay.querySelector('.iu-btn-cancel').addEventListener('click', () => cleanup('cancel'));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup('cancel');
      });
    });
  },

  _esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  /**
   * 格式化文件大小给 UI 显示
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  },
};

window.ImageUploader = ImageUploader;
