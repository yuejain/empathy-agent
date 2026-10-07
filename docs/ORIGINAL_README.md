> 上游原始说明归档，其中的能力描述和启动命令可能不适用于当前本地版本。以根目录 README.md 为准。

# 🌙 情感共情陪伴Agent / Empathy Companion Agent

> **中文**：面向"迷茫期"人群的AI陪伴系统，通过深度共情、智能记忆、安全防护和投射工具，帮助用户探索内心状态、理清困惑、找到方向。

> **English**: An AI companion system for people experiencing "life confusion", helping users explore their inner state, clarify confusions, and find direction through deep empathy, intelligent memory, safety protection, and projective tools.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![EdgeOne Makers](https://img.shields.io/badge/EdgeOne-Makers-orange.svg)](https://console.cloud.tencent.com/edgeone/makers)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-green.svg)](https://langchain-ai.github.io/langgraph/)
[![License](https://img.shields.io/badge/License-Apache%202.0-yellow.svg)](https://www.apache.org/licenses/LICENSE-2.0)

---

## ⚠️ 免责声明 / Disclaimer

### 中文

**本项目仅供研究和学习目的使用。**

1. **非医疗设备**：本系统不是医疗设备，不能替代专业的心理健康诊断、治疗或咨询服务。如有心理健康问题，请寻求专业医疗帮助。

2. **非专业咨询**：本系统提供的共情回应和探索引导不构成心理咨询、心理治疗或任何形式的专业建议。

3. **危机情况**：如果您或您认识的人正处于危机中（如自杀念头、自伤行为），请立即联系当地的紧急服务（中国：120/110）或心理健康热线（全国24小时心理援助热线：400-161-9995）。

4. **数据安全**：本系统处理用户的情感和个人信息。使用者应了解数据处理的风险，并遵守相关的数据保护法规。

5. **AI局限性**：本系统基于人工智能技术，可能存在误判、误报或不当回应。用户不应完全依赖AI的判断。

6. **责任限制**：在法律允许的最大范围内，本项目的贡献者和维护者不对因使用本系统而产生的任何直接、间接、偶然、特殊或后果性损害承担责任。

7. **使用年龄**：本系统不适用于18岁以下的未成年人。

**使用本系统即表示您已阅读、理解并同意上述免责声明。**

### English

**This project is for research and educational purposes only.**

1. **Not a Medical Device**: This system is not a medical device and cannot replace professional mental health diagnosis, treatment, or counseling services. If you have mental health concerns, please seek professional medical help.

2. **Not Professional Counseling**: The empathetic responses and exploratory guidance provided by this system do not constitute psychological counseling, psychotherapy, or any form of professional advice.

3. **Crisis Situations**: If you or someone you know is in crisis (such as suicidal thoughts, self-harm behavior), please immediately contact local emergency services or mental health hotlines (e.g., National Suicide Prevention Lifeline: 988 in the US).

4. **Data Security**: This system processes users' emotional and personal information. Users should be aware of the risks of data processing and comply with relevant data protection regulations.

5. **AI Limitations**: This system is based on artificial intelligence technology and may have misjudgments, false positives, or inappropriate responses. Users should not rely solely on AI judgments.

6. **Limitation of Liability**: To the maximum extent permitted by law, the contributors and maintainers of this project shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from the use of this system.

7. **Age Requirement**: This system is not intended for use by minors under 18 years of age.

**By using this system, you acknowledge that you have read, understood, and agreed to the above disclaimer.**

---

## 🤖 模型训练与接入指南 / Model Training & Integration Guide

### 小模型训练 / Small Model Training

本项目支持本地小模型微调，用于提升情感识别精度：

#### 训练数据准备 / Training Data Preparation

```bash
# 生成训练数据
cd lib/safety-classifier
# 运行数据准备脚本（Python）
python training-data-prep.py

# 数据格式：JSONL
# {"text": "我最近很迷茫", "label": "L1", "emotion": "confusion"}
```

#### 微调DistilBERT / Fine-tuning DistilBERT

```python
# 训练脚本位于 lib/safety-classifier/training-script.ts
# 可生成Python训练脚本

# 安装依赖
pip install transformers datasets torch scikit-learn

# 运行训练
python train_safety_classifier.py

# 模型保存位置
# ./models/safety-classifier/best_model/
```

#### 模型部署 / Model Deployment

训练完成后，将模型文件放置在项目中：

```
models/
├── safety-classifier/
│   ├── best_model/
│   │   ├── config.json
│   │   ├── model.safetensors
│   │   ├── tokenizer.json
│   │   └── vocab.txt
│   └── training_args.bin
└── emotion-classifier/
    └── best_model/
```

### 大模型接入 / Large Model Integration

本项目通过EdgeOne Makers的AI Gateway接入大模型，无需用户提供API Key：

#### 默认配置 / Default Configuration

```typescript
// 环境变量（平台自动注入）
AI_GATEWAY_API_KEY    // AI Gateway API密钥
AI_GATEWAY_BASE_URL   // AI Gateway基础URL
AI_GATEWAY_MODEL      // 模型名称（默认：@makers/deepseek-v4-flash）
```

#### 支持的模型 / Supported Models

| 模型 | 说明 | 适用场景 |
|------|------|----------|
| `@makers/deepseek-v4-flash` | DeepSeek V4 Flash | 默认模型，平衡性能与速度 |
| `@makers/deepseek-v4` | DeepSeek V4 | 更高质量，延迟略高 |
| `@makers/qwen-turbo` | 通义千问Turbo | 中文优化 |
| `@makers/gpt-4o-mini` | GPT-4o Mini | 英文场景 |

#### 自定义模型 / Custom Models

如需接入自定义模型（如本地部署的模型），修改环境变量：

```bash
# .env
AI_GATEWAY_BASE_URL=http://your-model-server:8000/v1
AI_GATEWAY_API_KEY=your-api-key
AI_GATEWAY_MODEL=your-model-name
```

#### 模型切换策略 / Model Switching Strategy

```typescript
// 在 lib/orchestrator/orchestrator.ts 中可配置不同场景使用不同模型
const MODEL_CONFIG = {
  // 情感识别：需要高精度
  emotion_recognition: '@makers/deepseek-v4',
  // 共情响应：需要自然流畅
  empathy_response: '@makers/deepseek-v4-flash',
  // 意图分类：需要快速
  intent_classification: '@makers/qwen-turbo',
  // 安全检测：需要高召回率
  safety_detection: '@makers/deepseek-v4',
};
```

---

## ✨ 核心特性 / Core Features

### 🎭 27类细粒度情绪识别 / 27 Fine-grained Emotion Recognition

基于Ekman六基本情绪理论 + GoEmotions数据集，构建三层情感标签体系：
Based on Ekman's six basic emotions theory + GoEmotions dataset, a three-layer emotion tag system:

- **基础层 / Layer 1**：10类（焦虑、悲伤、愤怒、恐惧、厌恶、惊讶、无力、麻木、羞耻、期待）
- **细粒度层 / Layer 2**：27类（9正向 + 12负向 + 6模糊/复合）
- **情境层 / Layer 3**：同一情绪在不同情境下的差异化共情策略

### 💝 五层共情决策引擎 / Five-layer Empathy Decision Engine

| 层级 | 名称 / Name | 适用场景 / Scenario | 核心技术 / Technique |
|------|-------------|---------------------|---------------------|
| L1 | 安全优先 / Safety First | 危机检测 | 评估风险、提供资源 |
| L2 | 情绪命名+验证 / Name+Validate | 高强度负面情绪 | 准确命名、验证合理性 |
| L3 | 正常化+去标签化 / Normalize | 中等负面情绪 | 说明普遍性、避免病理化 |
| L4 | 深度共情+镜像 / Deep Empathy | 情绪改善或探索 | 反映深层感受、探索需求 |
| L5 | 温和推进+行动实验 / Gentle Push | 积极状态 | 探索意愿、小步骤建议 |

### 🧠 智能记忆系统 / Intelligent Memory System

- **四路并行检索 / 4-way Parallel Retrieval**：Milvus向量检索 + Neo4j图查询 + PostgreSQL结构化检索 + GraphRAG全局推理
- **Cross-Encoder重排序 / Cross-Encoder Reranking**：精排top-5记忆
- **LLMLingua压缩 / LLMLingua Compression**：将检索结果压缩到目标token数
- **记忆衰减模型 / Memory Decay Model**：半衰期90天，自动归档过时记忆

### 🛡️ 四层安全防护 / Four-layer Safety Protection

```
Layer 1: 关键词/正则匹配（<5ms）
Layer 2: 语义模型分类（<50ms）
Layer 3: 上下文风险推理（<20ms）
Layer 4: 融合决策 + 阈值校准（<5ms）
```

### 🃏 塔罗破冰模块 / Tarot Ice-breaking Module

- 22张大阿尔卡纳，每张3面向诠释
- 智能选牌：基于情绪状态和已知主题匹配
- 敏感牌面安全化处理
- 跨会话叙事线索检测

### 🎯 意图识别与路由 / Intent Recognition & Routing

- 三级级联识别：安全快筛→粗分类→上下文增强
- 9类交互模式意图
- 智能路由决策引擎

### 🔄 对话状态机 / Conversation State Machine

- 12个全局状态 + 完整转换规则
- 4个旅程阶段（觉察→梳理→行动→整合）
- 跨会话状态持久化

---

## 🏗️ 系统架构 / System Architecture

```
用户输入 / User Input
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│              意图识别模块 / Intent Recognition            │
│         "用户此刻想要什么"（三级级联识别）                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              安全分类器 / Safety Classifier               │
│         四层融合检测（规则+模型+上下文+融合）              │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ 塔罗   │ │ 图片   │ │ 直接   │
         │ Tarot  │ │ Image  │ │ Direct │
         └───┬────┘ └───┬────┘ └───┬────┘
             └──────────┼──────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│          对话状态机与编排器 / State Machine & Orchestrator │
│    状态转换 → 记忆检索 → 上下文组装 → LLM生成             │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ 共情   │ │ 探索   │ │ 行动   │
         │Empathy │ │Explore │ │ Action │
         └───┬────┘ └───┬────┘ └───┬────┘
             └──────────┼──────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│                记忆系统 / Memory System                   │
│    向量 │ 图查询 │ 结构化 │ GraphRAG │ 衰减模型           │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
            SSE响应 / SSE Response → 用户 / User
```

---

## 📁 项目结构 / Project Structure

```
empathy-agent/
├── agents/                         # Agent后端 / Agent Backend
│   ├── _shared.ts                  # SSE辅助函数
│   └── empathy-agent/
│       └── index.ts                # 主入口（集成所有模块）
│
├── lib/                            # 核心库 / Core Library
│   ├── index.ts                    # 统一导出
│   ├── emotion-tags.ts             # 情感标签体系（27类）
│   ├── emotion-recognition.ts      # 情感识别引擎
│   ├── emotion-tracker.ts          # 情绪轨迹追踪器
│   ├── empathy-decision.ts         # 共情决策引擎
│   ├── safety.ts                   # 安全机制
│   ├── safety-classifier/          # 安全分类器
│   ├── memory/                     # 记忆系统
│   ├── tarot/                      # 塔罗破冰模块
│   ├── orchestrator/               # 对话状态机与编排器
│   └── intent/                     # 意图识别与路由
│
├── src/                            # 前端 / Frontend
│   └── index.html                  # 对话界面
│
├── models/                         # 训练模型 / Trained Models
│   └── safety-classifier/          # 安全分类器模型
│
├── edgeone.json                    # 部署配置
├── package.json                    # 项目依赖
├── LICENSE                         # Apache 2.0 协议
└── README.md                       # 本文件
```

---

## 🚀 快速开始 / Quick Start

### 1. 安装依赖 / Install Dependencies

```bash
npm install
```

### 2. 环境配置 / Environment Configuration

```bash
cp .env.example .env
```

需要配置的环境变量 / Required environment variables:
- `AI_GATEWAY_API_KEY`：AI Gateway API密钥（平台自动注入）
- `AI_GATEWAY_BASE_URL`：AI Gateway基础URL（平台自动注入）
- `AI_GATEWAY_MODEL`：可选，自定义模型名称

### 3. 本地开发 / Local Development

```bash
edgeone makers dev --name empathy-agent --skip-env-sync
```

访问 `http://127.0.0.1:8088/` 查看对话界面。

### 4. 部署 / Deploy

```bash
edgeone makers deploy -n empathy-agent
```

---

## 📊 情感标签体系 / Emotion Tag System

### 第一层：基础情绪层 / Layer 1: Basic Emotions

| 情绪 / Emotion | 效价 / Valence | 唤醒度 / Arousal | 支配度 / Dominance | 触发场景 / Trigger |
|----------------|----------------|------------------|--------------------|--------------------|
| 焦虑 / Anxiety | -0.7 | 0.8 | 0.3 | 转行选择、面试前 |
| 悲伤 / Sadness | -0.8 | 0.3 | 0.2 | 机会错过、关系破裂 |
| 愤怒 / Anger | -0.9 | 0.9 | 0.7 | 职场不公、被轻视 |
| 恐惧 / Fear | -0.9 | 0.9 | 0.1 | 失败后果、经济风险 |
| 无力 / Helplessness | -0.7 | 0.4 | 0.1 | 反复尝试无果 |
| 麻木 / Numbness | -0.3 | 0.2 | 0.3 | 长期迷茫后的倦怠 |
| 羞耻 / Shame | -0.8 | 0.7 | 0.2 | 觉得自己"混得差" |
| 期待 / Anticipation | 0.6 | 0.7 | 0.6 | 开始行动实验时 |

---

## 🛡️ 安全机制 / Safety Mechanism

### 三级风险分级 / Three-level Risk Classification

| 等级 / Level | 标签 / Label | 定义 / Definition | 响应 / Response |
|--------------|--------------|-------------------|-----------------|
| L0 | Safe / 安全 | 无安全顾虑 | 正常对话 |
| L1 | Caution / 关注 | 中度心理困扰 | 加强共情，建议专业帮助 |
| L2 | Crisis / 危机 | 即刻风险 | 终止对话，危机协议 |

### 危机热线 / Crisis Hotlines

- **中国**：全国24小时心理援助热线 400-161-9995
- **中国**：北京心理危机研究与干预中心 010-82951332
- **中国**：生命热线 400-821-1215
- **中国**：急救电话 120
- **美国**：National Suicide Prevention Lifeline 988
- **国际**：International Association for Suicide Prevention https://www.iasp.info/resources/Crisis_Centres/

---

## 🃏 塔罗破冰模块 / Tarot Ice-breaking Module

### 投射工具设计 / Projective Tool Design

塔罗不是占卜工具，而是**投射工具**（projective tool）。通过模糊的、开放性的刺激物，让人把内心状态"投射"出来。

Tarot is not a divination tool, but a **projective tool**. Through ambiguous, open-ended stimuli, people can "project" their inner state.

### 安全化处理 / Safety Processing

| 敏感牌面 / Sensitive Card | 呈现名称 / Display Name | 避免措辞 / Avoid |
|---------------------------|------------------------|------------------|
| XIII 死神 / Death | "转变" / "Transformation" | 不用"死"字 |
| XVI 高塔 / The Tower | "重建" / "Rebuilding" | 不用"崩塌" |
| XV 恶魔 / The Devil | "束缚" / "Bondage" | 不用"恶魔" |

---

## 🔄 对话状态机 / Conversation State Machine

### 全局状态 / Global States

```
INIT → SAFETY_SCREEN → ENTRY_SELECT
  ├── TAROT_ENTRY ─────┐
  ├── IMAGE_ENTRY ─────┤
  └── DIRECT_ENTRY ────┤
                       ▼
                  EMPATHY_PHASE
                       │
                       ▼
                  EXPLORE_PHASE
                       │
                       ▼
                   ACTION_PHASE
                       │
                       ▼
                   REVIEW_PHASE
                       │
                       ▼
                  SESSION_CLOSE
```

### 旅程阶段 / Journey Stages

| 阶段 / Stage | 目标 / Goal | 标志 / Sign | 推荐状态 / Recommended |
|--------------|-------------|-------------|------------------------|
| Stage 1: 觉察与稳定 | 建立信任 | 能说出模糊感受 | 共情 + 塔罗 |
| Stage 2: 具体化与梳理 | 看清冲突 | 能说出冲突所在 | 共情 + 探索 |
| Stage 3: 行动与验证 | 验证假设 | 完成行动实验 | 行动 + 探索 |
| Stage 4: 整合与方向 | 形成方向 | 有可执行方向 | 复盘 + 新探索 |

---

## 🎯 意图识别 / Intent Recognition

### 三层意图架构 / Three-layer Intent Architecture

```
Layer 1: 安全意图 / Safety Intent（最高优先级）
├── L1.1 危机求助 / Crisis Help
├── L1.2 自伤/自杀表达 / Self-harm
└── L1.3 伤害他人表达 / Harm Others

Layer 2: 交互模式意图 / Interaction Intent（9类）
├── L2.1 情绪倾诉 / Emotional Venting
├── L2.2 探索求助 / Exploration Request
├── L2.3 行动讨论 / Action Discussion
├── L2.4 复盘回顾 / Review Request
├── L2.5 寻求建议 / Advice Seeking
├── L2.6 信息查询 / Information Query
├── L2.7 元对话 / Meta-conversation
├── L2.8 关系建立 / Relationship Building
└── L2.9 意图不明 / Ambiguous Intent
```

---

## 🔧 技术栈 / Tech Stack

| 组件 / Component | 技术 / Technology | 说明 / Description |
|------------------|-------------------|-------------------|
| 平台 / Platform | EdgeOne Makers | 一站式Web全栈部署 |
| AI框架 / AI Framework | LangGraph | 状态图驱动的Agent框架 |
| AI能力 / AI Capability | AI Gateway | 平台自动注入，无需用户提供API Key |
| 流式响应 / Streaming | SSE | Server-Sent Events实时推送 |
| 前端 / Frontend | 原生HTML/CSS/JS | 零依赖，轻量级 |

---

## 📈 评估指标 / Evaluation Metrics

### 情感识别 / Emotion Recognition

| 指标 / Metric | 目标值 / Target |
|---------------|-----------------|
| 27类分类 Macro-F1 | ≥ 0.55 |
| Ekman 6类映射 F1 | ≥ 0.72 |
| 情绪强度回归误差 | ≤ 0.15 |

### 共情质量 / Empathy Quality

| 指标 / Metric | 目标值 / Target |
|---------------|-----------------|
| 专家评分（1-5分） | ≥ 3.8 |
| 禁止短语出现率 | 0% |
| 用户继续表达率 | ≥ 65% |

### 安全分类器 / Safety Classifier

| 指标 / Metric | 目标值 / Target |
|---------------|-----------------|
| L2 召回率 / Recall | ≥ 0.95 |
| L2 精确率 / Precision | ≥ 0.80 |
| L0 误报率 / False Positive | ≤ 0.10 |

---

## 🗺️ 后续规划 / Roadmap

### 短期（1-3个月）/ Short-term
- [ ] 接入 PostgreSQL 持久化存储
- [ ] 接入 Milvus 向量数据库
- [ ] 微调 DistilBERT 情感分类模型
- [ ] 完善红队测试用例

### 中期（3-6个月）/ Mid-term
- [ ] 接入 Neo4j 知识图谱
- [ ] 实现 GraphRAG 全局推理
- [ ] 多模态情感识别（语音+文本）
- [ ] 联邦学习模型优化

### 长期（6-12个月）/ Long-term
- [ ] 差分隐私保护
- [ ] 跨语言支持
- [ ] 移动端适配
- [ ] 临床验证与合规

---

## 🤝 贡献指南 / Contributing

欢迎贡献代码、报告问题或提出建议！

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork 本仓库 / Fork the repository
2. 创建特性分支 / Create your feature branch (`git checkout -b feature/amazing-feature`)
3. 提交更改 / Commit your changes (`git commit -m 'Add amazing feature'`)
4. 推送到分支 / Push to the branch (`git push origin feature/amazing-feature`)
5. 创建 Pull Request / Open a Pull Request

---

## 📄 许可证 / License

本项目基于 [Apache License 2.0](LICENSE) 开源。

This project is licensed under the [Apache License 2.0](LICENSE).

---

## 🙏 致谢 / Acknowledgments

- [GoEmotions](https://github.com/google-research/google-research/tree/master/goemotions) - 27类情感分类数据集
- [Ekman's Basic Emotions](https://en.wikipedia.org/wiki/Emotion_classification#Ekman's_basic_emotions) - 六基本情绪理论
- [LangGraph](https://langchain-ai.github.io/langgraph/) - Agent框架
- [EdgeOne Makers](https://console.cloud.tencent.com/edgeone/makers) - 部署平台
- [HuggingFace Transformers](https://huggingface.co/docs/transformers/) - 模型训练框架

---

## 📧 联系方式 / Contact

如有问题或建议，请通过以下方式联系：
For questions or suggestions, please contact:

- 提交 [Issue](../../issues)
- 发送邮件 / Email: 18042036670@163.com

---

<p align="center">
  <b>🌙 情感共情陪伴Agent</b><br>
  <i>让每一个迷茫的灵魂都被温柔以待</i><br>
  <i>Let every confused soul be treated with gentleness</i>
</p>
