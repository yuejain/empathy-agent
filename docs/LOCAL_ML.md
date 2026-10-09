# 本地语料、训练与情绪检索

这是应用实际调用的本地情绪 RAG 管线，独立于个人长期记忆。下载与训练产物留在本机；本地编码器和分类头负责分析、检索，将情绪指向和参考片段传给配置的云端大模型生成回复。旧本地 LoRA 生成入口已停用，已有权重仍保留，但运行时不加载。

## 已实现的链路

1. `ml/corpus.py`：三个类型的采集器（公开情绪数据、公开人类对话、中文诗文），另保留遵循 robots.txt 的 MediaWiki API 采集器。来源开关在 `ml/sources.json`。
2. 清洗：Unicode NFKC、HTML/控制字符、邮箱/链接/账号标记/电话或长号码/令牌替换、长度和重复字符筛选、规范化精确去重、语言及内容类别分类。不是完整匿名化，不能保证消除人名、地点、语境中的可识别信息；新增来源仍需人工抽检。
3. 情绪模型：冻结多语言 MiniLM 编码器，真实训练八个逻辑回归分类头；映射为喜悦、悲伤、愤怒、恐惧/焦虑、关爱、惊讶、困惑、中性。公开人工标签与关键词弱标签分别记录，弱标签权重降为 0.25；按语言加权上限为 10。训练时句向量在 GPU 计算，分类头由 CPU 上的 scikit-learn 拟合；在线分类和检索使用 CPU。
4. 检索库：本地 384 维真实句向量、词项匹配和情绪重合加权，得分为 `0.75 × 余弦相似度 + 0.15 × 查询词重合 + 0.10 × 情绪重合`。查询至少 8 字符、情绪有重合、余弦相似度至少 0.35 且总分至少 0.38 才返回结果；阈值是产品启发式，未做检索基准调优。只索引训练分区，中英文各取至多 2,000 条，取至多三个不同对话树的结果；保留来源、许可、情绪、类别、原文/回答。建库补充的关键词标签只用于检索，不冒充人工训练标签；没有训练独立排序器。
5. 情绪指向：`lib/emotion-rag.ts` 将本地分类分数、最多三个情绪信号、可信程度、用户倾诉/探索/行动意图和有界语料组合为 `EMOTION_RAG_CONTEXT`。分类分数低于 0.55 或前两项相差不足 0.1 标记不确定；阈值是启发式，未经校准。情绪强度来自词典规则，不能用分类概率替代。用户明确希望被倾听时，优先倾听而不是给建议。
6. 云端生成：最终提示包含当前原话、相关长期记忆、情绪指向与不可信语料参考。每条参考原文至多 200 字符、回答至多 300 字符，全部参考 JSON 合计至多 2,800 字符。用户自述和意愿优先，语料中的他人经历不能变成用户事实；语料不传给长期记忆提取器。个人会话不会自动成为训练数据。

`ml/serve.py` 只提供 `GET /health` 与 `POST /analyze`，运行在 CPU。健康状态为 `role: emotion-rag`、`generator: false`；旧 `/v1/chat/completions` 返回 410。网页旧 `backend: local` 请求也返回 410，不自动转发。没有匹配片段时标记 `no_matches`；本地服务失效或格式校验失败时标记 `unavailable`，云端继续使用当前原话与基础情绪线索，不伪造检索依据。规则命中的高风险情况优先本地安全回应，不等待 RAG 或云端。

## 数据来源与许可

