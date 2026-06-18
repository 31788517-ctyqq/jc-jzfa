<%@ page language="java" import="java.util.*" pageEncoding="UTF-8"%>
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
  <style type="text/css">
  <!--
	.tipBar {text-align:center;font-size:12px;line-height:20px;}
	.recharge-list a {padding-top:0; background-position:100% 30%;margin-top:-8px;}
	.bankcard {background:url(/imgs/rechargeSprite.png) no-repeat 20px 50%;background-size: 60px 250px;background-position: 10px -65px;}
	.saoma {background:url(/imgs/rechargeSprite.png) no-repeat 20px 50%;background-size: 55px 195px;background-position: 10px -145px;}
	.weixin {background:url(/imgs/rechargeSprite.png) no-repeat 20px 50%;background-size: 55px 195px;background-position: 10px -90px;}
	.alipay {background:url(/imgs/rechargeSprite.png) no-repeat 20px 50%;background-size: 55px 195px;background-position: 10px 0px;}
  	.jingdong {background:url(/imgs/jingdong.png) no-repeat;background-size: 52px 46px;background-position:10px 0px;}
  	.tagBox {position: relative;}
  	.tagZengsong {width: 45px;height: 45px;position: absolute;top: -13px;right: -1px;display: block;background-image: url(/imgs/donate.png);background-repeat: no-repeat;background-size: 45px;}
  	.tagTuijian {width: 45px;height: 45px;position: absolute;top: -13px;right: -1px;display: block;background-image: url(/imgs/recommend.png);background-repeat: no-repeat;background-size: 45px;}
  	.tagNewest {width: 45px;height: 45px;position: absolute;top: -13px;right: -1px;display: block;background-image: url(/imgs/newest.png);background-repeat: no-repeat;background-size: 45px;}
  	.btn{
  		display: inline-block;
	    padding: 3px 12px;
	    background: #0076ff;
	    color: #fff;
	    float: right;
	    line-height: 25px;
	    border-radius: 5px;
	    font-size:14px;
  	}
  -->
  </style>
<script type="text/javascript">
	function copy(value){
		var url = '';
		var UA = window.navigator.userAgent;
		var isIos = UA.indexOf("iPhone") > -1 || UA.indexOf("iPad") > -1;
		if(isIos){
			url = "objc://6value://"+value;
		}else{
			url = "objc://6"+value;
		}
		window.location.href = url;
	}
</script>
<div style="padding: 0 10px;">
	<p>尊敬的用户：</p><br>
	<p>咔咔已关闭所有站点打票业务，现专注于足球大数据研究，账号余额不受影响，可正常提款。</p><br>
	<p>目前胜平负和大小球两款小工具已新鲜出炉，各种数据一目了然、稳胆推荐免费奉送（复制以下地址即可打开浏览使用）</p><br>
	<p>地址</p><br>
	<p style="color: #0077ff;margin-bottom: 10px;">http://m.quncai.com/spfFilter/<a href="javascript:void(0);" class="btn" onclick="copy('http://m.quncai.com/spfFilter/')">复制</a></p>
  <p>欢迎大家使用和提出宝贵的意见，你们的支持是我们前进的动力！</p>
</div>
