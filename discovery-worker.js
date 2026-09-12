importScripts(
    "operation-registry.js",
    "expression-tree.js",
    "math-engine.js",
    "expression-generator.js",
    "fitness-engine.js",
    "validation-engine.js",
    "discovery-manager.js"
);

let cancelled = false;

self.onmessage = function (event) {
    const msg = event.data || {};
    if (msg.type === "DISCOVERY_CANCEL") {
        cancelled = true;
        DiscoveryManager.cancel();
        self.postMessage({ type: "DISCOVERY_CANCELLED", payload: {} });
        return;
    }
    if (msg.type !== "DISCOVERY_START") return;
    cancelled = false;
    const p = msg.payload || {};
    try {
        const results = DiscoveryManager.discoverSync({
            bytes: new Uint8Array(p.bytes || []),
            bytes2: new Uint8Array(p.bytes2 || []),
            bytes3: p.bytes3 && p.bytes3.length ? new Uint8Array(p.bytes3) : null,
            km1: p.km1,
            km2: p.km2,
            km3: p.km3,
            addrs: p.addrs || []
        });
        if (cancelled) {
            self.postMessage({ type: "DISCOVERY_CANCELLED", payload: {} });
            return;
        }
        self.postMessage({ type: "DISCOVERY_COMPLETE", payload: { results: results } });
    } catch (error) {
        self.postMessage({ type: "DISCOVERY_ERROR", payload: { message: String(error.message || error) } });
    }
};
