/**
 * manifest-loader.js · 浏览器侧 DNA manifest 加载器
 *
 * 职责:
 *  1. 启动时扫 /dnas/ 加载所有 7 套 manifest
 *  2. 提供查询接口: getDnaList, getManifest, getVariantsByRole, getVariant
 *  3. 加载 skeleton.html (HTML 文本字符串, 渲染时用 DOMParser 解析)
 *  4. 校验 manifest schema 1.2 字段完整性
 *
 * 暴露全局: window.MANIFEST_REGISTRY
 */

// 已知的 7 套 DNA(后续要加 DNA 时只改这里)
const KNOWN_DNA_IDS = [
  "capsule",
  "archive",
  "meridian",
  "editorial",
  "signal",
  "macaron",
  "studio",
];

class ManifestRegistry {
  constructor() {
    this.manifests = {};      // dnaId -> manifest JSON
    this.skeletons = {};      // dnaId -> skeleton HTML string
    this.loaded = false;
  }

  /**
   * 加载所有 DNA 的 manifest + skeleton
   * 返回 Promise, resolved 时 registry 就绪
   */
  async loadAll() {
    const errors = [];

    await Promise.all(
      KNOWN_DNA_IDS.map(async (id) => {
        try {
          const [manifest, skeleton] = await Promise.all([
            this._fetchJson(`/dnas/${id}/manifest.json`),
            this._fetchText(`/dnas/${id}/skeleton.html`),
          ]);

          this._validateManifest(manifest, id);
          this.manifests[id] = manifest;
          this.skeletons[id] = skeleton;
        } catch (err) {
          errors.push({ id, message: err.message });
          console.error(`[manifest-loader] 加载 ${id} 失败:`, err);
        }
      })
    );

    this.loaded = true;

    if (errors.length > 0) {
      console.warn(
        `[manifest-loader] ${errors.length} 套 DNA 加载失败:`,
        errors
      );
    }

    const loadedIds = Object.keys(this.manifests);
    console.log(
      `[manifest-loader] 加载完成: ${loadedIds.length}/${KNOWN_DNA_IDS.length} 套 DNA`,
      loadedIds
    );

    return {
      loaded: loadedIds,
      failed: errors,
    };
  }

  /**
   * 列出所有可用 DNA 的简略信息(给 UI 用)
   */
  getDnaList() {
    return Object.values(this.manifests).map((m) => ({
      id: m.dna.id,
      name: m.dna.name,
      tagline: m.dna.tagline,
      description: m.dna.description,
      适用场景: m.dna["适用场景"] || [],
      不适合: m.dna["不适合"] || [],
      关键词: m.dna["关键词"] || m.dna["关注词"] || [],
      variantCount: m.variants.length,
      skinCount: m.skins.length,
      skins: m.skins.map((s) => ({
        id: s.id,
        name: s.name,
        isDefault: s.is_default || false,
        color: s["色块预览"] || {},
      })),
    }));
  }

  /**
   * 获取完整 manifest
   */
  getManifest(dnaId) {
    return this.manifests[dnaId] || null;
  }

  /**
   * 获取 skeleton HTML 文本
   */
  getSkeleton(dnaId) {
    return this.skeletons[dnaId] || null;
  }

  /**
   * 按 page_role 筛选 variants (visual-planner 选 variant 时用)
   */
  getVariantsByRole(dnaId, pageRole) {
    const m = this.manifests[dnaId];
    if (!m) return [];
    return m.variants.filter((v) => v.page_role === pageRole);
  }

  /**
   * 按 variant id 拿单个 variant
   */
  getVariant(dnaId, variantId) {
    const m = this.manifests[dnaId];
    if (!m) return null;
    return m.variants.find((v) => v.id === variantId) || null;
  }

  /**
   * 拿 12 个标准 page_role(从任意一个 manifest 里抽,固定枚举)
   */
  getStandardPageRoles() {
    return [
      "cover",
      "outline",
      "chapter_break",
      "climax",
      "support",
      "comparison",
      "gallery",
      "insight",
      "timeline",
      "process",
      "framework",
      "closing",
    ];
  }

  /**
   * 取一个 manifest 的 _type_definitions(7 套都一样,任取一个)
   */
  getTypeDefinitions() {
    const anyManifest = Object.values(this.manifests)[0];
    return anyManifest?._type_definitions || null;
  }

  // === 内部工具 ===

  async _fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`fetch ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  async _fetchText(path) {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`fetch ${path} failed: ${res.status}`);
    }
    return res.text();
  }

  _validateManifest(m, expectedId) {
    if (m.schema_version !== "1.2") {
      throw new Error(
        `schema_version mismatch: expected 1.2, got ${m.schema_version}`
      );
    }
    if (!m.dna || m.dna.id !== expectedId) {
      throw new Error(
        `dna.id mismatch: expected ${expectedId}, got ${m.dna?.id}`
      );
    }
    if (!Array.isArray(m.variants) || m.variants.length === 0) {
      throw new Error(`variants empty or invalid`);
    }
    if (!Array.isArray(m.skins) || m.skins.length === 0) {
      throw new Error(`skins empty or invalid`);
    }
    // 必须有且只有一个默认 skin
    const defaults = m.skins.filter((s) => s.is_default);
    if (defaults.length !== 1) {
      console.warn(
        `[manifest-loader] ${expectedId}: 应有 1 个 is_default skin, 实际 ${defaults.length}`
      );
    }
  }
}

// 全局单例
window.MANIFEST_REGISTRY = new ManifestRegistry();

// 提供一个 helper 方便外部调用
window.loadManifests = () => window.MANIFEST_REGISTRY.loadAll();
