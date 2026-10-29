#!/usr/bin/env python3
"""Sends invoices to the local upload API and prints what the pipeline decided for each one.

Usage: python scripts/upload-invoice.py demo/build/invoices/01-*.pdf [more files ...]

Reads the API key and the n8n port from .env. Standard library only.
"""
import json
import mimetypes
import pathlib
import secrets
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def upload(url, api_key, path):
    boundary = secrets.token_hex(16)
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n").encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(url, data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}", "X-API-Key": api_key})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    env = read_env(ROOT / ".env")
    url = f"http://localhost:{env.get('N8N_HOST_PORT', '5681')}/webhook/invoices"
    for name in sys.argv[1:]:
        status, result = upload(url, env["UPLOAD_API_KEY"], pathlib.Path(name))
        issues = ", ".join(issue["code"] for issue in result.get("issues") or [])
        print(f"{pathlib.Path(name).name}: HTTP {status}, {result.get('status')}"
              f"{' (' + result['action'] + ')' if result.get('action') not in (None, 'registered') else ''}"
              f"{' - ' + issues if issues else ''}{' - ' + result['message'] if result.get('message') else ''}")


if __name__ == "__main__":
    main()
