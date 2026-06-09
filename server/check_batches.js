var fs = require('fs');
var bank = JSON.parse(fs.readFileSync(__dirname + '/stats_bank.json', 'utf8'));
var validBatches = [];

Object.keys(bank).forEach(function (k) {
  if (!k.startsWith('_raw_')) return;
  var entry = bank[k];
  var data = entry && entry.data ? entry.data : Array.isArray(entry) ? entry : [];
  if (!Array.isArray(data) || data.length === 0) return;

  var dates = data
    .map(function (d) {
      return d.matchTimeStr || d.matchDate || '';
    })
    .filter(Boolean)
    .sort();
  validBatches.push({
    dt: k.replace('_raw_', ''),
    count: data.length,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
  });
});

validBatches.sort(function (a, b) {
  return a.dt.localeCompare(b.dt);
});
console.log('有效批次: ' + validBatches.length);
console.log('');
validBatches.forEach(function (b) {
  console.log('  ' + b.dt + '  ' + b.count + '场  ' + b.firstDate + ' ~ ' + b.lastDate);
});

// 按月份汇总
var byMonth = {};
validBatches.forEach(function (b) {
  var s = b.dt;
  var m = parseInt(s[3]);
  if (!byMonth[m]) byMonth[m] = { batches: 0, matches: 0, minDate: b.firstDate, maxDate: b.firstDate };
  byMonth[m].batches++;
  byMonth[m].matches += b.count;
  if (b.firstDate < byMonth[m].minDate) byMonth[m].minDate = b.firstDate;
  if (b.lastDate > byMonth[m].maxDate) byMonth[m].maxDate = b.lastDate;
});

console.log('');
console.log('按月份汇总:');
var months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
Object.keys(byMonth)
  .sort()
  .forEach(function (m) {
    var info = byMonth[m];
    var name = months[parseInt(m)] || m + '月';
    console.log(
      '  ' + name + ': ' + info.batches + ' 批次, ' + info.matches + ' 场, ' + info.minDate + ' ~ ' + info.maxDate,
    );
  });

var total = validBatches.reduce(function (s, b) {
  return s + b.count;
}, 0);
console.log('');
console.log('总计: ' + validBatches.length + ' 批次, ' + total + ' 场比赛数据');
