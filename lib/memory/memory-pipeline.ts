import { ChatGateway, ChatMessage } from '../gateway';
/**
 * 记忆管线 - 完整的实时链路编排
 *
 * 时序：
 * ① 安全分类 → ② 记忆检索（四路并行）→ ③ LLMLingua 压缩 →
 * ④ 情绪识别 + 共情决策 → ⑤ LLM 生成 → ⑥ 输出过滤 →
 * ⑦ 记忆写入评估 → ⑧ 返回用户 → ⑨ 异步写入
 */

import { MemoryStore } from './memory-store';
import { MemoryRetrievalEngine } from './retrieval-engine';
import { SessionSummaryGenerator, type ConversationTurn } from './session-summary';
import {
  SafetyClassification, RiskLevel, MemoryWriteOperation,
  CompressedContext, RetrievalResult, MemoryEntryType
} from './types';

// 导入共情模块
import { EmotionRecognizer } from '../emotion-recognition';
import { EmotionTracker } from '../emotion-tracker';
import { EmpathyDecisionEngine, OutputFilter } from '../empathy-decision';
import { SafetyManager } from '../safety';

// 导入安全分类器模块
import {
  SafetyClassifier as AdvancedSafetyClassifier,
  type SafetyClassificationResult,
  type SafetyContextTurn,
  type SafetyClassifierConfig,
  DEFAULT_SAFETY_CONFIG,
} from '../safety-classifier';

// ==================== 管线配置 ====================

export interface MemoryPipelineConfig {
  /** 是否启用记忆检索 */
  enableRetrieval: boolean;
  /** 是否启用 LLMLingua 压缩 */
  enableCompression: boolean;
  /** 是否启用记忆写入 */
  enableWrite: boolean;
  /** 目标压缩率 */
  compressionRatio: number;
  /** 最大检索记忆数 */
  maxMemories: number;
  /** 对话历史保留轮数 */
  historyTurns: number;
}

const DEFAULT_CONFIG: MemoryPipelineConfig = {
  enableRetrieval: true,
  enableCompression: true,
  enableWrite: true,
  compressionRatio: 0.5,
  maxMemories: 5,
  historyTurns: 5,
};

// ==================== 管线上下文 ====================

export interface PipelineContext {
  userId: string;
  sessionId: string;
  conversationHistory: ConversationTurn[];
  env: Record<string, string>;
}

// ==================== 管线结果 ====================

export interface PipelineResult {
  /** 最终响应文本 */
  response: string;
  /** 情绪分析结果 */
  emotion: {
    primary: string;
    secondary?: string;
    intensity: number;
    valence: number;
    arousal: number;
  };
  /** 共情决策 */
  empathy: {
    level: string;
    strategy: string;
    reasoning: string;
  };
  /** 安全检查结果 */
  safety: {
    isSafe: boolean;
    riskLevel: RiskLevel;
    warnings: string[];
  };
  /** 记忆检索结果 */
  memory: {
    memoriesUsed: number;
    retrievalTimeMs: number;
    compressionRatio: number;
    graphragInsight?: string;
  };
  /** 记忆写入结果 */
  memoryWrite: {
    shouldWrite: boolean;
    operations: MemoryWriteOperation[];
    confirmed: boolean;
  };
  /** 质量评分 */
  quality: {
    score: number;
    warnings: string[];
  };
}

// ==================== 安全分类器（集成高级安全分类器） ====================

export class SafetyClassifier {
  private safetyManager: SafetyManager;
  private advancedClassifier: AdvancedSafetyClassifier;

  constructor(env: Record<string, string>, config?: Partial<SafetyClassifierConfig>) {
    this.safetyManager = new SafetyManager();
    this.advancedClassifier = new AdvancedSafetyClassifier(env, config);
  }

  /**
   * 快速安全分类（兼容旧接口）
   */
  classify(userInput: string, history: string[]): SafetyClassification {
    const quickCheck = this.safetyManager.quickSafetyCheck(userInput);

    if (!quickCheck.isSafe) {
      return {
        risk_level: 'high',
        risk_type: quickCheck.threatType,
        evidence: [`检测到安全威胁: ${quickCheck.threatType}`],
        should_block: true,
        safety_response: this.safetyManager['detector'].generateSafetyResponse(
          quickCheck.threatType,
          userInput
        ),
      };
    }

    // 检查连续负面情绪
    const recentNegative = history.slice(-3).filter(h =>
      /难过|悲伤|绝望|无助|痛苦/.test(h)
    );

    if (recentNegative.length >= 2) {
      return {
        risk_level: 'medium',
        risk_type: 'sustained_negative',
        evidence: ['连续多轮负面情绪'],
        should_block: false,
      };
    }

    return {
      risk_level: 'low',
      should_block: false,
      evidence: [],
    };
  }

