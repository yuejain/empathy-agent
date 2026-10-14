const test = require('node:test');
const assert = require('node:assert/strict');
const { ChatGateway } = require('../dist/lib/gateway');
const { inferTurnAnalysis } = require('../dist/lib/memory/extractor');
const { emptyProfile } = require('../dist/lib/memory/schema');
const { prepareMemory, mutateMemory } = require('../dist/lib/memory/profile');
const { IntentClassifier, IntentRouter, routeSubState, compatibleSubIntent } = require('../dist/lib/intent');
const { reflectionContext, TarotInteractionManager } = require('../dist/lib/tarot/interaction');
const { CardMatcher } = require('../dist/lib/tarot/card-matcher');
const { THEME_CARD_MAP } = require('../dist/lib/tarot/card-data');
const { reflectionGame } = require('../dist/lib/tarot/reflection-games');
const { continuityView, continuityPrompt } = require('../dist/lib/context/continuity');
const { provider, app, client } = require('./helpers.cjs');
const { SessionStore } = require('../dist/server/session-store');

const origin = () => ({sessionId:'synthetic-session',turnId:'1',now:Date.now()});
const remember = (p,text) => prepareMemory(p,text,origin()).profile;
const context = {userId:'u',sessionId:'synthetic-session',emotion:'焦虑',intensity:.4};

test('sub-intent uses the existing analysis request and discards mismatched or ungrounded labels',async t=>{
  let intent={intent:'L2.3_action_discussion',confidence:.9,quote:'我在考虑下一步计划',subIntent:'L2.3b_action_planning'};
  const cloud=await provider(t,{turnAnalysis:()=>({memories:[],experiments:[],intent})});
  const gateway=new ChatGateway(cloud.env);
  const run=()=>inferTurnAnalysis(gateway,'我在考虑下一步计划');
  assert.equal((await run()).intent.subIntent,'L2.3b_action_planning');
  assert.equal(cloud.requests.length,1);
  intent={...intent,subIntent:'L2.6c_privacy'};
  assert.equal((await run()).intent.subIntent,undefined);
  intent={...intent,subIntent:'L2.3b_action_planning',quote:'这不是用户的原话'};
  assert.equal((await run()).intent,undefined);
  assert.equal(compatibleSubIntent('L2.1_emotional_venting','L2.3b_action_planning'),undefined);
});

test('local sub-intents reach routing hints and cannot override the final safety or empathy phase',async()=>{
  const classifier=new IntentClassifier();
  const result=await classifier.classify('我的隐私怎么保护？',{recentHistory:[],currentState:'EMPATHY_PHASE',emotion:{primary:'未明确',intensity:.2,valence:0}});
  assert.equal(result.subIntent,'L2.6c_privacy');
  const router=new IntentRouter();
  const privacy=router.makeRouteDecision(result,'EMPATHY_PHASE',{intensity:.2,trajectory:'stable'});
  assert.match(privacy.strategyHints.join(' '),/未加密存储/);
  assert.equal(routeSubState(privacy,'EMPATHY_PHASE'),undefined);
  const route=router.makeRouteDecision({...result,primaryIntent:'L2.3_action_discussion',subIntent:'L2.3d_action_blocked'},'ACTION_PHASE',{intensity:.2,trajectory:'stable'});
  assert.equal(routeSubState(route,'ACTION_PHASE'),'ACTION_EXPLORE_BLOCK');
  assert.equal(routeSubState(route,'SAFETY_PROTOCOL'),undefined);
  assert.equal(routeSubState(route,'EMPATHY_PHASE'),undefined);
  assert.match(route.strategyHints.join(' '),/不重复催促/);
});

test('card themes use only valid stated user memory and disappear when recall or the record is removed',()=>{
  let p=mutateMemory(emptyProfile('u'),{revision:0,action:'add',kind:'profile',text:'我的工作需要稳定和自由'},origin());
  // Set a stable, self-reported profile record without relying on a cloud classifier.
  const entry=p.entries[0];
  assert.ok(entry);
  entry.certainty='stated';entry.kind='profile';entry.status='active';
  let enriched=reflectionContext(p,context);
  assert.deepEqual(enriched.knownThemes,['稳定','自由']);
  entry.certainty='inferred';assert.deepEqual(reflectionContext(p,context).knownThemes,[]);
  entry.certainty='stated';entry.expiresAt=Date.now()-1;assert.deepEqual(reflectionContext(p,context).knownThemes,[]);
  entry.expiresAt=Date.now()+60000;p.settings.recall=false;assert.deepEqual(reflectionContext(p,context).knownThemes,[]);
  p.settings.recall=true;p=mutateMemory(p,{revision:p.revision,action:'delete',id:entry.id},origin());
  assert.deepEqual(reflectionContext(p,context).knownThemes,[]);
});

