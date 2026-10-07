import threading, unittest
import numpy as np
from serve import Engine, lexical

class Encoder:
    def encode(self,*args,**kwargs): return np.array([[1.,0.]])
class Head:
    def predict_proba(self,*args): return np.array([[.1,.9]])

class RetrievalTests(unittest.TestCase):
    def engine(self):
        e=Engine.__new__(Engine)
        e.encoder=Encoder();e.encoder_lock=threading.Lock()
        e.head={'heads':[Head()],'labels':['sadness']}
        e.docs=[dict(id=str(i),text='Feeling lonely in a new city',response='I hear you.',source='fixture',
            source_url='https://example.org',license='fixture',language='en',emotions=['sadness'],
            category='human-assistant',group=str(i)) for i in range(5)]
        e.vectors=np.array([[.6,0.]]*5);e.tokens=[lexical(d['text']) for d in e.docs]
        return e
    def test_related_results_are_bounded_and_group_diverse(self):
        e=self.engine();e.docs[4]['group']=e.docs[3]['group']
        hits=e.analyze('Feeling lonely in a new city')['hits']
        self.assertEqual(len(hits),3)
        self.assertEqual(len({e.docs[int(h['id'])]['group'] for h in hits}),3)
    def test_emotion_and_semantic_relevance_are_required(self):
        e=self.engine()
        for d in e.docs: d['emotions']=['joy']
        self.assertEqual(e.analyze('Feeling lonely in a new city')['hits'],[])
        for d in e.docs: d['emotions']=['sadness']
        e.vectors[:]=[.1,0.]
        self.assertEqual(e.analyze('Feeling lonely in a new city')['hits'],[])
    def test_short_queries_do_not_force_citations(self):
        self.assertEqual(self.engine().analyze('Hi')['hits'],[])

if __name__=='__main__':unittest.main()
