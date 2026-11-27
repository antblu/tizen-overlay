# Odyssey G65B DisplayPort Overlay

Tizen TV Web applications, packaging tools, and an authenticated relay server for displaying LLM output over a live input on a Samsung Odyssey G65B monitor.

## Repository Layout

- [test-app/](test-app/) — **Step 1** minimal diagnostic Tizen TV Web app (`tv.window` + `VIDEOSOURCE` inspector) to verify live DisplayPort (or HDMI) `MAIN` `BEHIND` video and mode preservation before running the full overlay.
- [overlay-app/](overlay-app/) — **Steps 2 & 3** transparent Tizen TV Web overlay app with configurable HTTPS read URL, read-only bearer credential, 2-second polling with duplicate-ID skip, exponential backoff, stale banner, plain-text wrapping, remote toggle, and clean `Return` exit.
- [server/relay_server.py](server/relay_server.py) — Small authenticated HTTPS relay endpoint (`GET /latest` with read-only token, `POST /publish` with producer token, CORS + `Cache-Control: no-store`).
- [tests/test_relay_server.py](tests/test_relay_server.py) — Unit & TLS integration tests for `relay_server.py`.
- [scripts/package-app.ps1](scripts/package-app.ps1) — PowerShell helper to build, sign, install, and launch either `test-app` or `overlay-app` via Tizen Studio CLI.
- [docs/SIDELOAD_AND_TEST_GUIDE.md](docs/SIDELOAD_AND_TEST_GUIDE.md) — Tizen Studio setup, Developer Mode, Samsung certificate + DUID signing, and Step 1 test procedure.
- [docs/FIRMWARE_TEST_RECORD.md](docs/FIRMWARE_TEST_RECORD.md) — Record template for G65B firmware, `VIDEOSOURCE` output, and display-mode pass/fail.
- [docs/STEALTH_SCREENSHOTS_INTEGRATION.md](docs/STEALTH_SCREENSHOTS_INTEGRATION.md) — Step 2 producer wiring options (existing endpoint vs. `stealth-screenshots` bounded response parser + relay) and Step 3 verification checklist.

## Workflow

1. **Run Step 1 first on your G65B:**
   ```powershell
   .\scripts\package-app.ps1 -App test-app -ProfileName "<YOUR_SAMSUNG_PROFILE>" -TargetIp "<G65B_IP>"
   ```
   Confirm live DisplayPort video renders behind HTML without losing required resolution, refresh rate, VRR, HDR, or audio.
2. **If Step 1 passes (on DisplayPort or acceptable HDMI), sideload `overlay-app`:**
   ```powershell
   .\scripts\package-app.ps1 -App overlay-app -ProfileName "<YOUR_SAMSUNG_PROFILE>" -TargetIp "<G65B_IP>"
   ```
3. **If DisplayPort fails Step 1 and DisplayPort is required:**
   Render the overlay on the Windows PC and send the composed image over DisplayPort.
