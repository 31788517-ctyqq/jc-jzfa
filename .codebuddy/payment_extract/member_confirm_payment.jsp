<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>
<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1.0, maximum-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="shortcut icon" href="/favicon.ico" type="image/x-icon">
<title>群彩</title>
<link type="text/css" rel="stylesheet" href="/css/global.css" />
<!--[if lt IE 9]>
        <link rel="stylesheet" href="css/ie.css?v=20140416" />
    <![endif]-->
    <script type="text/javascript" src="/js/jquery-1.11.1.min.js"></script>
</head>
<body>
	<div>
		<c:if test="${isPass }">
			方案号:${lotteryPlan.planNo}<br>
			方案金额:${lotteryPlan.amount}<br>
			需要支付金额:${order.amount}
			<br>
			<c:if test="${isBalancEnough }">
				<a href="javascript:pay('${token}');">进行支付</a>
			</c:if>
			<c:if test="${!isBalancEnough }">
				余额不足
			</c:if>
		</c:if>
		<c:if test="${!isPass}">
			<p>校验不通过!</p>
		</c:if>
	</div>
</body>
<script type="text/javascript">
	var errorMessage = '${errorMessage}';
	if(errorMessage != null && errorMessage != '') {
		alert(errorMessage);
	}
	var isSub = false;
	function pay(token){
		var url = "/trade/pay.php?token=" + token;
		isSub = true;
		$.ajax({
			url: url, 
			type: "POST", 
			success:function(data){
				var datamessage = eval("("+data+")");
				if(datamessage.code == "0"){
					alert("恭喜您!支付成功!")
				} else{
					alert(datamessage.message);
				}
				isSub = false;
			},
			error: function(){
				alert("提交失败");
				isSub = false;
			}
		});
	}
</script>
</html>