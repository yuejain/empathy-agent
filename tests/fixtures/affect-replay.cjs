// Agent-authored synthetic regression scenarios. These are not human-rated dialogue,
// clinical measurements, or evidence of subjective emotional experience.
module.exports={
 id:'affect-replay-v1',provenance:'synthetic-agent-authored',
 cases:[
  {id:'zh-progress-then-boundary',steps:[
   {input:'我完成了报告',repeat:12,expect:{mode:'encourage',pace:'light'}},
   {input:'不要给我建议，只想倾诉',expect:{mode:'space',pace:'unhurried',followUp:'none',events:['boundary']}},
  ]},
  {id:'en-progress-then-correction',steps:[
   {input:'I finally finished the report',repeat:12},
   {input:'You misunderstood',expect:{mode:'repair',pace:'steady',followUp:'none',events:['correction']}},
  ]},
  {id:'zh-negative-result-overrides-positive-label',steps:[
   {input:'我完成了报告',repeat:15},
   {input:'没有改善',appraisals:[{signal:'progress',quote:'没有改善',confidence:.95}],expect:{mode:'support',pace:'unhurried',events:['setback']}},
  ]},
  {id:'en-distress-survives-full-model-slot-list',steps:[
   {input:'I finally finished the report',repeat:12},
   {input:'I feel sad',appraisals:['progress','discovery','appreciation'].map(signal=>({signal,quote:'I feel sad',confidence:.9})),expect:{mode:'support',pace:'unhurried',hasEvent:'distress',noEvent:'progress'}},
  ]},
  {id:'zh-current-relief-overrides-lingering-concern',steps:[
   {input:'我很难过',repeat:20,expect:{mode:'support'}},
   {input:'我现在好多了',expect:{mode:'relief',concernAbove:.32}},
  ]},
  {id:'en-current-progress-after-persistent-worry',steps:[
   {input:'I feel anxious',repeat:20},
   {input:'I finally finished the report',expect:{mode:'encourage',pace:'unhurried',concernAbove:.32}},
  ]},
  {id:'en-boundary-and-negative-outcome',steps:[
   {input:'I finally finished the report',repeat:8},
   {input:'It did not help. Just listen.',expect:{mode:'space',followUp:'none',hasEvent:'setback'}},
  ]},
  {id:'zh-correction-before-reframing-result',steps:[
   {input:'我完成了报告',repeat:8},
   {input:'你理解错了。没有改善',expect:{mode:'repair',followUp:'none',hasEvent:'setback'}},
  ]},
  {id:'zh-every-boundary-survives-event-limit',steps:[
   {input:'我完成了报告',repeat:8},
   {input:'不要建议。你误解了。我现在好多了，但没有改善',expect:{mode:'space',events:['boundary','correction','setback']}},
  ]},
  {id:'zh-inertia-then-neutral-recovery',steps:[
   {input:'我很难过',repeat:20},
   {input:'今天吃了面',expect:{mode:'support',basis:'state'}},
   {input:'今天吃了面',repeat:65,expect:{mode:'steady',nearFastBaseline:true,moodConcernAbove:.18}},
  ]},
  {id:'en-state-survives-serialization-without-text',steps:[
   {input:'I finally finished the report',repeat:8},
   {restart:true,input:'I want to explore another approach',expect:{mode:'explore',turns:9}},
   {waitHours:180*24,expect:{mode:'steady',nearBaseline:true,events:[]}},
  ]},
  {id:'zh-quoted-success-is-not-evidence',steps:[
   {input:'朋友说“我完成了报告”',appraisals:[{signal:'progress',quote:'我完成了报告',confidence:.99}],expect:{mode:'steady',events:[]}},
   {input:'如果我完成了报告',appraisals:[{signal:'progress',quote:'我完成了报告',confidence:.99}],expect:{mode:'steady',events:[]}},
   {input:'我没有完成报告',appraisals:[{signal:'progress',quote:'完成报告',confidence:.99}],expect:{mode:'steady',events:[]}},
  ]},
  {id:'en-ungrounded-and-question-evidence',steps:[
   {input:'We can talk about the weather',appraisals:[{signal:'progress',quote:'I finished the task',confidence:.9}],expect:{events:[]}},
   {input:'I finished the task?',appraisals:[{signal:'progress',quote:'I finished the task',confidence:.9}],expect:{events:[]}},
  ]},
  {id:'zh-capture-off-is-turn-only',settings:{capture:false,recall:true},steps:[
   {input:'这次终于顺利收尾',appraisals:[{signal:'progress',quote:'这次终于顺利收尾',confidence:.9}],expect:{mode:'encourage',persistence:'turn-only',persisted:false,turns:1}},
   {input:'今天吃了面',expect:{mode:'steady',persisted:false,turns:1}},
  ]},
  {id:'en-recall-off-is-turn-only',settings:{capture:true,recall:false},steps:[
   {input:'I finally finished the report',expect:{mode:'encourage',persistence:'turn-only',persisted:false}},
   {input:'Today I had noodles',expect:{mode:'steady',persisted:false,turns:1}},
  ]},
  {id:'zh-reset-and-disable-remove-inertia',steps:[
   {input:'我很难过',repeat:12},
   {reset:true,input:'今天吃了面',expect:{mode:'steady',turns:1}},
   {enabled:false,input:'我很难过',expect:{tone:'已关闭',persisted:false,turns:0}},
   {enabled:true,input:'今天吃了面',expect:{mode:'steady',turns:1}},
  ]},
 ],
};