  /**
   * 高级安全分类（使用四层融合检测）
   */
  async classifyAdvanced(
    userInput: string,
    sessionId: string,
    history: ConversationTurn[] = []
  ): Promise<SafetyClassificationResult> {
    // 转换历史格式
    const contextTurns: SafetyContextTurn[] = history.map(t => ({
      role: t.role as 'user' | 'assistant',
      content: t.content,
      timestamp: t.timestamp,
      emotionValence: t.emotion?.valence,
    }));

    return this.advancedClassifier.classify(userInput, sessionId, contextTurns);
  }
}

// ==================== 记忆管线主类 ====================

export class MemoryPipeline {
  private config: MemoryPipelineConfig;
  private store: MemoryStore;
  private retrievalEngine: MemoryRetrievalEngine;
  private summaryGenerator: SessionSummaryGenerator;
  private safetyClassifier: SafetyClassifier;

  // 共情模块
  private emotionRecognizer: EmotionRecognizer;
  private emotionTracker: EmotionTracker;
  private empathyEngine: EmpathyDecisionEngine;
  private outputFilter: OutputFilter;
  private safetyManager: SafetyManager;

  constructor(env: Record<string, string>, config: Partial<MemoryPipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化存储
    this.store = new MemoryStore();

    // 初始化检索引擎
    this.retrievalEngine = new MemoryRetrievalEngine(this.store);

    // 初始化会话摘要生成器
    this.summaryGenerator = new SessionSummaryGenerator(this.store);

    // 初始化安全分类器（使用高级四层融合检测）
    this.safetyClassifier = new SafetyClassifier(env);

    // 初始化共情模块
    this.emotionTracker = new EmotionTracker();
    this.empathyEngine = new EmpathyDecisionEngine();
    this.outputFilter = new OutputFilter();
    this.safetyManager = new SafetyManager();

    // EmotionRecognizer 需要 env，在 run 方法中初始化
    this.emotionRecognizer = null as any;
  }

