# Step 2 Integration Guide: Connecting Producer Output to the Overlay

There are two ways to feed the Tizen overlay app in [overlay-app/](file:///home/antblu/Github/tizen-overlay/overlay-app):

## Option A: Your Custom LLM Endpoint Already Exposes Latest Output

If your custom endpoint already exposes an authenticated HTTPS `GET` route returning:

```json
{
  "id": "resp-123",
  "text": "Plain-text model response...",
  "updatedAt": "2026-11-25T13:45:00Z"
}
```

1. Do **not** modify `stealth-screenshots`.
2. Provision a read-only token for the monitor (keep the LLM write/inference credential on the producer side).
3. Ensure the `GET` route returns CORS headers permitting your Tizen app origin (e.g. `Access-Control-Allow-Origin: *` or your widget origin, `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods: GET, OPTIONS`, and `Cache-Control: no-store`).
4. Enter that HTTPS URL and read-only token in the overlay's **Settings** drawer (`1` or `S`).

## Option B: Use the Relay Server + Add a Bounded Response Parser to `stealth-screenshots`

Right now, [winhttp_client.cpp](file:///home/antblu/Github/stealth-screenshots/src/win/winhttp_client.cpp) drains and discards 2xx response bodies, and [api_contract.hpp](file:///home/antblu/Github/stealth-screenshots/src/core/api_contract.hpp) `ApiResponse` has no response body field.

If you need `stealth-screenshots` to forward the LLM text to the monitor:

1. **Run the relay server ([relay_server.py](file:///home/antblu/Github/tizen-overlay/server/relay_server.py)) behind a trusted HTTPS certificate:**
   - **Important Tizen TLS note:** Samsung Tizen TV browsers/widgets verify TLS against the TV's system CA store and generally reject untrusted self-signed certificates on `fetch()` without throwing a bypass prompt. Place `relay_server.py` behind a reverse proxy with a publicly trusted or Tailscale/Let's Encrypt certificate (e.g., Caddy, Nginx, or `tailscale serve`), or serve TLS directly with a trusted cert.
   - Start with separate tokens:
     ```bash
     OVERLAY_READ_TOKEN="<monitor-read-only-token>" \
     OVERLAY_PRODUCER_TOKEN="<windows-producer-token>" \
     python3 server/relay_server.py --host 127.0.0.1 --port 8443 --allow-insecure-http
     ```
     *(Use `--allow-insecure-http` only behind a local TLS-terminating reverse proxy like Caddy/Nginx/`tailscale serve`, or pass `--tls-cert` and `--tls-key` directly.)*

2. **Extend `stealth-screenshots` (Windows producer):**
   - In `ApiResponse` ([api_contract.hpp](file:///home/antblu/Github/stealth-screenshots/src/core/api_contract.hpp)): add an optional bounded `std::string response_text` (e.g. capped at 64 KiB while reading in `WinHttpApiClient::send_screenshot`).
   - Add a small bounded JSON extractor for the custom LLM response text (e.g., extracting `choices[0].message.content` or `text` without logging the content to disk).
   - On `2xx` in `SessionController::run_loop` ([session_controller.cpp](file:///home/antblu/Github/stealth-screenshots/src/core/session_controller.cpp)), `POST` `{ "text": "<parsed_text>" }` with the producer token (`Authorization: Bearer <OVERLAY_PRODUCER_TOKEN>`) to `https://<your-relay>/publish` asynchronously or right after parsing.

## Step 3 Verification Checklist (Once Sideloaded)

- **Origin & CORS:** Open Settings (`1` / `S`) and click **Test Read URL** to confirm `200 OK` over HTTPS from the sideloaded widget origin (`file://` or `http://localhost` widget origin, depending on Tizen version).
- **Live updates over moving video:** Publish new messages via `POST /publish` and verify text updates within ~2 seconds without disturbing the `MAIN` `BEHIND` video stream.
- **Duplicate ID skipping:** Keep polling without publishing; confirm the UI remains steady with no flicker.
- **Network loss & recovery:** Disconnect network or stop relay -> confirm last response remains visible with the stale/retrying banner and backoff, then recovers automatically when restored.
- **Input disconnect/reconnect & standby:** Unplug/replug DisplayPort and sleep/wake the monitor -> verify `visibilitychange` re-binds `MAIN` `BEHIND` and polling resumes.
- **Remote controls:** Test toggle (`0`/`Enter`), scroll (`Up`/`Down`), Settings (`1`/`S`), and clean exit (`Return`).
