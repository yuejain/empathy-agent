/**
 * 记忆检索引擎
 * 四路并行检索 + Cross-Encoder 重排序 + LLMLingua 压缩
 *
 * 四路检索：
 * 1. Milvus 向量检索（稠密+稀疏双路 RRF 融合）
 * 2. Neo4j 图查询（1-2 跳遍历）
 * 3. PostgreSQL 结构化检索（精确匹配）
 * 4. GraphRAG 全局推理（Map-Reduce 摘要）
 */

import {
  MemoryCandidate, MemoryEntryType, RetrievalResult,
  StructuredContext, CompressedContext, UserProfile,
  DirectionCard, EmotionPattern, EmpathyPreferences,
  MemoryEntry
} from './types';
import { MemoryStore } from './memory-store';

// ==================== Embedding 模拟（MVP 阶段） ====================

/**
 * bge-m3 embedding 接口
 * 实际应用中应调用 bge-m3 模型生成 1024 维稠密向量和稀疏向量
 */
export interface EmbeddingModel {
  encodeDense(text: string): Promise<number[]>;
  encodeSparse(text: string): Promise<Record<string, number>>;
}

/** 模拟 embedding 模型（MVP 阶段，用随机向量代替） */
export class MockEmbeddingModel implements EmbeddingModel {
  private dimension = 1024;

  async encodeDense(text: string): Promise<number[]> {
    // 使用简单的哈希生成伪向量，保证相同文本生成相同向量
    const hash = this.simpleHash(text);
    const vector: number[] = [];
    for (let i = 0; i < this.dimension; i++) {
      vector.push(Math.sin(hash * (i + 1)) * 0.5 + 0.5);
    }
    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / norm);
  }

  async encodeSparse(text: string): Promise<Record<string, number>> {
    const tokens = text.split(/[\s，。！？、；：""''（）【】]+/).filter(t => t.length > 0);
    const sparse: Record<string, number> = {};
    tokens.forEach((token, index) => {
      sparse[token] = 1.0 / (index + 1); // 简单的 TF 权重
    });
    return sparse;
  }

  private simpleHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转为 32 位整数
    }
    return Math.abs(hash);
  }
}

// ==================== Cross-Encoder 模拟 ====================

/**
 * Cross-Encoder 重排序接口
 * 实际应用中应使用 BAAI/bge-reranker-v2-m3
 */
export interface CrossEncoderModel {
  score(query: string, document: string): Promise<number>;
}

/** 模拟 Cross-Encoder（MVP 阶段） */
export class MockCrossEncoderModel implements CrossEncoderModel {
  async score(query: string, document: string): Promise<number> {
    // 简单的关键词重叠度作为相关性分数
    const queryTokens = new Set(query.split(/[\s，。！？、；：""''（）【】]+/));
    const docTokens = new Set(document.split(/[\s，。！？、；：""''（）【】]+/));

    let overlap = 0;
    queryTokens.forEach(token => {
      if (docTokens.has(token) && token.length > 0) overlap++;
    });

    const maxPossible = Math.min(queryTokens.size, docTokens.size);
    return maxPossible === 0 ? 0.5 : Math.min(0.3 + (overlap / maxPossible) * 0.7, 1.0);
  }
}

// ==================== LLMLingua 压缩器 ====================

/**
 * LLMLingua 压缩器
 * 实际应用中应使用 LLMLingua-2（基于 XLM-RoBERTa 的 token 级压缩）
 * MVP 阶段使用基于规则的压缩
 */
export class LLMLinguaCompressor {
  private hardPreserveKeywords: Set<string> = new Set();

  constructor() {
    // 初始化强制保留的关键词类别
    this.initPreserveKeywords();
  }

