<%@ page language="java" pageEncoding="UTF-8"%>
<%@ taglib prefix="s" uri="/struts-tags" %>
<%@ taglib uri="http://java.sun.com/jsp/jstl/core" prefix="c" %>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn"%>


<script type="text/javascript" src="/js/jquery-1.11.1.min.js"></script>
<script type="text/javascript" src="/js/mobile-common.js"></script>
<script type="text/javascript" src="/js/member/dorechargeNew.js?v=20210602"></script>
<script src="https://cdn.jsdelivr.net/clipboard.js/1.5.12/clipboard.min.js"></script>

<html>
  <head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black">
	<meta name="format-detection" content="telephone=no">
	<title>支付方式</title>
	<link type="text/css" rel="stylesheet" href="/css/style.css">
	<link type="text/css" rel="stylesheet" href="/css/global.css">
	<link type="text/css" rel="stylesheet" href="/css/mobile.css">
	<script type="text/javascript" src="/js/jquery-1.11.1.min.js"></script>
	<style type="text/css">
		.conBox {background: #fff;}
		.titleBar {padding: 1.0rem 1.5rem;font-size: 1.4rem;color: #666;background:#fff;}
		.titleBar em {font-size: 1.2rem; color: #999; font-style: italic;}
		.aui-cell-box {border-top: 1px solid #E7E7E7;padding:1.5rem 1rem 1.5rem 1.6rem}
		.aui-grids {position: relative;overflow: hidden;}
		.aui-grids a {width: 18%;float: left;position: relative;z-index: 0;margin: .5rem 1.5% 1rem 0;border: 1px solid #ddd;border-radius: 5px;color: #50b56a;text-align: center;font-size: 1.4rem;line-height: 2.8;}
		.aui-grids a:nth-child(5) {margin-right: 0;}
		.aui-grids a:nth-child(10) {margin-right: 0;}
		.aui-grids-item span {font-size: 1.8rem;width: 100%;font-weight:500}
		.aui-grids a.this-card {background: #50b56a;border: 1px solid #50b56a;color: #fff;}
		.le-spacing {letter-spacing:-1px}
		.btn-erea {padding: 2rem;text-align: center;margin-bottom: 20px;}
		.btn-erea span {font-size: 1.2rem;color: #999;display: inline-block;margin-bottom: 2rem}
		.btn-add-card {color: #fff;background: #ff5353;height: 4.4rem;line-height: 4.4rem;font-size: 2rem;display: block;border-radius: 2.2rem;position: relative;}
		.btn-add-card small {font-size:1.6rem}
		.apply-form li {position: relative;padding: 0 0 2rem 10rem;}
		.apply-form li label.must {font-size: 1.4rem; line-height: 4rem; color: #333; display: block; width: 8.5rem; position: absolute; left: 0; top: 0; text-align: right; }
		.apply-form input.res-inp {height: 4rem;line-height: 4rem; border-radius: 1rem; background-color: #fff; border: 1px solid #d2d2d2; padding-left: 1rem; -webkit-transition: border-color .4s; transition: border-color .4s; font-size: 1.6rem;}
		.apply-form.caijinca {padding-top:3rem}
		.apply-form.caijinca li {padding-left: 14rem;}
		.apply-form.caijinca li label.must {width: 12rem}
		.kefu-select{border-top: 1px solid #E7E7E7;padding:1.5rem 0 3rem 1.5rem;}
		.kefu-select li{display: flex;justify-content: center;align-items: center;border-bottom: 1px solid #E7E7E7;padding:1.5rem 1.5rem 1.5rem 1rem;}
		.kefu-select li:last-child {border-bottom:none}
		.kefu-select li dt {font-size:2rem;display:block;margin-bottom:.5rem;color:#333}
		.kefu-select li dt em {font-size:1.2rem;color:#999;font-style: italic;}
		.kefu-select li dd {font-size:1.6rem;display:block;margin-bottom:.5rem;color:#888;}
		.kefu-select li .kefu-intro {flex: 1;display: inline-block;}
		.kefu-select li .kefu-icon {width:6rem;height: 6rem;position: relative;margin: 0 2rem 0 0;border:1px solid #ededed;border-radius:3rem;overflow:hidden;background: #eee}
		.kefu-select li .kefu-icon.icon-wx {background: #00c401 url(../imgs/icon_oth01.png) no-repeat;background-size: 100%}
		.kefu-select li .kefu-icon.icon-wxma {background: #00c401 url(../imgs/icon_oth06.png) no-repeat;background-size: 100%}
		.kefu-select li dd a {display:inline-block;color:#01a563;padding:0 1rem;border:1px solid #01a563;border-radius:1rem;}
		.kefu-select li dd b {color:#01a563;font-weight:600}
		.wxma-box {padding:2rem;border-top: 1px solid #E7E7E7;}
		.wxma-box img {width:100%}
		
		
		.bank-list .magic-radio {position: absolute;display: none;}
		.magic-radio[disabled] {cursor: not-allowed;}
		.magic-radio+label {position: relative;cursor: pointer;vertical-align: middle;position: relative;display: -webkit-box;display: -webkit-flex;display: flex;-webkit-box-align: center;-webkit-align-items: center;align-items: center;padding:1.5rem 0;}
		.magic-radio+label:hover:before {animation-duration: 0.4s;animation-fill-mode: both;animation-name: hover-color;}
		.magic-radio+label:before {position: absolute;top: 10px;right: 0;display: inline-block;width: 2rem;height: 2rem;content: '';border: 1px solid #ccc;background-color: #fff;}
		.magic-radio+label:after {position: absolute;display: none;content: '';}
		.magic-radio[disabled]+label {cursor: not-allowed;color: #e4e4e4;}
		.magic-radio[disabled]+label:hover,
		.magic-radio[disabled]+label:before,
		.magic-radio[disabled]+label:after {cursor: not-allowed;}
		.magic-radio[disabled]+label:hover:before {	border: 1px solid #e4e4e4;	animation-name: none;}
		.magic-radio[disabled]+label:before {border-color: #e4e4e4;}
		.magic-radio:checked+label:after {	display: block;	}
		.magic-radio+label:before {	border-radius: 50%;	}
		.magic-radio:checked+label:before {	border: 1px solid #fff;	animation-name: none;}
		.magic-radio:checked[disabled]+label:before {border: 1px solid #c9e2f9;}
		.magic-radio:checked[disabled]+label:after {background: #c9e2f9;}
		.bank-box {	margin: 1.5rem 0;background:#fff}
		.bank-list li {	padding: 0 1.5rem;position: relative;}
		.bank-list li:after {content: " ";position: absolute;left: 1.6rem;right: 0;bottom: 0;width: auto;height: 1px;border-bottom: 1px solid #ccc;color: #dee4e8;-webkit-transform-origin: 0 100%;	transform-origin: 0 100%;-webkit-transform: scaleY(.5);	transform: scaleY(.5);}
		.bank-list li:last-child:after {border-bottom: none;}
		.zhifu-m dt {font-size: 1.8rem;color: #1f1f1f;}
		.zhifu-m dd {font-size: 1.3rem;	color: #999;}
		.bank-list li .magic-radio+label:before {top: 2.2rem;right: 0rem;width: 2.5rem;height: 2.5rem;}
		.bank-list li .magic-radio+label:after {top: 2.2rem;right: 0rem;width: 2.8rem;height: 2.8rem;background: url('../images/icon_checked.png') no-repeat 0 0;background-size: 2.8rem;}
		.zhifu-b {-webkit-box-flex: 1;-webkit-flex: 1;	flex: 1;min-width: 0;margin-left:2rem;}
		.bank-logo {width: 4.5rem;height: 4.5rem;border:2px solid #09f;border-radius:1.5rem}
	</style>
  </head>
  <body class="bgf1f1f1">
		<!--wap头部文件begin-->
		<div class="top"> 
			<a class="back" href="javascript:void(0);" onclick="checkToBack();">返回</a>
			<h1>支付方式</h1>
		</div>
		<!--wap头部文件end-->
		<div id="box">
			<dl class="siftingnav">
				<dd class="cur">支付宝支付</dd>
				<dd class="">微信支付</dd>
				<!--<dd class="">收款码支付</dd>
				<dd class="">彩金卡支付</dd>-->
			</dl>
			<!--支付宝支付 begin-->
			<form onsubmit="return checkPayForm();" id="recharge_form" action="/member/recharge.php">
				<input type="hidden" value="51" name="chargeType" id="chargeType">
				<input type="hidden" value="2" name="isNumber" id="isNumber">
				<input type="hidden" value="${station}" name="station" id="station">
				<input type="hidden" value="15" name="dataMin" id="dataMin">
				<input type="hidden" value="10000" name="dataMax" id="dataMax">
				<input type="hidden" value="<%=System.currentTimeMillis()%>" name="version" id="version">
			<section class="hide" style="display:block;">
				<div class="conBox mt10">
					<div class="titleBar"><i></i><label class="text">请选择充值金额</label></div>
					<div class="aui-cell-box">
						<div class="aui-grids">
							<a href="javascript:;" class="aui-grids-item this-card" data-id="25">
								<span>25</span> 元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="49">
								<span>49</span> 元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="250">
								<span>250</span> 元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="490">
								<span>490</span> 元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="999">
								<span>999</span>元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="1000">
								<span class="le-spacing">1000</span>元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="2000">
								<span class="le-spacing">2000</span>元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="3000">
								<span class="le-spacing">3000</span>元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="5000">
								<span class="le-spacing">5000</span>元
							</a>
							<a href="javascript:;" class="aui-grids-item" data-id="9999">
								<span class="le-spacing">9999</span>元
							</a>
						</div>
						<script type="text/javascript">

							$('.aui-grids-item').click(function(e){

								$(this).addClass('this-card').siblings().removeClass('this-card');

								$('#type-amount').html($(this).find('.cardAmount').html());

							})
						</script>
					</div>
					<ul class="apply-form clearfix">
						<li>
							<label for="" class="must">充值金额 : </label>
							<input type="tel" value="25" id="amount" name="amount" class="res-inp" placeholder="请输入充值金额(元)">
						</li>
					</ul>
				</div>
				<div class="conBox mt10">
					<!--选择支付方式begin-->
					<div class="titleBar"><i></i><label class="text">请选择充值方式 : <em>(如有问题, 请联系在线客服)</em></label></div>
					<div class="aui-cell-box">
						<ul class="bank-list">
							<c:set var="nowDate" value="<%=new java.util.Date() %>"/>
							<s:iterator value="stationPayList" id="station" status="st">
							<c:if test="${chargeType.value == 51}">
								<li data-type="51" data-min="15" data-max="10000">
									<input class="magic-radio" type="radio" name="radio" id="${chargeType.value}" value="${chargeType.value}" checked="">
									<label class="zhifu-m" for="${chargeType.value}">
										<img src="../images/alipay.png" alt="" class="bank-logo">
										<dl class="zhifu-b">
											<dt>支付宝H5支付</dt>
											<dd>最低充值15元 , 最高10000元</dd>
										</dl>
									</label>
								</li>
							</c:if>
								<c:if test="${chargeType.value == 50}">
									<c:if test="${nowDate.hours >= 7 && nowDate.hours < 23}">
										<li>
											<input class="magic-radio" type="radio" name="radio" id="${chargeType.value}"
												   value="${chargeType.value}">
											<label class="zhifu-m" for="${chargeType.value}">
												<img src="../images/alipay.png" alt="" class="bank-logo">
												<dl class="zhifu-b">
													<dt>支付宝支付</dt>
													<dd>最低充值15元 , 最高500元</dd>
												</dl>
											</label>
										</li>
									</c:if>
								</c:if>
							</s:iterator>
						</ul>
					</div>
					<!--选择支付方式end-->
				</div>
				<div class="btn-erea">
					<span>充值金额只可用于消费，奖金方可提现，建议消费多少充值多少</span>
					<c:if test="${stationPayList!=null && fn:length(stationPayList) > 0}">
						<a onclick="document:recharge_form.submit()" class="btn-add-card" >确认充值</a>
					</c:if>
				</div>
			</section>
			</form>
			<!--微信支付 begin-->
			<section class="hide" style="">
				<div class="conBox mt10">
					<div class="titleBar">联系店主微信充值，充送1%</div>
					<ul class="kefu-select">
						<li><div class="kefu-icon icon-wx"></div><dl class="kefu-intro"><dt>${lotteryStation.ownerName} <em>${lotteryStation.shortName}</em></dt><dd id="copy_btn">
						店主微信：<b>${lotteryStation.weiXin}</b> <a class="btnCopyWXNumber" id="btnCopyWXNumber" value="${lotteryStation.weiXin}" href="javascript:;">复制</a></dd></dl></li>
					</ul>
				</div>

				<div class="btn-erea">
					<span>充值金额只可用于消费，奖金方可提现，建议消费多少充值多少</span>
<%--					<a href="javascript:;" class="btn-add-card">确认充值</a>--%>
				</div>
			</section>
			<!--收款码支付 begin-->
			<section class="hide" style="">
				<div class="conBox mt10">
					<div class="wxma-box"><img src="../imgs/wxma.jpg"></div>
					<ul class="kefu-select">
						<li><div class="kefu-icon icon-wxma"></div><dl class="kefu-intro"><dt>李嘉桦 <em>枫叶路投注站</em></dt><dd>微信：<b>aiqiu2022</b> <a href="javascript:;">复制</a></dd><dd>电话：<b>13812345678</b> <!--a href="javascript:;">拨打</a--></dd></dl></li>
					</ul>
				</div>

				<div class="btn-erea">
					<span>充值金额只可用于消费，奖金方可提现，建议消费多少充值多少</span>
					<a href="javascript:;" class="btn-add-card">上传凭证 <small>( 已传 )</small></a>
				</div>
			</section>
			<!--彩金卡支付 begin-->
			<section class="hide" style="">
				<div class="conBox mt10">
					<ul class="apply-form caijinca clearfix">
						<li class=""><label for="" class="must">输入彩金卡号 : </label><input type="text" id="" name="contact_person_mobile" class="res-inp" placeholder="请输入兑换码"></li>
					</ul>
				</div>

				<div class="btn-erea">
					<span>有问题加微信：aiqiu2022</span>
					<a href="javascript:;" class="btn-add-card">确认兑换</a>
				</div>
			</section>
			<!--彩金卡支付 end-->
		</div>
	</body>
	<script type="text/javascript">
		var btnCopyWXNumber = new Clipboard ('.btnCopyWXNumber', {
			text: function () {
				custom_alert ("微信号复制成功");
				return "${lotteryStation.weiXin}";
			}
		});

	window.onload = function() {
		var oBox = document.getElementById('box');
		var oLi = oBox.getElementsByTagName('dl')[0].getElementsByTagName('dd');
		var oDiv = oBox.getElementsByTagName('section');
		for (var i = 0; i < oLi.length; i++) {
			oLi[i].index = i;
			oLi[i].onclick = function() {
				for (var i = 0; i < oLi.length; i++) {
					oLi[i].className = ''
					oDiv[i].style.display = ''
				}
				this.className = 'cur'

				oDiv[this.index].style.display = 'block'
			}
		}
	}
	</script>
</html>
