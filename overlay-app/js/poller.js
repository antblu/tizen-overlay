(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.OverlayPoller = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var DEFAULT_MAX_TEXT_CHARS = 8192;

    function isAllowedReadUrl(rawUrl, allowHttp) {
        if (typeof rawUrl !== "string" || !rawUrl.trim()) {
            return false;
        }
        try {
            var parsed = new URL(rawUrl.trim());
            if (parsed.protocol === "https:") {
                return Boolean(parsed.hostname);
            }
            if (allowHttp && parsed.protocol === "http:") {
                return Boolean(parsed.hostname);
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function parseLatestPayload(data, maxTextChars) {
        var limit = typeof maxTextChars === "number" && maxTextChars > 0
            ? maxTextChars
            : DEFAULT_MAX_TEXT_CHARS;

        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Response JSON must be an object");
        }
        if (typeof data.id !== "string" || !data.id.trim()) {
            throw new Error("Missing non-empty string field 'id'");
        }
        if (typeof data.text !== "string") {
            throw new Error("Missing string field 'text'");
        }
        var updatedAt = typeof data.updatedAt === "string" ? data.updatedAt.trim() : "";
        var text = data.text;
        var truncated = false;
        if (text.length > limit) {
            text = text.slice(0, limit) + "\n\n[truncated]";
            truncated = true;
        }
        return {
            id: data.id.trim(),
            text: text,
            updatedAt: updatedAt,
            truncated: truncated
        };
    }

    function computeBackoffMs(consecutiveFailures, baseMs, maxMs, retryAfterHeader) {
        var base = typeof baseMs === "number" && baseMs > 0 ? baseMs : 2000;
        var cap = typeof maxMs === "number" && maxMs >= base ? maxMs : 30000;
        var shift = consecutiveFailures > 0 ? Math.min(consecutiveFailures - 1, 10) : 0;
        var delay = Math.min(base * Math.pow(2, shift), cap);

        if (typeof retryAfterHeader === "string" && /^\d+$/.test(retryAfterHeader.trim())) {
            var retryMs = parseInt(retryAfterHeader.trim(), 10) * 1000;
            if (retryMs > delay) {
                delay = Math.min(retryMs, cap);
            }
        }
        return delay;
    }

    function computeIsStale(lastUpdateEpochMs, staleAfterMs, nowMs, consecutiveFailures) {
        if (consecutiveFailures > 0) {
            return true;
        }
        if (!lastUpdateEpochMs || typeof staleAfterMs !== "number" || staleAfterMs <= 0) {
            return false;
        }
        return (nowMs - lastUpdateEpochMs) >= staleAfterMs;
    }

    function createPoller(options) {
        var opts = Object.assign({
            readUrl: "",
            readToken: "",
            authHeader: "Authorization",
            authScheme: "Bearer",
            pollIntervalMs: 2000,
            maxBackoffMs: 30000,
            requestTimeoutMs: 8000,
            staleAfterMs: 30000,
            maxTextChars: DEFAULT_MAX_TEXT_CHARS,
            allowHttp: false,
            fetchFn: typeof fetch === "function" ? fetch.bind(typeof window !== "undefined" ? window : globalThis) : null,
            nowFn: function () { return Date.now(); },
            onUpdate: function () {},
            onState: function () {}
        }, options || {});

        var timerId = null;
        var activeAbort = null;
        var stopped = true;
        var inFlight = false;
        var lastId = null;
        var lastText = null;
        var lastUpdatedAt = "";
        var lastPayloadEpochMs = 0;
        var consecutiveFailures = 0;
        var lastError = "";

        function emitState() {
            var now = opts.nowFn();
            var stale = computeIsStale(lastPayloadEpochMs, opts.staleAfterMs, now, consecutiveFailures);
            opts.onState({
                running: !stopped,
                configured: isAllowedReadUrl(opts.readUrl, opts.allowHttp),
                consecutiveFailures: consecutiveFailures,
                lastError: lastError,
                lastId: lastId,
                lastUpdatedAt: lastUpdatedAt,
                hasContent: lastText !== null,
                isStale: stale
            });
        }

        function scheduleNext(delayMs) {
            if (stopped) {
                return;
            }
            if (timerId !== null) {
                clearTimeout(timerId);
            }
            timerId = setTimeout(function () {
                timerId = null;
                pollOnce();
            }, delayMs);
        }

        function pollOnce() {
            if (stopped || inFlight) {
                return Promise.resolve();
            }
            if (!isAllowedReadUrl(opts.readUrl, opts.allowHttp)) {
                lastError = opts.readUrl ? "Read URL must use HTTPS (or enable HTTP in settings)" : "Read URL not configured";
                emitState();
                return Promise.resolve();
            }
            if (!opts.fetchFn) {
                lastError = "fetch API unavailable";
                emitState();
                return Promise.resolve();
            }

            inFlight = true;
            var headers = { "Accept": "application/json" };
            if (opts.readToken && opts.authHeader) {
                headers[opts.authHeader] = opts.authScheme
                    ? opts.authScheme + " " + opts.readToken
                    : opts.readToken;
            }

            var controller = typeof AbortController === "function" ? new AbortController() : null;
            activeAbort = controller;
            var timeoutId = null;
            if (controller) {
                timeoutId = setTimeout(function () {
                    controller.abort();
                }, opts.requestTimeoutMs);
            }

            var fetchOptions = {
                method: "GET",
                headers: headers,
                cache: "no-store",
                mode: "cors"
            };
            if (controller) {
                fetchOptions.signal = controller.signal;
            }

            var retryAfterHeader = null;

            return opts.fetchFn(opts.readUrl.trim(), fetchOptions)
                .then(function (resp) {
                    if (resp.headers && typeof resp.headers.get === "function") {
                        retryAfterHeader = resp.headers.get("Retry-After");
                    }
                    if (!resp.ok) {
                        throw new Error("HTTP " + resp.status);
                    }
                    return resp.json();
                })
                .then(function (jsonData) {
                    var parsed = parseLatestPayload(jsonData, opts.maxTextChars);
                    consecutiveFailures = 0;
                    lastError = "";

                    var parsedEpoch = parsed.updatedAt ? Date.parse(parsed.updatedAt) : NaN;
                    lastPayloadEpochMs = Number.isFinite(parsedEpoch) ? parsedEpoch : opts.nowFn();

                    if (parsed.id !== lastId) {
                        lastId = parsed.id;
                        lastText = parsed.text;
                        lastUpdatedAt = parsed.updatedAt;
                        opts.onUpdate(parsed);
                    }
                    emitState();
                    scheduleNext(opts.pollIntervalMs);
                })
                .catch(function (err) {
                    if (stopped) {
                        return;
                    }
                    consecutiveFailures += 1;
                    lastError = err && err.name === "AbortError"
                        ? "Request timed out"
                        : (err && err.message ? err.message : "Network error");
                    emitState();
                    scheduleNext(computeBackoffMs(
                        consecutiveFailures,
                        opts.pollIntervalMs,
                        opts.maxBackoffMs,
                        retryAfterHeader
                    ));
                })
                .then(function () {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                    }
                    activeAbort = null;
                    inFlight = false;
                });
        }

        function start() {
            stopped = false;
            emitState();
            return pollOnce();
        }

        function stop() {
            stopped = true;
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            if (activeAbort) {
                try {
                    activeAbort.abort();
                } catch (e) {
                    // Ignore abort errors.
                }
                activeAbort = null;
            }
            emitState();
        }

        function updateConfig(nextOpts) {
            var wasRunning = !stopped;
            stop();
            Object.assign(opts, nextOpts || {});
            consecutiveFailures = 0;
            lastError = "";
            if (wasRunning) {
                return start();
            }
            emitState();
            return Promise.resolve();
        }

        return {
            start: start,
            stop: stop,
            pollNow: pollOnce,
            updateConfig: updateConfig
        };
    }

    return {
        DEFAULT_MAX_TEXT_CHARS: DEFAULT_MAX_TEXT_CHARS,
        isAllowedReadUrl: isAllowedReadUrl,
        parseLatestPayload: parseLatestPayload,
        computeBackoffMs: computeBackoffMs,
        computeIsStale: computeIsStale,
        createPoller: createPoller
    };
}));
