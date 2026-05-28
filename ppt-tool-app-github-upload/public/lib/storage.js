/**
 * storage.js · localStorage 持久化
 *
 * 用法:
 *   Storage.save(state) → {ok, size, error?}
 *   Storage.load() → {state, savedAt} | null
 *   Storage.clear()
 *   Storage.getInfo() → {hasSaved, savedAt, sizeKB, near_limit}
 *
 * 存储约定:
 *   key 'ppt-tool:state'   - JSON 序列化的 state
 *   key 'ppt-tool:saved-at' - ISO 时间戳
 *   key 'ppt-tool:version'  - schema 版本, 用于将来迁移
 */

const STORAGE_KEY = 'ppt-tool:state';
const STORAGE_TS = 'ppt-tool:saved-at';
const STORAGE_VER = 'ppt-tool:version';
const CURRENT_VERSION = 1;

// localStorage 单 origin 通常 5-10 MB, 我们留 4 MB 安全余量
const SIZE_WARN_BYTES = 4 * 1024 * 1024;
const SIZE_MAX_BYTES = 8 * 1024 * 1024;

const Storage = {
  /**
   * 序列化 + 写盘
   * @param {Object} state - 要持久化的 state(自己选的字段)
   * @returns {{ok, size, error?}}
   */
  save(state) {
    try {
      const payload = JSON.stringify(state);
      const size = new Blob([payload]).size;
      
      if (size > SIZE_MAX_BYTES) {
        return { ok: false, size, error: 'too_large', message: `数据超过 ${(SIZE_MAX_BYTES/1024/1024).toFixed(1)} MB 上限,请删除部分图片` };
      }
      
      localStorage.setItem(STORAGE_KEY, payload);
      localStorage.setItem(STORAGE_TS, new Date().toISOString());
      localStorage.setItem(STORAGE_VER, String(CURRENT_VERSION));
      
      return { ok: true, size, near_limit: size > SIZE_WARN_BYTES };
    } catch (err) {
      // QuotaExceededError or others
      console.error('[storage] save failed:', err);
      return { ok: false, error: err.name, message: err.message };
    }
  },

  /**
   * 读取已存的 state
   * @returns {{state, savedAt, version} | null}
   */
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      
      const state = JSON.parse(raw);
      const savedAt = localStorage.getItem(STORAGE_TS);
      const version = parseInt(localStorage.getItem(STORAGE_VER) || '1', 10);
      
      // 版本兼容检查
      if (version > CURRENT_VERSION) {
        console.warn(`[storage] saved version ${version} > current ${CURRENT_VERSION}, may be incompatible`);
      }
      
      return { state, savedAt, version };
    } catch (err) {
      console.error('[storage] load failed:', err);
      return null;
    }
  },

  /**
   * 清缓存
   */
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_TS);
      localStorage.removeItem(STORAGE_VER);
      return true;
    } catch (err) {
      console.error('[storage] clear failed:', err);
      return false;
    }
  },

  /**
   * 获取概要信息(不解析完整 state)
   */
  getInfo() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { hasSaved: false };
      
      const size = new Blob([raw]).size;
      const savedAt = localStorage.getItem(STORAGE_TS);
      
      // 拿一些摘要信息(轻量解析)
      let summary = {};
      try {
        const state = JSON.parse(raw);
        summary = {
          stage: state.currentStage || 'input',
          reportLength: (state.rawReport || '').length,
          pageCount: state.visualPlan?.pages?.length || 0,
          dna: state.selectedDna || null,
        };
      } catch (e) {
        // ignore parse error
      }
      
      return {
        hasSaved: true,
        savedAt,
        sizeKB: Math.round(size / 1024),
        sizeMB: (size / 1024 / 1024).toFixed(2),
        near_limit: size > SIZE_WARN_BYTES,
        summary,
      };
    } catch (err) {
      return { hasSaved: false, error: err.message };
    }
  },

  /**
   * 格式化保存时间为人类可读(几分钟前/几小时前/具体日期)
   */
  formatSavedAt(isoString) {
    if (!isoString) return '未知时间';
    const saved = new Date(isoString);
    const diff = Date.now() - saved.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return saved.toLocaleString('zh-CN');
  },
};

window.Storage = Storage;
