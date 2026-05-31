const d = require('./data.json');
const r = d.r;
const ks = Object.keys(r).sort().slice(-10);
ks.forEach(function (k) {
  console.log(k, (r[k] || []).length);
});
console.log('Total recs:', Object.keys(r).length);
