from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("jj"), "jj is required for CLI behavior tests")
class SlopflowCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        self.run_raw(["git", "init", "-q"], cwd=self.repo)
        self.run_raw(["git", "remote", "add", "origin", "https://github.com/aivv73/slopflow.git"], cwd=self.repo)
        self.run_raw(["jj", "git", "init", "--colocate"], cwd=self.repo)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_raw(self, args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def slopflow(self, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(REPO_ROOT)
        return subprocess.run(
            [sys.executable, "-m", "slopflow", *args],
            cwd=cwd or self.repo,
            env=env,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_init_creates_machine_config_and_work_root(self) -> None:
        result = self.slopflow("init")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("init:", result.stdout)
        self.assertIn("status: created", result.stdout)
        self.assertIn("repo: aivv73/slopflow", result.stdout)
        self.assertIn("artifact-root: .slopflow/work", result.stdout)
        self.assertIn("next-step: slopflow status", result.stdout)

        config_path = self.repo / ".slopflow" / "config.json"
        work_path = self.repo / ".slopflow" / "work"
        self.assertTrue(config_path.exists())
        self.assertTrue(work_path.is_dir())

        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(
            config,
            {
                "schema_version": 1,
                "artifact_root": ".slopflow/work",
                "issue_tracker": {
                    "type": "github",
                    "repo": "aivv73/slopflow",
                    "prs_as_request_surface": True,
                },
                "vcs": {"type": "jj"},
            },
        )

    def test_init_is_idempotent_for_matching_config(self) -> None:
        first = self.slopflow("init")
        second = self.slopflow("init")

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("status: unchanged", second.stdout)

    def test_init_refuses_incompatible_config_without_force(self) -> None:
        result = self.slopflow("init")
        self.assertEqual(result.returncode, 0, result.stderr)
        config_path = self.repo / ".slopflow" / "config.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["artifact_root"] = ".elsewhere/work"
        config_path.write_text(json.dumps(config), encoding="utf-8")

        blocked = self.slopflow("init")

        self.assertEqual(blocked.returncode, 2)
        self.assertIn("status: blocked", blocked.stderr)
        self.assertIn("differs from detected config", blocked.stderr)
        self.assertIn("slopflow init --force", blocked.stderr)

    def test_init_force_refreshes_incompatible_config(self) -> None:
        self.assertEqual(self.slopflow("init").returncode, 0)
        config_path = self.repo / ".slopflow" / "config.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["artifact_root"] = ".elsewhere/work"
        config_path.write_text(json.dumps(config), encoding="utf-8")

        forced = self.slopflow("init", "--force")

        self.assertEqual(forced.returncode, 0, forced.stderr)
        self.assertIn("status: reinitialized", forced.stdout)
        refreshed = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(refreshed["artifact_root"], ".slopflow/work")

    def test_init_detects_repo_root_from_subdirectory(self) -> None:
        subdir = self.repo / "nested" / "path"
        subdir.mkdir(parents=True)

        result = self.slopflow("init", cwd=subdir)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.repo / ".slopflow" / "config.json").exists())
        self.assertFalse((subdir / ".slopflow" / "config.json").exists())

    def test_status_reports_config_jj_change_and_next_command(self) -> None:
        self.assertEqual(self.slopflow("init").returncode, 0)
        (self.repo / ".slopflow" / "work" / "1").mkdir()

        result = self.slopflow("status")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("status:", result.stdout)
        self.assertIn("state: initialized", result.stdout)
        self.assertIn("repo: aivv73/slopflow", result.stdout)
        self.assertIn("issue_tracker: github", result.stdout)
        self.assertIn("vcs: jj", result.stdout)
        self.assertIn("artifact-root: .slopflow/work", result.stdout)
        self.assertIn("current-jj-change:", result.stdout)
        self.assertIn("active-work-count: 1", result.stdout)
        self.assertIn("next-step: slopflow start <issue-id>", result.stdout)

    def test_status_blocks_before_init(self) -> None:
        result = self.slopflow("status")

        self.assertEqual(result.returncode, 2)
        self.assertIn("status: blocked", result.stderr)
        self.assertIn("Run `slopflow init` first", result.stderr)


if __name__ == "__main__":
    unittest.main()
