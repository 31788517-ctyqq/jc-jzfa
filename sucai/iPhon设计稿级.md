
---

# HTML

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>竞彩推荐监控</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>

<div class="page">

    <!-- Header -->
    <div class="header">
        <img class="logo" src="./images/logo.png">
        <span>竞彩推荐监控</span>
    </div>

    <!-- Banner -->
    <div class="banner">
        <img src="./images/banner.jpg">
    </div>

    <!-- Stats -->
    <div class="stats-wrap">

        <div class="stats-card">
            <div class="stats-num">4</div>
            <div class="stats-label">今日比赛</div>
            <div class="stats-bg football"></div>
        </div>

        <div class="stats-card">
            <div class="stats-num">173</div>
            <div class="stats-label">最多推荐</div>
            <div class="stats-bg shield"></div>
        </div>

    </div>

    <!-- Menu -->
    <div class="menu-list">

        <div class="menu-item">
            <div class="menu-left">

                <div class="menu-icon">
                    <img src="./images/icon-plan.svg">
                </div>

                <div>
                    <div class="menu-title">我要做方案</div>
                    <div class="menu-desc">
                        自定义方案和专家方案PK
                    </div>
                </div>

            </div>

            <div class="menu-arrow">›</div>
        </div>

        <div class="menu-item">
            <div class="menu-left">

                <div class="menu-icon">
                    <img src="./images/icon-profit.svg">
                </div>

                <div>
                    <div class="menu-title">方案收入比较</div>
                    <div class="menu-desc">
                        查看比较各类方案盈利情况
                    </div>
                </div>

            </div>

            <div class="menu-arrow">›</div>
        </div>

        <div class="menu-item">
            <div class="menu-left">

                <div class="menu-icon">
                    <img src="./images/icon-rank.svg">
                </div>

                <div>
                    <div class="menu-title">量化数据排行榜</div>
                    <div class="menu-desc">
                        量化数据排行及场次数据PK
                    </div>
                </div>

            </div>

            <div class="menu-arrow">›</div>
        </div>

        <div class="menu-item">
            <div class="menu-left">

                <div class="menu-icon">
                    <img src="./images/icon-hit.svg">
                </div>

                <div>
                    <div class="menu-title">推荐方向命中查询</div>
                    <div class="menu-desc">
                        查询推荐方向命中结果
                    </div>
                </div>

            </div>

            <div class="menu-arrow">›</div>
        </div>

        <div class="menu-item">
            <div class="menu-left">

                <div class="menu-icon">
                    <img src="./images/icon-history.svg">
                </div>

                <div>
                    <div class="menu-title">历史数据回测</div>
                    <div class="menu-desc">
                        融合AI和量化数据预测查询与分析
                    </div>
                </div>

            </div>

            <div class="menu-arrow">›</div>
        </div>

    </div>

</div>

<!-- Bottom Tab -->

<div class="tabbar">

    <div class="tab active">
        <img src="./images/tab-home.svg">
    </div>

    <div class="tab">
        <img src="./images/tab-ball.svg">
    </div>

    <div class="tab">
        <img src="./images/tab-chart.svg">
    </div>

    <div class="tab">
        <img src="./images/tab-report.svg">
    </div>

    <div class="tab">
        <img src="./images/tab-menu.svg">
    </div>

</div>

</body>
</html>
```

---

# CSS

```css
*{
    margin:0;
    padding:0;
    box-sizing:border-box;
}

body{
    background:#010C17;
    font-family:
    PingFang SC,
    Microsoft YaHei,
    sans-serif;
}

