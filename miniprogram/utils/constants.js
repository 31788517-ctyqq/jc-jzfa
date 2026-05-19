const CONSTANTS = {
  MIDOU_BASE_URL: 'https://midou310.com/mdsj',
  MIDOU_LOGIN_API: '/gduser/login.do',
  MIDOU_MATCH_LIST_API: '/score/footballDataList.do',
  MIDOU_RECOMMEND_API: '/score/getExpertRecommData.do',

  CRAWL_START_HOUR: 11,
  CRAWL_INTERVAL_MIN: 30,
  CRAWL_END_HOUR: 23,

  HIT_RATE_DAYS: 60,
  AUTO_REFRESH_INTERVAL: 30,

  RANKING_TOP_N: 20,
  RANKING_MEDALS: ['1', '2', '3'],

  MATCH_STATUS: {
    NOT_STARTED: 0,
    IN_PROGRESS: 1,
    FINISHED: 2,
    CANCELLED: 3,
    POSTPONED: 4
  },

  RESULT: {
    HIT: 1,
    MISS: 0,
    PENDING: null
  },

  TAG_COLORS: {
    HIT: 'green',
    MISS: 'default',
    PENDING: 'default'
  },

  DIRECTION_COLORS: {
    '胜': '#6fe027',
    '平': '#ff2d35',
    '负': '#23a8ff',
    '让胜': '#12f1e7',
    '让平': '#ffb21c',
    '让负': '#8ee849',
    '胜平': '#7ed321',
    '平负': '#ff2d35',
    '胜负': '#ffb21c',
    '胜、平': '#ff2d35',
    '平、负': '#ff2d35',
    '胜、负': '#ffb21c',
    '总进球-0、1球': '#23a8ff',
    '总进球-2、3球': '#23a8ff',
    '总进球-4、5球': '#23a8ff',
    '总进球-6、7+球': '#23a8ff',
    '半全场-胜胜': '#7ed321',
    '半全场-胜平': '#7ed321',
    '半全场-胜负': '#7ed321',
    '半全场-平胜': '#7ed321',
    '半全场-平平': '#7ed321',
    '半全场-平负': '#7ed321',
    '半全场-负胜': '#7ed321',
    '半全场-负平': '#7ed321',
    '半全场-负负': '#7ed321'
  },

  DIRECTION_LABELS: [
    { text: '综合排名', value: '' },
    { text: '胜平负', value: '胜平负' },
    { text: '半全场', value: '半全场' },
    { text: '进球数', value: '进球数' },
    { text: '双选', value: '双选' },
    { text: '让球', value: '让球' }
  ]
};

module.exports = CONSTANTS;
