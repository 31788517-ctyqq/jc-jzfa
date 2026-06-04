/**
 * P2: state.test.js — 全局状态管理 单元测试
 * 覆盖: 状态变量默认值、Setter/Getter 正确性
 */
import {
  currentPage, detailMatchId, lastPage, savedScrollY,
  weekDates, selectedWeekIdx, selectedMatchDate,
  selectedCategory, selectedDirection, rankDate, rankDateOffset,
  planDate, planDateOffset, planDateExplicit, planTab, incomeLoaded,
  setCurrentPage, setDetailMatchId, setLastPage, setSavedScrollY,
  setWeekDates, setSelectedWeekIdx,
  setSelectedCategory, setSelectedDirection,
  setRankDate, setRankDateOffset,
  setPlanDate, setPlanDateOffset, setPlanDateExplicit, setPlanTab,
  setIncomeLoaded, lastScrollY_nav, setLastScrollYNav,
} from '../js/state.js';

describe('state — 默认值', () => {
  it('currentPage 默认 home', () => {
    expect(currentPage).toBe('home');
  });

  it('detailMatchId 默认 null', () => {
    expect(detailMatchId).toBe(null);
  });

  it('selectedWeekIdx 默认 0', () => {
    expect(selectedWeekIdx).toBe(0);
  });

  it('planTab 默认 my', () => {
    expect(planTab).toBe('my');
  });

  it('incomeLoaded 默认 false', () => {
    expect(incomeLoaded).toBe(false);
  });

  it('planDateExplicit 默认 false', () => {
    expect(planDateExplicit).toBe(false);
  });

  it('rankDateOffset 默认 0', () => {
    expect(rankDateOffset).toBe(0);
  });

  it('planDateOffset 默认 0', () => {
    expect(planDateOffset).toBe(0);
  });

  it('savedScrollY 默认 0', () => {
    expect(savedScrollY).toBe(0);
  });
});

describe('state — Setters', () => {
  it('setCurrentPage 更新 currentPage', () => {
    setCurrentPage('ranking');
    expect(currentPage).toBe('ranking');
    setCurrentPage('home'); // 恢复
  });

  it('setDetailMatchId 更新 detailMatchId', () => {
    setDetailMatchId('match_123');
    expect(detailMatchId).toBe('match_123');
    setDetailMatchId(null); // 恢复
  });

  it('setLastPage 更新 lastPage', () => {
    setLastPage('match-detail');
    expect(lastPage).toBe('match-detail');
    setLastPage('home'); // 恢复
  });

  it('setSavedScrollY 更新 savedScrollY', () => {
    setSavedScrollY(500);
    expect(savedScrollY).toBe(500);
    setSavedScrollY(0);
  });

  it('setWeekDates 更新 weekDates', () => {
    const dates = ['2026-06-01', '2026-06-02'];
    setWeekDates(dates);
    expect(weekDates).toEqual(dates);
    setWeekDates([]); // 恢复
  });

  it('setSelectedWeekIdx 更新 selectedWeekIdx', () => {
    setSelectedWeekIdx(2);
    expect(selectedWeekIdx).toBe(2);
    setSelectedWeekIdx(0);
  });

  it('setSelectedCategory 更新 selectedCategory', () => {
    setSelectedCategory('胜平负');
    expect(selectedCategory).toBe('胜平负');
    setSelectedCategory('');
  });

  it('setSelectedDirection 更新 selectedDirection', () => {
    setSelectedDirection('胜');
    expect(selectedDirection).toBe('胜');
    setSelectedDirection('');
  });

  it('setRankDate 更新 rankDate', () => {
    setRankDate('2026-06-15');
    expect(rankDate).toBe('2026-06-15');
    setRankDate('');
  });

  it('setRankDateOffset 更新 rankDateOffset', () => {
    setRankDateOffset(-3);
    expect(rankDateOffset).toBe(-3);
    setRankDateOffset(0);
  });

  it('setPlanDate 更新 planDate', () => {
    setPlanDate('2026-06-20');
    expect(planDate).toBe('2026-06-20');
    setPlanDate('');
  });

  it('setPlanDateOffset 更新 planDateOffset', () => {
    setPlanDateOffset(5);
    expect(planDateOffset).toBe(5);
    setPlanDateOffset(0);
  });

  it('setPlanDateExplicit 更新 planDateExplicit', () => {
    setPlanDateExplicit(true);
    expect(planDateExplicit).toBe(true);
    setPlanDateExplicit(false);
  });

  it('setPlanTab 更新 planTab', () => {
    setPlanTab('score');
    expect(planTab).toBe('score');
    setPlanTab('my');
  });

  it('setIncomeLoaded 更新 incomeLoaded', () => {
    setIncomeLoaded(true);
    expect(incomeLoaded).toBe(true);
    setIncomeLoaded(false);
  });

  it('setLastScrollYNav 更新 lastScrollY_nav', () => {
    setLastScrollYNav(300);
    expect(lastScrollY_nav).toBe(300);
    setLastScrollYNav(0);
  });
});