.page{

    width:100%;
    min-height:100vh;

    padding:
    28px
    24px
    140px;

    background:
    radial-gradient(
    circle at top center,
    #062845 0%,
    #021221 35%,
    #010C17 100%);
}

/* header */

.header{
    display:flex;
    align-items:center;
    gap:12px;
    margin-bottom:24px;
}

.logo{
    width:32px;
    height:32px;
}

.header span{
    font-size:20px;
    font-weight:700;
    color:#FFF;
}

/* banner */

.banner{
    width:100%;
    height:210px;

    border-radius:24px;

    overflow:hidden;

    border:1px solid
    rgba(0,236,255,.5);

    box-shadow:
    0 0 40px
    rgba(0,236,255,.15);
}

.banner img{
    width:100%;
    height:100%;
    object-fit:cover;
}

/* stats */

.stats-wrap{
    margin-top:28px;

    display:flex;
    gap:16px;
}

.stats-card{

    flex:1;

    height:140px;

    position:relative;

    border-radius:30px;

    overflow:hidden;

    border:1px solid
    rgba(0,236,255,.35);

    background:
    linear-gradient(
    180deg,
    rgba(7,39,69,.95),
    rgba(3,19,38,.95));

    box-shadow:
    0 0 24px
    rgba(0,236,255,.12);
}

.stats-num{

    text-align:center;

    margin-top:30px;

    font-size:58px;
    font-weight:700;

    color:#18F3FF;

    text-shadow:
    0 0 18px
    rgba(24,243,255,.6);
}

.stats-label{
    text-align:center;
    font-size:24px;
    color:#EAF9FF;
}

.stats-bg{

    position:absolute;
    right:-15px;
    bottom:-15px;

    opacity:.08;

    width:120px;
    height:120px;
}

.football{
    background:url(football.svg);
    background-size:contain;
}

.shield{
    background:url(shield.svg);
    background-size:contain;
}

/* menu */

.menu-list{
    margin-top:24px;
}

.menu-item{

    height:126px;

    margin-bottom:20px;

    padding:0 24px;

    display:flex;
    align-items:center;
    justify-content:space-between;

    border-radius:28px;

    border:1px solid
    rgba(0,236,255,.2);

    background:
    linear-gradient(
    90deg,
    rgba(7,39,69,.95),
    rgba(3,19,38,.95));

    box-shadow:
    0 0 18px
    rgba(0,236,255,.08);
}

.menu-left{
    display:flex;
    align-items:center;
}

.menu-icon{

    width:64px;
    height:64px;

    border-radius:50%;

    display:flex;
    align-items:center;
    justify-content:center;

    margin-right:18px;

    background:
    linear-gradient(
    180deg,
    rgba(0,255,255,.18),
    rgba(0,255,255,.08));

    border:1px solid
    rgba(0,255,255,.25);
}

.menu-icon img{
    width:28px;
}

.menu-title{

    color:#FFF;

    font-size:32px;
    font-weight:700;

    margin-bottom:8px;
}

.menu-desc{

    color:
    rgba(255,255,255,.55);

    font-size:22px;
}

.menu-arrow{

    color:
    rgba(255,255,255,.5);

    font-size:36px;
}

/* bottom */

.tabbar{

    position:fixed;

    left:24px;
    right:24px;
    bottom:24px;

    height:94px;

    border-radius:48px;

    display:flex;
    align-items:center;
    justify-content:space-around;

    background:
    rgba(5,20,40,.98);

    border:1px solid
    rgba(0,236,255,.2);

    backdrop-filter:blur(20px);

    box-shadow:
    0 0 40px
    rgba(0,236,255,.12);
}

.tab{

    width:54px;
    height:54px;

    display:flex;
    align-items:center;
    justify-content:center;
}

.tab img{
    width:32px;
    opacity:.5;
}

.tab.active{

    width:68px;
    height:68px;

    border-radius:50%;

    background:
    rgba(0,236,255,.08);

    box-shadow:
    0 0 30px
    rgba(0,236,255,.5);
}

.tab.active img{
    opacity:1;
}
```

### 这版与设计图一致的关键参数

| 模块       | 数值                    |
| -------- | --------------------- |
| 页面左右边距   | 24px                  |
| Banner高度 | 210px                 |
| Banner圆角 | 24px                  |
| 统计卡高度    | 140px                 |
| 统计卡圆角    | 30px                  |
| 功能卡高度    | 126px                 |
| 功能卡圆角    | 28px                  |
| 图标圆形背景   | 64×64                 |
| TAB高度    | 94px                  |
| TAB圆角    | 48px                  |
| 主发光色     | #18F3FF               |
| 页面背景     | #010C17               |
| 卡片背景     | #072745 → #031326     |
| 标题文字     | #FFFFFF               |
| 副标题文字    | rgba(255,255,255,.55) |