  /**
   * 执行完整的实时链路
   */
  async run(userInput: string, context: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();

    // 初始化 EmotionRecognizer（需要 env）
    if (!this.emotionRecognizer) {
      this.emotionRecognizer = new EmotionRecognizer(context.env);
    }

    const historyTexts = context.conversationHistory.map(t => t.content);

    // ==================== ① 安全分类（使用四层融合检测） ====================
    const advancedSafetyResult = await this.safetyClassifier.classifyAdvanced(
      userInput,
      context.sessionId,
      context.conversationHistory
    );

    // 转换为兼容格式
    const safetyResult: SafetyClassification = {
      risk_level: advancedSafetyResult.riskLevel === 'L2' ? 'high' :
                  advancedSafetyResult.riskLevel === 'L1' ? 'medium' : 'low',
      risk_type: advancedSafetyResult.crisisSubtype !== 'none' ?
                 advancedSafetyResult.crisisSubtype : undefined,
      evidence: advancedSafetyResult.evidence,
      should_block: advancedSafetyResult.shouldBlock,
      safety_response: advancedSafetyResult.suggestedResponse,
    };

    if (safetyResult.should_block) {
      return this.buildSafetyResponse(safetyResult, context, advancedSafetyResult);
    }

    // ==================== ② 记忆检索 ====================
    let retrievalResult: RetrievalResult | null = null;
    let compressedContext: CompressedContext | null = null;
    let injectionText = '';

    if (this.config.enableRetrieval) {
      const result = await this.retrievalEngine.retrieve(context.userId, userInput);
      retrievalResult = result.retrievalResult;
      compressedContext = result.compressedContext;
      injectionText = result.injectionText;
    }

    // ==================== ③ 情绪识别 ====================
    const emotionResult = await this.emotionRecognizer.recognizeEmotion(userInput);

    // ==================== ④ 情绪轨迹分析 ====================
    const trajectoryAnalysis = this.emotionTracker.analyzeTrajectory(context.sessionId);

    // ==================== ⑤ 共情决策 ====================
    const empathyDecision = this.empathyEngine.makeDecision(
      emotionResult,
      trajectoryAnalysis,
      this.emotionTracker.getCurrentState(context.sessionId),
      userInput
    );

    // ==================== ⑥ 生成共情响应 ====================
    const empathyPrompt = this.empathyEngine.generateEmpathyPrompt(
      empathyDecision,
      emotionResult,
      trajectoryAnalysis,
      userInput,
      historyTexts
    );

    // 构建完整的系统提示
    const systemPrompt = this.buildSystemPrompt(injectionText, empathyPrompt);

    // 调用 LLM 生成响应
    const llmResponse = await this.callLLM(
      context.env,
      systemPrompt,
      context.conversationHistory,
      userInput
    );

    // ==================== ⑦ 输出过滤 ====================
    const shouldProgress = empathyDecision.level === 'L5';
    const filterResult = this.outputFilter.filterOutput(
      llmResponse,
      userInput,
      empathyDecision.level,
      shouldProgress
    );

    // ==================== ⑧ 记忆写入评估 ====================
    const memoryWriteOps = this.evaluateMemoryWrite(
      userInput,
      llmResponse,
      emotionResult,
      safetyResult
    );

    // ==================== ⑨ 记录情绪 ====================
    this.emotionTracker.recordEmotion(
      context.sessionId,
      userInput,
      emotionResult.primaryEmotion,
      emotionResult.intensity,
      emotionResult.valence,
      emotionResult.arousal,
      emotionResult.dominance
    );

    // ==================== ⑩ 异步写入（如果有） ====================
    if (this.config.enableWrite && memoryWriteOps.length > 0) {
      // 异步执行，不阻塞响应
      this.store.executeWrite(
        context.userId,
        userInput,
        memoryWriteOps,
        { isSafetyEvent: safetyResult.risk_level === 'high' }
      ).catch(err => console.error('记忆写入失败:', err));
    }

    const totalTime = Date.now() - startTime;

    return {
      response: filterResult.filteredResponse,
      emotion: {
        primary: emotionResult.primaryEmotion.name,
        secondary: emotionResult.secondaryEmotion?.name,
        intensity: emotionResult.intensity,
        valence: emotionResult.valence,
        arousal: emotionResult.arousal,
      },
      empathy: {
        level: empathyDecision.level,
        strategy: empathyDecision.strategy.name,
        reasoning: empathyDecision.reasoning,
      },
      safety: {
        isSafe: safetyResult.risk_level !== 'high',
        riskLevel: safetyResult.risk_level,
        warnings: safetyResult.evidence,
      },
      memory: {
        memoriesUsed: retrievalResult?.top_memories.length || 0,
        retrievalTimeMs: retrievalResult?.retrieval_time_ms || 0,
        compressionRatio: compressedContext?.compression_ratio || 1,
        graphragInsight: retrievalResult?.graphrag_insight,
      },
      memoryWrite: {
        shouldWrite: memoryWriteOps.length > 0,
        operations: memoryWriteOps,
        confirmed: false,
      },
      quality: {
        score: filterResult.qualityScore,
        warnings: filterResult.warnings,
      },
    };
  }

  /**
   * 结束会话 - 生成摘要
   */
  async endSession(context: PipelineContext): Promise<void> {
    const turns = context.conversationHistory.map(t => ({
      role: t.role,
      content: t.content,
      timestamp: t.timestamp,
      emotion: t.emotion,
    }));

    await this.summaryGenerator.generateSummary(
      context.userId,
      context.sessionId,
      turns
    );
  }

  /**
   * 执行记忆衰减（离线任务）
   */
  executeDecay(userId: string) {
    return this.store.executeDecay(userId);
  }

  /**
   * 获取用户画像
   */
  getUserProfile(userId: string) {
    return this.store.getOrCreateUserProfile(userId);
  }

  // ==================== 内部方法 ====================

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(memoryInjection: string, empathyPrompt: string): string {
    const parts: string[] = [];

    // 基础系统指令
    parts.push(`你是一个情感共情陪伴助手，专门为"迷茫期"人群提供支持。
你的核心能力：
1. 精确识别用户的27+类细分情绪
2. 根据情绪状态选择合适的共情策略
3. 追踪情绪变化轨迹
4. 记住用户的价值观、约束、主题等长期信息

你的回应原则：
- 先共情，后推进
- 使用用户原话中的关键词
- 避免病理化标签（如"你有抑郁症"）
- 避免空洞安慰（如"一切都会好的"）
- 一次只问一个问题`);

    // 记忆注入
    if (memoryInjection) {
      parts.push('');
      parts.push('【用户记忆】');
      parts.push(memoryInjection);
    }

    // 共情指令
    parts.push('');
    parts.push('【共情指令】');
    parts.push(empathyPrompt);

    return parts.join('\n');
  }

