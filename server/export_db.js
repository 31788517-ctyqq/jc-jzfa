const path = require('path');
const db = require('better-sqlite3')(path.join(__dirname,'midou_data.db'), { readonly: true });
const fs = require('fs');

const matches = db.prepare('SELECT matchId,homeName,visitName,leagueName,num,startTime,matchStatus,date FROM matches').all();
const recommends = db.prepare('SELECT matchId,type,num,result,fetchDate FROM recommends').all();

const data = { matches: {}, recommends: {} };
matches.forEach(m => { data.matches[String(m.matchId)] = m; });
recommends.forEach(r => {
  const key = String(r.matchId);
  if (!data.recommends[key]) data.recommends[key] = [];
  data.recommends[key].push({ type: r.type, num: r.num, result: r.result, fetchDate: r.fetchDate });
});

fs.writeFileSync('data.json', JSON.stringify(data));
console.log('matches:', Object.keys(data.matches).length);
console.log('recGroups:', Object.keys(data.recommends).length);
console.log('size:', (fs.statSync('data.json').size / 1024).toFixed(0), 'KB');
db.close();
