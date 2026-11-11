"""Minimal tool-using agent: review code, apply the smallest safe fix, run focused tests.

Usage:
    python fix_agent.py /path/to/repo "pytest -x -q" "Describe the bug or failing test here"

Safety:
  - File access is confined to the repo root (no path escapes).
  - The test command is fixed at startup (split with shlex, run WITHOUT a shell);
    the model can only add extra args such as a test path or -k expression.
  - No commit/push tools exist.
"""
import shlex
import subprocess
import sys
from pathlib import Path

import anthropic
from anthropic import beta_tool

MODEL = "claude-fable-5"
MAX_ITERATIONS = 40

ROOT: Path
TEST_CMD: list[str]


def _safe(path: str) -> Path:
    p = (ROOT / path).resolve()
    if p != ROOT and ROOT not in p.parents:
        raise ValueError(f"path escapes repo root: {path}")
    return p


@beta_tool
def list_files(directory: str = ".") -> str:
    """List files under a directory (recursive, skips .git and caches).

    Args:
        directory: Directory relative to the repo root.
    """
    skip = {".git", "__pycache__", "node_modules", ".venv", ".pytest_cache"}
    base = _safe(directory)
    out = [
        str(p.relative_to(ROOT))
        for p in sorted(base.rglob("*"))
        if p.is_file() and not skip & set(p.relative_to(ROOT).parts)
    ]
    return "\n".join(out[:500]) or "(empty)"


@beta_tool
def read_file(path: str) -> str:
    """Read a text file with line numbers.

    Args:
        path: File path relative to the repo root.
    """
    text = _safe(path).read_text(errors="replace")
    return "\n".join(f"{i}\t{line}" for i, line in enumerate(text.splitlines(), 1))


@beta_tool
def grep(pattern: str, directory: str = ".") -> str:
    """Search for a fixed string in files under a directory.

    Args:
        pattern: Literal text to search for.
        directory: Directory relative to the repo root.
    """
    r = subprocess.run(
        ["grep", "-rnF", "--exclude-dir=.git", "--", pattern, str(_safe(directory))],
        capture_output=True, text=True, timeout=30,
    )
    return r.stdout[:20000] or "(no matches)"


@beta_tool
def replace_in_file(path: str, old: str, new: str) -> str:
    """Replace one exact occurrence of `old` with `new` in a file.

    Fails if `old` is missing or appears more than once, which keeps edits small.

    Args:
        path: File path relative to the repo root.
        old: Exact existing text (must be unique in the file).
        new: Replacement text.
    """
    p = _safe(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        return f"ERROR: expected exactly 1 match, found {count}"
    p.write_text(text.replace(old, new))
    return "ok"


@beta_tool
def run_tests(extra_args: str = "") -> str:
    """Run the configured test command, optionally narrowed with extra args.

    Args:
        extra_args: Extra arguments such as a test path or -k expression, e.g. "tests/test_x.py -k parse".
    """
    r = subprocess.run(
        TEST_CMD + shlex.split(extra_args),
        cwd=ROOT, capture_output=True, text=True, timeout=600,
    )
    return f"exit={r.returncode}\n{(r.stdout + r.stderr)[-12000:]}"


SYSTEM = """You are a senior engineer making a minimal bug fix in an existing repo.
1. Reproduce the problem first with the narrowest failing test.
2. Read the relevant code and find the root cause before editing.
3. Apply the smallest change that fixes the root cause; no refactors or formatting changes.
4. Run the focused tests for the changed area, then directly related tests.
5. If a test fails or you are unsure, say so instead of guessing.
Finish with: Root cause, Change (files + summary), Tests (commands + results), Risks/follow-ups.
Do not commit or push."""


def main() -> int:
    global ROOT, TEST_CMD
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    ROOT = Path(sys.argv[1]).resolve()
    TEST_CMD = shlex.split(sys.argv[2])
    task = sys.argv[3]

    client = anthropic.Anthropic()
    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=16000,
        output_config={"effort": "medium"},
        system=SYSTEM,
        tools=[list_files, read_file, grep, replace_in_file, run_tests],
        messages=[{"role": "user", "content": f"Repository: {ROOT}\nTask: {task}"}],
        max_iterations=MAX_ITERATIONS,
    )

    last = None
    for message in runner:
        last = message
        if message.stop_reason == "refusal":
            print(f"Model declined (stop_details={message.stop_details}).")
            return 1
    if last is None:
        return 1
    for block in last.content:
        if block.type == "text":
            print(block.text)
    if last.stop_reason == "max_tokens":
        print("\n[output truncated: raise max_tokens]")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
