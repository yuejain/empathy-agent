import unittest
from corpus import clean_text,clean_records,record,weak_labels

class CorpusTests(unittest.TestCase):
    def test_personal_identifiers_and_markup(self):
        text=clean_text('<b>Hello</b> a@example.com +86 13812345678 @person https://example.com/a')
        self.assertNotIn('example.com',text);self.assertNotIn('13812345678',text);self.assertNotIn('@person',text)
        self.assertIn('[EMAIL]',text)
    def test_duplicate_evaluation_has_priority(self):
        source={'id':'s','homepage':'https://example.com','license':'test','label_origin':'human'}
        rows=[record(source,'a','A repeated emotional sentence','en','train'),record(source,'b','A repeated emotional sentence!','en','test')]
        result,stats=clean_records(rows)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['split'],'test');self.assertEqual(stats['duplicates'],1)
    def test_bilingual_weak_labels_not_substrings(self):
        self.assertIn('fear',weak_labels('我担心明天的考试'))
        self.assertIn('fear',weak_labels('I am worried about tomorrow'))
        self.assertNotIn('joy',weak_labels('This is unhappy'))

if __name__=='__main__':unittest.main()
