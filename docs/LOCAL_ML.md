# 本地语料、训练与情绪检索

这是应用实际调用的本地管线，与原仓库 `lib/memory` 中的模拟向量代码分开。所有下载和训练产物留在本机，不上传到模型托管平台。云端回复仍使用原来的 MiMo；在网页“回复模型”中可选择本地 LoRA 模型。

## 已实现的链路

1. `ml/corpus.py`：三个类型的采集器（公开情绪数据、公开人类对话、中文诗文），另保留遵循 robots.txt 的 MediaWiki API 采集器。来源开关在 `ml/sources.json`。
2. 清洗：Unicode NFKC、HTML/控制字符、邮箱/链接/账号标记/电话或长号码/令牌替换、长度和重复字符筛选、规范化精确去重、语言及内容类别分类。不是完整匿名化，不能保证消除人名、地点、语境中的可识别信息；新增来源仍需人工抽检。
3. 情绪模型：冻结多语言 MiniLM 编码器，真实训练八个逻辑回归分类头；映射为喜悦、悲伤、愤怒、恐惧/焦虑、关爱、惊讶、困惑、中性。公开人工标签与关键词弱标签分别记录，弱标签权重降为 0.25；按语言加权上限为 10。训练时句向量在 GPU 计算，分类头由 CPU 上的 scikit-learn 拟合；在线分类和检索使用 CPU。
4. 检索库：本地 384 维真实句向量、词项匹配和情绪重合加权，得分为 `0.75 × 余弦相似度 + 0.15 × 查询词重合 + 0.10 × 情绪重合`。查询至少 8 字符、情绪有重合、余弦相似度至少 0.35 且总分至少 0.38 才返回结果；阈值是产品启发式，未做检索基准调优。只索引训练分区，中英文各取至多 2,000 条，取至多三个不同对话树的结果；保留来源、许可、情绪、类别、原文/回答。建库补充的关键词标签只用于检索，不冒充人工训练标签；没有训练独立排序器。参考内容按完整句子截取，避免把半句送入小模型。
5. 生成模型：Qwen3-0.6B 上的 LoRA 监督微调（q/v 投影，rank 8）。中英文等量抽样，按整棵源对话树划分；长度过滤后再次按语言平衡。只对回答 token 计算损失，随机种子 42。它是预训练模型上的小规模适配，不是从零训练通用语言模型。
6. `ml/serve.py`：本机分类/检索以及兼容 Chat Completions 的流式生成接口。应用将检索片段作为不可信参考数据加入提示词，引用来源可展开查看。个人会话不会自动成为训练数据。

在线生成关闭 thinking，使用 [Qwen 模型说明](https://huggingface.co/Qwen/Qwen3-0.6B#best-practices) 建议的非思考采样参数（temperature 0.7、top-p 0.8、top-k 20），另加 repetition penalty 1.1。训练损失评估不使用这些采样参数。重复原输入的本地输出会报错并回滚，避免保存为成功回复。

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

已验证环境为 Windows、Python 3.11、RTX 4070 Ti 12GB、CUDA 版 PyTorch 2.11.0。完整依赖快照在 `ml/requirements-lock.txt`，常规安装范围在 `ml/requirements.txt`。

```powershell
# 首次安装独立环境，不改动父项目 Python 环境
powershell -ExecutionPolicy Bypass -File .\Setup-LocalML.ps1

# 下载、清洗、建库、分类训练、生成训练
powershell -ExecutionPolicy Bypass -File .\Train-LocalML.ps1

# 启停本地模型服务
powershell -ExecutionPolicy Bypass -File .\Start-LocalML.ps1
powershell -ExecutionPolicy Bypass -File .\Stop-LocalML.ps1
```

若官方 CUDA 轮子下载缓慢，本机验证过以下镜像；哈希来自官方 PyTorch 包索引，pip 会校验：

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
.\.venv-ml\Scripts\python.exe ml/train_generator.py --steps 160
.\.venv-ml\Scripts\python.exe -m unittest discover -s ml -p 'test_*.py'
```

`corpus.py --only 源ID` 更新所选来源，合并已保存的其他来源快照；全部采集失败时保留已有语料。缓存与 `.part` 文件支持中断后重试。请勿把重新下载当前版本与完全复现已固定快照混为一谈：后续上游更新会改变数据，需保留本次 manifests 和 hashes。

在 `.env` 设置 `LOCAL_ML_URL=http://127.0.0.1:3001`，然后重启网页服务。分类和检索服务离线工作；本地生成第一次调用会加载 GPU 模型。选择“本地小模型”后不会调用 MiMo，服务不可用时明确报错，不自动转发云端。选择云端时，消息、会话上下文和参考语料片段会发送到用户配置的云端服务。

## 产物与评价

本次实际数据量、参数、划分和指标见 [TRAINING_RESULTS.md](TRAINING_RESULTS.md)。生成损失仅在预先固定的验证/测试子集中各 40 条上测量；不是整个分区的全量评估。

| 路径 | 内容 |
| --- | --- |
| `data/manifests/corpus.json` | 来源版本、抓取/缓存记录、失败来源、去重与语言统计 |
| `data/processed/corpus.jsonl` | 清洗后的统一记录 |
| `data/training/generator-*.jsonl` | 按对话树分组的三份生成训练数据 |
| `data/index/` | 实际向量与可追溯文档 |
| `models/local/emotion-head.joblib`、`models/local/encoder/` | 本地分类器与多语言编码器；只加载自行生成的 joblib |
| `models/local/generator-adapter/` | LoRA 权重与 tokenizer |
| `data/reports/classifier.json` | 标签来源分组的 macro/micro F1、训练样本数和计算设备 |
| `data/reports/generator.json` | 基线/微调验证损失、固定测试损失、参数规模、显存和训练时间 |

评估超参数预先固定，不根据测试集调整；去重时测试分区优先，生成训练按整棵对话树分组。训练损失下降不等于共情能力提高，情绪分类概率未经校准，也不能用作医疗、危机评估或诊断。小模型的安全支持由应用的本地规则兜底，仍可能漏检；云端和本地效果应分别评估。

## 联想游戏

- 塔罗：原有 22 张大阿尔卡纳，正位偏向资源、逆位偏向阻力与需要，提供 A/B/C 联想。
- 周易：模拟六次三枚硬币，自下而上排爻，6/9 为变化爻；展示上下卦及变化意象。八卦形象参考[《说卦》](https://ctext.org/book-of-changes/shuo-gua)，情绪解释由本项目编写，属于现代联想练习，不是古籍断语。
- 情绪需要卡：围绕边界、连接、安定、探索、珍惜展开。三种玩法都可以跳过；危机支持优先于游戏，不作命运或诊断判断。
