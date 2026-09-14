/**
 * 记忆存储管理器
 * 提供记忆的 CRUD 操作、衰减计算、权重管理
 */

import {
  MemoryEntry, MemoryEntryType, MemoryEntryStatus,
  UserProfile, CoreMemory, DirectionCard, EmotionPattern,
  EmpathyPreferences, ActionExperiment, ConversationSummary,
  DecayConfig, DecayResult, ReviewInvitation,
  MemoryWriteOperation, MemoryWriteEvaluation, MemoryWriteResult,
  AuditLogEntry, MemoryAction
} from './types';

// ==================== 默认衰减配置 ====================

const DEFAULT_DECAY_CONFIG: DecayConfig = {
  half_life_days: 90,
  archive_threshold: 0.1,
  review_threshold: 0.3,
  confirmed_multiplier: 1.5,
  max_access_bonus: 1.0,
  access_bonus_per_visit: 0.1,
};

// ==================== ID 生成器 ====================

function generateId(prefix: string = 'mem'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

// ==================== 记忆衰减模型 ====================

export class MemoryDecayModel {
  private config: DecayConfig;

  constructor(config: Partial<DecayConfig> = {}) {
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
  }

  /**
   * 计算当前权重
   * current_weight = base_weight × 时间衰减 × 确认系数 × 访问频次加成
   */
  calculateCurrentWeight(entry: MemoryEntry): number {
    const now = Date.now();
    const lastAccessed = new Date(entry.last_accessed_at).getTime();
    const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

    // 时间衰减 = 0.5 ^ (距最近访问的天数 / 半衰期)
    const timeDecay = Math.pow(0.5, daysSinceAccess / this.config.half_life_days);

    // 确认系数
    const confirmationFactor = entry.confirmed
      ? this.config.confirmed_multiplier
      : 1.0;

    // 访问频次加成 = min(访问次数 × 每次加成, 上限)
    const accessBonus = Math.min(
      entry.access_count * this.config.access_bonus_per_visit,
      this.config.max_access_bonus
    );

    const currentWeight = entry.base_weight * timeDecay * confirmationFactor * (1 + accessBonus);

    // 确保在 [0, 1] 范围内
    return Math.max(0, Math.min(1, currentWeight));
  }

  /**
   * 判断记忆是否应归档
   */
  shouldArchive(entry: MemoryEntry): boolean {
    return this.calculateCurrentWeight(entry) < this.config.archive_threshold;
  }

  /**
   * 判断记忆是否需要复盘
   */
  needsReview(entry: MemoryEntry): boolean {
    const weight = this.calculateCurrentWeight(entry);
    return weight >= this.config.archive_threshold && weight < this.config.review_threshold;
  }

  /**
   * 生成复盘邀请
   */
  generateReviewInvitation(entry: MemoryEntry): ReviewInvitation {
    const weight = this.calculateCurrentWeight(entry);
    const daysSinceAccess = (Date.now() - new Date(entry.last_accessed_at).getTime()) / (1000 * 60 * 60 * 24);

    let suggestedAction: ReviewInvitation['suggested_action'];
    let reason: string;

    if (weight < 0.15) {
      suggestedAction = 'archive';
      reason = `这条记忆已经 ${Math.round(daysSinceAccess)} 天没有被提及，权重降至 ${weight.toFixed(2)}，可能已经不再相关。`;
    } else if (!entry.confirmed) {
      suggestedAction = 'reaffirm';
      reason = `这条记忆是系统推断的（非你直接确认），想确认一下是否准确。`;
    } else {
      suggestedAction = 'update';
      reason = `这条记忆有一段时间没有更新了，想确认一下是否还准确。`;
    }

    return {
      entry_id: entry.id,
      content: entry.content,
      current_weight: weight,
      suggested_action: suggestedAction,
      reason,
    };
  }
}

// ==================== 规则引擎 ====================

export class MemoryRuleEngine {
  /**
   * 规则底线检查 - 判断是否必须写入/删除
   */
  evaluate(userInput: string, context: { isSafetyEvent: boolean }): MemoryWriteEvaluation | null {
    const input = userInput.toLowerCase().trim();

    // 规则1: 用户明确要求记住
    if (/记住这个|记一下|帮我记|remember this|save this/i.test(input)) {
      return {
        should_write: true,
        operations: [{
          action: 'create',
          target: 'core_memory.themes',
          content: userInput,
          reason: '用户明确要求记住',
          needs_user_confirmation: false,
        }],
        source: 'rule_engine',
        confidence: 1.0,
      };
    }

    // 规则2: 用户明确要求忘记
    if (/忘掉这个|删除这个|不要记了|forget this|delete this/i.test(input)) {
      return {
        should_write: true,
        operations: [{
          action: 'delete',
          target: 'core_memory.themes',
          content: userInput,
          reason: '用户明确要求删除',
          needs_user_confirmation: false,
        }],
        source: 'rule_engine',
        confidence: 1.0,
      };
    }

    // 规则3: 安全事件强制写入安全档案
    if (context.isSafetyEvent) {
      return {
        should_write: true,
        operations: [{
          action: 'create',
          target: 'safety_record',
          content: userInput,
          reason: '安全事件，强制记录',
          needs_user_confirmation: false,
        }],
        source: 'rule_engine',
        confidence: 1.0,
      };
    }

    // 无规则命中
    return null;
  }
}

// ==================== 记忆写入评估器 ====================

export class MemoryWriteEvaluator {
  private ruleEngine: MemoryRuleEngine;

  constructor() {
    this.ruleEngine = new MemoryRuleEngine();
  }

  /**
   * 综合评估是否需要写入记忆
   * 规则引擎（底线）+ LLM 自主判断（主体）并行
   */
  evaluate(
    userInput: string,
    llmMemoryOps: MemoryWriteOperation[],
    context: { isSafetyEvent: boolean }
  ): MemoryWriteEvaluation {
    // 规则引擎检查（底线，不可违反）
    const ruleResult = this.ruleEngine.evaluate(userInput, context);

    if (ruleResult) {
      // 规则引擎命中，直接返回（规则优先级最高）
      return ruleResult;
    }

    // LLM 自主判断
    if (llmMemoryOps.length > 0) {
      return {
        should_write: true,
        operations: llmMemoryOps,
        source: 'llm_inference',
        confidence: 0.7, // LLM 推断的置信度较低，需要事后校验
      };
    }

    // 都没有命中，不写入
    return {
      should_write: false,
      operations: [],
      source: 'llm_inference',
      confidence: 0.0,
    };
  }
}

// ==================== 记忆一致性校验器 ====================

export class MemoryConsistencyChecker {
  /**
   * 检查新记忆与现有记忆是否矛盾
   */
  async checkConsistency(
    newEntry: MemoryWriteOperation,
    existingEntries: MemoryEntry[]
  ): Promise<{ consistent: boolean; conflicts: string[] }> {
    const conflicts: string[] = [];

    // 简单的关键词冲突检测
    // 实际应用中应使用 bge-m3 计算语义相似度
    for (const existing of existingEntries) {
      if (existing.status === 'deleted' || existing.status === 'archived') continue;

      // 检查同类型条目中是否有语义相反的内容
      if (existing.type === 'value' || existing.type === 'constraint') {
        const isNegation = this.checkNegation(newEntry.content, existing.content);
        if (isNegation) {
          conflicts.push(`与现有记忆 "${existing.content}" 可能存在矛盾`);
        }
      }
    }

    return {
      consistent: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * 检查是否是语义重复
   */
  async checkDuplication(
    newContent: string,
    existingEntries: MemoryEntry[],
    similarityThreshold: number = 0.92
  ): Promise<{ isDuplicate: boolean; duplicateOf?: string }> {
    // 简单的字符串相似度检查
    // 实际应用中应使用 bge-m3 计算余弦相似度
    for (const existing of existingEntries) {
      if (existing.status === 'deleted') continue;

      const similarity = this.calculateTextSimilarity(newContent, existing.content);
      if (similarity > similarityThreshold) {
        return { isDuplicate: true, duplicateOf: existing.id };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * 简单的文本相似度计算（Jaccard）
   * 实际应用中应替换为 bge-m3 向量余弦相似度
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.split(/[\s，。！？、；：""''（）【】]+/).filter(t => t.length > 0));
    const tokens2 = new Set(text2.split(/[\s，。！？、；：""''（）【】]+/).filter(t => t.length > 0));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * 简单的否定检测
   */
  private checkNegation(text1: string, text2: string): boolean {
    // 检测常见的否定模式
    const negationPairs = [
      ['喜欢', '不喜欢'], ['想要', '不想要'], ['重要', '不重要'],
      ['追求', '放弃'], ['坚持', '放弃'], ['勇敢', '害怕'],
    ];

    for (const [pos, neg] of negationPairs) {
      if ((text1.includes(pos) && text2.includes(neg)) ||
          (text1.includes(neg) && text2.includes(pos))) {
        return true;
      }
    }

    return false;
  }
}

// ==================== 记忆存储管理器 ====================

export class MemoryStore {
  private decayModel: MemoryDecayModel;
  private writeEvaluator: MemoryWriteEvaluator;
  private consistencyChecker: MemoryConsistencyChecker;

  // 内存存储（MVP 阶段，后续替换为持久化存储）
  private userProfiles: Map<string, UserProfile> = new Map();
  private memoryEntries: Map<string, MemoryEntry[]> = new Map();
  private auditLogs: AuditLogEntry[] = [];

  constructor(decayConfig?: Partial<DecayConfig>) {
    this.decayModel = new MemoryDecayModel(decayConfig);
    this.writeEvaluator = new MemoryWriteEvaluator();
    this.consistencyChecker = new MemoryConsistencyChecker();
  }

  // ==================== 用户画像 ====================

  /** 获取或创建用户画像 */
  getOrCreateUserProfile(userId: string): UserProfile {
    if (!this.userProfiles.has(userId)) {
      const profile: UserProfile = {
        user_id: userId,
        core_memory: { values: [], constraints: [], themes: [] },
        direction_cards: [],
        emotion_patterns: [],
        empathy_preferences: {
          user_id: userId,
          effective_approaches: [],
          ineffective_approaches: [],
          preferred_tone: '温暖、理解、不评判',
          avoid_phrases: [],
          updated_at: new Date().toISOString(),
        },
        action_experiments: [],
        conversation_summaries: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.userProfiles.set(userId, profile);
    }
    return this.userProfiles.get(userId)!;
  }

  /** 更新用户画像 */
  updateUserProfile(userId: string, updates: Partial<UserProfile>): void {
    const profile = this.getOrCreateUserProfile(userId);
    Object.assign(profile, updates, { updated_at: new Date().toISOString() });
    this.userProfiles.set(userId, profile);
  }

  // ==================== 记忆条目 CRUD ====================

  /** 获取用户的所有记忆条目 */
  getMemoryEntries(userId: string, type?: MemoryEntryType): MemoryEntry[] {
    const entries = this.memoryEntries.get(userId) || [];
    if (type) {
      return entries.filter(e => e.type === type && e.status !== 'deleted');
    }
    return entries.filter(e => e.status !== 'deleted');
  }

  /** 创建记忆条目 */
  createMemoryEntry(
    userId: string,
    type: MemoryEntryType,
    content: string,
    source: MemoryEntry['source'] = 'llm_inferred',
    baseWeight: number = 0.5
  ): MemoryEntry {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: generateId('mem'),
      user_id: userId,
      type,
      content,
      status: 'active',
      base_weight: baseWeight,
      current_weight: baseWeight,
      confirmed: source === 'user_explicit',
      access_count: 0,
      last_accessed_at: now,
      source,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    const entries = this.memoryEntries.get(userId) || [];
    entries.push(entry);
    this.memoryEntries.set(userId, entries);

    // 记录审计日志
    this.addAuditLog(userId, 'create', entry.id, `创建${type}记忆: ${content}`, source === 'user_explicit' ? 'user' : 'llm');

    return entry;
  }

  /** 更新记忆条目 */
  updateMemoryEntry(userId: string, entryId: string, updates: Partial<MemoryEntry>): MemoryEntry | null {
    const entries = this.memoryEntries.get(userId) || [];
    const index = entries.findIndex(e => e.id === entryId);

    if (index === -1) return null;

    Object.assign(entries[index], updates, { updated_at: new Date().toISOString() });
    this.memoryEntries.set(userId, entries);

    this.addAuditLog(userId, 'update', entryId, `更新记忆: ${JSON.stringify(updates)}`, 'system');

    return entries[index];
  }

  /** 归档记忆条目 */
  archiveMemoryEntry(userId: string, entryId: string): boolean {
    const entry = this.updateMemoryEntry(userId, entryId, {
      status: 'archived' as MemoryEntryStatus,
    });
    if (entry) {
      this.addAuditLog(userId, 'archive', entryId, `归档记忆: ${entry.content}`, 'system');
      return true;
    }
    return false;
  }

  /** 删除记忆条目（软删除） */
  deleteMemoryEntry(userId: string, entryId: string): boolean {
    const now = new Date().toISOString();
    const entry = this.updateMemoryEntry(userId, entryId, {
      status: 'deleted' as MemoryEntryStatus,
      deleted_at: now,
    });
    if (entry) {
      this.addAuditLog(userId, 'delete', entryId, `删除记忆: ${entry.content}`, 'user');
      return true;
    }
    return false;
  }

  /** 确认记忆条目 */
  confirmMemoryEntry(userId: string, entryId: string): boolean {
    const entry = this.updateMemoryEntry(userId, entryId, { confirmed: true });
    if (entry) {
      this.addAuditLog(userId, 'confirm', entryId, `确认记忆: ${entry.content}`, 'user');
      return true;
    }
    return false;
  }

  /** 记录记忆访问 */
  recordAccess(userId: string, entryId: string): void {
    const entries = this.memoryEntries.get(userId) || [];
    const entry = entries.find(e => e.id === entryId);
    if (entry) {
      entry.access_count++;
      entry.last_accessed_at = new Date().toISOString();
      entry.current_weight = this.decayModel.calculateCurrentWeight(entry);
    }
  }

  // ==================== 记忆衰减 ====================

  /** 执行记忆衰减 */
  executeDecay(userId: string): DecayResult {
    const entries = this.getMemoryEntries(userId);
    const reviewInvitations: ReviewInvitation[] = [];
    let entriesUpdated = 0;
    let entriesArchived = 0;

    for (const entry of entries) {
      const newWeight = this.decayModel.calculateCurrentWeight(entry);

      if (this.decayModel.shouldArchive(entry)) {
        this.archiveMemoryEntry(userId, entry.id);
        entriesArchived++;
      } else if (this.decayModel.needsReview(entry)) {
        reviewInvitations.push(this.decayModel.generateReviewInvitation(entry));
      }

      if (Math.abs(entry.current_weight - newWeight) > 0.01) {
        entry.current_weight = newWeight;
        entriesUpdated++;
      }
    }

    return {
      user_id: userId,
      entries_updated: entriesUpdated,
      entries_archived: entriesArchived,
      review_invitations: reviewInvitations,
      executed_at: new Date().toISOString(),
    };
  }

  // ==================== 记忆写入流程 ====================

  /**
   * 执行记忆写入流程
   * 包括：评估 → 校验 → 写入 → 审计
   */
  async executeWrite(
    userId: string,
    userInput: string,
    llmMemoryOps: MemoryWriteOperation[],
    context: { isSafetyEvent: boolean }
  ): Promise<MemoryWriteResult> {
    // 1. 评估是否需要写入
    const evaluation = this.writeEvaluator.evaluate(userInput, llmMemoryOps, context);

    if (!evaluation.should_write) {
      return {
        success: true,
        entries_written: [],
        vectors_upserted: [],
        graph_nodes_created: [],
        audit_log_id: '',
        kv_cache_invalidated: false,
        errors: [],
      };
    }

    const entriesWritten: string[] = [];
    const errors: string[] = [];

    // 2. 执行每个写入操作
    for (const op of evaluation.operations) {
      try {
        const targetType = this.parseTargetType(op.target);

        switch (op.action) {
          case 'create':
          case 'append': {
            // 3. 一致性检查
            const existingEntries = this.getMemoryEntries(userId, targetType);
            const consistency = await this.consistencyChecker.checkConsistency(op, existingEntries);

            if (!consistency.consistent) {
              // 存在冲突，标记为待确认
              const entry = this.createMemoryEntry(userId, targetType, op.content, 'llm_inferred', 0.3);
              entry.status = 'pending_confirmation';
              entry.metadata = { conflicts: consistency.conflicts };
              entriesWritten.push(entry.id);
            } else {
              // 4. 去重检查
              const duplication = await this.consistencyChecker.checkDuplication(op.content, existingEntries);

              if (duplication.isDuplicate) {
                // 重复，更新现有条目
                if (duplication.duplicateOf) {
                  this.updateMemoryEntry(userId, duplication.duplicateOf, {
                    access_count: (existingEntries.find(e => e.id === duplication.duplicateOf)?.access_count || 0) + 1,
                    last_accessed_at: new Date().toISOString(),
                  });
                }
              } else {
                // 新条目，创建
                const entry = this.createMemoryEntry(
                  userId,
                  targetType,
                  op.content,
                  evaluation.source === 'rule_engine' ? 'user_explicit' : 'llm_inferred',
                  evaluation.source === 'rule_engine' ? 0.8 : 0.5
                );
                entriesWritten.push(entry.id);
              }
            }
            break;
          }

          case 'update': {
            if (op.entry_id) {
              this.updateMemoryEntry(userId, op.entry_id, { content: op.content });
              entriesWritten.push(op.entry_id);
            }
            break;
          }

          case 'delete': {
            if (op.entry_id) {
              this.deleteMemoryEntry(userId, op.entry_id);
              entriesWritten.push(op.entry_id);
            }
            break;
          }

          case 'confirm': {
            if (op.entry_id) {
              this.confirmMemoryEntry(userId, op.entry_id);
              entriesWritten.push(op.entry_id);
            }
            break;
          }
        }
      } catch (error) {
        errors.push(`操作 ${op.action} 失败: ${(error as Error).message}`);
      }
    }

    return {
      success: errors.length === 0,
      entries_written: entriesWritten,
      vectors_upserted: [],  // 向量写入由异步链路处理
      graph_nodes_created: [], // 图写入由异步链路处理
      audit_log_id: this.auditLogs[this.auditLogs.length - 1]?.id || '',
      kv_cache_invalidated: entriesWritten.length > 0,
      errors,
    };
  }

  // ==================== 辅助方法 ====================

  /** 解析目标字段路径为记忆类型 */
  private parseTargetType(target: string): MemoryEntryType {
    if (target.includes('values')) return 'value';
    if (target.includes('constraints')) return 'constraint';
    if (target.includes('themes')) return 'theme';
    if (target.includes('emotion_pattern')) return 'emotion_pattern';
    if (target.includes('direction_card')) return 'direction_card';
    if (target.includes('empathy_preference')) return 'empathy_preference';
    if (target.includes('safety_record')) return 'safety_record';
    return 'theme'; // 默认
  }

  /** 添加审计日志 */
  private addAuditLog(
    userId: string,
    operation: MemoryAction,
    targetEntryId: string | undefined,
    details: string,
    operator: AuditLogEntry['operator']
  ): void {
    this.auditLogs.push({
      id: generateId('audit'),
      user_id: userId,
      operation,
      target_entry_id: targetEntryId,
      details,
      operator,
      timestamp: new Date().toISOString(),
    });
  }

  /** 获取审计日志 */
  getAuditLogs(userId: string): AuditLogEntry[] {
    return this.auditLogs.filter(log => log.user_id === userId);
  }
}
