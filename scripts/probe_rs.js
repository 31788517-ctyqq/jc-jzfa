// 探测 data.json 中 r 数据的 rs 分布
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('server/data.json', 'utf8'));
const rMap = d.r || {};

let totalEntries = 0;
let rs0 = 0,
  rs1 = 0,
  rsOther = 0;
const sampleEntries = [];

const keys = Object.keys(rMap);
console.log('Total r keys:', keys.length);

for (let i = 0; i < keys.length; i++) {
  const arr = rMap[keys[i]];
  if (!Array.isArray(arr)) continue;
  for (let j = 0; j < arr.length; j++) {
    totalEntries++;
    const r = arr[j];
    const rs = r.rs;
    if (rs === 0) rs0++;
    else if (rs === 1) rs1++;
    else {
      rsOther++;
      if (sampleEntries.length < 5) sampleEntries.push({ key: keys[i], r: r });
    }
  }
}

console.log('Total r entries:', totalEntries);
console.log('rs=0 (not hit):', rs0);
console.log('rs=1 (hit):', rs1);
console.log('rs=other (unknown):', rsOther);
console.log('Sample unknown entries:', JSON.stringify(sampleEntries.slice(0, 5)));

// Check a few days worth of entries to see if recent ones have rs
console.log('\n--- Recent entries check ---');
const matchDates = {};
const mMap = d.m || {};
for (const k in mMap) {
  const m = mMap[k];
  var ds = (m.date || '').slice(0, 10);
  if (!ds) continue;
  if (!matchDates[ds]) matchDates[ds] = [];
  matchDates[ds].push(k);
}

const sortedDates = Object.keys(matchDates).sort();
const recentDates = sortedDates.slice(-5);
for (let di = 0; di < recentDates.length; di++) {
  var ds = recentDates[di];
  const mids = matchDates[ds];
  let dayTotal = 0,
    dayRs1 = 0;
  for (let mi = 0; mi < mids.length; mi++) {
    const recs = rMap[mids[mi]] || [];
    for (let ri = 0; ri < recs.length; ri++) {
      dayTotal++;
      if (recs[ri].rs === 1) dayRs1++;
    }
  }
  console.log(ds + ': ' + mids.length + ' matches, ' + dayTotal + ' recs, rs=1: ' + dayRs1);
}
