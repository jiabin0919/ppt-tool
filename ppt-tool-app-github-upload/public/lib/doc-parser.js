/**
 * doc-parser.js · 文档解析器
 *
 * 用法:
 *   const result = await DocParser.parseFile(file);
 *   // result: {text, pageCount?, slideCount?, wordCount, type, name, size, error?}
 *
 * 支持格式:
 *   - .pdf  (pdf.js)
 *   - .docx (mammoth.js)
 *   - .pptx (JSZip + 自写 XML 提取)
 *   - .md / .markdown (直接 readAsText)
 *   - .txt (直接 readAsText)
 *
 * 依赖按需懒加载, CDN 链接:
 *   - pdf.js: https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs
 *   - mammoth: https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js
 *   - jszip: https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
 */

const DocParser = {
  // 本地 vendor 路径(从 public/ 根算起, 部署后 Netlify 自动 serve)
  CDN: {
    pdfjs: '/vendor/pdf.min.mjs',
    pdfjsWorker: '/vendor/pdf.worker.min.mjs',
    mammoth: '/vendor/mammoth.browser.min.js',
    jszip: '/vendor/jszip.min.js',
  },
  
  // 缓存已加载的库
  _libs: {},
  
  /**
   * 解析文件
   * @param {File} file
   * @returns {Promise<{text, pageCount?, slideCount?, wordCount, type, name, size, error?}>}
   */
  async parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const meta = {
      name: file.name,
      size: file.size,
      type: ext,
    };
    
    try {
      let result;
      switch (ext) {
        case 'pdf':
          result = await this.parsePdf(file);
          break;
        case 'docx':
          result = await this.parseDocx(file);
          break;
        case 'pptx':
          result = await this.parsePptx(file);
          break;
        case 'md':
        case 'markdown':
        case 'txt':
          result = await this.parseText(file);
          break;
        default:
          // 尝试当文本读
          result = await this.parseText(file);
          result.warning = `未识别格式 .${ext}, 当作纯文本读取`;
      }
      
      return {
        ...meta,
        ...result,
        wordCount: this._countWords(result.text),
      };
    } catch (err) {
      return {
        ...meta,
        text: '',
        wordCount: 0,
        error: err.message,
      };
    }
  },
  
  // === PDF ===
  
  async parsePdf(file) {
    const pdfjs = await this._loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // 拼接文本(用空格隔开 item, 用换行隔开 page)
      const pageText = tc.items
        .map(item => item.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(pageText);
    }
    
    return {
      text: pages.join('\n\n'),
      pageCount: pdf.numPages,
    };
  },
  
  // === DOCX ===
  
  async parseDocx(file) {
    const mammoth = await this._loadMammoth();
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    // mammoth.extractRawText 返回 {value: text, messages: [...]}
    return {
      text: (result.value || '').trim(),
      mammoth_messages: result.messages?.length || 0,
    };
  },
  
  // === PPTX ===
  
  async parsePptx(file) {
    const JSZip = await this._loadJSZip();
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    
    // 找所有 slideN.xml
    const slideFiles = [];
    zip.forEach((path, entry) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
        slideFiles.push({ path, entry });
      }
    });
    // 按 slide 编号排序
    slideFiles.sort((a, b) => {
      const na = parseInt(a.path.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.path.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });
    
    if (slideFiles.length === 0) {
      throw new Error('未找到 PPT 幻灯片(可能是损坏文件)');
    }
    
    const slides = [];
    for (const sf of slideFiles) {
      const xml = await sf.entry.async('string');
      const text = this._extractTextFromPptxXml(xml);
      slides.push(text);
    }
    
    return {
      text: slides
        .map((t, i) => `[幻灯片 ${i + 1}]\n${t}`)
        .join('\n\n'),
      slideCount: slides.length,
    };
  },
  
  _extractTextFromPptxXml(xml) {
    // PPT XML 文字都在 <a:t> 标签内
    // 比 DOM Parser 简单的正则提取(够用)
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const texts = matches
      .map(m => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
      .map(t => t
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
      )
      .filter(t => t.trim().length > 0);
    
    // 用空格拼接同一段落, 用换行分割不同段
    return texts.join('\n');
  },
  
  // === TXT / MD ===
  
  async parseText(file) {
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsText(file, 'UTF-8');
    });
    return { text: text || '' };
  },
  
  // === 库加载 ===
  
  async _loadPdfJs() {
    if (this._libs.pdfjs) return this._libs.pdfjs;
    
    // pdf.js 4.x 是 ESM module
    const pdfjs = await import(this.CDN.pdfjs);
    pdfjs.GlobalWorkerOptions.workerSrc = this.CDN.pdfjsWorker;
    this._libs.pdfjs = pdfjs;
    return pdfjs;
  },
  
  async _loadMammoth() {
    if (this._libs.mammoth) return this._libs.mammoth;
    await this._loadScript(this.CDN.mammoth);
    this._libs.mammoth = window.mammoth;
    return window.mammoth;
  },
  
  async _loadJSZip() {
    if (this._libs.jszip) return this._libs.jszip;
    await this._loadScript(this.CDN.jszip);
    this._libs.jszip = window.JSZip;
    return window.JSZip;
  },
  
  _loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) {
        return resolve();
      }
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`加载失败: ${url}`));
      document.head.appendChild(script);
    });
  },
  
  _countWords(text) {
    if (!text) return 0;
    // 中文字符 + 英文 word
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (text.match(/[a-zA-Z]+/g) || []).length;
    return cn + en;
  },
  
  /**
   * 格式化大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  },
};

window.DocParser = DocParser;
