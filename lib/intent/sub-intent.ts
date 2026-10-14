import { InteractionIntent, SubIntent } from './types';

/** One vocabulary is shared by local rules and the existing merged analysis request. */
export const SUB_INTENTS = [
  'L2.1a_venting', 'L2.1b_seeking_resonance', 'L2.1c_seeking_normalize', 'L2.1d_silent_venting',
  'L2.2a_value_sorting', 'L2.2b_conflict_clarification', 'L2.2c_cause_seeking', 'L2.2d_direction_finding',
  'L2.3a_decision_agonizing', 'L2.3b_action_planning', 'L2.3c_result_sharing', 'L2.3d_action_blocked',
  'L2.5a_career_advice', 'L2.5b_psychological', 'L2.5c_resource_recomm', 'L2.5d_decision_replace',
  'L2.6a_ai_identity', 'L2.6b_feature_usage', 'L2.6c_privacy', 'L2.6d_methodology',
  'L2.7a_negative_feedback', 'L2.7b_positive_feedback', 'L2.7c_style_adjustment', 'L2.7d_topic_switch',
  'L2.8a_trust_test', 'L2.8b_boundary_confirm', 'L2.8c_safety_seeking', 'L2.8d_anthropomorphism',
] as const satisfies readonly SubIntent[];

export function compatibleSubIntent(intent: InteractionIntent, subIntent: unknown): SubIntent | undefined {
  return typeof subIntent === 'string' && (SUB_INTENTS as readonly string[]).includes(subIntent)
    && subIntent.slice(0, 4) === intent.slice(0, 4) ? subIntent as SubIntent : undefined;
}

const RULES: [SubIntent, RegExp][] = [
  ['L2.1a_venting', /只想.{0,8}(倾诉|说说)|just (?:want|need).{0,15}(?:vent|listen)/i],
  ['L2.1b_seeking_resonance', /理解我|懂我|understand me/i],
  ['L2.1c_seeking_normalize', /正常吗|只有我|is this normal/i],
  ['L2.2a_value_sorting', /在意什么|重要的|价值|what matters|values/i],
  ['L2.2b_conflict_clarification', /冲突|矛盾|一方面|conflict|torn between/i],
  ['L2.2c_cause_seeking', /为什么|原因|why|cause/i],
  ['L2.2d_direction_finding', /方向|想要什么|direction|what I want/i],
  ['L2.3d_action_blocked', /卡住|受阻|做不下去|stuck|blocked/i],
  ['L2.3c_result_sharing', /结果|试过|尝试了|完成了|outcome|result|I tried|completed/i],
  ['L2.3a_decision_agonizing', /要不要|纠结|选哪个|whether|which.*choose/i],
  ['L2.3b_action_planning', /计划|下一步|怎么做|plan|next step|how to/i],
  ['L2.5d_decision_replace', /替我决定|帮我决定|decide for me/i],
  ['L2.5a_career_advice', /工作|职业|求职|career|job/i],
  ['L2.5b_psychological', /放松|情绪|焦虑|relax|anxiety/i],
  ['L2.5c_resource_recomm', /资源|推荐|resource|recommend/i],
  ['L2.6a_ai_identity', /真人|你是AI|are you (?:human|an AI)/i],
  ['L2.6c_privacy', /隐私|数据安全|保存|privacy|data/i],
  ['L2.6d_methodology', /塔罗|原理|如何判断|method|how.*work/i],
  ['L2.6b_feature_usage', /怎么用|功能|how.*use|feature/i],
  ['L2.7d_topic_switch', /换个话题|不聊这个|change.*topic/i],
  ['L2.7c_style_adjustment', /直接|简短|详细|别老问|direct|brief|detail|stop asking/i],
  ['L2.7a_negative_feedback', /没用|不理解|useless|not helpful/i],
  ['L2.7b_positive_feedback', /说得对|有帮助|helpful|you.re right/i],
  ['L2.8d_anthropomorphism', /感受|情感|feel|emotion/i],
  ['L2.8b_boundary_confirm', /告诉别人|保密|secret|tell.*others/i],
  ['L2.8a_trust_test', /信任|理解我|trust|understand me/i],
  ['L2.8c_safety_seeking', /安全|陪着|safe|stay with/i],
];

export function recognizeSubIntent(input: string, intent: InteractionIntent): SubIntent | undefined {
  return RULES.find(([subIntent, pattern]) => compatibleSubIntent(intent, subIntent) && pattern.test(input))?.[0];
}
