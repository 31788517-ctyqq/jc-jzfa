// 探测 data.json 中 r 数据的 rs 分布
var fs = require('fs');
var d = JSON.parse(fs.readFileSync('server/data.json', 'utf8'));
var rMap = d.r || {};

var totalEntries = 0;
var rs0 = 0,
  rs1 = 0,
  rsOther = 0;
var sampleEntries = [];

var keys = Object.keys(rMap);
console.log('Total r keys:', keys.length);

for (var i = 0; i < keys.length; i++) {
  var arr = rMap[keys[i]];
  if (!Array.isArray(arr)) continue;
  for (var j = 0; j < arr.length; j++) {
    totalEntries++;
    var r = arr[j];
    var rs = r.rs;
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
var matchDates = {};
var mMap = d.m || {};
for (var k in mMap) {
  var m = mMap[k];
  var ds = (m.date || '').slice(0, 10);
  if (!ds) continue;
  if (!matchDates[ds]) matchDates[ds] = [];
  matchDates[ds].push(k);
}

var sortedDates = Object.keys(matchDates).sort();
var recentDates = sortedDates.slice(-5);
for (var di = 0; di < recentDates.length; di++) {
  var ds = recentDates[di];
  var mids = matchDates[ds];
  var dayTotal = 0,
    dayRs1 = 0;
  for (var mi = 0; mi < mids.length; mi++) {
    var recs = rMap[mids[mi]] || [];
    for (var ri = 0; ri < recs.length; ri++) {
      dayTotal++;
      if (recs[ri].rs === 1) dayRs1++;
    }
  }
  console.log(ds + ': ' + mids.length + ' matches, ' + dayTotal + ' recs, rs=1: ' + dayRs1);
}
