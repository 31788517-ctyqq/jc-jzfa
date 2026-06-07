// 快速探测 data.json 的 m/r 结构
var fs = require('fs');
var d = JSON.parse(fs.readFileSync('server/data.json', 'utf8'));

// m 结构
var mKeys = Object.keys(d.m || {});
console.log('=== m 结构 ===');
console.log('m count:', mKeys.length);
if (mKeys.length > 0) {
  var m = d.m[mKeys[0]];
  console.log('m key:', mKeys[0]);
  console.log('m keys:', Object.keys(m));
  console.log('m sample:', JSON.stringify(m).substring(0, 500));
}

// r 结构
var rKeys = Object.keys(d.r || {});
console.log('\n=== r 结构 ===');
console.log('r count:', rKeys.length);
var rk = rKeys[0];
console.log('r sample key:', rk);
if (Array.isArray(d.r[rk])) {
  console.log('r is array, len:', d.r[rk].length);
  console.log('r[0]:', JSON.stringify(d.r[rk][0]));
  console.log('r[1]:', JSON.stringify(d.r[rk][1]));
} else if (typeof d.r[rk] === 'object') {
  console.log('r is object, keys:', Object.keys(d.r[rk]));
  console.log('r val:', JSON.stringify(d.r[rk]).substring(0, 400));
} else {
  console.log('r val type:', typeof d.r[rk], '; val:', d.r[rk]);
}

// 看看 r 的 key 命名规律
console.log('\nr keys sample (first 10):', JSON.stringify(rKeys.slice(0, 10)));

// 看看 m 的 matchId 和 num 字段
console.log('\n=== m 字段抽样 (前3条) ===');
var mSample = mKeys.slice(0, 3);
for (var i = 0; i < mSample.length; i++) {
  var mi = d.m[mSample[i]];
  console.log('m[' + i + '] matchId:', mi.matchId, 'num:', mi.num, 'date:', mi.date, 'score:', mi.score, 'hcp:', mi.hcp);
}
