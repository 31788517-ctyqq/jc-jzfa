// fix_scores.cjs — fetch Sporttery detail scores + patch data.json
var https = require('https');
var fs = require('fs');

var MATCHES = [
  { mid: '2040245', name: '厄瓜多尔 vs 库拉索', date: '2026-06-20' },
  { mid: '2040248', name: '比利时 vs 伊朗', date: '2026-06-21' },
];

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
        'Referer': 'https://www.lottery.gov.cn/',
      }
    }, function (res) {
      var d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () { resolve(d); });
    }).on('error', reject);
  });
}

function parseScore(html) {
  // Priority: num class spans
  var m = html.match(/<span[^>]*class="[^"]*num[^"]*"[^>]*>(\d+)<\/span>\s*[:：]\s*<span[^>]*class="[^"]*num[^"]*"[^>]*>(\d+)</);
  if (m) return m[1] + ':' + m[2];
  // Generic
  m = html.match(/(\d+)\s*[:：]\s*(\d+)/);
  if (m) return m[1] + ':' + m[2];
  return '';
}

async function main() {
  for (var i = 0; i < MATCHES.length; i++) {
    var m = MATCHES[i];
    try {
      var html = await httpGet(
        'https://www.sporttery.cn/jc/zqdz/index.html?showType=3&mid=' + m.mid
      );
      var score = parseScore(html);
      console.log(m.mid + ' (' + m.name + '): score=' + score);

      if (score && score !== '0:0' && score !== ':') {
        // Save odds file
        var oddsPath = '/root/server/sporttery_odds/' + m.mid + '.json';
        var oldOdds = {};
        try { oldOdds = JSON.parse(fs.readFileSync(oddsPath, 'utf8')); } catch (e) {}
        oldOdds.score = score;
        oldOdds._scraped_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        fs.writeFileSync(oddsPath, JSON.stringify(oldOdds, null, 2));

        // Patch data.json
        var dataJson = JSON.parse(fs.readFileSync('/root/server/data.json', 'utf8'));
        var matches = dataJson.m || {};
        var updated = false;
        Object.keys(matches).forEach(function (k) {
          if (k.indexOf(m.mid) >= 0) {
            matches[k].score = score;
            updated = true;
            console.log('  data.json: ' + matches[k].num + ' ' +
              matches[k].homeName + ' vs ' + matches[k].visitName +
              ' score=' + score);
          }
        });
        if (updated) {
          fs.writeFileSync('/root/server/data.json', JSON.stringify(dataJson, null, 2));
          console.log('  data.json saved');
        }
      }
    } catch (e) {
      console.log(m.mid + ': ERR ' + (e.message || '').slice(0, 100));
    }
  }
}

main().then(function () { process.exit(0); });
