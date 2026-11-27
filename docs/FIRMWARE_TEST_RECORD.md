# Odyssey G65B Firmware & DisplayPort Test Record

Complete this record after running [test-app](../test-app/) on the physical monitor.

## Device Info

- **Exact Model Code:** _(e.g., LS32BG652ENXGO / LS27BG652ENXGO)_
- **Firmware Version:**
- **Tizen Version (if shown):**
- **SDB / Certificate Profile Used:**
- **Test Date:**

## VIDEOSOURCE API Output

### With DisplayPort Connected
```json
{
  "getSource_MAIN": {},
  "VIDEOSOURCE_connected": [],
  "VIDEOSOURCE_disconnected": []
}
```

### With DisplayPort Disconnected
```json
{
  "VIDEOSOURCE_connected": [],
  "VIDEOSOURCE_disconnected": []
}
```

- **Did an entry track DisplayPort connect/disconnect?** `[ ] Yes  [ ] No`
- **Tracked entry (`type`, `number`, `signal`):**
- **Did `tizen.tvwindow.setSource()` succeed with that object?** `[ ] Yes  [ ] No  [ ] N/A`

## DisplayPort Mode & Pass/Fail Matrix

| Check | Normal DisplayPort Baseline | Inside `G65B DP Test` (`BEHIND`) | Pass? |
| --- | --- | --- | --- |
| Moving video visible behind HTML label | — | | `[ ]` |
| Survives close & reopen | — | | `[ ]` |
| Resolution (e.g., 2560x1440) | | | `[ ]` |
| Refresh rate (e.g., 240 Hz / 120 Hz) | | | `[ ]` |
| VRR / Adaptive-Sync / FreeSync | | | `[ ]` |
| HDR | | | `[ ]` |
| Audio | | | `[ ]` |

## HDMI Control Result (Run if DisplayPort Fails)

- **HDMI port tested:**
- **Video behind HTML label works?** `[ ] Yes  [ ] No`
- **Notes (resolution / Hz / VRR / HDR / audio):**

## Decision

- `[ ]` **PASS (DisplayPort):** Proceed to Step 2 & Step 3 (Tizen overlay polling endpoint over HTTPS).
- `[ ]` **FAIL DisplayPort, PASS HDMI:** Decide whether switching the PC input to HDMI is acceptable for Step 2 & Step 3.
- `[ ]` **FAIL DisplayPort & DisplayPort is required:** Pivot to rendering the overlay on Windows and sending the composed frame over DisplayPort.
