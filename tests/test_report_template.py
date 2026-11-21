"""Check report prose without requiring TeX or external project packages."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('report', Path(__file__).resolve().parents[1]/'scripts/generate_report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReportTemplateTests(unittest.TestCase):
    def setUp(self):
        report.TITLE = 'Python 计算器研究'
        report.DESCRIPTOR = {'type': 'source-analysis'}
        report.project = {
            'contentVersion': '1.0.0', 'analysisDate': '2026-11-21',
            'source': {'label': 'Python / Markdown 计算器快照', 'scope': '计算器源码',
                       'snapshotSha256': 'a'*64,
                       'runtimeNote': '已执行 offline_demo，未连接真实 API。'},
            'method': [], 'policies': [], 'exclusions': [],
        }
        report.manifest = {
            'stats': {'files': 0, 'totalLines': 0, 'symbols': 0,
                      'statusCounts': dict(indexed=0, summary=0, deep=0, pending=0)},
            'files': [], 'modules': [],
        }
        report.chapters = []
        report.content = {'flow': {'title': '输入与计算', 'summary': '按项目说明解读', 'steps': []},
                          'annotations': []}

    def test_non_agent_project_does_not_inherit_agent_claims(self):
        document = report.build_tex()
        self.assertIn(report.tex(report.project['source']['label']), document)
        for claim in ['TypeScript', 'Agent 公式', '模型请求', '工具权限', '会话恢复',
                      '示例系统未运行', '补全可构建工作树', '完整 AST']:
            self.assertNotIn(claim, document)
        self.assertNotIn(r'\section*{结语}', document)

    def test_existing_git_commit_is_preserved(self):
        report.project['source']['commit'] = 'abcdef1234'
        document = report.build_tex()
        self.assertIn('abcdef1234', document)
        self.assertNotIn('未提供 Git 提交号', document)

    def test_runtime_disclosure_comes_from_project_and_is_escaped(self):
        for note in ['已执行 offline_demo，未连接真实 API。', '未执行任何运行验证。']:
            with self.subTest(note=note):
                report.project['source']['runtimeNote'] = note
                document = report.build_tex()
                self.assertIn('报告性质}'+report.tex(note)+r'\par', document)
                self.assertNotIn('RUNTIME_NOTE', document)
                self.assertNotIn('示例系统未运行', document)


if __name__ == '__main__':
    unittest.main()
