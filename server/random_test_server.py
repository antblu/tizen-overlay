#!/usr/bin/env python3
"""Local test program that periodically publishes random plain-text messages
to the relay endpoint so you can verify G65BOverlay live on the monitor.
"""

from __future__ import annotations

import argparse
import os
import random
import secrets
import sys
import threading
import time

import relay_server


SAMPLE_RESPONSES = [
    "Summary: Frame timing steady at 240 Hz. No dropped frames detected in the last interval.",
    "Tip: Check the corner panel opacity in Settings (key 1 or S) if text contrast needs adjustment over bright scenes.",
    "Observation: High-contrast status bar visible at top-left; background window remains unobstructed.",
    "Analysis:\n- Latency: nominal\n- Link: DisplayPort 1\n- Polling: 2000 ms interval with duplicate-ID skip active.",
    "Reminder: Press 0 or Enter on the remote to hide the overlay completely, or Return to exit cleanly.",
    "Note: Long response wrapping check — this multi-sentence message verifies that overflow-wrap and vertical scrolling behave cleanly inside the translucent G65B overlay panel without clipping text at the edges.",
]


def build_random_message(rng: random.Random, counter: int) -> str:
    base = rng.choice(SAMPLE_RESPONSES)
    token = rng.randint(1000, 9999)
    return f"[Sample #{counter} | code={token}]\n{base}"


def start_random_publisher(
    store: relay_server.LatestOverlayStore,
    interval_seconds: float,
    stop_event: threading.Event,
    seed: int | None = None,
) -> threading.Thread:
    rng = random.Random(seed)

    def _loop() -> None:
        counter = 1
        store.publish(text=build_random_message(rng, counter))
        while not stop_event.wait(interval_seconds):
            counter += 1
            store.publish(text=build_random_message(rng, counter))

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local random-text test server for G65BOverlay")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8787, help="Bind port (default: 8787)")
    parser.add_argument("--interval", type=float, default=4.0, help="Seconds between random updates (default: 4.0)")
    parser.add_argument(
        "--read-token",
        default=os.environ.get("OVERLAY_READ_TOKEN", ""),
        help="Read-only bearer token (auto-generated if omitted)",
    )
    parser.add_argument("--tls-cert", default=None, help="Optional PEM TLS certificate")
    parser.add_argument("--tls-key", default=None, help="Optional PEM TLS private key")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.interval <= 0:
        sys.stderr.write("Error: --interval must be positive.\n")
        return 2

    read_token = args.read_token or f"test-read-{secrets.token_hex(8)}"
    producer_token = f"internal-producer-{secrets.token_hex(12)}"

    config = relay_server.RelayConfig(
        read_token=read_token,
        producer_token=producer_token,
        cors_origin="*",
    )
    store = relay_server.LatestOverlayStore(initial_text="Starting random text generator...")
    server = relay_server.create_server(
        host=args.host,
        port=args.port,
        config=config,
        store=store,
        tls_cert=args.tls_cert,
        tls_key=args.tls_key,
    )

    stop_event = threading.Event()
    start_random_publisher(store, interval_seconds=args.interval, stop_event=stop_event)

    scheme = "https" if args.tls_cert else "http"
    print(f"RANDOM_TEST_SERVER_READY", flush=True)
    print(f"URL={scheme}://{args.host}:{args.port}/latest", flush=True)
    print(f"READ_TOKEN={read_token}", flush=True)
    print(f"INTERVAL_SECONDS={args.interval}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
