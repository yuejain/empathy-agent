/**
 * 安全分类器 - 训练脚本
 *
 * 用于微调 DistilBERT/RoBERTa 模型
 * 当前为脚本框架，暂不执行实际训练
 *
 * 使用方式：
 * 1. 准备训练数据（getAllTrainingSamples()）
 * 2. 配置训练参数
 * 3. 运行训练（需要 Python 环境 + PyTorch + Transformers）
 */

import {
  SafetyTrainingSample, RedTeamTestCase,
  RedTeamTestResult, RiskLevel, CrisisSubtype,
} from './types';
import {
  getAllTrainingSamples,
  getAllRedTeamTestCases,
  TrainingDataExporter,
  AnnotationStatisticsCalculator,
} from './training-data';

// ==================== 训练配置 ====================

export interface TrainingConfig {
  /** 基础模型 */
  baseModel: 'distilbert-base-chinese' | 'bert-base-chinese' | 'roberta-base-chinese';
  /** 训练轮数 */
  epochs: number;
  /** 学习率 */
  learningRate: number;
  /** 批次大小 */
  batchSize: number;
  /** 最大序列长度 */
  maxLength: number;
  /** 训练集比例 */
  trainRatio: number;
  /** 验证集比例 */
  valRatio: number;
  /** 测试集比例 */
  testRatio: number;
  /** 是否使用上下文 */
  useContext: boolean;
  /** 上下文窗口大小 */
  contextWindowSize: number;
  /** 多标签分类 */
  multiLabel: boolean;
  /** 早停轮数 */
  earlyStoppingPatience: number;
  /** 输出目录 */
  outputDir: string;
}

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  baseModel: 'distilbert-base-chinese',
  epochs: 10,
  learningRate: 2e-5,
  batchSize: 16,
  maxLength: 256,
  trainRatio: 0.7,
  valRatio: 0.15,
  testRatio: 0.15,
  useContext: true,
  contextWindowSize: 5,
  multiLabel: true,
  earlyStoppingPatience: 3,
  outputDir: './models/safety-classifier',
};

// ==================== 数据集分割 ====================

export interface DatasetSplit {
  train: SafetyTrainingSample[];
  val: SafetyTrainingSample[];
  test: SafetyTrainingSample[];
}

export function splitDataset(
  samples: SafetyTrainingSample[],
  config: TrainingConfig
): DatasetSplit {
  // 按风险等级分层抽样
  const byLevel: Record<RiskLevel, SafetyTrainingSample[]> = {
    L0: [],
    L1: [],
    L2: [],
  };

  for (const sample of samples) {
    byLevel[sample.riskLevel].push(sample);
  }

  const train: SafetyTrainingSample[] = [];
  const val: SafetyTrainingSample[] = [];
  const test: SafetyTrainingSample[] = [];

  for (const level of ['L0', 'L1', 'L2'] as RiskLevel[]) {
    const levelSamples = byLevel[level];
    // 打乱
    const shuffled = [...levelSamples].sort(() => Math.random() - 0.5);

    const trainCount = Math.floor(shuffled.length * config.trainRatio);
    const valCount = Math.floor(shuffled.length * config.valRatio);

    train.push(...shuffled.slice(0, trainCount));
    val.push(...shuffled.slice(trainCount, trainCount + valCount));
    test.push(...shuffled.slice(trainCount + valCount));
  }

  return { train, val, test };
}

// ==================== Python 训练脚本生成 ====================

/**
 * 生成 Python 训练脚本
 * 使用 HuggingFace Transformers 库
 */
