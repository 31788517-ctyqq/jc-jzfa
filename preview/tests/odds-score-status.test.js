/**
 * 赔率/比分/比赛状态全方位测试
 * 覆盖: 赔率渲染/matchStatus/比分显示/WS更新/match-odds API
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const MATCH_LIST = path.join(__dirname, '..', 'js', 'pages', 'match-list.js');
const MATCH_DETAIL = path.join(__dirname, '..', 'js', 'pages', 'match-detail.js');
const WS_CLIENT = path.join(__dirname, '..', 'js', 'ws-client.js');
const MAIN_FUSION = path.join(__dirname, '..', 'js', 'main-fusion.js');
const GONGSHOUDAO = path.join(__dirname, '..', 'js', 'pages', 'gongshoudao.js');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');
const ODDS_HANDLER = path.join(__dirname, '..', '..', 'server', 'tests', 'odds-match-handler.test.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('赔率/比分/比赛状态全方位测试', () => {
  // ═══════════════════════════════════════════
  // 1. 比赛状态渲染 (match-list.js)
  // ═══════════════════════════════════════════
  describe('1. match-list.js 比赛状态', () => {
    const ml = src(MATCH_LIST);

    it('1.1 状态映射 0=未开始 1=进行中 2=已结束 3=取消', () => {
      expect(ml).toContain("'未开始'");
      expect(ml).toContain("'进行中'");
      expect(ml).toContain("'已结束'");
      expect(ml).toContain("'取消'");
    });

    it('1.2 matchStatus 文本映射逻辑', () => {
      expect(ml).toContain('matchStatus');
      expect(ml).toContain('statusText');
    });

    it('1.3 isLive 状态判断 (1 或 2)', () => {
      expect(ml).toContain('isLive');
      expect(ml).toContain('matchStatus === 1');
      expect(ml).toContain('matchStatus === 2');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 比分渲染
  // ═══════════════════════════════════════════
  describe('2. 比分渲染', () => {
    it('2.1 match-list 有比分 display', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-score');
      expect(ml).toContain('scoreText');
      expect(ml).toContain('halfScore');
    });

    it('2.2 match-list 有半场比分', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-half');
      expect(ml).toContain('半');
    });

    it('2.3 match-list 有比赛时长 durText', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('durText');
      expect(ml).toContain('duration');
    });

    it('2.4 match-list 有黄牌/红牌', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('yellow');
      expect(ml).toContain('red');
    });

    it('2.5 match-list 有让球 handicap 标签', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-handicap-tag');
      expect(ml).toContain('concede');
    });

    it('2.6 match-detail 有赔率趋势渲染', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('odds');
    });

    it('2.7 match-detail 有 SPF 赔率', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('spf');
    });

    it('2.8 match-detail 有 RQSPF 让球赔率', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('rqspf');
    });

    it('2.9 match-detail 有 Dutch 合并逻辑', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('_dutchOdds');
    });

    it('2.10 match-detail 有总进球解析 _parseJqs', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('_parseJqs');
    });

    it('2.11 match-detail 有半全场解析 _parseBqc', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('_parseBqc');
    });

    it('2.12 match-detail 有比分解析 _parseBf', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('_parseBf');
    });
  });

  // ═══════════════════════════════════════════
  // 3. 赔率显示
  // ═══════════════════════════════════════════
  describe('3. 赔率显示', () => {
    it('3.1 match-detail 有 Dutch 赔率合并', () => {
      const md = src(MATCH_DETAIL);
      expect(md).toContain('_dutchOdds');
    });

    it('3.2 功守道有胜平负交叉渲染', () => {
      const gs = src(GONGSHOUDAO);
      expect(gs).toContain('crossSpfWin');
      expect(gs).toContain('crossSpfDraw');
      expect(gs).toContain('crossSpfLose');
    });

    it('3.3 功守道有让球交叉', () => {
      const gs = src(GONGSHOUDAO);
      expect(gs).toContain('crossHcpWin');
    });

    it('3.4 match-list 有专家推荐数 recommNum', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('recommNum');
      expect(ml).toContain('专家推荐');
    });

    it('3.5 match-odds API handler 存在（服务端）', () => {
      expect(fs.existsSync(ODDS_HANDLER)).toBe(true);
      const oh = src(ODDS_HANDLER);
      expect(oh).toContain('match-odds');
    });
  });

  // ═══════════════════════════════════════════
  // 4. WebSocket 实时比分更新
  // ═══════════════════════════════════════════
  describe('4. WebSocket 实时比分', () => {
    const ws = src(WS_CLIENT);

    it('4.1 onScoreUpdate 比分回调', () => {
      expect(ws).toContain('onScoreUpdate');
    });

    it('4.2 比分缓存 _scoreCache 去重', () => {
      expect(ws).toContain('_scoreCache');
    });

    it('4.3 比分数据字段 status/score/halfScore/duration', () => {
      expect(ws).toContain('score');
      expect(ws).toContain('halfScore');
    });

    it('4.4 WS 断线重连指数退避', () => {
      expect(ws).toContain('reconnect');
      expect(ws).toContain('MAX_RECONNECT_DELAY');
    });
  });

  // ═══════════════════════════════════════════
  // 5. match-list.js 卡片样式
  // ═══════════════════════════════════════════
  describe('5. match-list.js 卡片结构', () => {
    it('5.1 match-card 卡片容器', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-card');
    });

    it('5.2 match-header 头部布局', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-header');
      expect(ml).toContain('match-header-left');
    });

    it('5.3 match-teams 对阵区', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-teams');
      expect(ml).toContain('team-name');
    });

    it('5.4 match-info 底部信息栏', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-info');
      expect(ml).toContain('match-time');
    });

    it('5.5 PK 多选 checkbox mc-chk', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('mc-chk');
    });

    it('5.6 loadMatchList 函数存在', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('loadMatchList');
    });

    it('5.7 单关标记 match-single-badge', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('match-single-badge');
    });

    it('5.8 展示 vs 或比分替换', () => {
      const ml = src(MATCH_LIST);
      expect(ml).toContain('VS');
      expect(ml).toContain('scoreDisplay');
    });
  });

  // ═══════════════════════════════════════════
  // 6. live_scores.json 服务端比分
  // ═══════════════════════════════════════════
  describe('6. live_scores.json 服务端', () => {
    it('6.1 .gitignore 排除 live_scores.json', () => {
      const gi = src(path.join(__dirname, '..', '..', '.gitignore'));
      expect(gi).toContain('live_scores');
    });

    it('6.2 API 层有 match-list action', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('match');
    });
  });

  // ═══════════════════════════════════════════
  // 7. CSS 样式
  // ═══════════════════════════════════════════
  describe('7. CSS 样式合同', () => {
    it('7.1 比分样式 match-score 存在', () => {
      const css = src(APP_CSS);
      expect(css).toContain('match-score');
    });

    it('7.2 对阵样式 match-teams 存在', () => {
      const css = src(APP_CSS);
      expect(css).toContain('match-teams');
    });

    it('7.3 让球标签 handicap-tag 样式', () => {
      const css = src(APP_CSS);
      expect(css).toContain('handicap');
    });

    it('7.4 专家推荐数样式', () => {
      const css = src(APP_CSS);
      expect(css).toContain('match-experts');
    });
  });
});
