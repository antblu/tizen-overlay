#!/usr/bin/env python3
"""Small authenticated HTTPS endpoint for Step 2/3 LLM overlay polling.

Separates producer writes (POST /publish with producer token) from monitor
reads (GET /latest with read-only token), returning:
    { "id": "...", "text": "...", "updatedAt": "..." }
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import ssl
import sys
import threading
import uuid
from typing import Any


DEFAULT_MAX_BODY_BYTES = 64 * 1024
DEFAULT_MAX_TEXT_CHARS = 8192


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class LatestOverlayStore:
    """Thread-safe in-memory store for the latest published plain-text payload."""

    def __init__(self, initial_text: str = "Connected. Waiting for first LLM response.") -> None:
        self._lock = threading.Lock()
        self._seq = 0
        self._latest: dict[str, str] = {
            "id": "init-0",
            "text": initial_text,
            "updatedAt": utc_now_iso(),
        }

    def get_latest(self) -> dict[str, str]:
        with self._lock:
            return dict(self._latest)

    def publish(self, text: str, entry_id: str | None = None, updated_at: str | None = None) -> dict[str, str]:
        with self._lock:
            self._seq += 1
            resolved_id = entry_id.strip() if entry_id and entry_id.strip() else f"msg-{self._seq}-{uuid.uuid4().hex[:8]}"
            resolved_ts = updated_at.strip() if updated_at and updated_at.strip() else utc_now_iso()
            self._latest = {
                "id": resolved_id,
                "text": text,
                "updatedAt": resolved_ts,
            }
            return dict(self._latest)


class RelayConfig:
    def __init__(
        self,
        read_token: str,
        producer_token: str,
        cors_origin: str = "*",
        max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
        max_text_chars: int = DEFAULT_MAX_TEXT_CHARS,
    ) -> None:
        self.read_token = read_token
        self.producer_token = producer_token
        self.cors_origin = cors_origin
        self.max_body_bytes = max_body_bytes
        self.max_text_chars = max_text_chars


def extract_bearer_token(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def make_handler(store: LatestOverlayStore, config: RelayConfig) -> type[BaseHTTPRequestHandler]:
    class OverlayRelayHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            # Avoid logging authorization headers or message bodies.
            sys.stderr.write(f"[relay] {self.address_string()} - {fmt % args}\n")

        def _send_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", config.cors_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Expose-Headers", "Retry-After")
            self.send_header("Cache-Control", "no-store")

        def _send_json(self, status: int, payload: dict[str, Any], close_connection: bool = False) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if close_connection:
                self.close_connection = True
            self.send_response(status)
            self._send_cors_headers()
            if close_connection:
                self.send_header("Connection", "close")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _check_token(self, expected_token: str, close_on_fail: bool = False) -> bool:
            provided = extract_bearer_token(self.headers.get("Authorization"))
            if not provided or not hmac.compare_digest(provided, expected_token):
                self._send_json(401, {"error": "Unauthorized"}, close_connection=close_on_fail)
                return False
            return True

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                self._send_json(200, {"ok": True})
                return
            if path not in ("/", "/latest"):
                self._send_json(404, {"error": "Not found"})
                return
            if not self._check_token(config.read_token):
                return
            self._send_json(200, store.get_latest())

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path != "/publish":
                self._send_json(404, {"error": "Not found"}, close_connection=True)
                return
            if not self._check_token(config.producer_token, close_on_fail=True):
                return

            content_length_raw = self.headers.get("Content-Length")
            if content_length_raw is None:
                self._send_json(411, {"error": "Content-Length required"}, close_connection=True)
                return
            try:
                content_length = int(content_length_raw)
            except ValueError:
                self._send_json(400, {"error": "Invalid Content-Length"}, close_connection=True)
                return
            if content_length < 0 or content_length > config.max_body_bytes:
                self._send_json(413, {"error": "Payload too large"}, close_connection=True)
                return

            raw_body = self.rfile.read(content_length)
            try:
                data = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_json(400, {"error": "Invalid JSON body"})
                return

            if not isinstance(data, dict) or not isinstance(data.get("text"), str):
                self._send_json(400, {"error": "JSON object with string 'text' is required"})
                return

            text = data["text"]
            if len(text) > config.max_text_chars:
                text = text[: config.max_text_chars]

            entry_id = data.get("id")
            if entry_id is not None and not isinstance(entry_id, str):
                self._send_json(400, {"error": "'id' must be a string if provided"})
                return

            updated_at = data.get("updatedAt")
            if updated_at is not None and not isinstance(updated_at, str):
                self._send_json(400, {"error": "'updatedAt' must be a string if provided"})
                return

            published = store.publish(text=text, entry_id=entry_id, updated_at=updated_at)
            self._send_json(200, published)

    return OverlayRelayHandler


def create_server(
    host: str,
    port: int,
    config: RelayConfig,
    store: LatestOverlayStore | None = None,
    tls_cert: str | None = None,
    tls_key: str | None = None,
) -> ThreadingHTTPServer:
    active_store = store or LatestOverlayStore()
    handler_cls = make_handler(active_store, config)
    server = ThreadingHTTPServer((host, port), handler_cls)
    if tls_cert or tls_key:
        if not (tls_cert and tls_key):
            server.server_close()
            raise ValueError("Both tls_cert and tls_key must be provided together")
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certfile=tls_cert, keyfile=tls_key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    return server


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authenticated relay server for G65B Tizen overlay")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8443, help="Bind port (default: 8443)")
    parser.add_argument(
        "--read-token",
        default=os.environ.get("OVERLAY_READ_TOKEN", ""),
        help="Read-only bearer token for GET /latest (or OVERLAY_READ_TOKEN env)",
    )
    parser.add_argument(
        "--producer-token",
        default=os.environ.get("OVERLAY_PRODUCER_TOKEN", ""),
        help="Producer bearer token for POST /publish (or OVERLAY_PRODUCER_TOKEN env)",
    )
    parser.add_argument("--cors-origin", default="*", help="Access-Control-Allow-Origin value (default: *)")
    parser.add_argument("--tls-cert", default=None, help="Path to PEM TLS certificate")
    parser.add_argument("--tls-key", default=None, help="Path to PEM TLS private key")
    parser.add_argument("--allow-insecure-http", action="store_true", help="Allow plain HTTP (local testing only)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.read_token or not args.producer_token:
        sys.stderr.write("Error: both --read-token and --producer-token (or env vars) are required.\n")
        return 2
    if hmac.compare_digest(args.read_token, args.producer_token):
        sys.stderr.write("Error: read-only token and producer token must be distinct.\n")
        return 2
    if not (args.tls_cert and args.tls_key) and not args.allow_insecure_http:
        sys.stderr.write("Error: provide --tls-cert and --tls-key for HTTPS, or pass --allow-insecure-http for local dev.\n")
        return 2

    config = RelayConfig(
        read_token=args.read_token,
        producer_token=args.producer_token,
        cors_origin=args.cors_origin,
    )
    server = create_server(
        host=args.host,
        port=args.port,
        config=config,
        tls_cert=args.tls_cert,
        tls_key=args.tls_key,
    )
    scheme = "https" if args.tls_cert else "http"
    sys.stderr.write(f"Listening on {scheme}://{args.host}:{args.port} (GET /latest, POST /publish, GET /healthz)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
