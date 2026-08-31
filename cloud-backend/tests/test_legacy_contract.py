import ast
import hashlib
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_legacy_snapshot_hash_and_ported_contracts() -> None:
    legacy = ROOT / "legacy" / "henry-play5.py"
    expected = (ROOT / "legacy" / "SHA256SUMS").read_text().split()[0]
    assert hashlib.sha256(legacy.read_bytes()).hexdigest() == expected

    tree = ast.parse(legacy.read_text(encoding="utf-8"))
    functions = {node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}
    assert {
        "tool_check_calendar",
        "tool_send_dm",
        "tool_create_event",
        "commit_pending_event",
    } <= functions
