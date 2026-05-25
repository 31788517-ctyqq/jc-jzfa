/**
 * 将 data_bak.json 中的历史比分合并到 data.json
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const BAK_FILE = path.join(__dirname, 'data_bak.json');

function log(msg) { console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg); }

// Load current data
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const mMap = data.m || {};
const rMap = data.r || {};

// Load backup data
const bak = JSON.parse(fs.readFileSync(BAK_FILE, 'utf8'));
const bakMap = bak.m || {};

log('Current data: ' + Object.keys(mMap).length + ' matches');
log('Backup data: ' + Object.keys(bakMap).length + ' matches');

// Merge scores from backup
let merged = 0, noBak = 0;
const scoreFields = ['score', 'halfScore', 'duration', 'yellow', 'red', 'matchStatus'];

Object.keys(mMap).forEach(k => {
  const m = mMap[k];
  if (!m || !m.matchId) return;
  
  // Skip if already has score
  if (m.score && m.score !== '') return;
  
  // Find in backup by matchId
  const mid = String(m.matchId);
  let bakMatch = null;
  
  // Try different key formats
  for (const bk of Object.keys(bakMap)) {
    const bm = bakMap[bk];
    if (bm && String(bm.matchId) === mid) {
      bakMatch = bm;
      break;
    }
  }
  
  if (bakMatch && bakMatch.score && bakMatch.score !== '') {
    scoreFields.forEach(f => {
      if (bakMatch[f] !== undefined && bakMatch[f] !== '') {
        m[f] = bakMatch[f];
      }
    });
    merged++;
  } else {
    noBak++;
  }
});

log('Merged scores: ' + merged + ' matches');
log('No backup score: ' + noBak + ' matches');

// Save
const tmp = DATA_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(data));
fs.renameSync(tmp, DATA_FILE);
log('Done!');
