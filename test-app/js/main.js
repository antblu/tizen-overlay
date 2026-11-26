(function () {
    "use strict";

    var BASELINE_STORAGE_KEY = "g65b_dp_test_videosource_baseline_v1";
    var MAX_LOG_LINES = 60;

    var state = {
        behindState: "UNKNOWN",
        lastRect: ["0%", "0%", "100%", "100%"],
        mainSource: null,
        videoSources: null,
        baseline: null,
        hudHidden: false,
        focusIndex: 0,
        logLines: []
    };

    var el = {};

    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function nowTime() {
        var d = new Date();
        return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }

    function formatError(err) {
        if (!err) {
            return "Unknown error";
        }
        var parts = [];
        if (err.name) {
            parts.push(err.name);
        }
        if (err.message) {
            parts.push(err.message);
        }
        if (parts.length === 0) {
            try {
                return JSON.stringify(err);
            } catch (e) {
                return String(err);
            }
        }
        return parts.join(": ");
    }

    function log(msg) {
        var line = "[" + nowTime() + "] " + msg;
        state.logLines.unshift(line);
        if (state.logLines.length > MAX_LOG_LINES) {
            state.logLines.length = MAX_LOG_LINES;
        }
        if (el.logBox) {
            el.logBox.textContent = state.logLines.join("\n");
        }
        if (typeof console !== "undefined" && console.log) {
            console.log(line);
        }
    }

    function formatSourceShort(src) {
        if (!src) {
            return "none";
        }
        var sig = typeof src.signal === "boolean" ? " signal=" + src.signal : "";
        return String(src.type) + " #" + String(src.number) + sig;
    }

    function updateFixedLabel() {
        if (!el.labelStatus) {
            return;
        }
        el.labelStatus.textContent =
            "MAIN: " + formatSourceShort(state.mainSource) +
            " | BEHIND: " + state.behindState +
            " | " + nowTime();
    }

    function loadBaselineFromStorage() {
        try {
            var raw = window.localStorage.getItem(BASELINE_STORAGE_KEY);
            if (raw) {
                state.baseline = JSON.parse(raw);
            }
        } catch (e) {
            log("Baseline load skipped: " + formatError(e));
        }
    }

    function saveBaseline() {
        if (!state.videoSources) {
            log("Cannot save baseline: VIDEOSOURCE has not been loaded yet.");
            return;
        }
        state.baseline = {
            savedAt: new Date().toISOString(),
            connected: state.videoSources.connected || [],
            disconnected: state.videoSources.disconnected || []
        };
        try {
            window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(state.baseline));
        } catch (e) {
            log("localStorage save warning: " + formatError(e));
        }
        log("Saved VIDEOSOURCE baseline snapshot.");
        renderBaselineDiff();
    }

    function clearBaseline() {
        state.baseline = null;
        try {
            window.localStorage.removeItem(BASELINE_STORAGE_KEY);
        } catch (e) {
            // Ignore storage errors on restricted runtimes.
        }
        log("Cleared VIDEOSOURCE baseline snapshot.");
        renderBaselineDiff();
    }

    function sourceKey(src) {
        return String(src.type) + ":" + String(src.number);
    }

    function indexSources(list) {
        var map = {};
        var i;
        if (!Array.isArray(list)) {
            return map;
        }
        for (i = 0; i < list.length; i++) {
            map[sourceKey(list[i])] = list[i];
        }
        return map;
    }

    function renderBaselineDiff() {
        if (!el.diffBox) {
            return;
        }
        if (!state.baseline) {
            el.diffBox.textContent =
                "No baseline saved yet. Press [6] with DisplayPort connected, " +
                "then unplug/replug DisplayPort and press [5].";
            return;
        }
        if (!state.videoSources) {
            el.diffBox.textContent = "Baseline saved at " + state.baseline.savedAt + " (waiting for current VIDEOSOURCE).";
            return;
        }

        var prevConn = indexSources(state.baseline.connected);
        var prevDisc = indexSources(state.baseline.disconnected);
        var curConn = indexSources(state.videoSources.connected);
        var curDisc = indexSources(state.videoSources.disconnected);

        var allKeys = {};
        var k;
        for (k in prevConn) { allKeys[k] = true; }
        for (k in prevDisc) { allKeys[k] = true; }
        for (k in curConn) { allKeys[k] = true; }
        for (k in curDisc) { allKeys[k] = true; }

        var changes = [];
        for (k in allKeys) {
            if (!Object.prototype.hasOwnProperty.call(allKeys, k)) {
                continue;
            }
            var beforeLoc = prevConn[k] ? "connected" : (prevDisc[k] ? "disconnected" : "absent");
            var afterLoc = curConn[k] ? "connected" : (curDisc[k] ? "disconnected" : "absent");
            var beforeObj = prevConn[k] || prevDisc[k] || null;
            var afterObj = curConn[k] || curDisc[k] || null;
            var beforeSig = beforeObj && typeof beforeObj.signal !== "undefined" ? String(beforeObj.signal) : "n/a";
            var afterSig = afterObj && typeof afterObj.signal !== "undefined" ? String(afterObj.signal) : "n/a";

            if (beforeLoc !== afterLoc || beforeSig !== afterSig) {
                changes.push(
                    k + ": " + beforeLoc + " (signal=" + beforeSig + ") -> " +
                    afterLoc + " (signal=" + afterSig + ")"
                );
            }
        }

        if (changes.length === 0) {
            el.diffBox.textContent =
                "Baseline (" + state.baseline.savedAt + "): No changes detected vs current VIDEOSOURCE.";
        } else {
            el.diffBox.textContent =
                "Baseline (" + state.baseline.savedAt + ") changes:\n" + changes.join("\n");
        }
    }

    function queryTvWindowSupport() {
        var pipSupported = "unavailable";
        var tvWindowType = typeof tizen !== "undefined" ? typeof tizen.tvwindow : "tizen-undefined";
        var lines = [];

        if (typeof tizen !== "undefined" && tizen.systeminfo && typeof tizen.systeminfo.getCapability === "function") {
            try {
                pipSupported = tizen.systeminfo.getCapability("http://tizen.org/feature/tv.pip");
            } catch (err) {
                pipSupported = "error: " + formatError(err);
            }
        }
        console.log("PiP supported:", pipSupported);
        console.log("TVWindow API:", tvWindowType);
        lines.push("PiP supported (tv.pip): " + String(pipSupported));
        lines.push("TVWindow API (typeof tizen.tvwindow): " + tvWindowType);
        log("PiP supported=" + String(pipSupported) + " | TVWindow API=" + tvWindowType);

        if (el.supportBox) {
            el.supportBox.textContent = lines.join("\n") + "\ngetAvailableWindows(): querying...";
        }

        if (typeof tizen !== "undefined" && tizen.tvwindow && typeof tizen.tvwindow.getAvailableWindows === "function") {
            try {
                tizen.tvwindow.getAvailableWindows(
                    function (windows) {
                        var json = JSON.stringify(windows);
                        console.log(json);
                        log("getAvailableWindows => " + json);
                        if (el.supportBox) {
                            el.supportBox.textContent = lines.join("\n") + "\ngetAvailableWindows(): " + json;
                        }
                    },
                    function (error) {
                        console.log(error.name, error.message);
                        log("getAvailableWindows ERROR: " + formatError(error));
                        if (el.supportBox) {
                            el.supportBox.textContent = lines.join("\n") + "\ngetAvailableWindows() ERROR: " + formatError(error);
                        }
                    }
                );
            } catch (error) {
                console.log(error.name, error.message);
                log("getAvailableWindows THREW: " + formatError(error));
                if (el.supportBox) {
                    el.supportBox.textContent = lines.join("\n") + "\ngetAvailableWindows() THREW: " + formatError(error);
                }
            }
        } else {
            var missingMsg = "getAvailableWindows() unavailable";
            log(missingMsg);
            if (el.supportBox) {
                el.supportBox.textContent = lines.join("\n") + "\n" + missingMsg;
            }
        }
    }

    function queryMainSource() {
        if (typeof tizen === "undefined" || !tizen.tvwindow || typeof tizen.tvwindow.getSource !== "function") {
            state.mainSource = null;
            el.mainSourceBox.textContent = "tizen.tvwindow.getSource is unavailable.";
            updateFixedLabel();
            return;
        }
        try {
            var src = tizen.tvwindow.getSource("MAIN");
            state.mainSource = src;
            el.mainSourceBox.textContent = JSON.stringify(src, null, 2);
            log("getSource('MAIN') => " + formatSourceShort(src));
        } catch (err) {
            state.mainSource = null;
            el.mainSourceBox.textContent = "getSource('MAIN') error: " + formatError(err);
            log("getSource('MAIN') failed: " + formatError(err));
        }
        updateFixedLabel();
    }

    function showMainBehind(rect) {
        state.lastRect = rect.slice();
        if (typeof tizen === "undefined" || !tizen.tvwindow || typeof tizen.tvwindow.show !== "function") {
            state.behindState = "NO_API";
            log("tizen.tvwindow.show is unavailable.");
            updateFixedLabel();
            return;
        }
        try {
            log("Calling tvwindow.show(" + JSON.stringify(rect) + ", 'MAIN', 'BEHIND')...");
            tizen.tvwindow.show(
                function (windowRect, windowType) {
                    state.behindState = "ACTIVE (" + rect.join(",") + ")";
                    log("tvwindow.show SUCCESS type=" + windowType + " rect=" + JSON.stringify(windowRect));
                    updateFixedLabel();
                    queryMainSource();
                },
                function (err) {
                    state.behindState = "ERROR";
                    log("tvwindow.show ERROR: " + formatError(err));
                    updateFixedLabel();
                },
                rect,
                "MAIN",
                "BEHIND"
            );
        } catch (err) {
            state.behindState = "THROW";
            log("tvwindow.show threw: " + formatError(err));
            updateFixedLabel();
        }
    }

    function hideMainWindow() {
        if (typeof tizen === "undefined" || !tizen.tvwindow || typeof tizen.tvwindow.hide !== "function") {
            log("tizen.tvwindow.hide is unavailable.");
            return;
        }
        try {
            tizen.tvwindow.hide(
                function () {
                    state.behindState = "HIDDEN";
                    log("tvwindow.hide('MAIN') SUCCESS.");
                    updateFixedLabel();
                },
                function (err) {
                    log("tvwindow.hide('MAIN') ERROR: " + formatError(err));
                },
                "MAIN"
            );
        } catch (err) {
            log("tvwindow.hide threw: " + formatError(err));
        }
    }

    function setMainSource(sourceObj, bucketName) {
        if (typeof tizen === "undefined" || !tizen.tvwindow || typeof tizen.tvwindow.setSource !== "function") {
            log("tizen.tvwindow.setSource is unavailable.");
            return;
        }
        try {
            log("Calling tvwindow.setSource(" + JSON.stringify(sourceObj) + ", 'MAIN') from " + bucketName + "...");
            tizen.tvwindow.setSource(
                sourceObj,
                function () {
                    log("tvwindow.setSource SUCCESS for " + formatSourceShort(sourceObj));
                    showMainBehind(state.lastRect);
                },
                function (err) {
                    log("tvwindow.setSource ERROR for " + formatSourceShort(sourceObj) + ": " + formatError(err));
                },
                "MAIN"
            );
        } catch (err) {
            log("tvwindow.setSource threw: " + formatError(err));
        }
    }

    function renderVideoSources() {
        if (!el.sourceButtons) {
            return;
        }
        el.sourceButtons.innerHTML = "";

        if (!state.videoSources) {
            el.sourceButtons.innerHTML = "<div class=\"muted\">No VIDEOSOURCE data.</div>";
            el.rawSourcesBox.textContent = "Unavailable";
            renderBaselineDiff();
            return;
        }

        el.rawSourcesBox.textContent = JSON.stringify(state.videoSources, null, 2);

        var groups = [
            { name: "connected", items: state.videoSources.connected || [] },
            { name: "disconnected", items: state.videoSources.disconnected || [] }
        ];

        var totalButtons = 0;
        groups.forEach(function (group) {
            group.items.forEach(function (src) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "btn";
                btn.textContent =
                    "[" + group.name + "] setSource -> " + formatSourceShort(src) +
                    " | raw=" + JSON.stringify(src);
                btn.addEventListener("click", function () {
                    setMainSource(src, group.name);
                });
                el.sourceButtons.appendChild(btn);
                totalButtons += 1;
            });
        });

        if (totalButtons === 0) {
            el.sourceButtons.innerHTML = "<div class=\"muted\">VIDEOSOURCE returned 0 connected and 0 disconnected sources.</div>";
        }

        renderBaselineDiff();
        syncFocusVisual();
    }

    function queryVideoSources() {
        if (typeof tizen === "undefined" || !tizen.systeminfo || typeof tizen.systeminfo.getPropertyValue !== "function") {
            state.videoSources = null;
            el.rawSourcesBox.textContent = "tizen.systeminfo.getPropertyValue is unavailable.";
            el.sourceButtons.innerHTML = "<div class=\"muted\">tizen.systeminfo API unavailable.</div>";
            log("tizen.systeminfo.getPropertyValue is unavailable.");
            return;
        }
        try {
            tizen.systeminfo.getPropertyValue(
                "VIDEOSOURCE",
                function (videoSource) {
                    state.videoSources = {
                        connected: videoSource && videoSource.connected ? videoSource.connected : [],
                        disconnected: videoSource && videoSource.disconnected ? videoSource.disconnected : []
                    };
                    log(
                        "VIDEOSOURCE returned connected=" + state.videoSources.connected.length +
                        ", disconnected=" + state.videoSources.disconnected.length
                    );
                    renderVideoSources();
                },
                function (err) {
                    state.videoSources = null;
                    log("VIDEOSOURCE error: " + formatError(err));
                    renderVideoSources();
                }
            );
        } catch (err) {
            state.videoSources = null;
            log("VIDEOSOURCE threw: " + formatError(err));
            renderVideoSources();
        }
    }

    function refreshAll() {
        queryTvWindowSupport();
        queryMainSource();
        queryVideoSources();
    }

    function toggleHud() {
        state.hudHidden = !state.hudHidden;
        if (state.hudHidden) {
            el.hud.classList.add("hidden");
            log("Switched to Compact Mode (fixed label only). Press 0 or Enter to restore HUD.");
        } else {
            el.hud.classList.remove("hidden");
            log("Restored diagnostic HUD.");
            syncFocusVisual();
        }
    }

    function exitApp() {
        log("Exiting application...");
        if (typeof tizen !== "undefined" && tizen.application) {
            try {
                tizen.application.getCurrentApplication().exit();
                return;
            } catch (err) {
                log("application.exit() error: " + formatError(err));
            }
        }
        window.close();
    }

    function getFocusableButtons() {
        if (state.hudHidden) {
            return [];
        }
        return Array.prototype.slice.call(document.querySelectorAll("#hud button.btn"));
    }

    function syncFocusVisual() {
        var buttons = getFocusableButtons();
        var i;
        if (buttons.length === 0) {
            return;
        }
        if (state.focusIndex < 0) {
            state.focusIndex = 0;
        }
        if (state.focusIndex >= buttons.length) {
            state.focusIndex = buttons.length - 1;
        }
        for (i = 0; i < buttons.length; i++) {
            if (i === state.focusIndex) {
                buttons[i].classList.add("focused");
                buttons[i].focus();
            } else {
                buttons[i].classList.remove("focused");
            }
        }
    }

    function handleAction(action) {
        switch (action) {
            case "show-pct":
                showMainBehind(["0%", "0%", "100%", "100%"]);
                break;
            case "show-1080p":
                showMainBehind(["0px", "0px", "1920px", "1080px"]);
                break;
            case "show-1440p":
                showMainBehind(["0px", "0px", "2560px", "1440px"]);
                break;
            case "hide-main":
                hideMainWindow();
                break;
            case "refresh":
                refreshAll();
                break;
            case "save-baseline":
                saveBaseline();
                break;
            case "clear-baseline":
                clearBaseline();
                break;
            case "toggle-hud":
                toggleHud();
                break;
            case "exit":
                exitApp();
                break;
            default:
                log("Unknown action: " + action);
        }
    }

    function bindUiEvents() {
        var buttons = document.querySelectorAll("#action-buttons button.btn");
        Array.prototype.forEach.call(buttons, function (btn) {
            btn.addEventListener("click", function () {
                handleAction(btn.getAttribute("data-action"));
            });
        });

        document.addEventListener("keydown", function (e) {
            var code = e.keyCode || e.which;
            var key = e.key || "";

            // Samsung TV Remote RETURN key is 10009; Escape is 27.
            if (code === 10009 || code === 27 || key === "XF86Back") {
                e.preventDefault();
                exitApp();
                return;
            }

            if (key === "0" || key === "h" || key === "H") {
                e.preventDefault();
                toggleHud();
                return;
            }

            if (state.hudHidden && (code === 13 || key === "Enter")) {
                e.preventDefault();
                toggleHud();
                return;
            }

            // Number shortcuts 1-7
            if (key >= "1" && key <= "7") {
                var shortcutBtn = document.querySelector('#action-buttons button.btn[data-key="' + key + '"]');
                if (shortcutBtn) {
                    e.preventDefault();
                    handleAction(shortcutBtn.getAttribute("data-action"));
                    return;
                }
            }

            var focusables = getFocusableButtons();
            if (focusables.length === 0) {
                return;
            }

            if (code === 38 || code === 37 || key === "ArrowUp" || key === "ArrowLeft") {
                e.preventDefault();
                state.focusIndex = (state.focusIndex - 1 + focusables.length) % focusables.length;
                syncFocusVisual();
            } else if (code === 40 || code === 39 || key === "ArrowDown" || key === "ArrowRight") {
                e.preventDefault();
                state.focusIndex = (state.focusIndex + 1) % focusables.length;
                syncFocusVisual();
            } else if (code === 13 || key === "Enter") {
                e.preventDefault();
                focusables[state.focusIndex].click();
            }
        });
    }

    function updateEnvInfo() {
        var hasTizen = typeof tizen !== "undefined";
        var hasTvWindow = hasTizen && Boolean(tizen.tvwindow);
        var hasSysInfo = hasTizen && Boolean(tizen.systeminfo);
        el.envInfo.textContent =
            "Viewport: " + window.innerWidth + "x" + window.innerHeight +
            " (dpr=" + (window.devicePixelRatio || 1) + ")" +
            " | Screen: " + screen.width + "x" + screen.height +
            " | tizen.tvwindow=" + hasTvWindow +
            " | tizen.systeminfo=" + hasSysInfo;
    }

    function init() {
        el.labelStatus = document.getElementById("label-status");
        el.hud = document.getElementById("hud");
        el.envInfo = document.getElementById("env-info");
        el.supportBox = document.getElementById("support-box");
        el.mainSourceBox = document.getElementById("main-source-box");
        el.sourceButtons = document.getElementById("source-buttons");
        el.diffBox = document.getElementById("diff-box");
        el.rawSourcesBox = document.getElementById("raw-sources-box");
        el.logBox = document.getElementById("log-box");

        loadBaselineFromStorage();
        updateEnvInfo();
        bindUiEvents();
        syncFocusVisual();
        updateFixedLabel();
        setInterval(updateFixedLabel, 1000);

        log("Test app loaded.");
        queryTvWindowSupport();
        queryMainSource();
        showMainBehind(["0%", "0%", "100%", "100%"]);
        queryVideoSources();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
