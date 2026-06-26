// batch_allplays.cjs — 批量回填全玩法赔率
var fa = require('../server/fetch_500all.js').fetchAllOdds;
var fs = require('fs');
var path = require('path');

var AP = path.join(__dirname, '..', 'server', 'ttyingqiu_data', 'odds_500_allplays.json');
var OUT = path.dirname(AP);
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

var allData = {};
if (fs.existsSync(AP)) {
  try { allData = JSON.parse(fs.readFileSync(AP, 'utf8')); } catch (e) {}
}

var dates = [];
var now = new Date();
for (var i = 0; i < 90; i++) {
  var s = new Date(now - i * 86400000).toISOString().slice(0, 10);
  if (!allData[s]) dates.push(s);
}
dates.sort();

console.log('allplays batch: need ' + dates.length + ' dates (out of 90)');
console.log('existing: ' + Object.keys(allData).length);

var ix = 0;
function save() {
  try { fs.writeFileSync(AP, JSON.stringify(allData, null, 2)); } catch (e) {}
}
function next() {
  if (ix >= dates.length) {
    save();
    console.log('DONE: ' + Object.keys(allData).length + ' dates total');
    process.exit(0);
  }
  var dt = dates[ix];
  fa(dt).then(function (o) {
    if (o && Object.keys(o).length > 0) {
      allData[dt] = o;
      console.log(dt + ': ' + Object.keys(o).length + ' matches');
    } else {
      console.log(dt + ': 0 matches');
    }
    ix++;
    if (ix % 5 === 0) save();
    setTimeout(next, 2000);
  }).catch(function (e) {
    console.log(dt + ': ERR ' + (e.message || '').slice(0, 80));
    ix++;
    setTimeout(next, 3000);
  });
}
next();
