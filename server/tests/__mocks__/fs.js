/**
 * fs mock — 用于 odds-tracker、cache_manager 等模块的文件系统模拟
 * 使用内存 Map 模拟文件读写操作
 */

const path = require('path');

// 内存文件系统
let _store = {};

function resetMockFs() {
  _store = {};
}

function getStore() {
  return _store;
}

const mock = {
  existsSync: function (filePath) {
    return _store.hasOwnProperty(filePath);
  },

  readFileSync: function (filePath, encoding) {
    if (!_store.hasOwnProperty(filePath)) {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    }
    return _store[filePath];
  },

  writeFileSync: function (filePath, data, encoding) {
    _store[filePath] = data;
  },

  appendFileSync: function (filePath, data, encoding) {
    if (!_store.hasOwnProperty(filePath)) {
      _store[filePath] = '';
    }
    _store[filePath] += data;
  },

  readdirSync: function (dirPath) {
    const files = [];
    Object.keys(_store).forEach(function (fp) {
      if (fp.startsWith(dirPath)) {
        const rel = fp.replace(dirPath, '').replace(/^[\\/]/, '');
        if (rel && rel.indexOf('/') === -1 && rel.indexOf('\\') === -1) {
          files.push(rel);
        }
      }
    });
    return files;
  },

  mkdirSync: function (dirPath, opts) {
    // no-op in memory
  },

  unlinkSync: function (filePath) {
    delete _store[filePath];
  },

  statSync: function (filePath, opts) {
    if (!_store.hasOwnProperty(filePath)) {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return {
      size: Buffer.byteLength(_store[filePath] || '', 'utf8'),
      mtimeMs: Date.now(),
    };
  },
};

module.exports = mock;
mock.resetMockFs = resetMockFs;
mock.getStore = getStore;
