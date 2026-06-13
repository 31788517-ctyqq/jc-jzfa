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
const path = require('path');

/**
 * 原子写入字符串内容到文件
 * 流程: 写入唯一 .tmp → 校验字节长度 → rename 替换
 * @param {string} filePath 目标文件路径
 * @param {string} content 要写入的字符串内容
 * @returns {boolean} 是否写入成功
 */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) return false;

  const tmpFile = filePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(16).slice(2);
  try {
    const buffer = Buffer.from(typeof content === 'string' ? content : String(content), 'utf8');
    fs.writeFileSync(tmpFile, buffer);
    // 验证写入完整性
    const written = fs.readFileSync(tmpFile);
    if (written.length !== buffer.length) {
      throw new Error('写入字节数不匹配(' + written.length + '≠' + buffer.length + ')');
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
