/** Local lexical fallback. The trained emotion head runs in Python; no duplicate cloud classifier. */
import { Emotion, getAllEmotions, getEmotionById } from './emotion-tags';
import { KnowledgeResult, localEmotions } from './local-knowledge';

const emotions = getAllEmotions();
const classifierIds: Record<string, string> = { fear: 'anxiety', love: 'loved' };
const neutral: Emotion = { id: 'neutral', name: '未明确', layer: 1, category: 'ambiguous', valence: 0, arousal: 0.3, dominance: 0.5, synonyms: [], description: '未发现明确情绪词' };

export interface EmotionRecognitionResult {
  primaryEmotion: Emotion;
  secondaryEmotion?: Emotion;
  intensity: number;          // 0.0 到 1.0
  confidence: number;         // 0.0 到 1.0
  valence: number;            // -1.0 到 +1.0
  arousal: number;            // 0.0 到 1.0
  dominance: number;          // 0.0 到 1.0
  contextualFactors: string[];
  rawAnalysis: string;
}

export class EmotionRecognizer {
  recognizeLocally(userInput: string): EmotionRecognitionResult {
    const match = emotions.find(e => [e.name, ...e.synonyms].some(word => userInput.includes(word)));
    const primaryEmotion = match || neutral;
    return { primaryEmotion, intensity: match ? 0.55 : 0.3, confidence: match ? 0.45 : 0.1,
      valence: primaryEmotion.valence, arousal: primaryEmotion.arousal, dominance: primaryEmotion.dominance,
      contextualFactors: ['本地词典估计，不是心理测评'], rawAnalysis: '本地词典估计' };
  }

  recognizeWithKnowledge(userInput: string, knowledge?: KnowledgeResult): EmotionRecognitionResult {
    const lexical = this.recognizeLocally(userInput);
    if (!knowledge || knowledge.confidence < .55) return lexical;
    const calibrated = localEmotions[knowledge.emotion];
    const primary = getEmotionById(classifierIds[knowledge.emotion] || knowledge.emotion) || neutral;
    return { ...lexical, primaryEmotion: { ...primary, id: knowledge.emotion === 'neutral' ? 'neutral' : primary.id,
      name: calibrated.name, valence: calibrated.valence, arousal: calibrated.arousal },
      valence: calibrated.valence, arousal: calibrated.arousal };
  }

}
