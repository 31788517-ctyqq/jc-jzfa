const theme = {
  '--color-primary': '#12f1e7',
  '--color-primary-light': '#5ffff6',
  '--color-primary-bg': 'rgba(18,241,231,0.10)',
  '--color-win': '#6fe027',
  '--color-lose': '#ff2d35',
  '--color-pending': 'rgba(255,255,255,0.48)',
  '--color-text-primary': '#ffffff',
  '--color-text-secondary': 'rgba(255,255,255,0.68)',
  '--color-text-tertiary': 'rgba(255,255,255,0.48)',
  '--color-bg-page': '#001018',
  '--color-bg-card': 'rgba(2,28,36,0.86)',
  '--color-border': 'rgba(64,233,227,0.16)',
  '--color-shadow': 'rgba(0,0,0,0.38)',
  '--spacing-xs': '8rpx',
  '--spacing-sm': '16rpx',
  '--spacing-md': '24rpx',
  '--spacing-lg': '32rpx',
  '--spacing-xl': '48rpx',
  '--font-h1': '36rpx',
  '--font-h2': '32rpx',
  '--font-h3': '28rpx',
  '--font-body': '26rpx',
  '--font-small': '22rpx',
  '--font-caption': '20rpx'
};

App({
  theme,
  globalData: {
    today: '',
    userToken: ''
  },
  onLaunch() {
    const date = new Date();
    this.globalData.today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
});
