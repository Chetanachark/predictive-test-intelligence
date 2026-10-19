"""Research semantics, source integrity and Streamlit interaction checks."""
import copy
import csv
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import dataLoader
from dataLoader import DataError, PROJECT_ROOT, csv_matches, load_bundle, local_path, validate_history, valid_evaluation, validate_adaptive
from metrics import *
from streamlit.testing.v1 import AppTest

class MetricsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = load_bundle()

    def test_verified_scope_and_denominators(self):
        chosen = filter_history(self.bundle["history"])
        stats = summary(chosen)
        self.assertEqual(stats["executions"], 1166)
        self.assertEqual(stats["failures"], 330)
        self.assertAlmostEqual(stats["failure_rate"], 330/1166)
        self.assertEqual(stats["healing_attempts"], 228)
        self.assertAlmostEqual(stats["healing_success_rate"], 94/228)
        self.assertFalse((chosen.cohort == "Unaudited experiment").any())

    def test_ordinary_negative_validation_is_not_failure(self):
        chosen = filter_history(self.bundle["history"], "Ordinary")
        stats = summary(chosen)
        self.assertEqual(stats["executions"], 204)
        self.assertEqual(stats["failures"], 0)
        self.assertIsNone(stats["healing_success_rate"])
        self.assertEqual(len(risk_rows(self.bundle["intelligence"], chosen)), 34)

    def test_empty_selection_is_unknown_not_zero_rate(self):
        chosen = filter_history(self.bundle["history"], "Ordinary", tests=["PROG-001"])
        self.assertEqual(len(chosen), 0)
        self.assertIsNone(summary(chosen)["failure_rate"])
        self.assertTrue(risk_table([]).empty)
        self.assertTrue(recommendation_table([]).empty)
        self.assertTrue(failure_trend(chosen).empty)

    def test_trends_and_taxonomy_reconcile(self):
        chosen = filter_history(self.bundle["history"])
        counts = failure_counts(chosen)
        trend = failure_trend(chosen)
        self.assertEqual(counts.Failures.sum(), summary(chosen)["failures"])
        self.assertEqual(trend.Failures.sum(), counts.Failures.sum())
        self.assertEqual(trend["Scored attempts"].sum(), len(chosen))
        self.assertTrue(trend.loc[trend["Scored attempts"] == 0, "Failure rate"].isna().all())

    def test_recommendations_are_group_counts_not_failure_counts(self):
        rows = [{"recommendations":["Review","Review"],"failures":{"primaryFailureTypes":["LOCATOR_NOT_FOUND"]}},
                {"recommendations":["Review"],"failures":{"primaryFailureTypes":[]}}]
        table = recommendation_table(rows)
        self.assertEqual(table.Frequency.sum(), 2)
        self.assertIn("No primary failure (evidence/process guidance)", table["Associated failure type"].tolist())

    def test_healing_safety_uses_verified_evaluation(self):
        report = verified_evaluations(self.bundle)[0]
        valid = healing_comparison(report)
        self.assertEqual(valid["Executions"].sum(), 24)
        self.assertEqual(valid["Healing success rate"].tolist(), [.25,.5])
        self.assertEqual(valid["Wrong recoveries"].sum(), 0)
        self.assertEqual(valid["Business defect probes"].sum(), 4)
        broken = copy.deepcopy(report)
        del broken["metrics"]["arms"]["adaptive-healing"]["wrongRecoveries"]
        with self.assertRaises(DataError): validate_adaptive(broken)

    def test_forecasts_abstention_and_holdout_accuracy_are_separate(self):
        report = self.bundle["evaluation"]["cohorts"]["ordinary"]
        self.assertFalse(report["models"])
        forecasts = forecast_table(self.bundle["predictions"], "ordinary", "random_forest")
        self.assertTrue((forecasts.Status == "ABSTAIN").all())
        self.assertTrue(forecasts["Failure probability"].isna().all())
        model = self.bundle["evaluation"]["cohorts"]["progression"]["models"]["random_forest"]
        self.assertEqual(sum(map(sum, model["confusion_matrix"])),192)
        self.assertTrue(all(x["history_end_time"] < x["prediction_time"] for x in model["prediction_evidence"]))

class IntegrityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        row = copy.deepcopy(json.loads((PROJECT_ROOT / "dataset/execution-history.json").read_text())[0])
        self.records = [row]
        self.write_sources()

    def save(self, relative, value):
        file = self.root / relative; file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(value))

    def write_sources(self):
        self.save("dataset/execution-history.json", self.records)
        out = io.StringIO(newline=""); writer=csv.DictWriter(out,fieldnames=list(self.records[0]));writer.writeheader()
        for row in self.records:
            writer.writerow({key:"" if value is None else json.dumps(value,ensure_ascii=False,separators=(',',':')) if isinstance(value,(dict,list,bool)) else value for key,value in row.items()})
        (self.root / "dataset/test-history.csv").write_text(out.getvalue())

    def test_valid_csv_and_read_only_loader(self):
        before = {p:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()}
        bundle = load_bundle(self.root)
        self.assertTrue(bundle["csv_synchronized"])
        self.assertFalse(bundle["evaluation"])
        self.assertEqual(before,{p:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()})

    def test_csv_disagreement_does_not_change_authoritative_json(self):
        csv_file = self.root / 'dataset/test-history.csv';csv_file.write_text(csv_file.read_text().replace('PASS','FAIL'))
        bundle = load_bundle(self.root)
        self.assertFalse(bundle["csv_synchronized"])
        self.assertEqual(bundle["history"].iloc[0].status,'PASS')

    def test_duplicate_missing_and_inconsistent_history_rejected(self):
        for rows in [[self.records[0],self.records[0]], [{}], [{**self.records[0],"status":"FAIL"}], [{**self.records[0],"healing_successful":True}]]:
            with self.assertRaises(DataError): validate_history(rows)

    def test_unsafe_reference_rejected(self):
        with self.assertRaises(DataError): local_path(self.root, '../escape.json')

    def test_malformed_history_fails_clearly(self):
        (self.root / 'dataset/execution-history.json').write_text('{broken')
        with self.assertRaises(DataError): load_bundle(self.root)

    def test_incompatible_training_ids_hidden(self):
        report = {"training_id":"a","cohorts":{}}
        self.save('ml/evaluation-report.json',report)
        self.save('ml/prediction-report.json',{"training_id":"b","predictions":[]})
        self.save('ml/feature-importance.json',{"training_id":"b","cohorts":{}})
        bundle=load_bundle(self.root)
        self.assertFalse(bundle["predictions"]);self.assertFalse(bundle["importance"])
        self.assertTrue(any('different training ID' in x for x in bundle['issues']))

    def test_malformed_optional_reports_hidden(self):
        self.save('ml/evaluation-report.json', {"training_id":"a", "cohorts":{}})
        self.save('ml/feature-importance.json', {"training_id":"a", "cohorts":{"progression":{"random_forest":[{}]}}})
        self.save('ml/prediction-report.json', {"training_id":"a", "predictions":"incorrect"})
        bundle=load_bundle(self.root)
        self.assertFalse(bundle['importance'])
        self.assertFalse(bundle['predictions'])
        self.assertTrue(any('Invalid ML importance' in issue for issue in bundle['issues']))

    def test_invalid_holdout_support_rejected(self):
        broken=copy.deepcopy(json.loads((PROJECT_ROOT/'ml/evaluation-report.json').read_text()))
        broken['cohorts']['progression']['models']['random_forest']['confusion_matrix'][0][0] += 1
        with self.assertRaises(DataError):valid_evaluation(broken)

    def test_missing_sources_app_is_explanatory(self):
        (self.root/'dataset/execution-history.json').unlink()
        with patch.object(dataLoader,'PROJECT_ROOT',self.root):
            app=AppTest.from_file(str(Path(__file__).parent/'app.py'),default_timeout=30).run()
        self.assertFalse(app.exception)
        self.assertTrue(app.error)
        self.assertEqual(len(app.metric),0)

class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.app=AppTest.from_file(str(Path(__file__).parent/'app.py'),default_timeout=30).run()

    def select(self,label):
        return next(item for item in self.app.selectbox if item.label==label)

    def test_chart_rate_scale_and_matrix_labels(self):
        import charts
        import pandas as pd
        figure=charts.bars(pd.DataFrame({"Arm":["Baseline","Adaptive"],"Healing success rate":[.25,.5]}), 'Arm','Healing success rate','Comparison')
        self.assertEqual(figure.layout.yaxis.tickformat,'.0%')
        self.assertEqual(tuple(figure.layout.yaxis.range),(0,1))
        figure=charts.matrix([[168,0],[0,24]])
        self.assertEqual(list(figure.data[0].x),['Predicted PASS','Predicted FAIL'])
        self.assertEqual(list(figure.data[0].y),['Actual PASS','Actual FAIL'])

    def test_default_all_modules_and_charts(self):
        self.assertFalse(self.app.exception)
        self.assertEqual(len(self.app.tabs),7)
        self.assertEqual(len(self.app.get('plotly_chart')),12)
        self.assertEqual(self.app.metric[0].value,'1,166')
        self.assertIn('JSON/CSV synchronized',self.app.expander[0].label)

    def test_ordinary_scope_and_ml_abstention(self):
        self.select('Telemetry scope').set_value('Ordinary').run()
        self.assertEqual(self.app.metric[0].value,'204')
        self.assertEqual(self.app.metric[1].value,'0')
        self.select('ML cohort').set_value('ordinary').run()
        self.assertFalse(self.app.exception)
        self.assertEqual(self.app.metric[4].value,'N/A')

    def test_empty_filtered_selection_retains_independent_ml(self):
        self.select('Telemetry scope').set_value('Ordinary').run()
        next(item for item in self.app.multiselect if item.label=='Test IDs').set_value(['PROG-001']).run()
        self.assertFalse(self.app.exception)
        self.assertEqual(self.app.metric[0].value,'0')
        self.assertEqual(self.app.metric[2].value,'N/A')
        self.assertEqual(self.app.metric[4].value,'100.0%')

if __name__ == '__main__':
    unittest.main()
