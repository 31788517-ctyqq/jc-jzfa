const FORMAT = require('../../utils/format');
const DATE = require('../../utils/date');
const CONSTANTS = require('../../utils/constants');

function classifyDirection(direction) {
  if (!direction) return '综合';
  if (direction.indexOf('半全场') === 0) return '半全场';
  if (direction.indexOf('总进球') === 0) return '进球数';
  if (direction.indexOf('、') !== -1) return '双选';
  if (direction.indexOf('让') === 0) return '让球';
  if (['胜', '平', '负'].indexOf(direction) !== -1) return '胜平负';
  return '推荐';
}

Component({
  properties: {
    rank: { type: Number, value: 0 },
    matchId: { type: String, value: '' },
    homeName: { type: String, value: '' },
    visitName: { type: String, value: '' },
    leagueName: { type: String, value: '' },
    num: { type: String, value: '' },
    date: { type: String, value: '' },
    direction: { type: String, value: '' },
    expertCount: { type: Number, value: 0 },
    maxExpertCount: { type: Number, value: 1 }
  },
  data: {
    shortHome: '',
    shortAway: '',
    barPercent: 0,
    directionColor: '#12f1e7',
    rankClass: 'normal',
    metaText: '',
    categoryText: ''
  },
  observers: {
    rank(rank) {
      this.setData({ rankClass: rank <= 3 ? `top${rank}` : 'normal' });
    },
    'homeName,visitName': function(home, away) {
      this.setData({
        shortHome: FORMAT.truncateText(home, 9),
        shortAway: FORMAT.truncateText(away, 9)
      });
    },
    'expertCount,maxExpertCount': function(count, max) {
      const pct = max > 0 ? Math.max(12, Math.round(count / max * 100)) : 0;
      this.setData({ barPercent: pct });
    },
    direction(dir) {
      this.setData({
        directionColor: CONSTANTS.DIRECTION_COLORS[dir] || '#12f1e7',
        categoryText: classifyDirection(dir)
      });
    },
    'leagueName,date,num': function(leagueName, date, num) {
      const roundDisplay = DATE.getRoundDisplay(date, num);
      this.setData({ metaText: [leagueName, roundDisplay].filter(Boolean).join(' · ') });
    }
  },
  methods: {
    handleTap() {
      this.triggerEvent('tap', { matchId: this.properties.matchId });
    }
  }
});