  /**
   * 调用 LLM
   */
  private async callLLM(
    env: Record<string, string>,
    systemPrompt: string,
    history: ConversationTurn[],
    userInput: string
  ): Promise<string> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-this.config.historyTurns).map(t => ({
          role: t.role,
          content: t.content,
        })),
        { role: 'user', content: userInput },
      ];

      return await new ChatGateway(env).complete(messages);
    } catch (error) {
      // Do not log conversations or upstream error bodies.
      return '抱歉，处理您的请求时出现了问题。请稍后再试。';
    }
  }

  /**
   * 评估记忆写入
   */
  private evaluateMemoryWrite(
    userInput: string,
    llmResponse: string,
    emotionResult: any,
    safetyResult: SafetyClassification
  ): MemoryWriteOperation[] {
    const operations: MemoryWriteOperation[] = [];

    // 规则引擎检查
    if (/记住这个|记一下|帮我记/.test(userInput)) {
      operations.push({
        action: 'create',
        target: 'core_memory.themes',
        content: userInput,
        reason: '用户明确要求记住',
        needs_user_confirmation: false,
      });
    }

    // 安全事件写入
    if (safetyResult.risk_level === 'high') {
      operations.push({
        action: 'create',
        target: 'safety_record',
        content: userInput,
        reason: '安全事件，强制记录',
        needs_user_confirmation: false,
      });
    }

    // LLM function call 评估（模拟）
    // 实际应用中，LLM 在生成响应时会同时输出 memory_operations
    const hasNewValue = /对我来说.*重要|我最看重|我追求/.test(userInput);
    const hasNewConstraint = /我必须|我不能|硬性要求/.test(userInput);
    const hasNewTheme = /我总是|每次.*我都会|我一直/.test(userInput);

    if (hasNewValue) {
      operations.push({
        action: 'create',
        target: 'core_memory.values',
        content: this.extractPattern(userInput, /对我来说(.+?)重要|我最看重(.+)|我追求(.+)/),
        reason: '用户表达了价值观',
        needs_user_confirmation: true,
      });
    }

    if (hasNewConstraint) {
      operations.push({
        action: 'create',
        target: 'core_memory.constraints',
        content: this.extractPattern(userInput, /我必须(.+)|我不能(.+)/),
        reason: '用户表达了约束',
        needs_user_confirmation: true,
      });
    }

    if (hasNewTheme) {
      operations.push({
        action: 'create',
        target: 'core_memory.themes',
        content: this.extractPattern(userInput, /我总是(.+)|每次(.+?)我都会|我一直(.+)/),
        reason: '用户表达了反复主题',
        needs_user_confirmation: true,
      });
    }

    return operations;
  }

  /**
   * 提取匹配模式的内容
   */
  private extractPattern(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    if (!match) return text.substring(0, 50);

    // 返回第一个非空的捕获组
    for (let i = 1; i < match.length; i++) {
      if (match[i]) return match[i];
    }

    return match[0];
  }

  /**
   * 构建安全响应
   */
  private buildSafetyResponse(
    safetyResult: SafetyClassification,
    context: PipelineContext,
    advancedResult?: SafetyClassificationResult
  ): PipelineResult {
    // 使用高级分类器的建议响应，如果有的话
    const responseText = advancedResult?.suggestedResponse ||
      safetyResult.safety_response ||
      '我注意到你可能正在经历困难。请记住，你并不孤单，有人在乎你。';

    return {
      response: responseText,
      emotion: {
        primary: '恐惧',
        intensity: 0.9,
        valence: -0.8,
        arousal: 0.9,
      },
      empathy: {
        level: 'L1',
        strategy: '安全优先',
        reasoning: '检测到安全威胁，启动安全协议',
      },
      safety: {
        isSafe: false,
        riskLevel: safetyResult.risk_level,
        warnings: safetyResult.evidence,
      },
      memory: {
        memoriesUsed: 0,
        retrievalTimeMs: 0,
        compressionRatio: 1,
      },
      memoryWrite: {
        shouldWrite: true,
        operations: [{
          action: 'create',
          target: 'safety_record',
          content: context.conversationHistory[context.conversationHistory.length - 1]?.content || '',
          reason: '安全事件',
          needs_user_confirmation: false,
        }],
        confirmed: false,
      },
      quality: {
        score: 1.0,
        warnings: [],
      },
    };
  }
}
