const { ChatGateway } = require('../dist/lib/gateway');
(async () => {
  try {
    const gateway = new ChatGateway(process.env);
    if (gateway.mode !== 'live') throw new Error('尚未配置真实模型。请先填写 .env 的地址、模型和密钥。');
    const reply = await gateway.complete([{ role: 'user', content: '这是一条连接测试。请只回复：连接成功。' }], { maxTokens: 40, temperature: 0 });
    console.log('模型接口返回了有效回复：', reply);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
})();
