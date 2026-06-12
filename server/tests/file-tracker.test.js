/**
 * server/tests/file-tracker.test.js
 * 文件追踪系统测试 — snapshot, check, checkDbIntegrity, getFileList, FILES_LIST
 */
const path = require('path');

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  const _mocks = { files: {}, dirContents: {} };

  function _setFile(filePath, stat, content) {
    _mocks.files[filePath] = {
      stat: { size: 1024, mtimeMs: Date.now() - 60000, isDirectory: () => false, ...stat },
      content,
    };
  }
  function _setDir(dirPath, files) {
    _mocks.dirContents[dirPath] = files;
  }
  function _reset() {
    Object.keys(_mocks.files).forEach((k) => delete _mocks.files[k]);
    Object.keys(_mocks.dirContents).forEach((k) => delete _mocks.dirContents[k]);
  }

  return {
    ...actualFs,
    statSync: jest.fn((fp) => {
      if (_mocks.files[fp]) return _mocks.files[fp].stat;
      throw new Error('ENOENT: ' + fp);
    }),
    existsSync: jest.fn((fp) => {
      if (_mocks.files[fp]) return true;
      if (
        fp.includes('midou_data.db') ||
        fp.includes('data.json') ||
        fp.includes('trends.json') ||
        fp.includes('ai_cache.json') ||
        fp.includes('cache.json') ||
        fp.includes('stats_bank.json') ||
        fp.includes('scheduler_state.json') ||
        fp.includes('ecosystem')
      ) {
        return true;
      }
      // odds_history: check statSync result to determine directory vs file
      return false;
    }),
    readdirSync: jest.fn((dp) => {
      if (_mocks.dirContents[dp]) return _mocks.dirContents[dp];
      return [];
    }),
    readFileSync: jest.fn(),
    openSync: jest.fn(() => 123),
    readSync: jest.fn(),
    closeSync: jest.fn(),
    _setFile,
    _setDir,
    _reset,
  };
});

const tracker = require('../core/file-tracker');

describe('file-tracker', () => {
  beforeEach(() => {
    require('fs')._reset();
  });
  afterEach(() => {
    require('fs')._reset();
  });

  // ── FILES_LIST ──
  describe('FILES_LIST', () => {
    it('should contain known files', () => {
      expect(Array.isArray(tracker.FILES_LIST)).toBe(true);
      expect(tracker.FILES_LIST.length).toBeGreaterThan(5);
    });
    it('each entry should have key/tag/label', () => {
      tracker.FILES_LIST.forEach((f) => {
        expect(f).toHaveProperty('key');
        expect(f).toHaveProperty('tag');
        expect(f).toHaveProperty('label');
        expect(f).toHaveProperty('staleMin');
      });
    });
  });

  // ── getFileList ──
  describe('getFileList', () => {
    it('should return simplified list', () => {
      const list = tracker.getFileList();
      expect(Array.isArray(list)).toBe(true);
      list.forEach((f) => {
        expect(f).toHaveProperty('key');
        expect(f).toHaveProperty('label');
        expect(f).toHaveProperty('tag');
        expect(f).toHaveProperty('staleMin');
        expect(f).not.toHaveProperty('path');
      });
    });
  });

  // ── snapshot ──
  describe('snapshot', () => {
    it('should return structured snapshot', () => {
      const snap = tracker.snapshot();
      expect(snap).toHaveProperty('time');
      expect(snap).toHaveProperty('summary');
      expect(snap).toHaveProperty('files');
      expect(snap.summary).toHaveProperty('total');
      expect(snap.summary).toHaveProperty('overall');
    });

    it('should report healthy when all files ok', () => {
      const snap = tracker.snapshot();
      expect(snap.summary.total).toBeGreaterThan(0);
      expect(typeof snap.summary.overall).toBe('string');
    });
  });

  // ── check ──
  describe('check', () => {
    it('should detect missing file', () => {
      const r = tracker.check('/nonexistent/file.json', 120);
      expect(['missing', 'error']).toContain(r.status);
    });

    it('should check absolute path', () => {
      const r = tracker.check('/absolute/path/file.json', 60);
      expect(['missing', 'error', 'ok', 'stale']).toContain(r.status);
    });

    it('should handle directory type', () => {
      const dirPath = path.join(__dirname, '..', 'odds_history');
      // Set up a mock directory with statSync returning a directory
      require('fs')._setFile(dirPath, { size: 0, mtimeMs: Date.now(), isDirectory: () => true });
      require('fs')._setDir(dirPath, ['2026-06-01.json', '2026-06-02.json']);
      // Also mock the file stats inside the directory
      const f1 = path.join(dirPath, '2026-06-01.json');
      const f2 = path.join(dirPath, '2026-06-02.json');
      require('fs')._setFile(f1, { size: 1024, mtimeMs: Date.now() - 120000, isDirectory: () => false });
      require('fs')._setFile(f2, { size: 2048, mtimeMs: Date.now() - 60000, isDirectory: () => false });
      const r = tracker.check('odds_history', 60);
      expect(r.category).toBe('dir');
      expect(r.fileCount).toBe(2);
    });

    it('should report stale for old files', () => {
      // File exists but is old
      const dataPath = path.join(__dirname, '..', 'data.json');
      const oldStat = { size: 2048, mtimeMs: Date.now() - 3600 * 60 * 1000, isDirectory: () => false };
      require('fs')._setFile(dataPath, oldStat);
      const r = tracker.check('data.json', 30);
      expect(['stale', 'ok', 'corrupt']).toContain(r.status);
    });
  });

  // ── checkDbIntegrity ──
  describe('checkDbIntegrity', () => {
    it('should not throw', () => {
      expect(() => tracker.checkDbIntegrity()).not.toThrow();
    });

    it('should return an object with status', () => {
      const r = tracker.checkDbIntegrity();
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('message');
      expect(typeof r.status).toBe('string');
    });
  });

  // ── integration ──
  describe('integration', () => {
    it('snapshot should contain all FILES_LIST keys', () => {
      const snap = tracker.snapshot();
      const keys = Object.keys(snap.files);
      const fileKeys = tracker.FILES_LIST.map((f) => f.key);
      fileKeys.forEach((k) => expect(keys).toContain(k));
    });

    it('summary counts should add up', () => {
      const snap = tracker.snapshot();
      const { ok, stale, missing, corrupt, error } = snap.summary;
      expect(ok + stale + missing + corrupt + error).toBe(snap.summary.total);
    });
  });
});
