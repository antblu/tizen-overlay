# Step 1: Sideload & DisplayPort Verification Guide (Odyssey G65B)

This guide covers signing, sideloading, and verifying [test-app/](../test-app/) on a Samsung Odyssey G65B before building the LLM overlay integration.

## 1. Prerequisites on Windows / Tizen Studio

Your Tizen Studio installation at `C:\tizen-studio` currently has the base Web CLI installed, without the Samsung TV extensions or a Samsung certificate profile yet.

1. Open **Tizen Studio Package Manager** (`C:\tizen-studio\package-manager\package-manager.exe`).
2. Under **Extension SDK**, install:
   - **Samsung Certificate Extension**
   - **TV Extensions** (match the Tizen version on your G65B, or install the latest available TV Extensions image/SDK tools).
3. Record your monitor's exact model code and firmware version in [FIRMWARE_TEST_RECORD.md](FIRMWARE_TEST_RECORD.md):
   - On the G65B: **Settings → Support → About This TV** (or **Contact Samsung**).

## 2. Enable Developer Mode & Connect Over LAN

1. Connect the G65B and your PC to the same local network.
2. Note your PC's local IPv4 address (`ipconfig` in PowerShell).
3. On the G65B:
   - Open **Apps** on the Smart Hub.
   - Enter `12345` on the remote (on remotes without a number pad, use the `123` / `123/color` button to bring up the on-screen keypad, then enter `12345`).
   - Toggle **Developer Mode** to **ON**.
   - Enter your PC's local IPv4 address as the **Host PC IP**.
   - Reboot the monitor completely (hold the power button or unplug power briefly so Developer Mode takes effect).
4. Re-open **Apps** → verify the **Developer Mode** badge appears at the top.
5. Connect from Windows PowerShell via SDB:
   ```powershell
   C:\tizen-studio\tools\sdb.exe connect <G65B_IP>:26101
   C:\tizen-studio\tools\sdb.exe devices
   ```
6. Retrieve the monitor's **DUID** (needed for the Samsung distributor certificate):
   ```powershell
   C:\tizen-studio\tools\sdb.exe -s <G65B_IP>:26101 shell 0 getduid
   ```
   *(If `0 getduid` is unavailable on your firmware, open **Device Manager** in Tizen Studio and copy the DUID from the connected monitor's properties.)*

## 3. Create a Samsung Certificate Profile (with G65B DUID)

1. Open **Tizen Studio Certificate Manager** (or run from Tizen Studio IDE).
2. Click **+** → select **Samsung** (NOT Tizen default — Samsung retail monitors reject non-Samsung distributor certificates).
3. Create a **TV** certificate profile:
   - Sign in with your Samsung Account when prompted for the Author and Distributor certificates.
   - Add the G65B's **DUID** to the Distributor certificate device list.
   - Set this new profile as the active profile (note the exact profile name, e.g. `G65B_Profile`).

## 4. Package, Sign, and Install `test-app`

From PowerShell (using the WSL UNC path or a Windows clone path):

```powershell
# Package and sign only:
.\scripts\package-app.ps1 -App test-app -ProfileName "<YOUR_SAMSUNG_PROFILE>"

# Package, sign, install, and launch directly on the G65B:
.\scripts\package-app.ps1 -App test-app -ProfileName "<YOUR_SAMSUNG_PROFILE>" -TargetIp "<G65B_IP>"
```

Manual equivalent (note `tizen install -t` and `tizen run -t` take the SDB device name from `sdb.exe devices`, e.g. `LS27BG652ENXGO`, rather than `<IP>:26101`):

```powershell
C:\tizen-studio\tools\ide\bin\tizen.bat package -t wgt -s "<YOUR_SAMSUNG_PROFILE>" -o dist -- test-app
C:\tizen-studio\tools\ide\bin\tizen.bat install -n "G65B DP Test.wgt" -t "<DEVICE_NAME>" -- dist
C:\tizen-studio\tools\ide\bin\tizen.bat run -p tznOvly001.G65BDpTest -t "<DEVICE_NAME>"
```

## 5. Step 1 Hardware Test Procedure

### A. Baseline DisplayPort Mode (before launching the app)
1. Switch the G65B to its **DisplayPort** input with a moving test pattern on screen (for example, a smooth 60/120/240 Hz motion test, scrolling text, or bouncing window).
2. Note the monitor's active DisplayPort parameters (via G65B Game Bar / OSD and Windows Display Settings):
   - Resolution, Refresh rate, VRR / FreeSync state, HDR state, and Audio output behavior.

### B. Launch from DisplayPort Input
1. With DisplayPort active, open the sideloaded **G65B DP Test** app.
2. On launch, the app automatically:
   - Checks `tizen.systeminfo.getCapability("http://tizen.org/feature/tv.pip")`, `typeof tizen.tvwindow`, and `tizen.tvwindow.getAvailableWindows(...)` (shown in **2. TVWindow API Support** and `console.log`)
   - Calls `tizen.tvwindow.getSource("MAIN")`
   - Calls `tizen.tvwindow.show(..., ["0%", "0%", "100%", "100%"], "MAIN", "BEHIND")`
   - Queries `tizen.systeminfo.getPropertyValue("VIDEOSOURCE")`
3. Check the screen and log:
   - If `["0%", "0%", "100%", "100%"]` fails or doesn't render, try `[2]` (`1920px x 1080px`) and `[3]` (`2560px x 1440px`).
   - Press `[0]` to collapse the diagnostic HUD so only the top-left fixed label remains.

### C. VIDEOSOURCE Connected vs. Disconnected Comparison
1. While DisplayPort is connected, press `[6]` (**Save VIDEOSOURCE Baseline Snapshot**).
2. Unplug the DisplayPort cable from the PC or monitor (or switch PC output off if testing hotplug), wait 3 seconds, and press `[5]` (**Refresh**).
3. Check **4. Baseline Diff** to see whether any `VIDEOSOURCE` entry moved between `connected` and `disconnected` (or changed `signal`).
4. Reconnect DisplayPort, wait 3 seconds, press `[5]`, and select that source entry in **3. VIDEOSOURCE Entries** to test `tizen.tvwindow.setSource(sourceObj, ..., "MAIN")` + `show(..., "BEHIND")`.

### D. HDMI Control Test (if DisplayPort fails)
If DisplayPort video does not appear behind the HTML or `setSource` rejects/misses DisplayPort:
1. Connect the PC (or another source) to **HDMI** on the G65B.
2. Repeat steps B and C on HDMI (`type: "HDMI"`) to verify whether `tv.window` + `BEHIND` works on HDMI on your firmware.

### E. Pass Condition
Record results in [FIRMWARE_TEST_RECORD.md](FIRMWARE_TEST_RECORD.md). Step 1 passes **only** if:
1. Live DisplayPort moving video and the fixed HTML text label appear simultaneously.
2. The behavior survives closing (`Return` / `[7]`) and reopening the app.
3. Resolution, refresh rate, VRR, HDR, and audio match your normal DisplayPort requirements (if the app drops VRR, HDR, refresh rate, or audio you need, treat Step 1 as **FAIL**).