export function generatePythonTrainingScript(config: TrainingConfig): string {
  return `#!/usr/bin/env python3
"""
安全分类器训练脚本
基于 HuggingFace Transformers 微调 DistilBERT/RoBERTa

使用方式：
  pip install transformers datasets torch scikit-learn
  python train_safety_classifier.py

注意：此脚本需要 Python 3.8+ 环境
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    EarlyStoppingCallback,
)
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    classification_report,
)
import numpy as np


# ==================== 配置 ====================

CONFIG = {
    "base_model": "${config.baseModel}",
    "epochs": ${config.epochs},
    "learning_rate": ${config.learningRate},
    "batch_size": ${config.batchSize},
    "max_length": ${config.maxLength},
    "train_ratio": ${config.trainRatio},
    "val_ratio": ${config.valRatio},
    "test_ratio": ${config.testRatio},
    "use_context": ${config.useContext ? 'True' : 'False'},
    "context_window_size": ${config.contextWindowSize},
    "multi_label": ${config.multiLabel ? 'True' : 'False'},
    "early_stopping_patience": ${config.earlyStoppingPatience},
    "output_dir": "${config.outputDir}",
}

# 风险等级标签
LABEL2ID = {"L0": 0, "L1": 1, "L2": 2}
ID2LABEL = {v: k for k, v in LABEL2ID.items()}

# 危机子类标签
SUBTYPE2ID = {
    "suicide_self_harm": 0,
    "violence_others": 1,
    "abuse": 2,
    "acute_psychosis": 3,
    "substance_abuse": 4,
    "eating_disorder": 5,
    "none": 6,
}
ID2SUBTYPE = {v: k for k, v in SUBTYPE2ID.items()}


# ==================== 数据集 ====================

class SafetyDataset(Dataset):
    """安全分类器数据集"""

    def __init__(
        self,
        data: List[Dict],
        tokenizer,
        max_length: int,
        use_context: bool = False,
        context_window_size: int = 5,
    ):
        self.data = data
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.use_context = use_context
        self.context_window_size = context_window_size

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        item = self.data[idx]
        text = item["text"]
        label = LABEL2ID[item["label"]]
        subtype = SUBTYPE2ID[item.get("subtype", "none")]

        # 如果使用上下文，将上下文拼接到文本前面
        if self.use_context and item.get("context"):
            context = item["context"][-self.context_window_size:]
            context_text = " [SEP] ".join(context)
            text = f"{context_text} [SEP] {text}"

        # Tokenize
        encoding = self.tokenizer(
            text,
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

        return {
            "input_ids": encoding["input_ids"].squeeze(),
            "attention_mask": encoding["attention_mask"].squeeze(),
            "labels": torch.tensor(label, dtype=torch.long),
            "subtypes": torch.tensor(subtype, dtype=torch.long),
        }


# ==================== 模型 ====================

class SafetyClassifierModel:
    """安全分类器模型"""

    def __init__(self, config: Dict):
        self.config = config
        self.tokenizer = AutoTokenizer.from_pretrained(config["base_model"])
        self.model = AutoModelForSequenceClassification.from_pretrained(
            config["base_model"],
            num_labels=3,  # L0, L1, L2
            id2label=ID2LABEL,
            label2id=LABEL2ID,
            problem_type="single_label_classification",
        )

    def train(
        self,
        train_data: List[Dict],
        val_data: List[Dict],
    ):
        """训练模型"""
        # 创建数据集
        train_dataset = SafetyDataset(
            train_data,
            self.tokenizer,
            self.config["max_length"],
            self.config["use_context"],
            self.config["context_window_size"],
        )
        val_dataset = SafetyDataset(
            val_data,
            self.tokenizer,
            self.config["max_length"],
            self.config["use_context"],
            self.config["context_window_size"],
        )

        # 训练参数
        training_args = TrainingArguments(
            output_dir=self.config["output_dir"],
            num_train_epochs=self.config["epochs"],
            per_device_train_batch_size=self.config["batch_size"],
            per_device_eval_batch_size=self.config["batch_size"],
            learning_rate=self.config["learning_rate"],
            weight_decay=0.01,
            evaluation_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
            metric_for_best_model="f1",
            greater_is_better=True,
            logging_dir=f"{self.config['output_dir']}/logs",
            logging_steps=10,
            save_total_limit=3,
            fp16=torch.cuda.is_available(),
        )

        # 创建 Trainer
        trainer = Trainer(
            model=self.model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            compute_metrics=self.compute_metrics,
            callbacks=[
                EarlyStoppingCallback(
                    early_stopping_patience=self.config["early_stopping_patience"]
                )
            ],
        )

        # 开始训练
        print("开始训练...")
        trainer.train()

        # 保存模型
        trainer.save_model(f"{self.config['output_dir']}/best_model")
        self.tokenizer.save_pretrained(f"{self.config['output_dir']}/best_model")
        print(f"模型已保存到 {self.config['output_dir']}/best_model")

    def evaluate(self, test_data: List[Dict]) -> Dict:
        """评估模型"""
        test_dataset = SafetyDataset(
            test_data,
            self.tokenizer,
            self.config["max_length"],
            self.config["use_context"],
            self.config["context_window_size"],
        )

        trainer = Trainer(
            model=self.model,
            compute_metrics=self.compute_metrics,
        )

        results = trainer.evaluate(test_dataset)
        return results

    @staticmethod
    def compute_metrics(eval_pred) -> Dict:
        """计算评估指标"""
        logits, labels = eval_pred
        predictions = np.argmax(logits, axis=-1)

        precision, recall, f1, _ = precision_recall_fscore_support(
            labels, predictions, average="weighted"
        )
        accuracy = accuracy_score(labels, predictions)

        # 计算每个类别的指标
        per_class_report = classification_report(
            labels, predictions,
            target_names=["L0", "L1", "L2"],
            output_dict=True,
        )

        return {
            "accuracy": accuracy,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "l0_f1": per_class_report["L0"]["f1-score"],
            "l1_f1": per_class_report["L1"]["f1-score"],
            "l2_f1": per_class_report["L2"]["f1-score"],
            "l2_recall": per_class_report["L2"]["recall"],  # L2 召回率是关键指标
        }

    def predict(self, text: str, context: List[str] = None) -> Dict:
        """预测单条文本"""
        # 拼接上下文
        if context and self.config["use_context"]:
            context_text = " [SEP] ".join(context[-self.config["context_window_size"]:])
            text = f"{context_text} [SEP] {text}"

        # Tokenize
        inputs = self.tokenizer(
            text,
            max_length=self.config["max_length"],
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

        # 推理
        self.model.eval()
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            probs = torch.softmax(logits, dim=-1).squeeze().tolist()

        # 解析结果
        predicted_id = np.argmax(probs)
        predicted_level = ID2LABEL[predicted_id]

        return {
            "risk_level": predicted_level,
            "probabilities": {ID2LABEL[i]: p for i, p in enumerate(probs)},
            "confidence": max(probs),
        }


# ==================== 红队测试 ====================

def run_red_team_tests(model: SafetyClassifierModel, test_cases: List[Dict]) -> Dict:
    """运行红队测试"""
    total = len(test_cases)
    passed = 0
    failed = 0
    failure_modes = []

    for tc in test_cases:
        prediction = model.predict(tc["input"], tc.get("context"))

        if prediction["risk_level"] == tc["expected_level"]:
            passed += 1
        else:
            failed += 1
            failure_modes.append({
                "test_case": tc,
                "actual_level": prediction["risk_level"],
                "reason": f"Expected {tc['expected_level']}, got {prediction['risk_level']}",
            })

    return {
        "total_tests": total,
        "passed": passed,
        "failed": failed,
        "attack_success_rate": failed / total if total > 0 else 0,
        "failure_modes": failure_modes,
    }


# ==================== 主函数 ====================

def main():
    """主训练流程"""
    print("=" * 60)
    print("安全分类器训练脚本")
    print("=" * 60)

    # 1. 加载数据
    print("\\n[1/5] 加载训练数据...")
    # TODO: 从文件加载实际训练数据
    # train_data = load_jsonl("data/train.jsonl")
    # val_data = load_jsonl("data/val.jsonl")
    # test_data = load_jsonl("data/test.jsonl")

    # 示例数据
    train_data = [
        {"text": "我最近工作压力很大", "label": "L0", "subtype": "none"},
        {"text": "我每天都失眠", "label": "L1", "subtype": "none"},
        {"text": "我想死", "label": "L2", "subtype": "suicide_self_harm"},
    ]
    val_data = train_data[:1]
    test_data = train_data[:1]

    print(f"  训练集：{len(train_data)} 条")
    print(f"  验证集：{len(val_data)} 条")
    print(f"  测试集：{len(test_data)} 条")

    # 2. 初始化模型
    print("\\n[2/5] 初始化模型...")
    classifier = SafetyClassifierModel(CONFIG)
    print(f"  基础模型：{CONFIG['base_model']}")
    print(f"  参数量：{sum(p.numel() for p in classifier.model.parameters()):,}")

    # 3. 训练
    print("\\n[3/5] 开始训练...")
    classifier.train(train_data, val_data)

    # 4. 评估
    print("\\n[4/5] 评估模型...")
    results = classifier.evaluate(test_data)
    print(f"  准确率：{results['eval_accuracy']:.4f}")
    print(f"  F1分数：{results['eval_f1']:.4f}")
    print(f"  L2召回率：{results['eval_l2_recall']:.4f}")

    # 5. 红队测试
    print("\\n[5/5] 运行红队测试...")
    red_team_results = run_red_team_tests(classifier, []  # TODO: 加载红队测试用例
    )
    print(f"  通过：{red_team_results['passed']}/{red_team_results['total_tests']}")
    print(f"  攻击成功率：{red_team_results['attack_success_rate']:.2%}")

    print("\\n" + "=" * 60)
    print("训练完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
`;
}

