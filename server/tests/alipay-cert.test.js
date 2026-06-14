const PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA0\n-----END PRIVATE KEY-----';

function setSandboxEnv() {
  process.env.ALIPAY_ENABLED = 'true';
  process.env.ALIPAY_MODE = 'cert';
  process.env.ALIPAY_SANDBOX = 'true';
  process.env.ALIPAY_APP_ID = '2021006161653361';
  process.env.ALIPAY_SELLER_ID = '2088040915526659';
  process.env.ALIPAY_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
  process.env.ALIPAY_SIGN_TYPE = 'RSA2';
  process.env.ALIPAY_NOTIFY_URL = 'https://zj.100qiu.com/api/payments/notify';
  process.env.ALIPAY_RETURN_URL = 'https://zj.100qiu.com/preview/index.html#payment-result';
  process.env.ALIPAY_APP_PRIVATE_KEY = PRIVATE_KEY;
  process.env.ALIPAY_APP_CERT_PATH = '/root/server/keys/alipay/appCertPublicKey_2021006161653361.crt';
  process.env.ALIPAY_PUBLIC_CERT_PATH = '/root/server/keys/alipay/alipayCertPublicKey_RSA2.crt';
  process.env.ALIPAY_ROOT_CERT_PATH = '/root/server/keys/alipay/alipayRootCert.crt';
}

function clearAlipayEnv() {
  [
    'ALIPAY_ENABLED',
    'ALIPAY_MODE',
    'ALIPAY_SANDBOX',
    'ALIPAY_APP_ID',
    'ALIPAY_SELLER_ID',
    'ALIPAY_GATEWAY',
    'ALIPAY_SIGN_TYPE',
    'ALIPAY_NOTIFY_URL',
    'ALIPAY_RETURN_URL',
    'ALIPAY_APP_PRIVATE_KEY',
    'ALIPAY_APP_PRIVATE_KEY_PATH',
    'ALIPAY_APP_CERT_PATH',
    'ALIPAY_PUBLIC_CERT_PATH',
    'ALIPAY_ROOT_CERT_PATH',
  ].forEach((key) => delete process.env[key]);
}

describe('支付宝证书模式集成', () => {
  let capturedConfig;
  let capturedPage;

  beforeEach(() => {
    jest.resetModules();
    clearAlipayEnv();
    capturedConfig = null;
    capturedPage = null;
    jest.doMock('alipay-sdk', () => ({
      AlipaySdk: class MockAlipaySdk {
        constructor(config) {
          capturedConfig = config;
        }

        pageExecute(method, httpMethod, params) {
          capturedPage = { method, httpMethod, params };
          return `https://sandbox-pay.example/${method}?out_trade_no=${params.bizContent.outTradeNo}`;
        }

        checkNotifySign(params) {
          return params.sign === 'ok';
        }
      },
    }));
  });

  afterEach(() => {
    jest.dontMock('alipay-sdk');
    clearAlipayEnv();
  });

  test('读取沙箱证书模式配置', () => {
    setSandboxEnv();
    const { getAlipayConfig } = require('../payments/alipay');
    const config = getAlipayConfig();

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('cert');
    expect(config.sandbox).toBe(true);
    expect(config.appId).toBe('2021006161653361');
    expect(config.sellerId).toBe('2088040915526659');
    expect(config.gateway).toContain('openapi-sandbox');
  });

  test('桌面端生成 alipay.trade.page.pay 证书模式支付链接', async () => {
    setSandboxEnv();
    const { createPaymentUrl } = require('../payments/alipay');
    const result = await createPaymentUrl({
      orderNo: 'ZJ202606130001',
      amount: 9800,
      planCode: 'monthly',
      planName: '月度套餐',
      userAgent: 'Mozilla/5.0 Windows NT',
    });

    expect(result.mode).toBe('alipay_sandbox_cert');
    expect(result.method).toBe('alipay.trade.page.pay');
    expect(result.paymentUrl).toContain('ZJ202606130001');
    expect(capturedConfig.appId).toBe('2021006161653361');
    expect(capturedConfig.appCertPath).toContain('appCertPublicKey_2021006161653361.crt');
    expect(capturedPage.httpMethod).toBe('GET');
    expect(capturedPage.params.notifyUrl).toBe('https://zj.100qiu.com/api/payments/notify');
    expect(capturedPage.params.returnUrl).toContain('orderNo=ZJ202606130001');
    expect(capturedPage.params.bizContent.productCode).toBe('FAST_INSTANT_TRADE_PAY');
    expect(capturedPage.params.bizContent.totalAmount).toBe('98.00');
  });

  test('移动端生成 alipay.trade.wap.pay 支付链接', async () => {
    setSandboxEnv();
    const { createPaymentUrl } = require('../payments/alipay');
    const result = await createPaymentUrl({
      orderNo: 'ZJ202606130002',
      amount: 25800,
      planCode: 'quarterly',
      planName: '季度套餐',
      userAgent: 'iPhone Mobile Safari',
    });

    expect(result.method).toBe('alipay.trade.wap.pay');
    expect(capturedPage.params.bizContent.productCode).toBe('QUICK_WAP_WAY');
    expect(capturedPage.params.bizContent.totalAmount).toBe('258.00');
  });

  test('未启用支付宝时回退模拟支付链接', async () => {
    const { createPaymentUrl } = require('../payments/alipay');
    const result = await createPaymentUrl({ orderNo: 'ZJMOCK', amount: 9800, planCode: 'monthly' });

    expect(result.mode).toBe('mock');
    expect(result.paymentUrl).toContain('/api/payments/simulate-pay');
    expect(result.paymentUrl).toContain('orderNo=ZJMOCK');
  });

  test('证书配置缺失时拒绝生成真实支付链接', async () => {
    setSandboxEnv();
    delete process.env.ALIPAY_APP_CERT_PATH;
    const { createPaymentUrl } = require('../payments/alipay');

    await expect(createPaymentUrl({ orderNo: 'ZJERR', amount: 9800, planCode: 'monthly' })).rejects.toThrow(
      'ALIPAY_CERT_CONFIG_MISSING',
    );
  });

  test('支付宝通知身份校验必须通过验签、APPID 与 seller_id', () => {
    setSandboxEnv();
    const { getAlipayConfig } = require('../payments/alipay');
    const { validateNotifyIdentity } = require('../payments/alipay-callback');
    const config = getAlipayConfig();

    expect(
      validateNotifyIdentity({ sign: 'ok', app_id: '2021006161653361', seller_id: '2088040915526659' }, config),
    ).toBe(true);
    expect(
      validateNotifyIdentity({ sign: 'bad', app_id: '2021006161653361', seller_id: '2088040915526659' }, config),
    ).toBe(false);
    expect(validateNotifyIdentity({ sign: 'ok', app_id: 'wrong', seller_id: '2088040915526659' }, config)).toBe(false);
    expect(validateNotifyIdentity({ sign: 'ok', app_id: '2021006161653361', seller_id: 'wrong' }, config)).toBe(false);
  });
});
