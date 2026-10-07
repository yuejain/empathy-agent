# 留白 · Empathy Agent

可在 Windows / macOS / Linux 本地运行的情感陪伴应用，界面为中文、对话支持中英文。基于 [yuejain/empathy-agent](https://github.com/yuejain/empathy-agent) 的共情、状态机、安全分类与卡牌资料完善而来。

当前提供流式聊天、OpenAI 兼容接口、会话恢复、显式记忆，以及塔罗、周易和情绪需要卡。另有可独立启停的本地 Python 服务：采集清洗语料、训练情绪分类头、训练 Qwen3-0.6B LoRA、构建情绪检索库。默认使用已配置的云端模型；网页可切换到本地实验模型。未配置真实模型时，规则演示会明确标注。

本机已实际完成采集和两类训练；[训练结果与局限](docs/TRAINING_RESULTS.md)、[复现和来源说明](docs/LOCAL_ML.md)。本地模型仍为实验版，中文人工情绪标注不足，不能把训练完成理解为质量已经充分验证。

## 快速运行

要求 Node.js **22.9 或更新版本**，推荐 Node.js 24。

```powershell
# 在仓库目录内
npm ci
Copy-Item .env.example .env  # 仅首次；已有配置时不要覆盖
npm run dev
```

打开 http://127.0.0.1:3000 。Windows 也可运行 `powershell -ExecutionPolicy Bypass -File .\Start.ps1`。脚本以自身目录为工作目录，缺依赖时安装，然后构建并启动；设置了 `LOCAL_ML_URL=http://127.0.0.1:3001` 时还会启动已训练的本地服务。Ctrl+C 停止前台网页服务，本地 Python 服务另用 `Stop-LocalML.ps1` 停止。

`npm run dev` 会先编译再启动，修改代码后需重新运行。已有构建可直接 `npm start`。

本次交付已在后台启动本地服务。停止本次后台实例可运行 `powershell -ExecutionPolicy Bypass -File .\Stop.ps1`；脚本核对 PID 与本项目入口路径后才停止。之后可用 `Start.ps1` 在终端启动。

## 接入真实模型

编辑本机 `.env`，填写你的服务商信息：

```dotenv
APP_MODE=live
AI_GATEWAY_BASE_URL=https://your-provider.example/v1
AI_GATEWAY_API_KEY=你的密钥
AI_GATEWAY_MODEL=你的模型ID
AI_TIMEOUT_MS=45000
PORT=3000
SESSION_PERSISTENCE=true
```

上面的地址和模型是占位内容，需替换。模型 ID 不做硬编码，请使用服务商实际提供的 ID。基础地址支持 `/v1`、`/api/v3` 等自定义路径，或完整的 `/chat/completions` 地址；不重复追加 `/v1`。无路径的主机地址默认使用 `/v1/chat/completions`。本地无认证服务可以留空密钥。

兼容 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 别名，以 `AI_GATEWAY_*` 优先。配置保存在服务端，浏览器不会接收密钥。

小米 MiMo 已验证配置（密钥仍使用你自己的本地配置）：

```dotenv
AI_GATEWAY_BASE_URL=https://api.xiaomimimo.com/v1
AI_GATEWAY_MODEL=mimo-v2.6-pro
AI_GATEWAY_THINKING=disabled
AI_GATEWAY_TOKEN_PARAM=max_completion_tokens
```

依据 [MiMo 文档](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking)，深度思考默认开启且占用输出预算。本应用以短回复和结构化分类为主，使用 `disabled` 减少等待、避免推理耗尽短输出预算。其他服务默认不发送 `thinking` 字段，使用 `max_tokens`；只在服务商支持时调整这两个选项。

```powershell
npm run model:check
npm start
```

`model:check` 会向已配置的服务发送一条固定连接测试消息，可能产生少量服务商费用。它不会发送本地聊天记录。更改 `.env` 后重启服务。

- `APP_MODE=auto`：所有模型配置为空时用演示模式；部分配置缺失时启动报错。
- `APP_MODE=demo`：云端选项使用本地词典、规则与模板；选择已启动的本地模型仍可真实生成。
- `APP_MODE=live`：要求云端地址和模型；正常云端聊天会并行情绪/风险分析，再流式生成。接通本地分类检索后，通常只剩风险分析和回复两次云端调用；未接通时最多三次。选择本地模型不会调用云端。
- 页面显示“模型已配置”代表读取了配置，连接是否有效应使用 `model:check` 验证。认证失败、限流、超时不会被伪装成成功对话。

## 已接通的功能

- 流式多轮对话：真实模型增量内容逐段显示，处理 UTF-8 分片与心跳；跨片段过滤禁用措辞。停止或中断不保存半轮记录，可重试。
- 情绪增强检索：多语言句向量、词项与情绪标签共同检索，显示来源；没有合适结果时不强行引用。本地训练头用于情绪线索，不能用作诊断。
- 会话恢复：同一浏览器刷新或服务重启后恢复当前会话最近 10 轮。
- 显式记忆：发送 `记住：我叫小林`，再问 `我叫什么`；最多 20 条，每条最多 500 字，独立于最近 10 轮上下文。同一会话内恢复，不跨会话自动推断身份。
- 遗忘与删除：`忘记所有记忆` 只删除单独保存的记忆，历史消息仍在。界面的“清除记录”删除当前会话及其记忆。
- 新对话与导出：开始新的独立会话；导出当前加载的最近 10 轮文本。新对话不自动删除旧会话，旧记录按保留期清理。
- 联想游戏：22 张塔罗牌与正逆位、六次三枚硬币的周易意象、情绪需要卡。对话中随时从下方菜单开始，三种游戏共享每会话三次额度，不预测未来。
- 阶段转换：倾听、探索、行动、复盘、结束；尊重只想倾诉的要求。
- 安全支持：高风险规则命中时不等待联网、不抽牌、不写入显式记忆，返回支持性内容和现实求助资源。低风险模型结论不覆盖已命中的高风险规则。
- 输入与隔离：消息校验、大小限制、速率限制、同会话并发保护、跨站请求检查；会话编号加 HttpOnly 所有者 cookie 隔离浏览器。
- 文本安全：用户与模型文本均按纯文本显示，禁止 HTML 注入；页面使用 CSP，不依赖外部 CDN。

## 存储与使用边界

默认在 `.data/sessions.json` 以**未加密 JSON** 保存会话，原子替换写入；文件已被 Git 忽略。每会话保存最近 10 轮、最多 20 条显式记忆及有界状态，最多保存 200 个会话，超量淘汰最久未更新的会话；7 天未活动的会话在启动、读取或写入时清理。

`SESSION_PERSISTENCE=false` 关闭磁盘保存；`DATA_DIR` 可指定保存目录。请避免将数据目录加入网盘或公开仓库。cookie 与浏览器本地会话 ID 共同用于恢复；清除浏览器站点数据后不能恢复原身份。

服务只监听 `127.0.0.1`。这是本机个人使用版本，没有账号、远程登录、数据库集群或多进程协调；不要直接当作公网多用户服务部署。原 EdgeOne 配置保留供迁移参考，当前未验证 EdgeOne 发布，原 `edgeone makers dev` 命令不是当前启动路径。

AI 回复与情绪/风险分类是启发式结果，可能出错；本项目面向成年人，不是医疗服务，不承诺诊断或危机识别准确率。紧急危险请联系当地急救；中国大陆 120 / 110，心理援助热线 [12356（国家卫健委通知）](https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml)。其他地区使用当地资源。

## 验证

```powershell
npm test                          # 构建、核心模块和 HTTP 集成测试
npx playwright install chromium   # 首次安装浏览器
npm run test:browser               # 桌面 + 手机尺寸的浏览器用例
npm run check                     # 全部测试
npm run security:check            # 扫描 Git 暂存区，不输出密钥内容
npm audit --registry=https://registry.npmjs.org
```

API 联调用本机模拟服务验证模型名称、地址、认证、上下文传递以及 401/429/503、超时、取消等分支，不冒充真实商业模型效果。真实服务需在填写 `.env` 后单独验证。浏览器截图输出到 `artifacts/`，失败追踪在 `test-results/`，均不提交 Git。GitHub Actions 配置已添加，但需推送后才会在远程执行。

提交前先暂存需要上传的源码，再运行 `npm run security:check`。检查实际 Git 索引中的常见令牌、私钥、敏感文件路径，并与本机 `.env*` 中的凭据作精确比对；输出只有文件名和问题类别。它是基础防误传检查，不保证识别所有形式的敏感信息。`.env.example` 只保留空白密钥和说明。

2026-10-07 已额外完成 `mimo-v2.6-pro` 真实连接和增量输出、本地 GPU 训练及本地模型中英文流式调用。`node scripts/verify-live.cjs` 可验收已运行的本地模型；加 `--cloud` 会额外调用已配置的云端服务一次。详细范围见 [验收记录](docs/REVIEW.md)，不构成临床有效性评估。

## 代码结构

| 路径 | 当前作用 |
| --- | --- |
| `server/index.ts` | 本地 HTTP、请求验证、所有者隔离、限流、SSE、停止接口 |
| `server/session-store.ts` | 本地有界持久化、校验、保留期与删除 |
| `lib/gateway.ts` | 统一模型接口、地址标准化、超时、取消和脱敏错误 |
| `lib/orchestrator/` | 主对话链路、状态更新、显式记忆和卡牌入口 |
| `lib/safety-classifier/` | 规则、模型、上下文和融合决策 |
| `lib/local-knowledge.ts`、`ml/serve.py` | 本地分类、情绪检索和 LoRA 生成的连接 |
| `ml/` | 来源配置、采集清洗、模型下载、训练与评估 |
| `lib/tarot/reflection-games.ts` | 塔罗、周易和需要卡的规则 |
| `agents/empathy-agent/` | Fetch 风格适配器及事件映射；本地服务负责持久化 |
| `src/` | 无框架的响应式界面与独立 SSE 解析器 |
| `tests/` | 核心、HTTP 与浏览器回归用例 |
| `docs/REVIEW.md` | 代码审阅、修改范围与尚未实现的研究能力 |

原 `lib/memory/` 内的向量、图检索、GraphRAG、Cross-Encoder、LLMLingua 仍是原型或模拟，**主对话链路不把它们当成真实服务**。本次真实分类、向量索引和微调代码位于 `ml/`，不属于临床模型。仅使用云端聊天或规则演示无需 Python/GPU；本地模型需要按文档安装独立环境。原项目说明保存在 `docs/ORIGINAL_README.md`，其中的设想不代表当前实现。

许可证沿用 Apache-2.0。