// ==================== 数据准备脚本 ====================

/**
 * 生成数据准备脚本
 */
export function generateDataPreparationScript(): string {
  return `#!/usr/bin/env python3
"""
安全分类器 - 数据准备脚本

将训练数据导出为 JSONL 格式，用于模型训练
"""

import json
from pathlib import Path


def prepare_training_data():
    """准备训练数据"""
    # 这里应该从 TypeScript 训练数据模块导出数据
    # 实际使用时，需要先运行 TypeScript 导出脚本

    # 示例：创建数据目录
    output_dir = Path("data/safety-classifier")
    output_dir.mkdir(parents=True, exist_ok=True)

    # 训练数据
    train_data = [
        {"text": "我最近工作压力很大", "label": "L0", "subtype": "none", "context": []},
        {"text": "我每天都失眠，已经持续一个月了", "label": "L1", "subtype": "none", "context": []},
        {"text": "我想死，活着太累了", "label": "L2", "subtype": "suicide_self_harm", "context": []},
        # ... 更多训练数据
    ]

    # 验证数据
    val_data = train_data[:2]

    # 测试数据
    test_data = train_data[:2]

    # 保存为 JSONL
    for name, data in [("train", train_data), ("val", val_data), ("test", test_data)]:
        filepath = output_dir / f"{name}.jsonl"
        with open(filepath, "w", encoding="utf-8") as f:
            for item in data:
                f.write(json.dumps(item, ensure_ascii=False) + "\\n")
        print(f"已保存 {filepath}：{len(data)} 条")

    print("\\n数据准备完成！")


if __name__ == "__main__":
    prepare_training_data()
`;
}

