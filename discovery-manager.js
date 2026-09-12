const DiscoveryManager = {
    running: false,
    cancelled: false,
    worker: null,
    lastResults: [],

    cancel() {
        this.cancelled = true;
        this.running = false;
        if (this.worker) {
            try { this.worker.postMessage({ type: "DISCOVERY_CANCEL" }); } catch (error) { /* ignore */ }
            try { this.worker.terminate(); } catch (error) { /* ignore */ }
            this.worker = null;
        }
    },

    getResults() {
        return this.lastResults.slice();
    },

    readRaw(bytes, addr, width, little, bcd) {
        if (!bytes || addr < 0 || addr + width > bytes.length) return null;
        if (bcd && typeof MathEngine !== "undefined") return MathEngine.fromBCD(bytes, addr, width);
        return MathEngine.fromBytes(bytes, addr, width, little);
    },

    samplesFromPair(bytes, bytes2, km1, km2, addrs, width, little) {
        return this.samplesFromBins([
            { bytes: bytes, km: km1, name: "BIN1" },
            { bytes: bytes2, km: km2, name: "BIN2" }
        ], addrs, width, little);
    },

    samplesFromBins(bins, addrs, width, little) {
        const rows = [];
        (addrs || []).forEach((addr) => {
            (bins || []).forEach((bin) => {
                if (!bin || !bin.bytes || !bin.km) return;
                const raw = this.readRaw(bin.bytes, addr, width, little, false);
                if (raw === null) return;
                rows.push({ input: bin.km, output: raw, bin: bin.name || "BIN", slack: 40, addr: addr });
            });
        });
        return rows;
    },

    explain(hit) {
        const v = hit.validation || {};
        return "Encontró " + hit.expression + " en 0x" + Number(hit.offset).toString(16).toUpperCase().padStart(4, "0") +
            " · " + hit.length + " bytes " + hit.endian +
            ". Train " + (v.train ? v.train.samplesMatched : 0) +
            " · Validación " + (v.test ? v.test.samplesMatched : 0) +
            " · " + (v.label || "") + " · " + (v.status || "") +
            ". " + (v.independent ? "Validado fuera de las muestras de entrenamiento." : "Aún no es algoritmo confirmado.");
    },

    discoverSync(config) {
        const bins = (config.bins && config.bins.length)
            ? config.bins
            : [
                { bytes: config.bytes, km: config.km1, name: "BIN1" },
                { bytes: config.bytes2, km: config.km2, name: "BIN2" }
            ].concat(config.bytes3 && config.km3 ? [{ bytes: config.bytes3, km: config.km3, name: "BIN3" }] : []);
        const addrs = config.addrs || [];
        if (bins.length < 2 || !addrs.length) return [];
        const widths = config.widths || [2, 3, 4];
        const endians = [
            { id: "LE", little: true },
            { id: "BE", little: false }
        ];
        const found = [];
        const seen = new Set();
        widths.forEach((width) => {
            endians.forEach((en) => {
                const dataset = this.samplesFromBins(bins, addrs, width, en.little);
                if (dataset.length < 2) return;
                const trees = ExpressionGenerator.generate({
                    samples: dataset,
                    maximumDepth: 3,
                    maximumCandidates: 280,
                    timeout: 600,
                    beamWidth: 32
                });
                trees.forEach((tree) => {
                    const fit = FitnessEngine.evaluate(tree, dataset);
                    if (fit.samplesMatched < 2 || fit.accuracy < 70) return;
                    const check = ValidationEngine.validate(tree, dataset);
                    if (check.status === "REJECTED" && check.confidence < 70) return;
                    const expr = ExpressionTree.toMath(tree);
                    const key = expr + "|" + width + "|" + en.id;
                    if (seen.has(key)) return;
                    seen.add(key);
                    const addr = addrs[addrs.length - 1];
                    const hit = {
                        id: key,
                        offset: addr,
                        length: width,
                        format: "UINT" + (width * 8),
                        endian: en.id === "LE" ? "LITTLE_ENDIAN" : "BIG_ENDIAN",
                        expression: expr,
                        tree: tree,
                        fitness: fit,
                        validation: check,
                        confidence: check.confidence,
                        status: check.status,
                        evidence: this.explain({ expression: expr, offset: addr, length: width, endian: en.id === "LE" ? "LE" : "BE", validation: check }),
                        timestamp: Date.now(),
                        version: "V1"
                    };
                    found.push(hit);
                });
            });
        });
        found.sort((a, b) => b.confidence - a.confidence);
        this.lastResults = found.slice(0, 12);
        return this.lastResults;
    },

    start(config, onEvent) {
        const self = this;
        this.cancel();
        this.cancelled = false;
        this.running = true;
        const emit = (type, payload) => {
            if (onEvent) onEvent({ type: type, payload: payload || {} });
        };
        const finish = (results) => {
            self.running = false;
            self.lastResults = results || [];
            emit("DISCOVERY_COMPLETE", { results: self.lastResults });
        };
        try {
            if (typeof Worker !== "undefined" && config && config.useWorker) {
                self.worker = new Worker("discovery-worker.js");
                self.worker.onmessage = function (event) {
                    const msg = event.data || {};
                    if (msg.type === "DISCOVERY_COMPLETE") finish(msg.payload && msg.payload.results);
                    else emit(msg.type, msg.payload);
                };
                self.worker.onerror = function (error) {
                    emit("DISCOVERY_ERROR", { message: String(error.message || error) });
                    finish([]);
                };
                self.worker.postMessage({ type: "DISCOVERY_START", payload: {
                    km1: config.km1,
                    km2: config.km2,
                    km3: config.km3,
                    addrs: config.addrs,
                    bytes: Array.from(config.bytes || []),
                    bytes2: Array.from(config.bytes2 || []),
                    bytes3: Array.from(config.bytes3 || [])
                } });
                return;
            }
        } catch (error) {
            emit("DISCOVERY_ERROR", { message: "Worker no disponible, sigo en el hilo." });
        }
        const results = this.discoverSync(config);
        results.forEach((hit, i) => emit("DISCOVERY_PROGRESS", { pct: ((i + 1) / Math.max(1, results.length)) * 100, hit: hit }));
        if (this.cancelled) emit("DISCOVERY_CANCELLED", {});
        else finish(results);
    }
};
