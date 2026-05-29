// 全局共享状态
export let currentPage = 'home';
export let detailMatchId = null;
export let lastPage = 'home';
export let savedScrollY = 0;

// 比赛列表
export let weekDates = [];
export let selectedWeekIdx = 0;
export let selectedMatchDate = '';

// 排行榜
export let selectedCategory = '';
export let selectedDirection = '';
export let rankDate = '';
export let rankDateOffset = 0;

// 方案列表
export let planDate = '';
export let planDateOffset = 0;
export let planDateExplicit = false;  // 标记日历直接选日，loadPlanList应直接发送该日期
export let planTab = 'expert'; // 'expert' | 'score' | 'quant'

// 方案收入缓存
export let incomeLoaded = false;

// 导航栏滚动
export let lastScrollY_nav = 0;
export function setLastScrollYNav(v) { lastScrollY_nav = v; }

// Setters
export function setCurrentPage(v) { currentPage = v; }
export function setDetailMatchId(v) { detailMatchId = v; }
export function setLastPage(v) { lastPage = v; }
export function setSavedScrollY(v) { savedScrollY = v; }
export function setWeekDates(v) { weekDates = v; }
export function setSelectedWeekIdx(v) { selectedWeekIdx = v; }
export function setSelectedCategory(v) { selectedCategory = v; }
export function setSelectedDirection(v) { selectedDirection = v; }
export function setRankDate(v) { rankDate = v; }
export function setRankDateOffset(v) { rankDateOffset = v; }
export function setPlanDate(v) { planDate = v; }
export function setPlanDateOffset(v) { planDateOffset = v; }
export function setPlanDateExplicit(v) { planDateExplicit = v; }
export function setPlanTab(v) { planTab = v; }
export function setIncomeLoaded(v) { incomeLoaded = v; }