// ==================== 训练管理器 ====================

export class TrainingManager {
  private config: TrainingConfig;
  private samples: SafetyTrainingSample[];
  private redTeamTests: RedTeamTestCase[];

  constructor(config: Partial<TrainingConfig> = {}) {
    this.config = { ...DEFAULT_TRAINING_CONFIG, ...config };
    this.samples = getAllTrainingSamples();
    this.redTeamTests = getAllRedTeamTestCases();
  }

  /**
   * 获取训练数据统计
   */
  getDataStatistics(): string {
    return AnnotationStatisticsCalculator.generateReport(this.samples);
  }

  /**
   * 导出训练数据
   */
  exportTrainingData(outputDir: string): void {
    const split = splitDataset(this.samples, this.config);

    // 导出 JSONL
    const trainJSONL = TrainingDataExporter.toJSONL(split.train);
    const valJSONL = TrainingDataExporter.toJSONL(split.val);
    const testJSONL = TrainingDataExporter.toJSONL(split.test);

    console.log(`训练集：${split.train.length} 条`);
    console.log(`验证集：${split.val.length} 条`);
    console.log(`测试集：${split.test.length} 条`);

    // 这里应该写入文件，但当前环境不支持
    // fs.writeFileSync(`${outputDir}/train.jsonl`, trainJSONL);
    // fs.writeFileSync(`${outputDir}/val.jsonl`, valJSONL);
    // fs.writeFileSync(`${outputDir}/test.jsonl`, testJSONL);
  }

  /**
   * 导出红队测试用例
   */
  exportRedTeamTests(): string {
    return TrainingDataExporter.exportRedTeamTests(this.redTeamTests);
  }

  /**
   * 生成 Python 训练脚本
   */
  generateTrainingScript(): string {
    return generatePythonTrainingScript(this.config);
  }

  /**
   * 生成数据准备脚本
   */
  generateDataPrepScript(): string {
    return generateDataPreparationScript();
  }

  /**
   * 获取完整训练计划
   */
  getTrainingPlan(): string {
    let plan = `# 安全分类器训练计划\n\n`;

    plan += `## 1. 数据统计\n`;
    plan += this.getDataStatistics();

    plan += `\n## 2. 训练配置\n`;
    plan += `- 基础模型：${this.config.baseModel}\n`;
    plan += `- 训练轮数：${this.config.epochs}\n`;
    plan += `- 学习率：${this.config.learningRate}\n`;
    plan += `- 批次大小：${this.config.batchSize}\n`;
    plan += `- 最大序列长度：${this.config.maxLength}\n`;
    plan += `- 使用上下文：${this.config.useContext ? '是' : '否'}\n`;
    plan += `- 早停轮数：${this.config.earlyStoppingPatience}\n`;

    plan += `\n## 3. 数据分割\n`;
    const split = splitDataset(this.samples, this.config);
    plan += `- 训练集：${split.train.length} 条\n`;
    plan += `- 验证集：${split.val.length} 条\n`;
    plan += `- 测试集：${split.test.length} 条\n`;

    plan += `\n## 4. 红队测试\n`;
    plan += `- 测试用例数：${this.redTeamTests.length}\n`;
    plan += `- 难度分布：\n`;
    const difficultyCount: Record<string, number> = {};
    for (const tc of this.redTeamTests) {
      difficultyCount[tc.difficulty] = (difficultyCount[tc.difficulty] || 0) + 1;
    }
    for (const [difficulty, count] of Object.entries(difficultyCount)) {
      plan += `  - ${difficulty}: ${count}\n`;
    }

    plan += `\n## 5. 评估指标\n`;
    plan += `- L2 召回率目标：≥ 0.95\n`;
    plan += `- L2 精确率目标：≥ 0.80\n`;
    plan += `- L1 召回率目标：≥ 0.85\n`;
    plan += `- L0 误报率目标：≤ 0.10\n`;
    plan += `- 整体 F1 目标：≥ 0.90\n`;

    return plan;
  }
}
