#!/usr/bin/env node
// 服务器端诊断脚本：DB表行数+内存
const fs = require('fs');

try {
  const Database = require('/root/server/node_modules/better-sqlite3');
  
  // midou_data.db
  const db = new Database('/root/server/midou_data.db');
  db.pragma('journal_mode = WAL');
  
  console.log('=== midou_data.db ===');
  const ps = db.pragma('page_size')[0].page_size;
  const pc = db.pragma('page_count')[0].page_count;
  console.log('page_size:', ps, 'page_count:', pc, 'total_MB:', (ps * pc / 1048576).toFixed(1));
  
  const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
  tables.forEach(r => {
    try {
      const c = db.prepare('SELECT count(*) as c FROM "' + r.name + '"').get();
      console.log(r.name + ': ' + c.c + ' rows');
    } catch(e) { console.log(r.name + ': ERR ' + e.message); }
  });
  db.close();
} catch(e) { console.log('midou_data.db ERR:', e.message); }

// sporttery_archive.db
try {
  const Database = require('/root/server/node_modules/better-sqlite3');
  const db = new Database('/root/server/sporttery_archive.db');
  db.pragma('journal_mode = WAL');
  
  console.log('\n=== sporttery_archive.db ===');
  const ps = db.pragma('page_size')[0].page_size;
  const pc = db.pragma('page_count')[0].page_count;
  console.log('page_size:', ps, 'page_count:', pc, 'total_MB:', (ps * pc / 1048576).toFixed(1));
  
  const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
  tables.forEach(r => {
    try {
      const c = db.prepare('SELECT count(*) as c FROM "' + r.name + '"').get();
      console.log(r.name + ': ' + c.c + ' rows');
    } catch(e) { console.log(r.name + ': ERR ' + e.message); }
  });
  db.close();
} catch(e) { console.log('sporttery_archive.db ERR:', e.message); }

// File sizes
console.log('\n=== File sizes ===');
['/root/server/midou_data.db', '/root/server/sporttery_archive.db', '/root/server/auth.db', '/root/server/data.json'].forEach(f => {
  try { console.log(f + ': ' + (fs.statSync(f).size / 1048576).toFixed(1) + ' MB'); } catch(e) { console.log(f + ': not found'); }
});
