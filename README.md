# 留白 · Empathy Agent

[![Validate local app](https://github.com/yuejain/empathy-agent/actions/workflows/ci.yml/badge.svg?branch=codex%2Flong-term-memory)](https://github.com/yuejain/empathy-agent/actions/workflows/ci.yml)

一个可以在本机运行的情感陪伴应用，界面为中文，对话支持中英文。提供真实流式输出、主动跨会话记忆、情绪增强检索，以及塔罗、周易和情绪需要卡联想练习。可以接入 OpenAI 兼容的云端 API，也可以使用自行训练的本地小模型。

基础可用版本已通过 [PR #1](https://github.com/yuejain/empathy-agent/pull/1) 合并；本次长期记忆重构位于 **`codex/long-term-memory`**。首次克隆后，无模型配置时使用明确标注的规则演示；本地模型需要另行下载和训练。

[快速运行](#快速运行) · [云端模型](#接入真实模型) · [长期记忆](#长期记忆) · [本地模型与语料](#本地模型与语料) · [训练结果](docs/TRAINING_RESULTS.md) · [实现与验收](docs/REVIEW.md)

本地分类头、生成 LoRA 和情绪检索已实际运行验证。**本地生成仍为实验版**，可能角色混淆、复读或编造背景；中文人工情绪标签不足，不能把训练完成理解为质量已充分验证。

## 快速运行

网页服务要求 Git 和 **Node.js 22.9+**。仅使用云端模型或规则演示，无需 Python、GPU 或数据库。网页服务已在 Windows 本机和 Ubuntu CI 验证；本地训练的配套脚本目前按 Windows + NVIDIA CUDA 环境提供。

```bash
git clone --branch codex/long-term-memory https://github.com/yuejain/empathy-agent.git
cd empathy-agent
npm ci
```

Windows PowerShell：

```powershell
# 只在配置不存在时创建，保留已有密钥
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

macOS / Linux Shell：

```bash
test -f .env || cp .env.example .env
npm run dev
```

打开 **[http://127.0.0.1:3000](http://127.0.0.1:3000)**。默认是规则演示，配置真实模型后重启即可开始生成。Windows 也可运行 `powershell -ExecutionPolicy Bypass -File .\Start.ps1`，脚本会补齐缺失的配置模板和 Node 依赖，再构建并启动。

若 `.env` 设置了 `LOCAL_ML_URL=http://127.0.0.1:3001`，`Start.ps1` 还会启动已训练好的本地模型服务，不会替你下载或训练权重。Ctrl+C 停止前台网页服务；本地 Python 服务独立运行，用 `Stop-LocalML.ps1` 停止。

`npm run dev` 会先编译再启动，修改代码后需重新运行。已有构建可直接 `npm start`。

`Stop.ps1` 仅用于存在本项目 `server.pid` 的后台网页实例，会核对 PID 与本项目入口后再停止。普通的 `npm run dev` 或 `Start.ps1` 前台实例直接按 Ctrl+C 即可。

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

本应用以短回复和结构化分类为主，MiMo 配置使用 `disabled` 关闭深度思考。其他服务默认不发送 `thinking` 字段，使用 `max_tokens`；参数支持情况以服务商文档为准。MiMo 参数说明见[官方文档](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking)。

```powershell
npm run model:check
npm start
```

`model:check` 会向已配置的服务发送一条固定连接测试消息，可能产生少量服务商费用。它不会发送本地聊天记录。更改 `.env` 后重启服务。

- `APP_MODE=auto`：所有模型配置为空时用演示模式；部分配置缺失时启动报错。
- `APP_MODE=demo`：云端选项使用本地词典、规则与模板；选择已启动的本地模型仍可真实生成。
- `APP_MODE=live`：要求云端地址和模型；正常云端聊天会并行情绪/风险分析，再提取记忆、流式生成。自动记忆可增加一次结构化模型调用（最多等待 10 秒，失败时仍可用规则提取）；接通本地分类检索可省去云端情绪分析。选择本地模型时，记忆提取也在本机完成，不会调用云端。
- 页面显示“模型已配置”代表读取了配置，连接是否有效应使用 `model:check` 验证。认证失败、限流、超时不会被伪装成成功对话。

## 本地模型与语料

管线分为两个任务：冻结多语言 MiniLM 编码器、训练情绪分类头并建库；在 Qwen3-0.6B 上训练生成 LoRA。在线分类和检索使用 CPU，本次生成训练和推理已在 RTX 4070 Ti 12GB 上验证。

**Git 仓库只包含代码、配置模板和结果说明，不包含语料快照、索引或模型权重。** 首次使用需要下载公开语料和基座模型，然后训练；下载依赖网络和额外磁盘空间。本机验证环境为 Python 3.11、CUDA 版 PyTorch 2.11.0，生成训练脚本要求可用的 CUDA GPU。

在仓库目录的 Windows PowerShell 中运行：

```powershell
# 创建独立 Python 环境并安装依赖
powershell -ExecutionPolicy Bypass -File .\Setup-LocalML.ps1

# 下载语料和基座，清洗、训练分类器、建库、训练生成模型
powershell -ExecutionPolicy Bypass -File .\Train-LocalML.ps1

# 启动本地分类、检索和生成服务
powershell -ExecutionPolicy Bypass -File .\Start-LocalML.ps1
```

在 `.env` 增加下面一行，重启网页服务：

```dotenv
LOCAL_ML_URL=http://127.0.0.1:3001
```

页面会显示语料库条数。在“回复模型”中选择本地实验模型即可离线生成，首次调用需要加载权重。只希望用本地检索辅助云端回复时，保持云端选项即可；这一方式仍会将消息、上下文和参考片段交给配置的云端服务。

只用本地模型时，可以设置 `APP_MODE=demo`、保留云端配置为空，并在页面选择本地模型。停止本地服务使用 `powershell -ExecutionPolicy Bypass -File .\Stop-LocalML.ps1`。

采集来源包括 GoEmotions、OpenAssistant 1/2 和 chinese-poetry，记录许可、版本、来源 URL 和内容哈希。清洗包括 Unicode 规范化、标识符替换、长度筛选及规范化精确去重。它不是完整匿名化；个人聊天不会自动成为训练数据。MediaWiki 采集器遵循 robots 限制，受限来源不计入已采集数据。

按阶段重跑、下载校验、依赖快照、来源许可和产物路径见 [本地管线说明](docs/LOCAL_ML.md)。

### 实际训练结果

以下是 2026-10-07 本机实际运行的记录，不代表每次重新采集都得到相同数量：

| 项目 | 结果与范围 |
| --- | --- |
| 清洗语料 | 64,541 条：中文 3,394、英文 61,147；原始语言分布不均衡 |
| 情绪检索库 | 4,000 条，仅来自训练分区，中英文各 2,000 条；真实 384 维句向量 |
| 情绪分类器 | 八个逻辑回归分类头，共 3,080 个训练参数；编码器保持冻结 |
| 人工英文标注测试 | 5,394 条，macro-F1 0.4393、micro-F1 0.4978 |
| 中文分类覆盖 | 训练仅 6 条弱标签、测试仅 2 条弱标签，无法报告可靠的中文准确率 |
| 生成训练池 | 中英文各 295 条，共 590 条；本轮处理 320 条训练样本，40 次参数更新 |
| 生成模型 | Qwen3-0.6B + LoRA，1,146,880 个可训练参数 |
| 固定测试子集损失 | 40 条上的回答交叉熵从 2.7426 降至 2.2609，不能据此证明共情能力提升 |

完整数据划分、计算设备、参数和局限见 [训练结果](docs/TRAINING_RESULTS.md)。

## 已接通的功能

- 流式多轮对话：真实模型增量内容逐段显示，处理 UTF-8 分片与心跳；跨片段过滤禁用措辞。停止或中断不保存半轮记录，可重试。
- 情绪增强检索：多语言句向量、词项与情绪标签共同检索，显示来源；没有合适结果时不强行引用。本地训练头用于情绪线索，不能用作诊断。
- 会话恢复：同一浏览器刷新或服务重启后恢复当前会话最近 10 轮。
- 主动长期记忆：普通聊天自动提取情绪、正在做的事、计划、决定和背景；同一浏览器的新对话与重启后可继续使用，最多 300 条。支持 `记住：我叫小林`、`我叫什么`，并可查看原话依据。
- 遗忘与更正：“长期记忆”面板支持添加、更正、确认、结束和删除；`忘记所有记忆` 清空长期档案并让旧聊天退出模型上下文。“清除记录”只删除当前聊天，长期记忆单独管理。
- 新对话与导出：开始新的会话并沿用本浏览器的长期记忆；导出当前加载的最近 10 轮文本。新对话不自动删除旧会话，旧记录按保留期清理。
- 联想游戏：22 张塔罗牌与正逆位、六次三枚硬币的周易意象、情绪需要卡。对话中随时从下方菜单开始，三种游戏共享每会话三次额度，不预测未来。
- 阶段转换：倾听、探索、行动、复盘、结束；尊重只想倾诉的要求。
- 安全支持：高风险规则命中时不等待联网、不抽牌、不提取长期记忆，返回支持性内容和现实求助资源。低风险模型结论不覆盖已命中的高风险规则。
- 输入与隔离：消息校验、大小限制、速率限制、同一所有者跨会话并发保护、记忆版本冲突检查、跨站请求检查；会话编号加 HttpOnly 所有者 cookie 隔离浏览器。
- 文本安全：用户与模型文本均按纯文本显示，禁止 HTML 注入；页面使用 CSP，不依赖外部 CDN。

## 长期记忆

默认开启**自动记忆**与**回复时参考记忆**。直接聊近况即可，不需要每次说“记住”，也不需要逐条确认。例如：

> 我今天很焦虑。我正在写论文。我考虑辞职。我决定周末休息。

系统将这些内容分为情绪、活动、考虑中的计划和明确决定。真实模型还能提取含蓄表达；所有保存内容都来自用户当轮原话，不把助手回复、塔罗解释或公开检索语料写成人生经历。推测和计划可以自动进入记忆，但会标注为推测或考虑中，不冒充已确定的事实。

| 类别 | 默认有效期 | 更新方式 |
| --- | --- | --- |
| 当前情绪 | 6 小时；推测情绪 1 小时 | 新状态替代旧状态，不把短暂情绪变成人格标签 |
| 正在做的事 | 30 天 | 再次提及延长有效期；完成或停止后退出当前记忆 |
| 计划与决策 | 90 天 | 区分考虑中、已决定与已撤回；识别同主题改口并替代旧项 |
| 稳定背景 | 365 天 | 重复提及可续期；姓名等单值信息以新陈述为准 |

点击页面上的 **长期记忆**，可查看类别、状态、时间、原话依据，直接更正、结束或删除，也可分别关闭自动采集和回复参考。过期内容不会用于回复，可在历史筛选中核对、更新。旧版显式记忆迁移到“待核对”，避免把来源不完整的旧记录直接当作当前事实；正常新聊天自动提取的记忆直接生效。

删除、更正、结束或冲突替代会更新上下文版本，使旧聊天中的相应陈述及助手复述不再进入后续模型请求。界面仍保留聊天文字，需要时另点“清除记录”。细节、迁移和接口见 [长期记忆设计](docs/MEMORY.md)。

## 存储与使用边界

默认在 `.data/sessions.json` 以**未加密 JSON** 保存会话和独立的用户记忆档案，回复完成后一起原子写入；文件已被 Git 忽略。每会话保留最近 10 轮，最多 200 个会话；7 天未活动不再返回，启动或写入时清理，超量淘汰最久未更新会话。模型短期上下文另限最近 1 小时；更早的信息依赖有效长期记忆。

长期档案不随会话淘汰，每个所有者最多 300 条、全机最多 1,000 个档案；达到档案上限时拒绝新增，不静默删除其他用户。条目按上表过期，过期超过 30 天的条目在后续记忆写入时清理。旧版数据首次迁移会留下 `.data/sessions.json.v1.bak` 备份；它不参与运行、不会自动恢复已删除记忆，也不会随界面删除操作擦除。

`SESSION_PERSISTENCE=false` 关闭磁盘保存；`DATA_DIR` 可指定保存目录。请避免将数据目录加入网盘或公开仓库。HttpOnly 所有者 cookie 有效期为 365 天，每次访问 API 延长；同一浏览器的新会话共享记忆。**不支持跨浏览器或跨设备同步**，清除站点 cookie 后不能自动恢复原身份。

检索来源链接只在本次回复中展示，刷新恢复的是文字记录。选择本地回复时，分类、检索与生成在本机完成；本地生成服务不可用会明确报错，不自动转发云端。

服务只监听 `127.0.0.1`。这是本机个人使用版本，没有账号、远程登录、数据库集群或多进程协调；不要直接当作公网多用户服务部署。原 EdgeOne 配置保留供迁移参考，当前未验证 EdgeOne 发布，原 `edgeone makers dev` 命令不是当前启动路径。

AI 回复与情绪/风险分类是启发式结果，可能出错；本项目面向成年人，不是医疗服务，不承诺诊断或危机识别准确率。紧急危险请联系当地急救；中国大陆 120 / 110，心理援助热线 [12356（国家卫健委通知）](https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml)。其他地区使用当地资源。

## 验证

长期记忆重构新增覆盖跨会话、持久化、过期、冲突、推测、旧版迁移、删除后不再引用、并发和失败回滚的测试；桌面与手机验证记忆管理操作。验证结果记录在 [验收记录](docs/REVIEW.md)，远程状态见 [Actions](https://github.com/yuejain/empathy-agent/actions/workflows/ci.yml)。Python 测试和真实模型验收单独在本机执行，不属于当前 CI 工作流。

```powershell
npm test                          # 构建、核心模块和 HTTP 集成测试
npx playwright install chromium   # 首次安装浏览器
npm run test:browser               # 桌面 + 手机尺寸的浏览器用例
npm run check                     # Node + 浏览器测试
npm run security:check             # 扫描 Git 暂存区，不输出密钥内容
node --env-file-if-exists=.env scripts/verify-memory-live.cjs # 真实云端跨会话测试，产生 API 费用
# 同一脚本加 --local，测试已启动的本地生成模型
npm audit --registry=https://registry.npmjs.org
.\.venv-ml\Scripts\python.exe -m unittest discover -s ml -p 'test_*.py'
```

API 联调用本机模拟服务验证模型名称、地址、认证、上下文传递以及 401/429/503、超时、取消等分支，不冒充真实商业模型效果。真实服务需在填写 `.env` 后单独验证。浏览器截图输出到 `artifacts/`，失败追踪在 `test-results/`，均不提交 Git。GitHub Actions 在 `push` 和 `pull_request` 时自动触发。

提交前先暂存需要上传的源码，再运行 `npm run security:check`。检查实际 Git 索引中的常见令牌、私钥、敏感文件路径，并与本机 `.env*` 中的凭据作精确比对；输出只有文件名和问题类别。它是基础防误传检查，不保证识别所有形式的敏感信息。`.env.example` 只保留空白密钥和说明。

`.env*`（除示例）、私钥、聊天记录、原始/处理语料、模型权重、缓存和验收日志均有 Git 忽略规则，发布代码时保留在本机。

2026-10-07 已额外完成 `mimo-v2.6-pro` 真实连接和增量输出、本地 GPU 训练及本地模型中英文流式调用。`node scripts/verify-live.cjs` 可验收已运行的本地模型；加 `--cloud` 会额外调用已配置的云端服务一次。详细范围见 [验收记录](docs/REVIEW.md)，不构成临床有效性评估。

## 代码结构

| 路径 | 当前作用 |
| --- | --- |
| `server/index.ts` | 本地 HTTP、请求验证、所有者隔离、限流、SSE、停止接口 |
| `server/session-store.ts` | 本地有界持久化、校验、保留期与删除 |
| `lib/gateway.ts` | 统一模型接口、地址标准化、超时、取消和脱敏错误 |
| `lib/orchestrator/` | 主对话链路、状态更新、长期记忆与上下文衔接、卡牌入口 |
| `lib/memory/` | 主动提取、原话校验、版本替代、时效、检索与管理操作 |
| `lib/safety-classifier/` | 规则、模型、上下文和融合决策 |
| `lib/local-knowledge.ts`、`ml/serve.py` | 本地分类、情绪检索和 LoRA 生成的连接 |
| `ml/` | 来源配置、采集清洗、模型下载、训练与评估 |
| `lib/tarot/reflection-games.ts` | 塔罗、周易和需要卡的规则 |
| `agents/empathy-agent/` | Fetch 风格适配器及事件映射；本地服务负责持久化 |
| `src/` | 无框架的响应式界面与独立 SSE 解析器 |
| `tests/` | 核心、HTTP 与浏览器回归用例 |
| `docs/REVIEW.md` | 代码审阅、修改范围与尚未实现的研究能力 |

原 `lib/memory/` 的模拟向量、图检索和摘要管线已删除，替换为接入主流程的长期记忆模块。用户记忆采用有界的类别、词项、时效检索；公开情绪语料的真实向量索引、分类与微调位于 `ml/`。两者分开，个人聊天不会自动成为训练语料。原项目说明保存在 `docs/ORIGINAL_README.md`，其中的设想不代表当前实现。

项目代码沿用 [Apache-2.0](LICENSE)。外部语料和基座模型遵循各自的许可，详见 [来源说明](docs/LOCAL_ML.md#数据来源与许可)。
