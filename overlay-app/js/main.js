(function () {
    "use strict";

    var SETTINGS_STORAGE_KEY = "g65b_overlay_settings_v1";

    var POSITIONS = [
        { value: "top-right", label: "Top Right" },
        { value: "top-left", label: "Top Left" },
        { value: "center", label: "Middle" },
        { value: "middle-left", label: "Middle Left" },
        { value: "bottom-right", label: "Bottom Right" },
        { value: "bottom-center", label: "Bottom Middle" },
        { value: "bottom-left", label: "Bottom Left" }
    ];

    var SIZES = [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
        { value: "full", label: "Extra Large" }
    ];

    var OPACITIES = [
        { value: "0", label: "0% (Text Only)" },
        { value: "0.15", label: "15%" },
        { value: "0.30", label: "30%" },
        { value: "0.45", label: "45%" },
        { value: "0.60", label: "60%" },
        { value: "0.78", label: "78%" },
        { value: "0.90", label: "90%" },
        { value: "1", label: "100%" }
    ];

    var DEFAULT_CONFIG = {
        readUrl: "",
        readToken: "",
        authHeader: "Authorization",
        authScheme: "Bearer",
        pollIntervalMs: 2000,
        maxBackoffMs: 30000,
        requestTimeoutMs: 8000,
        staleAfterMs: 30000,
        maxTextChars: 8192,
        panelPosition: "top-right",
        panelSize: "medium",
        panelOpacity: "0.78",
        allowHttp: false
    };

    var state = {
        config: Object.assign({}, DEFAULT_CONFIG),
        draft: Object.assign({}, DEFAULT_CONFIG),
        panelHidden: false,
        hasOutputText: false,
        settingsOpen: false,
        editingField: false,
        poller: null
    };

    var el = {};

    function bindMainVideoBehind() {
        if (typeof tizen === "undefined" || !tizen.tvwindow || typeof tizen.tvwindow.show !== "function") {
            return;
        }
        try {
            tizen.tvwindow.show(
                function () {},
                function () {},
                ["0%", "0%", "100%", "100%"],
                "MAIN",
                "BEHIND"
            );
        } catch (err) {
            // Keep UI responsive if tvwindow throws transiently on resume.
        }
    }

    function applyVisualPreferences() {
        POSITIONS.forEach(function (p) {
            el.overlayPanel.classList.remove("pos-" + p.value);
        });
        SIZES.forEach(function (s) {
            el.overlayPanel.classList.remove("size-" + s.value);
        });
        el.overlayPanel.classList.add("pos-" + (state.config.panelPosition || "top-right"));
        el.overlayPanel.classList.add("size-" + (state.config.panelSize || "medium"));
        el.overlayPanel.style.setProperty("--panel-alpha", state.config.panelOpacity || "0.78");
    }

    function syncPanelVisibility() {
        if (state.panelHidden || !state.hasOutputText) {
            el.overlayPanel.classList.add("hidden");
        } else {
            el.overlayPanel.classList.remove("hidden");
        }
    }

    function loadSavedSettings() {
        try {
            var raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    Object.assign(state.config, parsed);
                }
            }
        } catch (e) {
            // Ignore storage errors.
        }
    }

    function saveSettingsToStorage() {
        try {
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.config));
        } catch (e) {
            // Ignore storage errors.
        }
    }

    function labelFor(list, value, fallback) {
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].value === value) {
                return list[i].label;
            }
        }
        return fallback;
    }

    function cycleOption(list, current) {
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].value === current) {
                return list[(i + 1) % list.length].value;
            }
        }
        return list[0].value;
    }

    function renderDraftValues() {
        el.valReadUrl.textContent = state.draft.readUrl ? state.draft.readUrl : "Not set";
        el.valReadToken.textContent = state.draft.readToken
            ? (state.draft.readToken.length + " chars")
            : "None";
        el.valAuthHeader.textContent = state.draft.authHeader || "Authorization";
        el.valAuthScheme.textContent = state.draft.authScheme || "(none)";
        el.valPollMs.textContent = String(state.draft.pollIntervalMs || 2000);
        el.valStaleMs.textContent = String(state.draft.staleAfterMs || 30000);
        el.valPosition.textContent = labelFor(POSITIONS, state.draft.panelPosition, "Top Right");
        el.valSize.textContent = labelFor(SIZES, state.draft.panelSize, "Medium");
        el.valOpacity.textContent = labelFor(OPACITIES, String(state.draft.panelOpacity), "78%");
        el.valAllowHttp.textContent = state.draft.allowHttp ? "On" : "Off";
    }

    function commitFieldValue(fieldName, rawValue) {
        if (fieldName === "pollIntervalMs") {
            var pollMs = parseInt(rawValue, 10);
            state.draft.pollIntervalMs = Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000;
        } else if (fieldName === "staleAfterMs") {
            var staleMs = parseInt(rawValue, 10);
            state.draft.staleAfterMs = Number.isFinite(staleMs) && staleMs >= 5000 ? staleMs : 30000;
        } else if (fieldName === "readToken") {
            state.draft.readToken = rawValue;
        } else if (fieldName === "authHeader") {
            state.draft.authHeader = rawValue.trim() || "Authorization";
        } else {
            state.draft[fieldName] = rawValue.trim();
        }
        renderDraftValues();
    }

    function activateInlineEditor(container) {
        if (state.editingField) {
            return;
        }
        var triggerBtn = container.querySelector(".field-trigger");
        var fieldName = container.getAttribute("data-field");
        var inputType = container.getAttribute("data-type") || "text";
        var placeholder = container.getAttribute("data-placeholder") || "";

        var input = document.createElement("input");
        input.type = inputType;
        input.className = "inline-editor";
        input.placeholder = placeholder;
        input.autocomplete = "off";
        input.value = state.draft[fieldName] !== undefined && state.draft[fieldName] !== null
            ? String(state.draft[fieldName])
            : "";

        state.editingField = true;
        triggerBtn.classList.add("hidden");
        container.appendChild(input);

        function finishEdit(saveChange) {
            if (!state.editingField) {
                return;
            }
            state.editingField = false;
            if (saveChange) {
                commitFieldValue(fieldName, input.value);
            }
            if (input.parentNode === container) {
                container.removeChild(input);
            }
            triggerBtn.classList.remove("hidden");
            triggerBtn.focus();
        }

        input.addEventListener("keydown", function (e) {
            var code = e.keyCode || e.which;
            var key = e.key || "";
            if (code === 13 || code === 65376 || key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                finishEdit(true);
            } else if (code === 10009 || code === 27 || code === 65385 || key === "Escape" || key === "XF86Back") {
                e.preventDefault();
                e.stopPropagation();
                finishEdit(false);
            }
        });

        input.addEventListener("blur", function () {
            finishEdit(true);
        });

        input.focus();
    }

    function handlePollerUpdate(payload) {
        var trimmed = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!trimmed) {
            state.hasOutputText = false;
            el.responseText.textContent = "";
            syncPanelVisibility();
            return;
        }
        // Plain-text rendering only (never innerHTML).
        state.hasOutputText = true;
        el.responseText.textContent = payload.text;
        el.responseScroll.scrollTop = 0;
        syncPanelVisibility();
    }

    function toggleOverlayPanel(forceState) {
        state.panelHidden = typeof forceState === "boolean" ? forceState : !state.panelHidden;
        syncPanelVisibility();
    }

    function openSettings() {
        state.draft = Object.assign({}, state.config);
        renderDraftValues();
        el.settingsDiag.textContent = "";
        state.settingsOpen = true;
        el.settingsDrawer.classList.remove("hidden");
        el.btnSaveSettings.focus();
    }

    function closeSettings() {
        state.settingsOpen = false;
        el.settingsDrawer.classList.add("hidden");
    }

    function testReadUrlFromSettings() {
        var draft = state.draft;
        if (!window.OverlayPoller.isAllowedReadUrl(draft.readUrl, draft.allowHttp)) {
            el.settingsDiag.textContent = "Invalid URL (enable Allow HTTP for http://).";
            return;
        }
        el.settingsDiag.textContent = "Testing " + draft.readUrl + " ...";
        var headers = { "Accept": "application/json" };
        if (draft.readToken && draft.authHeader) {
            headers[draft.authHeader] = draft.authScheme
                ? draft.authScheme + " " + draft.readToken
                : draft.readToken;
        }
        fetch(draft.readUrl, { method: "GET", headers: headers, cache: "no-store", mode: "cors" })
            .then(function (resp) {
                if (!resp.ok) {
                    throw new Error("HTTP " + resp.status);
                }
                return resp.text();
            })
            .then(function (rawBody) {
                var parsed = window.OverlayPoller.parseResponseText(rawBody, state.config.maxTextChars);
                el.settingsDiag.textContent = "OK: " + (parsed.text ? parsed.text.slice(0, 60) : "(empty)");
            })
            .catch(function (err) {
                el.settingsDiag.textContent = "Failed: " + (err && err.message ? err.message : String(err));
            });
    }

    function exitApp() {
        if (state.poller) {
            state.poller.stop();
        }
        if (typeof tizen !== "undefined" && tizen.application) {
            try {
                tizen.application.getCurrentApplication().exit();
                return;
            } catch (e) {
                // Fallback to window.close below.
            }
        }
        window.close();
    }

    function moveSettingsFocus(delta) {
        var items = Array.prototype.slice.call(
            el.settingsDrawer.querySelectorAll("button:not(.hidden)")
        );
        if (items.length === 0) {
            return;
        }
        var idx = items.indexOf(document.activeElement);
        if (idx === -1) {
            idx = 0;
        } else {
            idx = (idx + delta + items.length) % items.length;
        }
        items[idx].focus();
    }

    function bindEvents() {
        var fieldItems = document.querySelectorAll("#settings-fields .field-item");
        Array.prototype.forEach.call(fieldItems, function (container) {
            var btn = container.querySelector(".field-trigger");
            btn.addEventListener("click", function () {
                activateInlineEditor(container);
            });
        });

        el.btnCyclePosition.addEventListener("click", function () {
            state.draft.panelPosition = cycleOption(POSITIONS, state.draft.panelPosition);
            renderDraftValues();
        });
        el.btnCycleSize.addEventListener("click", function () {
            state.draft.panelSize = cycleOption(SIZES, state.draft.panelSize);
            renderDraftValues();
        });
        el.btnCycleOpacity.addEventListener("click", function () {
            state.draft.panelOpacity = cycleOption(OPACITIES, String(state.draft.panelOpacity));
            renderDraftValues();
        });
        el.btnToggleHttp.addEventListener("click", function () {
            state.draft.allowHttp = !state.draft.allowHttp;
            renderDraftValues();
        });

        el.btnCloseSettings.addEventListener("click", closeSettings);
        el.btnSaveSettings.addEventListener("click", function () {
            Object.assign(state.config, state.draft);
            saveSettingsToStorage();
            applyVisualPreferences();
            closeSettings();
            state.panelHidden = false;
            syncPanelVisibility();
            state.poller.updateConfig(state.config);
        });
        el.btnTestFetch.addEventListener("click", testReadUrlFromSettings);
        el.btnExitApp.addEventListener("click", exitApp);

        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) {
                bindMainVideoBehind();
                if (state.poller) {
                    state.poller.pollNow();
                }
            }
        });

        window.addEventListener("online", function () {
            if (state.poller) {
                state.poller.pollNow();
            }
        });

        document.addEventListener("keydown", function (e) {
            var code = e.keyCode || e.which;
            var key = e.key || "";

            if (state.editingField) {
                return;
            }

            // Return (10009) or Escape (27)
            if (code === 10009 || code === 27 || key === "XF86Back") {
                e.preventDefault();
                if (state.settingsOpen) {
                    closeSettings();
                } else {
                    exitApp();
                }
                return;
            }

            if (state.settingsOpen) {
                if (code === 38 || key === "ArrowUp") {
                    e.preventDefault();
                    moveSettingsFocus(-1);
                } else if (code === 40 || key === "ArrowDown") {
                    e.preventDefault();
                    moveSettingsFocus(1);
                }
                return;
            }

            // Toggle panel visibility: 0, h/H, Info (457), Red button (403), or Enter
            if (key === "0" || key === "h" || key === "H" || code === 457 || code === 403 || code === 13 || key === "Enter") {
                e.preventDefault();
                toggleOverlayPanel();
                return;
            }

            // Settings drawer: ArrowUp (38), 1, s/S, Menu (10133)
            if (code === 38 || key === "ArrowUp" || key === "1" || key === "s" || key === "S" || code === 10133) {
                e.preventDefault();
                openSettings();
                return;
            }

            // Scroll long plain-text response
            if (code === 37 || key === "ArrowLeft") {
                e.preventDefault();
                el.responseScroll.scrollTop = Math.max(0, el.responseScroll.scrollTop - 80);
            } else if (code === 40 || key === "ArrowDown" || code === 39 || key === "ArrowRight") {
                e.preventDefault();
                el.responseScroll.scrollTop += 80;
            }
        });
    }

    function loadBundledDefaults() {
        return fetch("config.json", { cache: "no-store" })
            .then(function (resp) {
                return resp.ok ? resp.json() : {};
            })
            .catch(function () {
                return {};
            });
    }

    function init() {
        el.overlayPanel = document.getElementById("overlay-panel");
        el.responseScroll = document.getElementById("response-scroll");
        el.responseText = document.getElementById("response-text");
        el.settingsDrawer = document.getElementById("settings-drawer");
        el.btnCloseSettings = document.getElementById("btn-close-settings");
        el.valReadUrl = document.getElementById("val-read-url");
        el.valReadToken = document.getElementById("val-read-token");
        el.valAuthHeader = document.getElementById("val-auth-header");
        el.valAuthScheme = document.getElementById("val-auth-scheme");
        el.valPollMs = document.getElementById("val-poll-ms");
        el.valStaleMs = document.getElementById("val-stale-ms");
        el.valPosition = document.getElementById("val-position");
        el.valSize = document.getElementById("val-size");
        el.valOpacity = document.getElementById("val-opacity");
        el.valAllowHttp = document.getElementById("val-allow-http");
        el.btnCyclePosition = document.getElementById("btn-cycle-position");
        el.btnCycleSize = document.getElementById("btn-cycle-size");
        el.btnCycleOpacity = document.getElementById("btn-cycle-opacity");
        el.btnToggleHttp = document.getElementById("btn-toggle-http");
        el.settingsDiag = document.getElementById("settings-diag");
        el.btnSaveSettings = document.getElementById("btn-save-settings");
        el.btnTestFetch = document.getElementById("btn-test-fetch");
        el.btnExitApp = document.getElementById("btn-exit-app");

        bindEvents();
        bindMainVideoBehind();

        loadBundledDefaults().then(function (bundled) {
            if (bundled && typeof bundled === "object") {
                Object.assign(state.config, bundled);
            }
            loadSavedSettings();
            applyVisualPreferences();
            syncPanelVisibility();

            state.poller = window.OverlayPoller.createPoller({
                readUrl: state.config.readUrl,
                readToken: state.config.readToken,
                authHeader: state.config.authHeader,
                authScheme: state.config.authScheme,
                pollIntervalMs: state.config.pollIntervalMs,
                maxBackoffMs: state.config.maxBackoffMs,
                requestTimeoutMs: state.config.requestTimeoutMs,
                staleAfterMs: state.config.staleAfterMs,
                maxTextChars: state.config.maxTextChars,
                allowHttp: state.config.allowHttp,
                onUpdate: handlePollerUpdate
            });

            if (!window.OverlayPoller.isAllowedReadUrl(state.config.readUrl, state.config.allowHttp)) {
                openSettings();
            }
            state.poller.start();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
