"""Offline generator tests: synthetic coordinates, no charts, network or provider calls."""
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ltfm_generator', ROOT / 'scripts/build-ltfm-data.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
DATA = json.loads((ROOT / 'src/ltfm-data.json').read_text(encoding='utf-8'))

class GeneratorTests(unittest.TestCase):
    def run_main(self, *args):
        with patch('sys.argv', ['build-ltfm-data.py', *map(str, args)]), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            generator.main()

    def test_all_procedures_and_prior_v2_corrections_match_canonical_data(self):
        stems = ['STAR_01_A', 'SID_01_A', 'IAC_13', 'IAC_15', 'IAC_17']
        texts = {stem: '\n'.join(name + ' 41:00:00N 028:00:00E' for name, row in DATA['fixes'].items() if row['source'] == stem) for stem in stems}
        with patch.object(generator, 'read_inputs', return_value=texts):
            built = generator.build_data(Path('synthetic-inputs-not-read'))
        self.assertEqual(built['procedures'], DATA['procedures'])
        self.assertEqual(built['holds'], DATA['holds'])
        self.assertEqual(built['runways'], DATA['runways'])
        self.assertEqual(built['id'], 'LTFM-SOUTH-v3')

    def test_default_check_never_rewrites_source(self):
        before = (ROOT / 'src/ltfm-data.json').read_bytes()
        with patch.object(generator, 'build_data', return_value=DATA):
            self.run_main()
        self.assertEqual((ROOT / 'src/ltfm-data.json').read_bytes(), before)

    def test_default_check_rejects_generator_drift(self):
        with patch.object(generator, 'build_data', return_value={'id': 'wrong'}):
            with self.assertRaisesRegex(ValueError, 'Generated data differs'):
                self.run_main()

    def test_in_repo_output_is_rejected_before_generation(self):
        with patch.object(generator, 'build_data') as build:
            with self.assertRaises(SystemExit):
                self.run_main('--output', ROOT / 'src/ltfm-data.json')
            build.assert_not_called()

    def test_existing_external_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'existing.json'; output.write_text('preserve')
            with patch.object(generator, 'build_data') as build:
                with self.assertRaises(SystemExit):
                    self.run_main('--output', output)
                build.assert_not_called()
            self.assertEqual(output.read_text(), 'preserve')

    def test_new_external_candidate_does_not_mutate_source(self):
        before = (ROOT / 'src/ltfm-data.json').read_bytes()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'candidate.json'
            with patch.object(generator, 'build_data', return_value=DATA):
                self.run_main('--output', output)
            self.assertEqual(json.loads(output.read_text()), DATA)
        self.assertEqual((ROOT / 'src/ltfm-data.json').read_bytes(), before)

    def test_changed_pdf_is_rejected_before_using_its_text(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'LT_AD_2_LTFM_STAR_01_A_en.pdf').write_bytes(b'changed-pdf')
            with self.assertRaisesRegex(ValueError, 'Frozen source PDF mismatch'):
                generator.read_inputs(Path(folder))

if __name__ == '__main__':
    unittest.main()