  private initPreserveKeywords(): void {
    // 价值名称
    const values = ['自主', '自由', '稳定', '安全', '成长', '连接', '创造', '意义', '成就', '平衡'];
    // 情绪标签
    const emotions = ['焦虑', '悲伤', '愤怒', '恐惧', '无力', '麻木', '羞耻', '期待', '希望', '困惑'];
    // 共情方式
    const empathy = ['反映', '验证', '正常化', '推进', '具体', '两难', '方案'];

    [...values, ...emotions, ...empathy].forEach(kw => this.hardPreserveKeywords.add(kw));
  }

  /**
   * 压缩文本
   * @param text 输入文本
   * @param targetRatio 目标压缩率 (0.4-0.6)
   * @param hardPreserve 额外需要强制保留的关键词
   */
  compress(text: string, targetRatio: number = 0.5, hardPreserve: string[] = []): {
    compressed: string;
    originalTokens: number;
    compressedTokens: number;
    ratio: number;
  } {
    const allPreserve = new Set([...this.hardPreserveKeywords, ...hardPreserve]);

    // 按句子分割
    const sentences = this.splitSentences(text);
    const originalTokenCount = text.length; // 简化：用字符数代替 token 数

    // 为每个句子计算信息量分数
    const scoredSentences = sentences.map(sentence => ({
      text: sentence,
      score: this.scoreSentence(sentence, allPreserve),
      hasPreserveKeyword: this.hasAnyKeyword(sentence, allPreserve),
    }));

    // 排序：保留分数高的句子
    const targetTokenCount = Math.floor(originalTokenCount * targetRatio);
    let currentTokenCount = 0;
    const selectedSentences: typeof scoredSentences = [];

    // 先保留包含强制关键词的句子
    for (const s of scoredSentences) {
      if (s.hasPreserveKeyword && currentTokenCount + s.text.length <= targetTokenCount * 1.2) {
        selectedSentences.push(s);
        currentTokenCount += s.text.length;
      }
    }

    // 再按分数填充剩余空间
    const remaining = scoredSentences
      .filter(s => !s.hasPreserveKeyword)
      .sort((a, b) => b.score - a.score);

    for (const s of remaining) {
      if (currentTokenCount + s.text.length <= targetTokenCount) {
        selectedSentences.push(s);
        currentTokenCount += s.text.length;
      }
    }

    // 按原始顺序重新排列
    const selectedSet = new Set(selectedSentences.map(s => s.text));
    const compressed = sentences
      .filter(s => selectedSet.has(s))
      .join('');

    return {
      compressed,
      originalTokens: originalTokenCount,
      compressedTokens: compressed.length,
      ratio: compressed.length / originalTokenCount,
    };
  }

  /**
   * 分割句子
   */
  private splitSentences(text: string): string[] {
    // 按中文标点和换行符分割
    const sentences = text.split(/(?<=[。！？；\n])/).filter(s => s.trim().length > 0);
    return sentences;
  }

  /**
   * 为句子计算信息量分数
   */
  private scoreSentence(sentence: string, preserveKeywords: Set<string>): number {
    let score = 0.5; // 基础分

    // 包含关键词加分
    const keywordCount = this.countKeywords(sentence, preserveKeywords);
    score += keywordCount * 0.15;

    // 包含数字加分（数字通常携带重要信息）
    if (/\d/.test(sentence)) score += 0.1;

    // 包含引号加分（用户原话）
    if (/[""'']/.test(sentence)) score += 0.1;

    // 句子过短扣分（过短的句子信息量通常较低）
    if (sentence.length < 5) score -= 0.2;

    // 包含"你"加分（直接针对用户的描述）
    if (sentence.includes('你')) score += 0.05;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * 统计句子中的关键词数量
   */
  private countKeywords(sentence: string, keywords: Set<string>): number {
    let count = 0;
    keywords.forEach(kw => {
      if (sentence.includes(kw)) count++;
    });
    return count;
  }

  /**
   * 检查句子是否包含任何关键词
   */
  private hasAnyKeyword(sentence: string, keywords: Set<string>): boolean {
    for (const kw of keywords) {
      if (sentence.includes(kw)) return true;
    }
    return false;
  }
}

// ==================== 四路检索器 ====================

/** 向量检索器（Milvus 模拟） */
export class VectorRetriever {
  private embeddingModel: EmbeddingModel;
  private store: MemoryStore;