test('theme matching and all tarot randomness participate in the actual draw',()=>{
  const matcher=new CardMatcher(()=>.2);
  const result=matcher.selectCards({userId:'u',sessionId:'s',trigger:'user_request',currentEmotion:'焦虑',knownThemes:['稳定']});
  assert.ok(THEME_CARD_MAP['稳定'].includes(result.selectionReason.themeCard));
  assert.equal(new Set(result.cards.map(c=>c.id)).size,3);
  const input={...context,knownThemes:['稳定']};
  assert.equal(reflectionGame('tarot',input,()=>.2),reflectionGame('tarot',input,()=>.2));
  assert.match(reflectionGame('tarot',input,()=>.2),/不预测未来/);
});

test('entry recommendations require an explicit request and respect a direct-chat preference',()=>{
  const manager=new TarotInteractionManager();let p=emptyProfile('u');
  assert.equal(manager.recommend('今天我很焦虑','焦虑',p),undefined);
  assert.match(manager.recommend('推荐一种联想练习','焦虑',p),/场景联想/);
  assert.equal(manager.recommend('不要推荐一种联想游戏','焦虑',p),undefined);
  p=remember(p,'我不喜欢塔罗');
  assert.equal(manager.preferredEntry(p),'direct');
  assert.match(manager.recommend('换一种练习','焦虑',p),/直接聊/);
});

test('dated reflection narrative reaches cloud context only when relevant and is forgotten with its memory',()=>{
  let p=remember(emptyProfile('u'),'我正在写论文');
  const entry=p.entries[0];entry.reflection={game:'scenario',choice:1};
  const view=continuityView(p);
  assert.equal(view.reflectionHistory.length,1);
  assert.doesNotMatch(continuityPrompt(view,'聊聊天',[]),/我正在写论文/);
  assert.match(continuityPrompt(view,'论文的进展',[entry]),/"reflections":\[\{/);
  assert.match(continuityPrompt(view,'回顾上次的联想练习',[]),/我正在写论文/);
  p=mutateMemory(p,{revision:p.revision,action:'delete',id:entry.id},origin());
  assert.doesNotMatch(continuityPrompt(continuityView(p),'回顾上次的联想练习',[]),/我正在写论文/);
});

test('HTTP main flow uses one merged sub-intent analysis and updates the persisted phase detail',async t=>{
  const cloud=await provider(t,{turnAnalysis:body=>({memories:[],experiments:[],intent:{intent:'L2.3_action_discussion',confidence:.9,quote:body.messages.at(-1).content,subIntent:'L2.3b_action_planning'}})});
  const store=new SessionStore(),{url}=await app(t,cloud.env,store),c=client(url);
  const result=await c.chat('我在考虑下一步怎么做');
  assert.equal(result.events[0].intentSource,'merged-context');
  assert.equal(result.events[0].state.current,'ACTION_PHASE');
  assert.equal(cloud.requests.length,3);
  assert.equal(cloud.requests.filter(r=>r.body.messages[0].content.includes('TURN_ANALYSIS')).length,1);
  let state=[...store.records.values()][0].state;
  assert.equal(state.currentSubState,'ACTION_PLAN');
  assert.match(cloud.requests.find(r=>r.body.stream).body.messages[0].content,/可撤回的小步计划/);
  await c.chat('我现在只想倾诉，不要建议');
  state=[...store.records.values()][0].state;
  assert.equal(state.currentState,'EMPATHY_PHASE');
  assert.notEqual(state.currentSubState,'ACTION_PLAN');
});

test('HTTP recommendation requests do not draw cards, write user facts or call cloud even with a named game',async t=>{
  const cloud=await provider(t),store=new SessionStore(),{url}=await app(t,cloud.env,store),c=client(url);
  for(const message of ['推荐一种联想游戏','推荐一个周易联想游戏','换一种练习']) {
    const result=await c.chat(message);
    assert.equal(result.status,200);
    assert.match(result.events[0].content,/可选的联想入口/);
  }
  assert.equal(cloud.requests.length,0);
  const state=[...store.records.values()][0].state;
  assert.equal(state.tarotDraws||0,0);
  assert.equal(state.reflection,undefined);
  assert.equal((await c.state()).memory.entries.length,0);
});
