/**
 * server/core/file-utils.js
 * 统一原子写入工具 — 防止 JSON 文件写半损坏
 *
 * 使用方式:
 *   const { atomicWrite, atomicWriteJson } = require('./core/file-utils');
 *   atomicWrite('/path/to/file.json', jsonString);
 *   atomicWriteJson('/path/to/file.json', obj);
 */

const fs = require('fs');

/**
 * 原子写入字符串内容到文件
 * 流程: 写入 .tmp → 校验长度 → rename 替换
 * @param {string} filePath 目标文件路径
 * @param {string} content 要写入的字符串内容
 * @returns {boolean} 是否写入成功
 */
function atomicWrite(filePath, content) {
  const tmpFile = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    // 验证写入完整性
    const written = fs.readFileSync(tmpFile, 'utf8');
    if (written.length !== content.length) {
      throw new Error('写入不完整(' + written.length + '≠' + content.length + ')');
    }
    fs.renameSync(tmpFile, filePath);
    return true;
  } catch (e) {
    console.error('[file-utils] 原子写入失败: ' + filePath + ' — ' + e.message);
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
    return false;
  }
}

/**
 * 原子写入 JSON 对象到文件
 * @param {string} filePath 目标文件路径
 * @param {Object} obj JSON 对象
 * @returns {boolean} 是否写入成功
 */
function atomicWriteJson(filePath, obj) {
  return atomicWrite(filePath, JSON.stringify(obj));
}

module.exports = { atomicWrite, atomicWriteJson };
