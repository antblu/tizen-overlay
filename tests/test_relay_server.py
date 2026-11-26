import http.client
import json
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "server"))
import relay_server  # noqa: E402
import random_test_server  # noqa: E402


class RelayServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = relay_server.RelayConfig(
            read_token="read-only-secret-123",
            producer_token="producer-secret-456",
            cors_origin="https://overlay.local",
            max_body_bytes=1024,
            max_text_chars=50,
        )
        self.store = relay_server.LatestOverlayStore(initial_text="Initial text")
        self.server = relay_server.create_server("127.0.0.1", 0, self.config, self.store)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def _request(self, method: str, path: str, token: str | None = None, body: bytes | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        resp_headers = dict(resp.getheaders())
        conn.close()
        return resp.status, resp_headers, raw

    def test_get_latest_enforces_read_token_and_returns_schema(self) -> None:
        status, _, _ = self._request("GET", "/latest")
        self.assertEqual(status, 401)

        status, _, _ = self._request("GET", "/latest", token="producer-secret-456")
        self.assertEqual(status, 401)

        status, headers, raw = self._request("GET", "/latest", token="read-only-secret-123")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-store")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://overlay.local")
        payload = json.loads(raw.decode("utf-8"))
        self.assertEqual(payload["id"], "init-0")
        self.assertEqual(payload["text"], "Initial text")
        self.assertTrue(payload["updatedAt"].endswith("Z"))

        status_root, _, raw_root = self._request("GET", "/", token="read-only-secret-123")
        self.assertEqual(status_root, 200)
        self.assertEqual(json.loads(raw_root.decode("utf-8"))["id"], "init-0")

    def test_publish_requires_producer_token_and_updates_latest(self) -> None:
        body = json.dumps({"text": "Hello G65B", "id": "resp-42"}).encode("utf-8")

        status, _, _ = self._request("POST", "/publish", token="read-only-secret-123", body=body)
        self.assertEqual(status, 401)

        status, _, raw = self._request("POST", "/publish", token="producer-secret-456", body=body)
        self.assertEqual(status, 200)
        published = json.loads(raw.decode("utf-8"))
        self.assertEqual(published["id"], "resp-42")
        self.assertEqual(published["text"], "Hello G65B")

        status, _, raw = self._request("GET", "/latest", token="read-only-secret-123")
        self.assertEqual(status, 200)
        fetched = json.loads(raw.decode("utf-8"))
        self.assertEqual(fetched["id"], "resp-42")
        self.assertEqual(fetched["text"], "Hello G65B")

    def test_publish_rejects_oversized_and_truncates_long_text(self) -> None:
        too_big = json.dumps({"text": "x" * 2048}).encode("utf-8")
        status, _, _ = self._request("POST", "/publish", token="producer-secret-456", body=too_big)
        self.assertEqual(status, 413)

        within_bytes_over_chars = json.dumps({"text": "a" * 80}).encode("utf-8")
        status, _, raw = self._request("POST", "/publish", token="producer-secret-456", body=within_bytes_over_chars)
        self.assertEqual(status, 200)
        payload = json.loads(raw.decode("utf-8"))
        self.assertEqual(len(payload["text"]), 50)

    def test_options_preflight_headers(self) -> None:
        status, headers, _ = self._request("OPTIONS", "/latest")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://overlay.local")
        self.assertIn("Authorization", headers.get("Access-Control-Allow-Headers", ""))

    def test_https_tls_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            cert_path = pathlib.Path(tmpdir) / "cert.pem"
            key_path = pathlib.Path(tmpdir) / "key.pem"
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-keyout",
                    str(key_path),
                    "-out",
                    str(cert_path),
                    "-days",
                    "1",
                    "-nodes",
                    "-subj",
                    "/CN=127.0.0.1",
                    "-addext",
                    "subjectAltName=IP:127.0.0.1",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            tls_server = relay_server.create_server(
                "127.0.0.1",
                0,
                self.config,
                self.store,
                tls_cert=str(cert_path),
                tls_key=str(key_path),
            )
            tls_port = tls_server.server_address[1]
            tls_thread = threading.Thread(target=tls_server.serve_forever, daemon=True)
            tls_thread.start()
            try:
                client_ctx = ssl.create_default_context(cafile=str(cert_path))
                req = urllib.request.Request(
                    f"https://127.0.0.1:{tls_port}/latest",
                    headers={"Authorization": "Bearer read-only-secret-123"},
                )
                with urllib.request.urlopen(req, context=client_ctx, timeout=5) as resp:
                    self.assertEqual(resp.status, 200)
                    data = json.loads(resp.read().decode("utf-8"))
                    self.assertEqual(data["id"], "init-0")
            finally:
                tls_server.shutdown()
                tls_server.server_close()
                tls_thread.join(timeout=2)

    def test_random_publisher_updates_store(self) -> None:
        store = relay_server.LatestOverlayStore()
        stop_event = threading.Event()
        t = random_test_server.start_random_publisher(store, interval_seconds=0.05, stop_event=stop_event, seed=42)
        try:
            import time
            time.sleep(0.18)
            latest = store.get_latest()
            self.assertIn("[Sample #", latest["text"])
            self.assertNotEqual(latest["id"], "init-0")
        finally:
            stop_event.set()
            t.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
