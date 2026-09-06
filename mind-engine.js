const MindEngine = {

    WMI: {
        JY: "YAMAHA", JH: "HONDA", "1H": "HONDA", "2H": "HONDA", "3H": "HONDA",
        JN: "NISSAN", "1N": "NISSAN", "3N": "NISSAN",
        JT: "TOYOTA", "1N4": "NISSAN", "3N1": "NISSAN",
        "1G": "GM", WBA: "BMW", WBS: "BMW", WVW: "VW",
        WF0: "FORD", "1F": "FORD", MA3: "SUZUKI", JS1: "SUZUKI",
        ML0: "HARLEY", "5Y": "TESLA", KN: "KIA", KMH: "HYUNDAI",
        VF1: "RENAULT", VF3: "PEUGEOT", WDB: "MERCEDES", WDD: "MERCEDES"
    },

    decodeVin(vin) {
        if (!vin || String(vin).length < 3) return null;
        const v = String(vin).toUpperCase();
        const wmi3 = v.slice(0, 3);
        const wmi2 = v.slice(0, 2);
        const maker = this.WMI[wmi3] || this.WMI[wmi2] || null;
        return { vin: v, wmi: wmi3, maker, yearCode: v[9] || "" };
    },

    isVinChar(b) {
        const c = String.fromCharCode(b);
        return /[A-HJ-NPR-Z0-9]/.test(c);
    },

    extractVins(bytes) {
        const found = [];
        const push = (value, address, step) => {
            if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return;
            if (found.some((v) => v.value === value && v.address === address)) return;
            found.push({
                name: "VIN",
                value,
                address,
                addressText: Hunters.range(address, step === 1 ? 17 : 33),
                width: 17,
                type: "ASCII",
                confidence: step === 1 ? 93 : 86
            });
        };
        const scan = (step) => {
            let text = "";
            let start = -1;
            for (let i = 0; i <= bytes.length - step; i += step) {
                const b = bytes[i];
                const padOk = step === 1 || bytes[i + 1] === 0 || bytes[i + 1] === 0xFF;
                if (padOk && this.isVinChar(b)) {
                    if (start < 0) start = i;
                    text += String.fromCharCode(b);
                    if (text.length === 17) {
                        push(text, start, step);
                        text = "";
                        start = -1;
                    }
                } else {
                    text = "";
                    start = -1;
                }
            }
        };
        scan(1);
        scan(2);
        return found.slice(0, 6);
    },

    invert(stored, formula) {
        if (formula === "X") return stored;
        if (formula === "BCD") return stored;
        const mulSub = String(formula).match(/^X \* (\d+) - (\d+)$/);
        if (mulSub) return (stored + Number(mulSub[2])) / Number(mulSub[1]);
        const mulAdd = String(formula).match(/^X \* (\d+) \+ (\d+)$/);
        if (mulAdd) return (stored - Number(mulAdd[2])) / Number(mulAdd[1]);
        const mul = String(formula).match(/^X \* (\d+)$/);
        if (mul) return stored / Number(mul[1]);
        const div = String(formula).match(/^X \/ (\d+)$/);
        if (div) return stored * Number(div[1]);
        const add = String(formula).match(/^X \+ (\d+)$/);
        if (add) return stored - Number(add[1]);
        const sub = String(formula).match(/^X - (\d+)$/);
        if (sub) return stored + Number(sub[1]);
        return stored;
    },

    looksLikeKm(value) {
        return Number.isFinite(value) && value >= 15 && value <= 400000 && Math.abs(value - Math.round(value)) < 0.51;
    },

    recall(bytes) {
        const db = KnowledgeBase.load();
        const hits = [];
        (db.algorithms || []).forEach((algo) => {
            if (algo.fileSize && algo.fileSize !== bytes.length) return;
            const addrs = algo.addresses && algo.addresses.length ? algo.addresses : (algo.copies || []);
            addrs.forEach((addr) => {
                if (addr + (algo.width || 2) > bytes.length) return;
                const little = algo.endian !== "BE" && algo.endian !== "BCD";
                const stored = algo.endian === "BCD"
                    ? MathEngine.fromBCD(bytes, addr, algo.width)
                    : MathEngine.fromBytes(bytes, addr, algo.width, little);
                if (stored === null) return;
                const km = this.invert(stored, algo.formula);
                if (!this.looksLikeKm(km)) return;
                const rounded = Math.round(km);
                hits.push({
                    fromMemory: true,
                    fromMind: true,
                    label: "KILOMETRAJE",
                    name: algo.name,
                    formula: algo.formula,
                    width: algo.width,
                    endian: algo.endian,
                    copies: addrs,
                    address: addr,
                    addressText: Hunters.range(addr, algo.width),
                    hex: MathEngine.hexBytes(bytes.slice(addr, addr + algo.width)),
                    numeric: rounded,
                    value: rounded,
                    writeHow: algo.writeHow || MathEngine.encodeWriteup(algo.formula, algo.endian, algo.width),
                    confidence: Math.min(97.5, 84 + Math.min(algo.hits || 1, 5) * 2)
                });
            });
        });
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    },

    reasonPair(bytesA, bytesB, kmA, kmB) {
        if (!bytesA || !bytesB || kmA === null || kmB === null) return [];
        if (bytesA.length !== bytesB.length || kmA === kmB) return [];
        const hits = [];
        const seen = new Set();
        const varsA = MathEngine.variantsForValue(kmA);
        const varsB = MathEngine.variantsForValue(kmB);
        const mapB = {};
        varsB.forEach((vb) => {
            mapB[vb.formula + "|" + vb.width + "|" + vb.endian] = vb;
        });
        varsA.forEach((va) => {
            const vb = mapB[va.formula + "|" + va.width + "|" + va.endian];
            if (!vb || va.hex === vb.hex) return;
            const locA = MathEngine.findPattern(bytesA, va.bytes);
            if (!locA.length || locA.length > 16) return;
            const common = locA.filter((addr) => {
                for (let i = 0; i < va.width; i++) {
                    if (bytesB[addr + i] !== vb.bytes[i]) return false;
                }
                return true;
            });
            if (!common.length) return;
            const key = va.formula + "|" + va.width + "|" + common[0];
            if (seen.has(key)) return;
            seen.add(key);
            hits.push({
                fromMind: true,
                fromPair: true,
                label: "KILOMETRAJE",
                name: KnowledgeBase.algorithmName(va.formula, va.width, va.endian),
                formula: va.formula,
                width: va.width,
                endian: va.endian,
                copies: common,
                address: common[0],
                addressText: Hunters.range(common[0], va.width),
                hex: va.hex,
                numeric: kmA,
                value: kmA,
                writeHow: MathEngine.encodeWriteup(va.formula, va.endian, va.width),
                confidence: Math.min(99.3, 92 + Math.min(common.length, 4) * 1.5),
                representation: va.endian + " par demostrado"
            });
        });

        const scales = [
            { formula: "X", fn: (k) => k, width: 2 },
            { formula: "X", fn: (k) => k, width: 3 },
            { formula: "X * 10", fn: (k) => k * 10, width: 3 },
            { formula: "X * 10 - 5", fn: (k) => k * 10 - 5, width: 3 },
            { formula: "X * 100", fn: (k) => k * 100, width: 4 }
        ];
        const n = bytesA.length;
        for (let i = 0; i < n; i++) {
            if (bytesA[i] === bytesB[i]) continue;
            scales.forEach((scale) => {
                if (i + scale.width > n) return;
                const a = MathEngine.fromBytes(bytesA, i, scale.width, true);
                const b = MathEngine.fromBytes(bytesB, i, scale.width, true);
                if (a === null || b === null || a === b) return;
                if (Math.abs(a - scale.fn(kmA)) > 8 || Math.abs(b - scale.fn(kmB)) > 8) return;
                const key = "scale|" + scale.formula + "|" + i;
                if (seen.has(key)) return;
                seen.add(key);
                hits.push({
                    fromMind: true,
                    fromPair: true,
                    label: "KILOMETRAJE",
                    name: KnowledgeBase.algorithmName(scale.formula, scale.width, "LE"),
                    formula: scale.formula,
                    width: scale.width,
                    endian: "LE",
                    copies: [i],
                    address: i,
                    addressText: Hunters.range(i, scale.width),
                    hex: MathEngine.hexBytes(bytesA.slice(i, i + scale.width)),
                    numeric: kmA,
                    value: kmA,
                    writeHow: MathEngine.encodeWriteup(scale.formula, "LE", scale.width),
                    confidence: 95.5,
                    representation: "LE par · " + scale.formula
                });
            });
        }
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    },

    scanRings(bytes) {
        const out = [];
        [0x10, 0x20].forEach((stride) => {
            const pages = [];
            for (let p = 0; p + stride <= bytes.length; p += stride) {
                const v = bytes[p] + (bytes[p + 1] << 8) + ((stride >= 4 ? bytes[p + 2] : 0) << 16);
                if (v < 80 || v > 2500000) continue;
                pages.push({ addr: p, value: v });
            }
            if (pages.length < 6) return;
            let run = 1;
            let bestRun = 1;
            let last = pages[0];
            for (let i = 1; i < pages.length; i++) {
                if (pages[i].addr === last.addr + stride && pages[i].value === last.value + 1) {
                    run++;
                    if (run > bestRun) bestRun = run;
                } else run = 1;
                last = pages[i];
            }
            if (bestRun < 6) return;
            const top = pages.reduce((a, b) => (a.value >= b.value ? a : b));
            const km = Math.round(top.value / 10);
            if (!this.looksLikeKm(km)) return;
            out.push({
                fromMind: true,
                label: "KILOMETRAJE",
                name: "RING_LE24_X10",
                formula: "X * 10",
                width: 3,
                endian: "LE",
                copies: [top.addr],
                address: top.addr,
                addressText: Hunters.range(top.addr, 3),
                hex: MathEngine.hexBytes(bytes.slice(top.addr, top.addr + 3)),
                numeric: km,
                value: km,
                writeHow: "Última página del anillo " + stride + "B: LE24 de décimas.",
                confidence: 78 + Math.min(bestRun, 10),
                representation: "anillo " + stride + "B"
            });
        });
        return out;
    },

    think(ctx) {
        const parts = [];
        if (ctx.vinId && ctx.vinId.maker) {
            parts.push("VIN " + ctx.vinId.vin + " → " + ctx.vinId.maker + " (WMI " + ctx.vinId.wmi + ").");
        } else {
            parts.push("Sin VIN en el dump. No uso el nombre del archivo.");
        }
        if (ctx.familyMatch) {
            parts.push("Estructura = " + ctx.familyMatch.family.id + ".");
        }
        if (ctx.recalled && ctx.recalled.length) {
            parts.push("Memoria: " + ctx.recalled[0].formula + " @ " + ctx.recalled[0].addressText + ".");
        }
        if (ctx.pairHits && ctx.pairHits.length) {
            parts.push("El par demuestra " + ctx.pairHits[0].formula + " en " + ctx.pairHits[0].addressText + ".");
        }
        if (ctx.best) {
            parts.push("Prioridad: " + ctx.best.formula + " · " + (ctx.best.writeHow || "validar copias y checksum") + ".");
        } else {
            parts.push("Siguiente: otro BIN de la misma estructura o un KM conocido.");
        }
        return parts.join(" ");
    }
};