| 来源 | 内容 | 许可与标注 |
| --- | --- | --- |
| [GoEmotions](https://github.com/google-research/google-research/tree/master/goemotions) | 英文公开评论，人工细粒度情绪标注 | Apache-2.0；原始类别合并为本项目八类 |
| [OpenAssistant 1](https://huggingface.co/datasets/OpenAssistant/oasst1)、[OpenAssistant 2](https://huggingface.co/datasets/OpenAssistant/oasst2) | 志愿者创作的中英文对话 | Apache-2.0；排除 synthetic、已删除、不通过审阅和明显低质量/敏感标注条目；情绪标签是关键词弱标签 |
| [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) | 唐诗，补充中文文学表达 | 仓库 MIT，古代原作已进入公有领域；情绪标签是弱标签，不是现代用户情绪真值 |
| [中文维基文库](https://zh.wikisource.org) | 配置中的公开散文 | 保留采集器；robots 或访问限制禁止时记录失败，不绕过限制、不计入已采集语料 |

原始语料数量不代表训练均衡。英文人工标签丰富，中文对话和情绪标签覆盖仍有限：生成训练采用中英文等量样本；中文情绪识别包含跨语言迁移和弱监督，不能把弱标签测试指标当成人工中文准确率。所有数值以本次 `data/reports/` 中的报告为准。

下载记录包含 URL、版本/提交、时间、字节数和 SHA256。OASST2 分片下载最终按官方快照 SHA256 验证；模型权重从发布者 ModelScope 页面加速下载，逐文件与 Hugging Face 固定提交的 SHA256/Git blob 哈希核对。未加入登录站点、私人消息或验证码绕过。

## 本机复现

当前 RAG 服务已在 Windows、Python 3.11、PyTorch 2.11.0 的 CPU 推理上验证。`Setup-LocalML.ps1` 默认 CPU 安装；添加 `-UseCuda` 可用于 GPU 加速分类训练。`ml/requirements.txt` 是当前 RAG 依赖，`ml/requirements-lock.txt` 保留早期 CUDA/LoRA 环境快照，不代表默认安装必须使用 GPU。

```powershell
# 首次安装独立环境，不改动父项目 Python 环境
powershell -ExecutionPolicy Bypass -File .\Setup-LocalML.ps1

# 下载、清洗、分类训练、建库；不下载或训练生成模型
powershell -ExecutionPolicy Bypass -File .\Train-LocalML.ps1

# 启停本地模型服务
powershell -ExecutionPolicy Bypass -File .\Start-LocalML.ps1
powershell -ExecutionPolicy Bypass -File .\Stop-LocalML.ps1
```

只有选择 CUDA 加速训练时才需要 GPU 轮子。早期环境验证过以下镜像；哈希来自官方 PyTorch 包索引，pip 会校验：

```powershell
.\.venv-ml\Scripts\python.exe -m pip install 'torch @ https://mirrors.nju.edu.cn/pytorch/whl/cu128/torch-2.11.0%2Bcu128-cp311-cp311-win_amd64.whl#sha256=90ef0c2454e5296a9fb021ddd42252e4ce1abe2c0a4988a173ef90a6cded0bf5'
```

按阶段重跑：

```powershell
.\.venv-ml\Scripts\python.exe ml/download_corpus_snapshot.py  # OASST2 四路分片与续传
.\.venv-ml\Scripts\python.exe ml/corpus.py
.\.venv-ml\Scripts\python.exe ml/download_models.py
.\.venv-ml\Scripts\python.exe ml/train_classifier.py
.\.venv-ml\Scripts\python.exe ml/build_index.py             # 只重建检索库，不重新训练分类头
.\.venv-ml\Scripts\python.exe -m unittest discover -s ml -p 'test_*.py'
```

`corpus.py --only 源ID` 更新所选来源，合并已保存的其他来源快照；全部采集失败时保留已有语料。`--refresh` 重新抓取可变来源，固定提交快照继续复用缓存；旧缓存只在新下载完整后替换。固定快照缓存与 `.part` 文件支持中断后重试。请勿把重新下载当前版本与完全复现已固定快照混为一谈：后续上游更新会改变数据，需保留本次 manifests 和 hashes。

网页“语料库”通过 `/api/corpus` 连接本地服务 `/maintenance`。只允许 `update` / `rebuild` 固定操作和 `scheduleHours: 0 / 24 / 168`，不接受任意 URL、路径或命令。更新任务串行，状态及公开语料日志保存在 `data/reports/`；自动更新默认关闭，仅服务运行期间有效。不可变索引位于 `data/index/versions/<版本>/`，`current.json` 原子发布；服务检索前检查版本，核对哈希与维度后切换。失败不会覆盖服务已加载的索引。旧版本保留供人工排查，暂未自动清理。

`POST /analyze` 新增可选 `query` 和 `memories: [{id,text}]`。最多 80 条、每条 500 字符；一次批量编码分别完成当前消息分类、公共语料检索和私人记忆排序。私人文本与向量不落盘、不跨请求缓存，不加入公共向量矩阵。返回 `memory_hits` 与阶段计时。新版 health 标明 `api_version: 2`；升级后请停止并重启本地服务。

在 `.env` 设置 `LOCAL_ML_URL=http://127.0.0.1:3001`，然后重启网页服务。分类和检索不需要外网；消息、情绪指向、会话上下文和参考片段会发送到配置的云端服务，由其完成回复。界面分别显示云端回复与本地 RAG 状态，每轮可查看情绪参考和来源。

`node --env-file-if-exists=.env scripts/verify-live.cjs` 只验收本地 RAG；加 `--cloud` 使用两条构造的中英文消息测试完整云端流式链路。脚本使用独立内存档案，不读取用户聊天。旧生成训练脚本仅作研究保留，需另装 `ml/requirements-generator.txt`、用 `download_models.py --with-legacy-generator` 下载权重，并显式运行 `train_generator.py`；其产物不会被当前服务加载。

## 产物与评价

本次实际数据量、参数、划分和指标见 [TRAINING_RESULTS.md](TRAINING_RESULTS.md)。生成损失仅在预先固定的验证/测试子集中各 40 条上测量；不是整个分区的全量评估。

| 路径 | 内容 |
| --- | --- |
| `data/manifests/corpus.json` | 来源版本、抓取/缓存记录、失败来源、去重与语言统计 |
| `data/processed/corpus.jsonl` | 清洗后的统一记录 |
| `data/training/generator-*.jsonl` | 历史生成实验的三份训练数据，不参与在线 RAG |
| `data/index/` | 实际向量与可追溯文档 |
| `models/local/emotion-head.joblib`、`models/local/encoder/` | 本地分类器与多语言编码器；只加载自行生成的 joblib |
| `models/local/generator-adapter/` | 历史 LoRA 权重与 tokenizer，当前服务不加载 |
| `data/reports/classifier.json` | 标签来源分组的 macro/micro F1、训练样本数和计算设备 |
| `data/reports/generator.json` | 基线/微调验证损失、固定测试损失、参数规模、显存和训练时间 |

评估超参数预先固定，不根据测试集调整；去重时测试分区优先，历史生成训练按整棵对话树分组。训练损失下降不等于共情能力提高，情绪分类分数未经校准，也不能用作医疗、危机评估或诊断。结构化指向的传递经过测试，不等于已经证明云端情感回应质量提升。

## 联想游戏

- 塔罗：原有 22 张大阿尔卡纳，正位偏向资源、逆位偏向阻力与需要，提供 A/B/C 联想。
- 周易：模拟六次三枚硬币，自下而上排爻，6/9 为变化爻；展示上下卦及变化意象。八卦形象参考[《说卦》](https://ctext.org/book-of-changes/shuo-gua)，情绪解释由本项目编写，属于现代联想练习，不是古籍断语。
- 情绪需要卡：围绕边界、连接、安定、探索、珍惜展开。另有文字意象、生活场景和关键词三种入口。六种玩法都支持选项续聊与跳过；危机支持优先于游戏，不作命运或诊断判断。