  constructor(embeddingModel: EmbeddingModel, store: MemoryStore) {
    this.embeddingModel = embeddingModel;
    this.store = store;
  }

  /**
   * 执行向量检索（稠密+稀疏双路 RRF 融合）
   */
  async retrieve(userId: string, query: string, topK: number = 15): Promise<MemoryCandidate[]> {
    // 1. 生成查询向量
    const [denseVector, sparseVector] = await Promise.all([
      this.embeddingModel.encodeDense(query),
      this.embeddingModel.encodeSparse(query),
    ]);

    // 2. 获取用户的所有记忆条目
    const entries = this.store.getMemoryEntries(userId);

    // 3. 为每条记忆计算相似度分数
    const candidates: MemoryCandidate[] = [];

    for (const entry of entries) {
      if (entry.status === 'archived' || entry.status === 'deleted') continue;
      if (entry.current_weight < 0.1) continue; // 跳过低权重条目

      // 稠密向量相似度（余弦相似度）
      const entryDense = await this.embeddingModel.encodeDense(entry.content);
      const denseScore = this.cosineSimilarity(denseVector, entryDense);

      // 稀疏向量相似度
      const entrySparse = await this.embeddingModel.encodeSparse(entry.content);
      const sparseScore = this.sparseSimilarity(sparseVector, entrySparse);

      // RRF 融合
      const rrfScore = this.reciprocalRankFusion(denseScore, sparseScore);

      candidates.push({
        id: `vec_${entry.id}`,
        source: 'vector',
        content_text: entry.content,
        raw_data: entry,
        source_score: rrfScore,
        content_type: entry.type,
        entry_id: entry.id,
      });
    }

    // 4. 按分数排序，取 top-K
    candidates.sort((a, b) => b.source_score - a.source_score);
    return candidates.slice(0, topK);
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /** 稀疏向量相似度 */
  private sparseSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const [key, value] of Object.entries(a)) {
      normA += value * value;
      if (b[key]) {
        dotProduct += value * b[key];
      }
    }

    for (const value of Object.values(b)) {
      normB += value * value;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /** Reciprocal Rank Fusion */
  private reciprocalRankFusion(score1: number, score2: number, k: number = 60): number {
    // 将相似度分数转换为排名（简化版）
    // 实际应用中应该对整个列表做排名后再融合
    const rank1 = Math.max(1, Math.round((1 - score1) * 100));
    const rank2 = Math.max(1, Math.round((1 - score2) * 100));

    return 1 / (k + rank1) + 1 / (k + rank2);
  }
}

/** 图查询检索器（Neo4j 模拟） */
export class GraphRetriever {
  private embeddingModel: EmbeddingModel;
  private store: MemoryStore;

  constructor(embeddingModel: EmbeddingModel, store: MemoryStore) {
    this.embeddingModel = embeddingModel;
    this.store = store;
  }

  /**
   * 执行图查询检索
   * 1. 用向量检索定位入口节点
   * 2. 从入口节点做 1-2 跳遍历
   */
  async retrieve(userId: string, query: string): Promise<MemoryCandidate[]> {
    // 1. 获取入口节点（与查询最相关的记忆条目）
    const entries = this.store.getMemoryEntries(userId);
    const queryEmbedding = await this.embeddingModel.encodeDense(query);

    // 计算每条记忆与查询的相似度，找 top-3 作为入口节点
    const entryScores: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of entries) {
      if (entry.status === 'archived' || entry.status === 'deleted') continue;
      const entryEmbedding = await this.embeddingModel.encodeDense(entry.content);
      const score = this.cosineSimilarity(queryEmbedding, entryEmbedding);
      entryScores.push({ entry, score });
    }

    entryScores.sort((a, b) => b.score - a.score);
    const entryNodes = entryScores.slice(0, 3);

