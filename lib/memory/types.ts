/**
 * 记忆系统 - 核心数据模型
 * 定义记忆条目、用户画像、方向卡、情绪模式等核心类型
 */

// ==================== 基础枚举 ====================

/** 记忆条目类型 */
export type MemoryEntryType =
  | 'value'              // 价值观
  | 'constraint'         // 约束条件
  | 'theme'              // 反复出现的主题
  | 'emotion_pattern'    // 情绪模式
  | 'direction_card'     // 方向卡
  | 'action_experiment'  // 行动实验
  | 'empathy_preference' // 共情偏好
  | 'conversation_summary' // 对话摘要
  | 'safety_record';     // 安全档案

/** 记忆条目状态 */
export type MemoryEntryStatus = 'active' | 'archived' | 'deleted' | 'pending_confirmation';

/** 记忆写入动作 */
export type MemoryAction = 'create' | 'append' | 'update' | 'archive' | 'delete' | 'confirm' | 'deny';

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 方向卡状态 */
export type DirectionCardStatus = 'hypothesis' | 'in_progress' | 'validated' | 'rejected' | 'paused';

/** 实验状态 */
export type ExperimentStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned';

// ==================== 核心数据结构 ====================

/** 记忆条目 - 最小记忆单元 */
export interface MemoryEntry {
  id: string;
  user_id: string;
  type: MemoryEntryType;
  content: string;               // 记忆内容的自然语言描述
  content_encrypted?: string;    // AES-256-GCM 加密后的内容
  status: MemoryEntryStatus;
  base_weight: number;           // 基础权重 0.0-1.0
  current_weight: number;        // 当前权重（经衰减后）
  confirmed: boolean;            // 用户是否确认过
  access_count: number;          // 访问次数
  last_accessed_at: string;      // 最近访问时间 ISO-8601
  source: 'user_explicit' | 'llm_inferred' | 'system_generated';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

/** 向量记忆条目 - 用于 Milvus 存储 */
export interface VectorMemoryEntry {
  id: string;
  user_id: string;
  entry_id: string;              // 关联 MemoryEntry.id
  dense_vector: number[];        // bge-m3 稠密向量 1024维
  sparse_vector: Record<string, number>; // bge-m3 稀疏向量
  content_text: string;          // 原始文本
  content_type: MemoryEntryType;
  created_at: string;
}

/** 图节点 - 用于 Neo4j 存储 */
export interface GraphNode {
  id: string;
  entry_id: string;              // 关联 MemoryEntry.id
  labels: string[];              // Neo4j 标签
  properties: Record<string, unknown>;
  active: boolean;
}

/** 图关系 */
export interface GraphRelationship {
  id: string;
  source_id: string;
  target_id: string;
  type: GraphRelationType;
  properties: Record<string, unknown>;
}

/** 图关系类型 */
export type GraphRelationType =
  | 'EXPLORES'         // 探索关系
  | 'CONFLICTS_WITH'   // 价值冲突
  | 'TRIGGERS_EMOTION' // 触发情绪
  | 'LINKED_TO'        // 一般关联
  | 'PART_OF'          // 属于
  | 'LEADS_TO'         // 导向
  | 'BLOCKS';          // 阻碍

// ==================== 用户画像 ====================

/** 用户模型 - 完整的用户心理画像 */
export interface UserProfile {
  user_id: string;
  core_memory: CoreMemory;
  direction_cards: DirectionCard[];
  emotion_patterns: EmotionPattern[];
  empathy_preferences: EmpathyPreferences;
  action_experiments: ActionExperiment[];
  conversation_summaries: ConversationSummary[];
  created_at: string;
  updated_at: string;
}

/** 核心记忆 */
export interface CoreMemory {
  values: MemoryEntry[];         // 价值观列表
  constraints: MemoryEntry[];    // 约束条件列表
  themes: MemoryEntry[];         // 反复主题列表
}

/** 方向卡 - 探索方向的结构化表示 */
export interface DirectionCard {
  id: string;
  user_id: string;
  name: string;                  // 方向名称
  hypothesis: string;            // 假设描述
  status: DirectionCardStatus;
  progress: number;              // 进度 0-10
  evidence_for: string[];        // 支持证据
  evidence_against: string[];    // 反对证据
  related_values: string[];      // 关联的价值观
  related_constraints: string[]; // 关联的约束
  created_at: string;
  updated_at: string;
}

/** 情绪模式 - 记录用户在特定情境下的情绪反应 */
export interface EmotionPattern {
  id: string;
  user_id: string;
  trigger: string;               // 触发情境描述
  primary_emotion: string;       // 主要情绪
  secondary_emotion?: string;    // 次要情绪
  typical_intensity: number;     // 典型强度
  typical_valence: number;       // 典型效价
  frequency: number;             // 出现频次
  trend: 'improving' | 'stable' | 'worsening';
  first_observed_at: string;
  last_observed_at: string;
  examples: string[];            // 用户原话示例
}

/** 共情偏好 - 记录对用户有效的共情方式 */
export interface EmpathyPreferences {
  user_id: string;
  effective_approaches: string[];    // 有效的方式
  ineffective_approaches: string[];  // 无效的方式
  preferred_tone: string;            // 偏好的语气
  avoid_phrases: string[];           // 需要避免的表达
  updated_at: string;
}

/** 行动实验 - 用户正在尝试的行动 */
export interface ActionExperiment {
  id: string;
  user_id: string;
  direction_card_id: string;     // 关联的方向卡
  name: string;
  description: string;
  status: ExperimentStatus;
  start_date: string;
  end_date?: string;
  steps_total: number;
  steps_completed: number;
  observations: string[];
  created_at: string;
  updated_at: string;
}

/** 对话摘要 */
export interface ConversationSummary {
  id: string;
  user_id: string;
  session_id: string;
  summary_text: string;
  topics: string[];
  emotions_arc: string;          // 情绪弧线描述
  key_turning_points: string[];
  new_information: string[];
  action_items: string[];
  embedding?: number[];          // 摘要向量
  created_at: string;
}

// ==================== 检索相关 ====================

/** 统一的候选记忆条目（四路检索汇总后的中间表示） */
export interface MemoryCandidate {
  id: string;
  source: 'vector' | 'graph' | 'structured' | 'graphrag';
  content_text: string;
  raw_data: unknown;
  source_score: number;
  cross_encoder_score?: number;
  final_score?: number;
  content_type: MemoryEntryType | 'insight';
  entry_id?: string;             // 关联的 MemoryEntry.id
}

/** 检索结果 */
export interface RetrievalResult {
  candidates: MemoryCandidate[];
  top_memories: MemoryCandidate[];   // Cross-Encoder 重排后的 top-5
  graphrag_insight?: string;         // GraphRAG 全局洞察
  structured_context: StructuredContext;
  retrieval_time_ms: number;
}

/** 结构化基础上下文（每次都注入） */
export interface StructuredContext {
  user_profile_summary: string;  // 用户画像摘要
  empathy_preferences: string;   // 共情偏好
  active_direction_cards: DirectionCard[];
  current_emotion_patterns: EmotionPattern[];
}

/** 压缩后的注入内容 */
export interface CompressedContext {
  hard_preserved: string;        // 硬保留区（不压缩）
  compressed: string;            // 可压缩区（经 LLMLingua 压缩）
  original_token_count: number;
  compressed_token_count: number;
  compression_ratio: number;
}

// ==================== 写入相关 ====================

/** 记忆写入操作 */
export interface MemoryWriteOperation {
  action: MemoryAction;
  target: string;                // 目标字段路径，如 "core_memory.values"
  content: string;
  reason: string;
  needs_user_confirmation: boolean;
  entry_id?: string;             // 更新/删除时需要
}

/** 记忆写入评估结果 */
export interface MemoryWriteEvaluation {
  should_write: boolean;
  operations: MemoryWriteOperation[];
  source: 'rule_engine' | 'llm_inference' | 'both';
  confidence: number;
}

/** 写入执行结果 */
export interface MemoryWriteResult {
  success: boolean;
  entries_written: string[];     // 写入的 entry id 列表
  vectors_upserted: string[];   // upsert 的向量 id 列图
  graph_nodes_created: string[]; // 创建的图节点 id 列表
  audit_log_id: string;
  kv_cache_invalidated: boolean;
  errors: string[];
}

// ==================== 衰减相关 ====================

/** 记忆衰减配置 */
export interface DecayConfig {
  half_life_days: number;        // 衰减半衰期（天），默认 90
  archive_threshold: number;     // 归档阈值，默认 0.1
  review_threshold: number;      // 复盘阈值，默认 0.3
  confirmed_multiplier: number;  // 用户确认过的记忆乘数，默认 1.5
  max_access_bonus: number;      // 访问频次加成上限，默认 1.0
  access_bonus_per_visit: number; // 每次访问的加成，默认 0.1
}

/** 复盘邀请 */
export interface ReviewInvitation {
  entry_id: string;
  content: string;
  current_weight: number;
  suggested_action: 'reaffirm' | 'update' | 'archive' | 'delete';
  reason: string;
}

/** 衰减执行结果 */
export interface DecayResult {
  user_id: string;
  entries_updated: number;
  entries_archived: number;
  review_invitations: ReviewInvitation[];
  executed_at: string;
}

// ==================== 安全相关 ====================

/** 安全分类结果 */
export interface SafetyClassification {
  risk_level: RiskLevel;
  risk_type?: string;
  evidence: string[];
  should_block: boolean;
  safety_response?: string;
}

/** 审计日志条目 */
export interface AuditLogEntry {
  id: string;
  user_id: string;
  operation: MemoryAction;
  target_entry_id?: string;
  details: string;
  operator: 'user' | 'system' | 'llm';
  timestamp: string;
}

// ==================== 存储适配器接口 ====================

/** 结构化存储适配器（PostgreSQL） */
export interface StructuredStoreAdapter {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  saveUserProfile(profile: UserProfile): Promise<void>;
  getMemoryEntries(userId: string, type?: MemoryEntryType): Promise<MemoryEntry[]>;
  saveMemoryEntry(entry: MemoryEntry): Promise<void>;
  updateMemoryEntry(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  deleteMemoryEntry(id: string): Promise<void>;
  getActiveDirectionCards(userId: string): Promise<DirectionCard[]>;
  getEmotionPatterns(userId: string): Promise<EmotionPattern[]>;
  getEmpathyPreferences(userId: string): Promise<EmpathyPreferences | null>;
  saveAuditLog(entry: AuditLogEntry): Promise<void>;
}

/** 向量存储适配器（Milvus） */
export interface VectorStoreAdapter {
  upsertVector(entry: VectorMemoryEntry): Promise<void>;
  deleteVector(id: string): Promise<void>;
  searchDense(userId: string, vector: number[], topK: number): Promise<MemoryCandidate[]>;
  searchSparse(userId: string, vector: Record<string, number>, topK: number): Promise<MemoryCandidate[]>;
  searchHybrid(userId: string, dense: number[], sparse: Record<string, number>, topK: number): Promise<MemoryCandidate[]>;
}

/** 图存储适配器（Neo4j） */
export interface GraphStoreAdapter {
  createNode(node: GraphNode): Promise<string>;
  updateNode(id: string, properties: Record<string, unknown>): Promise<void>;
  deactivateNode(id: string): Promise<void>;
  createRelationship(rel: GraphRelationship): Promise<string>;
  findEntryNodes(userId: string, embedding: number[], topK: number): Promise<GraphNode[]>;
  traverseFromNodes(nodeIds: string[], hops: number, relationTypes?: GraphRelationType[]): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }>;
  detectValueConflicts(userId: string): Promise<GraphRelationship[]>;
}

/** 缓存适配器（Redis/KV） */
export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  isKvCacheValid(userId: string): Promise<boolean>;
  invalidateKvCache(userId: string): Promise<void>;
}
