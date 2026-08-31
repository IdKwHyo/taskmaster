#!/usr/bin/env python3
"""Create Henry's single-owner Google Calendar OAuth token.

This is intentionally a one-time local bootstrap for the hackathon demo. The
resulting authorized-user JSON belongs in Secret Manager, never in Git.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--client-secrets",
        type=Path,
        required=True,
        help="Downloaded Desktop OAuth client JSON from Google Cloud Console.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("oauth-token.json"),
        help="Local token output. This path is ignored by Git.",
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--force", action="store_true", help="Replace an existing output file.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client_path = args.client_secrets.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if not client_path.is_file():
        raise SystemExit(f"OAuth client file not found: {client_path}")
    if output_path.exists() and not args.force:
        raise SystemExit(f"Refusing to overwrite {output_path}. Pass --force to replace it.")

    flow = InstalledAppFlow.from_client_secrets_file(str(client_path), scopes=SCOPES)
    credentials = flow.run_local_server(
        host="localhost",
        port=args.port,
        open_browser=True,
        access_type="offline",
        prompt="consent",
        success_message="Henry is connected to Google Calendar. You can close this window.",
    )
    output_path.write_text(credentials.to_json(), encoding="utf-8")
    os.chmod(output_path, 0o600)
    print(f"OAuth token saved securely to {output_path}")
    print("Next: upload this file to Secret Manager using docs/google-oauth.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