    // 2. 模拟图遍历（1-2 跳）
    // 在 MVP 阶段，我们通过关键词关联来模拟图遍历
    const candidates: MemoryCandidate[] = [];
    const visited = new Set<string>();

    for (const { entry, score } of entryNodes) {
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);

      // 添加入口节点
      candidates.push({
        id: `graph_${entry.id}`,
        source: 'graph',
        content_text: entry.content,
        raw_data: { entry, hops: 0 },
        source_score: score,
        content_type: entry.type,
        entry_id: entry.id,
      });

      // 模拟 1 跳遍历：查找相关记忆
      const relatedEntries = this.findRelatedEntries(entry, entries, visited);
      for (const related of relatedEntries) {
        candidates.push({
          id: `graph_${related.id}_hop1`,
          source: 'graph',
          content_text: related.content,
          raw_data: { entry: related, hops: 1, from: entry.id },
          source_score: score * 0.7, // 1 跳衰减
          content_type: related.type,
          entry_id: related.id,
        });
        visited.add(related.id);
      }
    }

    return candidates;
  }

  /**
   * 查找相关记忆条目（模拟图遍历）
   */
  private findRelatedEntries(
    source: MemoryEntry,
    allEntries: MemoryEntry[],
    visited: Set<string>
  ): MemoryEntry[] {
    const related: MemoryEntry[] = [];

    for (const entry of allEntries) {
      if (visited.has(entry.id)) continue;
      if (entry.status === 'archived' || entry.status === 'deleted') continue;

      // 同类型的其他条目
      if (entry.type === source.type && entry.id !== source.id) {
        related.push(entry);
        continue;
      }

      // 内容有关键词重叠的条目
      const sourceTokens = new Set(source.content.split(/[\s，。！？、；：""''（）【】]+/));
      const entryTokens = new Set(entry.content.split(/[\s，。！？、；：""''（）【】]+/));

      let overlap = 0;
      sourceTokens.forEach(token => {
        if (entryTokens.has(token) && token.length > 1) overlap++;
      });

      if (overlap >= 2) {
        related.push(entry);
      }
    }

    return related.slice(0, 3); // 最多返回 3 个相关条目
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/** 结构化检索器（PostgreSQL 模拟） */
export class StructuredRetriever {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * 执行结构化检索
   * 查询活跃方向卡、当前情绪模式、共情偏好
   */
  retrieve(userId: string): StructuredContext {
    const profile = this.store.getOrCreateUserProfile(userId);

    // 获取活跃方向卡
    const activeDirectionCards = profile.direction_cards.filter(
      dc => dc.status === 'in_progress' || dc.status === 'hypothesis'
    );

    // 获取当前情绪模式
    const currentEmotionPatterns = profile.emotion_patterns
      .sort((a, b) => new Date(b.last_observed_at).getTime() - new Date(a.last_observed_at).getTime())
      .slice(0, 5);

    // 构建用户画像摘要
    const profileSummary = this.buildProfileSummary(profile);

    // 构建共情偏好描述
    const empathyPrefDesc = this.buildEmpathyPreferencesDesc(profile.empathy_preferences);

    return {
      user_profile_summary: profileSummary,
      empathy_preferences: empathyPrefDesc,
      active_direction_cards: activeDirectionCards,
      current_emotion_patterns: currentEmotionPatterns,
    };
  }

  private buildProfileSummary(profile: UserProfile): string {
    const parts: string[] = [];

    // 价值观
    const values = profile.core_memory.values
      .filter(v => v.status === 'active')
      .map(v => v.content);
    if (values.length > 0) {
      parts.push(`价值：${values.join('、')}`);
    }

    // 约束
    const constraints = profile.core_memory.constraints
      .filter(c => c.status === 'active')
      .map(c => c.content);
    if (constraints.length > 0) {
      parts.push(`约束：${constraints.join('、')}`);
    }

    // 主题
    const themes = profile.core_memory.themes
      .filter(t => t.status === 'active')
      .map(t => t.content);
    if (themes.length > 0) {
      parts.push(`主题：${themes.join('、')}`);
    }

    return parts.join('。') || '暂无用户画像';
  }

  private buildEmpathyPreferencesDesc(prefs: EmpathyPreferences): string {
    const parts: string[] = [];

    if (prefs.effective_approaches.length > 0) {
      parts.push(`有效方式：${prefs.effective_approaches.join('、')}`);
    }
    if (prefs.ineffective_approaches.length > 0) {
      parts.push(`避免方式：${prefs.ineffective_approaches.join('、')}`);
    }
    if (prefs.preferred_tone) {
      parts.push(`偏好语气：${prefs.preferred_tone}`);
    }

    return parts.join('。') || '暂无共情偏好';
  }
}

/** GraphRAG 检索器（模拟） */
export class GraphRAGRetriever {
  private embeddingModel: EmbeddingModel;
  private store: MemoryStore;

  // 社区摘要缓存（离线预计算）
  private communitySummaries: Map<string, { summary: string; embedding: number[] }> = new Map();

  constructor(embeddingModel: EmbeddingModel, store: MemoryStore) {
    this.embeddingModel = embeddingModel;
    this.store = store;
  }

  /**
   * 执行 GraphRAG 全局推理
   * 1. 用查询 embedding 匹配最相关的社区摘要
   * 2. 对匹配的社区摘要做 Map-Reduce 推理
   */
  async retrieve(userId: string, query: string): Promise<string | null> {
    // 1. 获取或生成社区摘要
    const summaries = await this.getCommunitySummaries(userId);
    if (summaries.length === 0) return null;

    // 2. 用查询 embedding 匹配最相关的社区
    const queryEmbedding = await this.embeddingModel.encodeDense(query);
    const scoredSummaries = summaries.map(s => ({
      ...s,
      score: this.cosineSimilarity(queryEmbedding, s.embedding),
    }));

    scoredSummaries.sort((a, b) => b.score - a.score);
    const topSummaries = scoredSummaries.slice(0, 3);

    // 3. Map-Reduce 推理（MVP 阶段简化为直接拼接）
    const insight = this.mapReduceInsight(topSummaries.map(s => s.summary));

    return insight;
  }

  /**
   * 获取社区摘要（模拟离线预计算）
   */
  private async getCommunitySummaries(userId: string): Promise<Array<{ summary: string; embedding: number[] }>> {
    // 检查缓存
    const cacheKey = `communities_${userId}`;
    if (this.communitySummaries.has(cacheKey)) {
      return [this.communitySummaries.get(cacheKey)!];
    }

    // 模拟社区摘要生成
    const entries = this.store.getMemoryEntries(userId);
    if (entries.length === 0) return [];

    // 按类型分组作为"社区"
    const communities = new Map<MemoryEntryType, MemoryEntry[]>();
    entries.forEach(entry => {
      if (!communities.has(entry.type)) {
        communities.set(entry.type, []);
      }
      communities.get(entry.type)!.push(entry);
    });

    const summaries: Array<{ summary: string; embedding: number[] }> = [];

    for (const [type, typeEntries] of communities) {
      const summary = this.generateCommunitySummary(type, typeEntries);
      const embedding = await this.embeddingModel.encodeDense(summary);
      summaries.push({ summary, embedding });
    }

    // 缓存
    if (summaries.length > 0) {
      this.communitySummaries.set(cacheKey, summaries[0]);
    }

    return summaries;
  }

  /**
   * 生成社区摘要
   */
  private generateCommunitySummary(type: MemoryEntryType, entries: MemoryEntry[]): string {
    const contents = entries
      .filter(e => e.status === 'active')
      .sort((a, b) => b.current_weight - a.current_weight)
      .slice(0, 5)
      .map(e => e.content);

    const typeNames: Record<string, string> = {
      'value': '价值观社区',
      'constraint': '约束社区',
      'theme': '主题社区',
      'emotion_pattern': '情绪模式社区',
      'direction_card': '方向卡社区',
      'action_experiment': '行动实验社区',
      'empathy_preference': '共情偏好社区',
      'conversation_summary': '对话摘要社区',
      'safety_record': '安全档案社区',
    };

    return `[${typeNames[type] || type}摘要] 包含 ${entries.length} 条记忆。核心内容：${contents.join('；')}`;
  }

  /**
   * Map-Reduce 推理
   */
  private mapReduceInsight(summaries: string[]): string {
    // Map 阶段：每段摘要独立分析
    const mapResults = summaries.map((summary, index) => {
      return `洞察${index + 1}：${summary}`;
    });

    // Reduce 阶段：综合生成最终洞察
    return `[全局洞察] 基于用户知识图谱的 ${summaries.length} 个社区分析：${mapResults.join('。')}`;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

// ==================== 记忆检索引擎主类 ====================

export class MemoryRetrievalEngine {
  private vectorRetriever: VectorRetriever;
  private graphRetriever: GraphRetriever;
  private structuredRetriever: StructuredRetriever;
  private graphragRetriever: GraphRAGRetriever;
  private crossEncoder: CrossEncoderModel;
  private compressor: LLMLinguaCompressor;

  constructor(store: MemoryStore) {
    const embeddingModel = new MockEmbeddingModel();
    this.vectorRetriever = new VectorRetriever(embeddingModel, store);
    this.graphRetriever = new GraphRetriever(embeddingModel, store);
    this.structuredRetriever = new StructuredRetriever(store);
    this.graphragRetriever = new GraphRAGRetriever(embeddingModel, store);
    this.crossEncoder = new MockCrossEncoderModel();
    this.compressor = new LLMLinguaCompressor();
  }

  /**
   * 执行完整的记忆检索流程
   * 四路并行 → 汇总去重 → Cross-Encoder 重排 → 注入内容组装 → LLMLingua 压缩
   */
  async retrieve(userId: string, query: string): Promise<{
    retrievalResult: RetrievalResult;
    compressedContext: CompressedContext;
    injectionText: string;
  }> {
    const startTime = Date.now();

    // 1. 四路并行检索
    const [vectorResults, graphResults, graphragInsight] = await Promise.all([
      this.vectorRetriever.retrieve(userId, query, 15),
      this.graphRetriever.retrieve(userId, query),
      this.graphragRetriever.retrieve(userId, query),
    ]);

    const structuredContext = this.structuredRetriever.retrieve(userId);

    // 2. 汇总去重
    const allCandidates = this.deduplicateCandidates([...vectorResults, ...graphResults]);

    // 3. Cross-Encoder 重排序
    const topCandidates = allCandidates.slice(0, 20);
    const reranked = await this.rerankWithCrossEncoder(query, topCandidates);

    // 4. 取 top-5
    const topMemories = reranked.slice(0, 5);

    // 5. 组装注入内容
    const injectionContent = this.assembleInjectionContent(
      structuredContext,
      topMemories,
      graphragInsight || undefined
    );

    // 6. LLMLingua 压缩
    const compressionResult = this.compressor.compress(
      injectionContent,
      0.5,
      this.extractPreserveKeywords(structuredContext, topMemories)
    );

    const retrievalTime = Date.now() - startTime;

    return {
      retrievalResult: {
        candidates: allCandidates,
        top_memories: topMemories,
        graphrag_insight: graphragInsight || undefined,
        structured_context: structuredContext,
        retrieval_time_ms: retrievalTime,
      },
      compressedContext: {
        hard_preserved: this.buildHardPreserved(structuredContext),
        compressed: compressionResult.compressed,
        original_token_count: compressionResult.originalTokens,
        compressed_token_count: compressionResult.compressedTokens,
        compression_ratio: compressionResult.ratio,
      },
      injectionText: this.buildHardPreserved(structuredContext) + '\n' + compressionResult.compressed,
    };
  }

  /**
   * 去重候选结果
   */
  private deduplicateCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
    const seen = new Map<string, MemoryCandidate>();

    for (const candidate of candidates) {
      const key = candidate.entry_id || candidate.id;

      if (seen.has(key)) {
        // 保留分数更高的
        const existing = seen.get(key)!;
        if (candidate.source_score > existing.source_score) {
          seen.set(key, candidate);
        }
      } else {
        // 模糊去重：检查内容相似度
        let isDuplicate = false;
        for (const [_, existing] of seen) {
          if (this.textSimilarity(candidate.content_text, existing.content_text) > 0.92) {
            isDuplicate = true;
            if (candidate.source_score > existing.source_score) {
              seen.set(existing.id, candidate);
            }
            break;
          }
        }

        if (!isDuplicate) {
          seen.set(key, candidate);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Cross-Encoder 重排序
   */
  private async rerankWithCrossEncoder(
    query: string,
    candidates: MemoryCandidate[]
  ): Promise<MemoryCandidate[]> {
    const reranked: MemoryCandidate[] = [];

    for (const candidate of candidates) {
      const crossEncoderScore = await this.crossEncoder.score(query, candidate.content_text);

      // 最终分数 = Cross-Encoder 分数 × 0.7 + 原始分数 × 0.3
      const finalScore = crossEncoderScore * 0.7 + candidate.source_score * 0.3;

      reranked.push({
        ...candidate,
        cross_encoder_score: crossEncoderScore,
        final_score: finalScore,
      });
    }

    reranked.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));
    return reranked;
  }

  /**
   * 组装注入内容
   */
  private assembleInjectionContent(
    structured: StructuredContext,
    memories: MemoryCandidate[],
    graphragInsight?: string
  ): string {
    const parts: string[] = [];

    // 检索到的记忆条目
    if (memories.length > 0) {
      parts.push('【相关记忆】');
      memories.forEach((m, i) => {
        parts.push(`${i + 1}. ${m.content_text}`);
      });
    }

    // GraphRAG 全局洞察
    if (graphragInsight) {
      parts.push('');
      parts.push('【全局洞察】');
      parts.push(graphragInsight);
    }

    return parts.join('\n');
  }

  /**
   * 构建硬保留区（不压缩）
   */
  private buildHardPreserved(structured: StructuredContext): string {
    const parts: string[] = [];

    if (structured.user_profile_summary !== '暂无用户画像') {
      parts.push(`[用户画像] ${structured.user_profile_summary}`);
    }

    if (structured.empathy_preferences !== '暂无共情偏好') {
      parts.push(`[共情偏好] ${structured.empathy_preferences}`);
    }

    if (structured.active_direction_cards.length > 0) {
      const cards = structured.active_direction_cards
        .map(dc => `${dc.name}(${dc.status} ${dc.progress}/10)`)
        .join('、');
      parts.push(`[方向卡] ${cards}`);
    }

    return parts.join('\n');
  }

  /**
   * 提取需要强制保留的关键词
   */
  private extractPreserveKeywords(
    structured: StructuredContext,
    memories: MemoryCandidate[]
  ): string[] {
    const keywords: string[] = [];

    // 从方向卡名称提取
    structured.active_direction_cards.forEach(dc => {
      keywords.push(dc.name);
    });

    // 从情绪模式提取
    structured.current_emotion_patterns.forEach(ep => {
      keywords.push(ep.primary_emotion);
      if (ep.secondary_emotion) keywords.push(ep.secondary_emotion);
    });

    // 从记忆内容提取关键名词
    memories.forEach(m => {
      const tokens = m.content_text.split(/[\s，。！？、；：""''（）【】]+/);
      tokens.forEach(token => {
        if (token.length >= 2 && token.length <= 4) {
          keywords.push(token);
        }
      });
    });

    return [...new Set(keywords)];
  }

  /**
   * 文本相似度（Jaccard）
   */
  private textSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.split(/[\s，。！？、；：""''（）【】]+/).filter(t => t.length > 0));
    const tokens2 = new Set(text2.split(/[\s，。！？、；：""''（）【】]+/).filter(t => t.length > 0));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}
