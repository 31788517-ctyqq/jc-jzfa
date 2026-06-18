<%@ page language="java" contentType="text/html; charset=UTF-8"
	pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core"%>
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>咔咔</title>
</head>
<body>
	<script type="text/javascript">
		//调用支付宝JS api 支付

		var options = {

			"tradeNO" : "${request.tradeNO}"

		};

		AlipayJSBridge.call('tradePay', options, function(result) {

			if (result.resultCode == '9000') {

				//location.href = "/alipay_success.shtml";//支付成功后跳转处理

			}

		});
	</script>
</body>
</html>
