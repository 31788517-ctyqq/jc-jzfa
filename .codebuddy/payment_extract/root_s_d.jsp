<%@ page language="java" import="java.util.*" pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="dns-prefetch" href="//img.quncai.com" />
  <link rel="apple-touch-icon-precomposed" href="http://img.quncai.com/images/wap/screen_icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black" />
  <meta name="format-detection" content="telephone=no">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon" sizes="64*64">
  <title>群彩App下载</title>
  <link rel="stylesheet" type="text/css" href="/css/index/index.css" />
  <style type="text/css">
  <!--
    body {background-color:#fff;}
	article,aside,footer,header,hgroup,main,nav,section {display:block;}
	center {display:block;text-align:center;}
	header {width:100%;height:56px;margin:10px 0;}
	.logo {width:250px;height:55px;display:block;background-position:-40px -238px;text-indent:-9999px;}
	.pc {width:160px;height:55px;display:block;background-position:-40px -156px;text-indent:-9999px;border-left:1px solid #8a8a8a;float:right;}
	.hide {display:none;}
	.ban img {width:100%;margin-top:-10px;}
	.ban_radar {background:url(http://img.quncai.com/images/wap/logo_radar.png) no-repeat center 0;background-size:180px 180px;height:190px;}
	.m {margin:0 20px;}
	.d {height:50px;border-radius:2px;margin:10px 0;line-height:50px;display:block;font-size:20px;color:#fff;text-align:center;}
	.d1 {background-color:#3eb5ed;}
	.d2 {background-color:#76c156;}
	.d3 {background-color:#fff;border:2px solid #3eb5ed;color:#3eb5ed;}
	.d4 {background-color:#fff;border:2px solid #76c156;color:#76c156;}
	.icon-i,.icon-a,.icon-ri,.icon-ra {width:36px;height:50px;display:inline-block;vertical-align:-17px;}
	.icon-i,.icon-a {background:url(http://img.quncai.com/images/wap/iphandr.png) no-repeat;background-size:50px 112px;}
	.icon-i {background-position:-10px 1px;}
	.icon-a {background-position:-10px -62px;}
	.icon-ri,.icon-ra {background:url(http://img.quncai.com/images/wap/iphandr2.png) no-repeat;background-size:50px 112px;}
	.icon-ri {background-position:-10px 1px;}
	.icon-ra {background-position:-10px -62px;}
	
	a {color:#8a8a8a;text-decoration:none;}
	span.s {border-left:1px solid #ccc;margin:0 10px;}
	.f {padding:30px 0 0;color:#666;}
	.f .gray {color:#ccc;vertical-align:5px;}
	.arrow-d {display:block;margin:-8px auto 0;width:9px;height:9px;border-left:1px solid #ccc;border-bottom:1px solid #ccc;content:'';-webkit-transform:rotate(-45deg);}
	.line-y {display:block;width:1px;height:50px;background-color:#ccc;margin:0 auto;}
	.space50 {height:50px;display:block;clear:both;}
	.lineBar {width:1px;margin:0 auto;position:relative;}
	.lineBar .line-y {top:-50px;left:-1px;height:60px;position:absolute;}
	
	.weixin-app-download-mask {background-color:#000;height:100%;opacity:0.6;position:fixed;width:100%;z-index:10;top:0;}
	.popup {height:100%;position:fixed;text-align:right;top:0;width:100%;z-index:11;}
	.popup img {width:95%;}
	.hide {display: none;}
	
	
  -->
  </style>
</head>

<body>
  <div id="weixin-app-download-mask" class="weixin-app-download-mask hide"></div>
  <article class="popup weixin-popup hide" onclick="javascript:closeCover();">
    <img src="http://img.quncai.com/images/wap/weixin.png" alt="微信提示">
  </article>
  
  <center>
    <!--<header>
        <a class="logo" href=""><img src="#" alt="群彩"></a>
        <a class="pc hide" href="http://m.quncai.com">群彩网页版</a>
    </header>-->
    <article>
        <div class="h ban">
            <img src="http://img.quncai.com/images/wap/d_p_01.png">
        </div>
		<div class="m">
		  <a id="android_dowlink" class="d d2" href="${andriodForwardUrl }" onclick="download('qc_android')"><i class="icon-a"></i><em id="qc_android">安装android客户端</em></a>
          <a id="ios_dowlink" class="d d1" href="${iosForwardUrl }" onclick="download('qc_ios')"><i class="icon-i"></i><em id="qc_ios">安装iPhone客户端</em></a>
        </div>
        <div class="f"><span class="gray">诚邀您下载由群彩第三方支持的“幸运站点”，享受移动站点带来的购买乐趣。</span><em class="arrow-d"></em><em class="line-y"></em></div>
    </article>
  </center>
  <script type="text/javascript">
  	function checkDevice(device) {
      return navigator.userAgent.toLowerCase().indexOf(device) != -1 ? 1 : 0;
    }
    function addClass(el,css){
        el.className = el.className+' '+css;
    }
    function removeClass(el,css){
        el.className = el.className.replace(css,'');
    }
    function closeCover(){
        removeClass(document.querySelector('.popup'),'show');
        addClass(document.querySelector('.popup'),'hide');
        removeClass(document.querySelector('.weixin-app-download-mask'),'show');
        addClass(document.querySelector('.weixin-app-download-mask'),'hide');
        return false;
    }
    function is_weixn(){
        var ua = navigator.userAgent.toLowerCase();
        if(ua.match(/MicroMessenger/i)=="micromessenger") {
            return true;
        } else {
            return false;
        }
    }
    function is_weibo(){
        var ua = navigator.userAgent.toLowerCase();
        if(ua.match(/Weibo/i)=="weibo") {
            return true;
        } else {
            return false;
        }
    }
    function download(btnId) {
      var id_djw = document.getElementById(btnId);
      var nowHtml=id_djw.innerHTML;
      id_djw.innerHTML = "加载中...";
      setTimeout(function(){
          id_dj.className = "b j";
          id_djw.innerHTML = nowHtml;
      },3000);
      setTimeout(function() {
          id_djw.innerHTML = nowHtml;
      }, 3000);
    };
    var ios_btn=document.getElementById("ios_dowlink");
    var android_btn=document.getElementById("android_dowlink");
    if(checkDevice('iphone')){
    		addClass(android_btn,'hide');
    	}else if(checkDevice('android')){
    		addClass(ios_btn,'hide');
    	}
   
    if(is_weixn()||is_weibo()){
        var tags = document.getElementsByTagName('a');
        for (var i=0;i<tags.length; i++) {
            if(tags[i].className=="d d1" ||tags[i].className=="d d2" ||tags[i].className=="d d3"||tags[i].className=="d d4"){
                tags[i].addEventListener('click',function(e){
                    e.preventDefault();
                    removeClass(document.querySelector('.popup'),'hide');
                    addClass(document.querySelector('.popup'),'show');
                    removeClass(document.querySelector('.weixin-app-download-mask'),'hide');
                    addClass(document.querySelector('.weixin-app-download-mask'),'show');
                    return false;
                });
            }
        }

    }
  </script>
</body>
</html>

