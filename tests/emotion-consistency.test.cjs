const test=require('node:test');
const assert=require('node:assert/strict');
const {EmotionRecognizer}=require('../dist/lib/emotion-recognition');

test('trained emotion names and strategy IDs agree without treating scores as intensity',()=>{
 const recognizer=new EmotionRecognizer();let calls=0;
 const original=recognizer.recognizeLocally.bind(recognizer);
 recognizer.recognizeLocally=text=>{calls++;return original(text);};
 const result=recognizer.recognizeWithKnowledge('我很开心',{emotion:'fear',confidence:.9});
 assert.equal(calls,1);assert.equal(result.primaryEmotion.id,'anxiety');assert.equal(result.primaryEmotion.name,'焦虑');
 assert.equal(result.intensity,.55);assert.notEqual(result.intensity,.9);
 const neutral=recognizer.recognizeWithKnowledge('我很开心',{emotion:'neutral',confidence:.8});
 assert.equal(neutral.primaryEmotion.id,'neutral');assert.equal(neutral.primaryEmotion.name,'未明确');
 assert.equal(neutral.primaryEmotion.category,'ambiguous');assert.equal(neutral.primaryEmotion.synonyms.length,0);
 const weak=recognizer.recognizeWithKnowledge('我很开心',{emotion:'fear',confidence:.3});
 assert.equal(weak.primaryEmotion.id,'joy');
});
