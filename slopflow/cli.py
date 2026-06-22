from __future__ import annotations

import argparse
import configparser
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
DEFAULT_ARTIFACT_ROOT = ".slopflow/work"
DEFAULT_PRS_AS_REQUEST_SURFACE = True


class SlopflowError(Exception):
    def __init__(self, message: str, *, hint: str | None = None, code: int = 1) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.code = code


@dataclass(frozen=True)
class RepoContext:
    root: Path
    github_repo: str


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "init":
            return init_command(force=args.force)
        if args.command == "status":
            return status_command()
    except SlopflowError as error:
        print_block(
            "error",
            {
                "status": "blocked",
                "message": error.message,
                **({"hint": error.hint} if error.hint else {}),
            },
            stream=sys.stderr,
        )
        return error.code

    parser.print_help()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="slopflow",
        description="Controlled issue execution CLI-runbook for AI coding agents.",
    )
    subparsers = parser.add_subparsers(dest="command")

    init_parser = subparsers.add_parser("init", help="Initialize Slopflow machine config")
    init_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite incompatible existing Slopflow machine config",
    )

    subparsers.add_parser("status", help="Print compact Slopflow project status")
    return parser


def init_command(*, force: bool) -> int:
    repo = discover_repo_context(Path.cwd())
    config_path = repo.root / ".slopflow" / "config.json"
    work_path = repo.root / DEFAULT_ARTIFACT_ROOT
    desired = desired_config(repo.github_repo)

    action = "created"
    if config_path.exists():
        existing = read_json(config_path)
        if existing == desired:
            action = "unchanged"
        elif not force:
            raise SlopflowError(
                "Existing .slopflow/config.json differs from detected config.",
                hint="Re-run with `slopflow init --force` to intentionally refresh machine config.",
                code=2,
            )
        else:
            action = "reinitialized"

    if action != "unchanged":
        config_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(config_path, desired)
    work_path.mkdir(parents=True, exist_ok=True)

    print_block(
        "init",
        {
            "status": action,
            "repo": repo.github_repo,
            "vcs": "jj",
            "config": relative_to_cwd(config_path),
            "artifact-root": desired["artifact_root"],
            "next-step": "slopflow status",
        },
    )
    return 0


def status_command() -> int:
    root = find_repo_root(Path.cwd())
    if root is None:
        raise SlopflowError(
            "Could not find a repository root.",
            hint="Run Slopflow inside a Jujutsu repository.",
            code=2,
        )
    config_path = root / ".slopflow" / "config.json"
    if not config_path.exists():
        raise SlopflowError(
            "Slopflow machine config is missing.",
            hint="Run `slopflow init` first.",
            code=2,
        )

    config = read_json(config_path)
    artifact_root = str(config.get("artifact_root", DEFAULT_ARTIFACT_ROOT))
    work_root = root / artifact_root
    active_work_dirs = count_work_dirs(work_root)
    current_change = read_current_jj_change(root)

    issue_tracker = config.get("issue_tracker", {})
    vcs = config.get("vcs", {})
    print_block(
        "status",
        {
            "state": "initialized",
            "repo": issue_tracker.get("repo", "unknown"),
            "issue_tracker": issue_tracker.get("type", "unknown"),
            "vcs": vcs.get("type", "unknown"),
            "artifact-root": artifact_root,
            "current-jj-change": current_change,
            "active-work-count": active_work_dirs,
            "next-step": "slopflow start <issue-id>",
        },
    )
    return 0


def discover_repo_context(start: Path) -> RepoContext:
    root = find_repo_root(start)
    if root is None:
        raise SlopflowError(
            "Could not find a repository root.",
            hint="Run `slopflow init` inside a Jujutsu repository with a GitHub origin remote.",
            code=2,
        )
    if not (root / ".jj").exists():
        raise SlopflowError(
            "Jujutsu repository not detected.",
            hint="Initialize Jujutsu first; Slopflow v0 only supports jj-backed work.",
            code=2,
        )
    if shutil.which("jj") is None:
        raise SlopflowError(
            "Jujutsu executable not found.",
            hint="Install `jj` before running `slopflow init`.",
            code=2,
        )
    github_repo = read_github_repo(root)
    return RepoContext(root=root, github_repo=github_repo)


def find_repo_root(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".jj").exists() or (candidate / ".git").exists():
            return candidate
    return None


def read_github_repo(root: Path) -> str:
    config_path = git_config_path(root)
    if not config_path.exists():
        raise SlopflowError(
            "Git config not found for GitHub remote detection.",
            hint="Use a colocated Jujutsu/Git repository with an origin remote.",
            code=2,
        )

    parser = configparser.ConfigParser()
    parser.read(config_path)
    section = 'remote "origin"'
    if not parser.has_section(section) or not parser.has_option(section, "url"):
        raise SlopflowError(
            "GitHub origin remote not found.",
            hint="Set origin to a GitHub repository before running `slopflow init`.",
            code=2,
        )

    url = parser.get(section, "url")
    repo = parse_github_remote(url)
    if repo is None:
        raise SlopflowError(
            f"Origin remote is not a supported GitHub URL: {url}",
            hint="Use https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git.",
            code=2,
        )
    return repo


def git_config_path(root: Path) -> Path:
    dot_git = root / ".git"
    if dot_git.is_dir():
        return dot_git / "config"
    if dot_git.is_file():
        content = dot_git.read_text(encoding="utf-8", errors="replace").strip()
        prefix = "gitdir:"
        if content.lower().startswith(prefix):
            gitdir = content[len(prefix) :].strip()
            gitdir_path = Path(gitdir)
            if not gitdir_path.is_absolute():
                gitdir_path = root / gitdir_path
            return gitdir_path / "config"
    return dot_git / "config"


def parse_github_remote(url: str) -> str | None:
    patterns = [
        r"^https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/?$",
        r"^git@github\.com:(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
        r"^ssh://git@github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/?$",
    ]
    for pattern in patterns:
        match = re.match(pattern, url)
        if match:
            return f"{match.group('owner')}/{match.group('repo')}"
    return None


def desired_config(github_repo: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_root": DEFAULT_ARTIFACT_ROOT,
        "issue_tracker": {
            "type": "github",
            "repo": github_repo,
            "prs_as_request_surface": DEFAULT_PRS_AS_REQUEST_SURFACE,
        },
        "vcs": {"type": "jj"},
    }


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SlopflowError(
            f"Invalid JSON in {path}.",
            hint=str(error),
            code=2,
        ) from error


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def count_work_dirs(work_root: Path) -> int:
    if not work_root.exists():
        return 0
    return sum(1 for child in work_root.iterdir() if child.is_dir())


def read_current_jj_change(root: Path) -> str:
    try:
        result = subprocess.run(
            ["jj", "--no-pager", "status"],
            cwd=root,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        return "unavailable: jj not found"
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "jj status failed"
        return f"unavailable: {detail}"
    for line in result.stdout.splitlines():
        if "Working copy" in line and "(@)" in line:
            _, _, remainder = line.partition(":")
            return remainder.strip()
    return "unknown"


def relative_to_cwd(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def print_block(name: str, values: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    print(f"{name}:", file=stream)
    for key, value in values.items():
        print(f"  {key}: {value}", file=stream)
