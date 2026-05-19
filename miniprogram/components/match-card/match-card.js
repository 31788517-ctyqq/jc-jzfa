const FORMAT = require('../../utils/format');
const DATE = require('../../utils/date');

Component({
  properties: {
    matchId: { type: String, value: '' },
    homeName: { type: String, value: '' },
    visitName: { type: String, value: '' },
    leagueName: { type: String, value: '' },
    startTime: { type: String, value: '' },
    matchStatus: { type: Number, value: 0 },
    score: { type: String, value: '' },
    recommNum: { type: Number, value: 0 },
    lastResult: { type: Number, value: null },
    num: { type: String, value: '' },
    date: { type: String, value: '' }
  },
  data: {
    statusText: '',
    scoreDisplay: 'VS',
    roundDisplay: '',
    displayTime: ''
  },
  observers: {
    matchStatus(status) {
      this.setData({ statusText: FORMAT.getStatusText(status) });
    },
    score(score) {
      this.setData({ scoreDisplay: score || 'VS' });
    },
    'startTime,date,num': function(startTime, date, num) {
      const roundDisplay = DATE.getRoundDisplay(date, num);
      const day = date ? date.slice(5).replace('-', '-') : '';
      this.setData({
        roundDisplay,
        displayTime: day ? `${day} ${startTime}` : startTime
      });
    }
  },
  methods: {
    handleTap() {
      this.triggerEvent('tap', { matchId: this.properties.matchId });
    }
  }
});
