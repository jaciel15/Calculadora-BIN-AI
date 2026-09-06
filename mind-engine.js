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

    vinCharAt(bytes, start, index, layout) {
        let addr;
        if (layout.id === "SWAP16") addr = start + (index ^ 1);
        else addr = start + index * layout.step;
        if (addr < 0 || addr >= bytes.length) return { addr: -1, ch: "", pad: null };
        if (layout.step === 2 && layout.pad !== null && layout.pad !== undefined) {
            const padAddr = addr + 1;
            if (padAddr >= bytes.length || bytes[padAddr] !== layout.pad) {
                return { addr, ch: "", pad: padAddr };
            }
        }
        const b = bytes[addr];
        if (!this.isVinChar(b)) return { addr, ch: "", pad: null };
        return { addr, ch: String.fromCharCode(b), pad: layout.step === 2 ? addr + 1 : null };
    },

    readVin(bytes, start, layout) {
        let value = "";
        const slots = [];
        for (let i = 0; i < 17; i++) {
            const slot = this.vinCharAt(bytes, start, i, layout);
            if (!slot.ch) return null;
            value += slot.ch;
            slots.push(slot);
        }
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return null;
        const last = slots[16];
        const span = (last.pad !== null && last.pad !== undefined ? last.pad : last.addr) - start + 1;
        return { value, slots, span: Math.max(17, span), layout };
    },

    cleanVin(vin) {
        return String(vin || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    },

    encodeVinVariants(vin) {
        const text = this.cleanVin(vin);
        if (text.length < 3) return [];
        const chars = Array.from(text).map((ch) => ch.charCodeAt(0));
        const out = [];
        const add = (id, label, arr, extra) => {
            extra = extra || {};
            out.push(Object.assign({
                id,
                label,
                bytes: Uint8Array.from(arr),
                span: arr.length,
                step: extra.step || 1,
                xor: extra.xor || 0,
                pad: extra.pad
            }, extra));
        };
        add("PACKED", "ASCII seguido · " + text.length + " letras", chars, { step: 1 });
        const pad = (p) => {
            const arr = [];
            chars.forEach((c) => { arr.push(c); arr.push(p); });
            return arr;
        };
        add("PAD00", "letra + 00", pad(0), { step: 2, pad: 0 });
        add("PADFF", "letra + FF", pad(0xFF), { step: 2, pad: 0xFF });
        const swapped = chars.slice();
        for (let i = 0; i + 1 < swapped.length; i += 2) {
            const tmp = swapped[i];
            swapped[i] = swapped[i + 1];
            swapped[i + 1] = tmp;
        }
        add("SWAP16", "words intercambiados", swapped, { step: 1 });
        [0xFF, 0x55, 0xAA, 0x7F].forEach((mask) => {
            add("XOR" + mask.toString(16).toUpperCase(), "ASCII XOR " + mask.toString(16).toUpperCase(), chars.map((c) => c ^ mask), { step: 1, xor: mask });
        });
        return out;
    },

    huntKnownVin(bytes, vin) {
        const text = this.cleanVin(vin);
        const hits = [];
        this.encodeVinVariants(text).forEach((variant) => {
            const locs = MathEngine.findPattern(bytes, variant.bytes);
            if (!locs.length) return;
            hits.push({
                name: "VIN",
                value: text,
                address: locs[0],
                addressText: Hunters.range(locs[0], variant.span),
                width: variant.span,
                span: variant.span,
                step: variant.step,
                pad: variant.pad,
                xor: variant.xor || 0,
                layout: variant.id,
                layoutLabel: variant.label,
                copies: locs.slice(),
                type: "ASCII",
                formula: "VIN_" + variant.id,
                endian: "ASCII",
                writeHow: "VIN propio: " + variant.label + " en " + locs.length + " copias. No usa el KM.",
                confidence: Math.min(99.4, 90 + Math.min(locs.length, 4) * 2)
            });
        });
        return hits.sort((a, b) => b.confidence - a.confidence);
    },

    reasonVinPair(bytesA, bytesB, vinA, vinB) {
        if (!bytesA || !bytesB || !vinA || !vinB) return [];
        const a = this.cleanVin(vinA);
        const b = this.cleanVin(vinB);
        if (a.length < 3 || b.length < 3 || a === b) return [];
        const varsA = this.encodeVinVariants(a);
        const varsB = this.encodeVinVariants(b);
        const hits = [];
        varsA.forEach((va) => {
            const vb = varsB.find((item) => item.id === va.id);
            if (!vb) return;
            const locs = MathEngine.findPattern(bytesA, va.bytes).filter((addr) => {
                for (let i = 0; i < vb.bytes.length; i++) {
                    if (bytesB[addr + i] !== vb.bytes[i]) return false;
                }
                return true;
            });
            if (!locs.length) return;
            hits.push({
                name: "VIN",
                value: a,
                address: locs[0],
                addressText: Hunters.range(locs[0], va.span),
                width: va.span,
                span: va.span,
                step: va.step,
                pad: va.pad,
                xor: va.xor || 0,
                layout: va.id,
                layoutLabel: va.label,
                copies: locs,
                type: "ASCII",
                formula: "VIN_" + va.id,
                endian: "ASCII",
                fromPair: true,
                writeHow: "Par demostrado: misma plantilla VIN en ambos BIN, " + va.label + ".",
                confidence: Math.min(99.6, 94 + Math.min(locs.length, 3) * 1.5)
            });
        });
        return hits.sort((x, y) => y.confidence - x.confidence);
    },

    vinHeart(bytes, knownVin) {
        if (knownVin && this.cleanVin(knownVin).length >= 6) {
            const known = this.huntKnownVin(bytes, knownVin);
            if (known.length) return known;
        }
        const layouts = [
            { id: "PACKED", step: 1, pad: null, label: "17 ASCII seguidos" },
            { id: "PAD00", step: 2, pad: 0, label: "letra + 00 · 17 veces" },
            { id: "PADFF", step: 2, pad: 0xFF, label: "letra + FF · 17 veces" },
            { id: "SWAP16", step: 1, pad: null, label: "ASCII con words intercambiados" }
        ];
        const found = [];
        layouts.forEach((layout) => {
            const need = layout.id === "SWAP16" ? 18 : 17 * layout.step;
            const max = bytes.length - need + 1;
            for (let i = 0; i < max; i++) {
                const read = this.readVin(bytes, i, layout);
                if (!read) continue;
                found.push({
                    name: "VIN",
                    value: read.value,
                    address: i,
                    addressText: Hunters.range(i, read.span),
                    width: read.span,
                    span: read.span,
                    step: layout.step,
                    pad: layout.pad,
                    xor: 0,
                    layout: layout.id,
                    layoutLabel: layout.label,
                    slots: read.slots,
                    type: "ASCII",
                    formula: "VIN_" + layout.id,
                    endian: "ASCII",
                    confidence: layout.id === "PACKED" ? 94 : 88
                });
                i += Math.max(1, read.span) - 1;
            }
        });
        const grouped = [];
        found.forEach((hit) => {
            let group = grouped.find((g) => g.value === hit.value && g.layout === hit.layout);
            if (!group) {
                group = Object.assign({ copies: [], slotsAll: [] }, hit);
                grouped.push(group);
            }
            if (group.copies.indexOf(hit.address) === -1) group.copies.push(hit.address);
        });
        grouped.forEach((group) => {
            group.copies.sort((a, b) => a - b);
            group.address = group.copies[0];
            group.addressText = Hunters.range(group.address, group.span);
            group.confidence = Math.min(99.2, group.confidence + Math.min(group.copies.length, 4) * 1.6);
            group.writeHow = "VIN propio: escribe las 17 letras en " + group.layoutLabel +
                ", en " + group.copies.length + " copias. No usa la fórmula del KM.";
            const after = group.address + group.span;
            if (after < bytes.length) {
                let sum = 0;
                for (let i = 0; i < 17; i++) {
                    const slot = this.vinCharAt(bytes, group.address, i, { id: group.layout, step: group.step, pad: group.pad });
                    if (slot.addr >= 0) sum = (sum + bytes[slot.addr]) & 0xFF;
                }
                if (bytes[after] === sum) {
                    group.checksum = { name: "SUM8", storedAt: after, size: 1, endian: "LE", start: group.address, end: after };
                }
            }
        });
        return grouped.sort((a, b) => b.confidence - a.confidence);
    },

    extractVins(bytes, knownVin) {
        return this.vinHeart(bytes, knownVin).slice(0, 8);
    },

    invert(stored, formula) {
        return MathEngine.invertFormula(stored, formula);
    },

    looksLikeKm(value) {
        return Number.isFinite(value) && value >= 15 && value <= 400000 && Math.abs(value - Math.round(value)) < 0.51;
    },

    recall(bytes) {
        const db = KnowledgeBase.load();
        const hits = [];
        (db.algorithms || []).forEach((algo) => {
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
                    confidence: Math.min(98.8, (algo.savedByUser ? 90 : 84) + Math.min(algo.hits || 1, 5) * 2 + (algo.checksums && algo.checksums.length ? 2 : 0)),
                    familyId: algo.familyId,
                    checksums: algo.checksums || []
                });
            });
        });
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    },

    pairScales() {
        return [
            { formula: "X", fn: (k) => k, widths: [2, 3, 4] },
            { formula: "X * 10", fn: (k) => k * 10, widths: [2, 3, 4] },
            { formula: "X * 10 - 1", fn: (k) => k * 10 - 1, widths: [3, 4] },
            { formula: "X * 10 - 5", fn: (k) => k * 10 - 5, widths: [3, 4] },
            { formula: "X * 100", fn: (k) => k * 100, widths: [3, 4] },
            { formula: "X * 16", fn: (k) => k * 16, widths: [2, 3, 4] }
        ];
    },

    pairStarts(bytesA, bytesB) {
        const starts = new Set();
        const n = Math.min(bytesA.length, bytesB.length);
        for (let i = 0; i < n; i++) {
            if (bytesA[i] !== bytesB[i]) starts.add(i);
        }
        if (typeof MarkBook !== "undefined") {
            MarkBook.lessonRanges("KM").forEach((range) => starts.add(range.start));
            MarkBook.lessonRanges("COPY").forEach((range) => starts.add(range.start));
            MarkBook.lessonRanges("HINT").forEach((range) => starts.add(range.start));
        }
        return starts;
    },

    siblingsSameAlgo(bytesA, bytesB, start, width, littleEndian, fn, kmA, kmB) {
        const n = Math.min(bytesA.length, bytesB.length);
        const copies = [start];
        const wantA = fn(kmA);
        const wantB = fn(kmB);
        [4, 8, 16, 32].forEach((stride) => {
            const base = start % stride;
            for (let p = base; p + width <= n; p += stride) {
                if (p === start) continue;
                const a = MathEngine.fromBytes(bytesA, p, width, littleEndian);
                const b = MathEngine.fromBytes(bytesB, p, width, littleEndian);
                if (a === null || b === null || a === b) continue;
                const near = Math.abs(a - wantA) <= 24 && Math.abs(b - wantB) <= 24;
                const sameAge = Math.abs((a - wantA) - (b - wantB)) <= 2 && a > 80 && b > 80;
                if (near || sameAge) copies.push(p);
            }
        });
        return copies.sort((a, b) => a - b);
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
            if (!locA.length || locA.length > 24) return;
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
                writeHow: MathEngine.encodeWriteup(va.formula, va.endian, va.width) + " Misma fórmula en cada copia/página.",
                confidence: Math.min(99.4, 92 + Math.min(common.length, 5) * 1.4),
                representation: va.endian + " par demostrado"
            });
        });

        const n = bytesA.length;
        const starts = this.pairStarts(bytesA, bytesB);
        this.pairScales().forEach((scale) => {
            scale.widths.forEach((width) => {
                ["LE", "BE"].forEach((endian) => {
                    const little = endian !== "BE";
                    starts.forEach((i) => {
                        if (i + width > n) return;
                        const a = MathEngine.fromBytes(bytesA, i, width, little);
                        const b = MathEngine.fromBytes(bytesB, i, width, little);
                        if (a === null || b === null || a === b) return;
                        if (Math.abs(a - scale.fn(kmA)) > 8 || Math.abs(b - scale.fn(kmB)) > 8) return;
                        const copies = this.siblingsSameAlgo(bytesA, bytesB, i, width, little, scale.fn, kmA, kmB);
                        const key = "scale|" + scale.formula + "|" + endian + width + "|" + copies[0];
                        if (seen.has(key)) return;
                        seen.add(key);
                        hits.push({
                            fromMind: true,
                            fromPair: true,
                            label: "KILOMETRAJE",
                            name: KnowledgeBase.algorithmName(scale.formula, width, endian),
                            formula: scale.formula,
                            width,
                            endian,
                            copies,
                            address: i,
                            addressText: Hunters.range(i, width),
                            hex: MathEngine.hexBytes(bytesA.slice(i, i + width)),
                            numeric: kmA,
                            value: kmA,
                            writeHow: MathEngine.encodeWriteup(scale.formula, endian, width) + " Misma fórmula en cada byte/página que procede.",
                            confidence: Math.min(99.2, 95 + Math.min(copies.length, 4)),
                            representation: endian + " par · " + scale.formula
                        });
                    });
                });
            });
        });
        this.reasonPairStairs(bytesA, bytesB, kmA, kmB).forEach((hit) => hits.unshift(hit));
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 14);
    },

    reasonPairStairs(bytesA, bytesB, kmA, kmB) {
        const stairsA = this.scanStairs(bytesA, kmA);
        const stairsB = this.scanStairs(bytesB, kmB);
        const hits = [];
        const seen = new Set();
        stairsA.forEach((ha) => {
            if (ha.scatter) return;
            stairsB.forEach((hb) => {
                if (hb.scatter) return;
                if (ha.width !== hb.width || ha.endian !== hb.endian || ha.formula !== hb.formula) return;
                const common = (ha.copies || []).filter((addr) => (hb.copies || []).indexOf(addr) !== -1);
                if (common.length < 4) return;
                const key = ha.formula + "|" + ha.endian + ha.width + "|" + common[0];
                if (seen.has(key)) return;
                seen.add(key);
                hits.push({
                    fromMind: true,
                    fromPair: true,
                    fromStair: true,
                    label: "KILOMETRAJE",
                    name: ha.name,
                    formula: ha.formula,
                    width: ha.width,
                    endian: ha.endian,
                    copies: common,
                    stair: ha.stair,
                    step: ha.step,
                    address: ha.address,
                    addressText: ha.addressText,
                    hex: ha.hex,
                    numeric: kmA,
                    value: kmA,
                    writeHow: "Par: misma rampa ±1 en ambos BIN, " + common.length +
                        " huecos. Las copias no son iguales. El actual es el más alto.",
                    confidence: Math.min(99.5, 96 + Math.min(common.length, 6)),
                    representation: "escalera par " + (ha.step > 0 ? "+1" : "-1")
                });
            });
        });
        return hits;
    },

    scanStairs(bytes, knownKm) {
        const hits = [];
        const widths = [2, 3, 4];
        const strides = [4, 8, 16, 32, 64];
        const scales = [
            { formula: "X", fn: (k) => k },
            { formula: "X * 10", fn: (k) => k * 10 },
            { formula: "X * 10 - 1", fn: (k) => k * 10 - 1 },
            { formula: "X * 10 - 5", fn: (k) => k * 10 - 5 },
            { formula: "X * 100", fn: (k) => k * 100 }
        ];
        const matchScale = (raw) => {
            if (knownKm === null || knownKm === undefined) {
                if (this.looksLikeKm(raw)) return { formula: "X", km: raw };
                const tenth = Math.round(raw / 10);
                if (this.looksLikeKm(tenth)) return { formula: "X * 10", km: tenth };
                return null;
            }
            const hit = scales.find((s) => Math.abs(raw - s.fn(knownKm)) <= 8);
            return hit ? { formula: hit.formula, km: knownKm } : null;
        };

        strides.forEach((stride) => {
            widths.forEach((width) => {
                if (width > stride) return;
                [true, false].forEach((little) => {
                    for (let phase = 0; phase < stride; phase++) {
                        const slots = [];
                        for (let p = phase; p + width <= bytes.length; p += stride) {
                            const value = MathEngine.fromBytes(bytes, p, width, little);
                            if (value === null) continue;
                            slots.push({ addr: p, value });
                        }
                        if (slots.length < 4) continue;
                        let run = [slots[0]];
                        const flush = () => {
                            if (run.length < 4) return;
                            const step = run[1].value - run[0].value;
                            if (step !== 1 && step !== -1) return;
                            let ok = true;
                            for (let i = 1; i < run.length; i++) {
                                if (run[i].addr !== run[i - 1].addr + stride) ok = false;
                                if (run[i].value - run[i - 1].value !== step) ok = false;
                            }
                            if (!ok) return;
                            const high = run.reduce((a, b) => (a.value >= b.value ? a : b));
                            const scaled = matchScale(high.value);
                            if (!scaled) return;
                            hits.push({
                                fromMind: true,
                                fromStair: true,
                                label: "KILOMETRAJE",
                                name: "STAIR_" + (little ? "LE" : "BE") + width + "_S" + stride.toString(16).toUpperCase(),
                                formula: scaled.formula,
                                width,
                                endian: little ? "LE" : "BE",
                                copies: run.map((s) => s.addr),
                                stair: run.map((s) => ({ addr: s.addr, value: s.value })),
                                step,
                                address: high.addr,
                                addressText: Hunters.range(high.addr, width),
                                hex: MathEngine.hexBytes(bytes.slice(high.addr, high.addr + width)),
                                numeric: scaled.km,
                                value: scaled.km,
                                writeHow: "Todo el BIN: rampa de " + run.length + " huecos, cada " + stride +
                                    " bytes, van " + (step > 0 ? "+1" : "-1") +
                                    " hasta el KM. Las copias no son iguales. El actual es el más alto.",
                                confidence: Math.min(98.6, 76 + Math.min(run.length, 16)),
                                representation: "escalera " + (step > 0 ? "+1" : "-1") + " stride " + stride
                            });
                        };
                        for (let i = 1; i < slots.length; i++) {
                            const prev = run[run.length - 1];
                            const cur = slots[i];
                            const step = cur.value - prev.value;
                            const want = run.length >= 2 ? (run[1].value - run[0].value) : null;
                            if (cur.addr === prev.addr + stride && (step === 1 || step === -1) && (want === null || step === want)) {
                                run.push(cur);
                            } else {
                                flush();
                                run = [cur];
                            }
                        }
                        flush();
                    }
                });
            });
        });

        if (knownKm !== null && knownKm !== undefined) {
            scales.forEach((scale) => {
                const want = scale.fn(knownKm);
                widths.forEach((width) => {
                    [true, false].forEach((little) => {
                        const found = [];
                        for (let i = 0; i + width <= bytes.length; i++) {
                            const value = MathEngine.fromBytes(bytes, i, width, little);
                            if (value === null) continue;
                            const delta = want - value;
                            if (delta >= 0 && delta <= 40) found.push({ addr: i, value, delta });
                        }
                        if (found.length < 4) return;
                        const deltas = found.map((s) => s.delta);
                        if (deltas.indexOf(0) === -1) return;
                        const uniq = Array.from(new Set(deltas)).sort((a, b) => a - b);
                        let chain = 1;
                        let bestChain = 1;
                        for (let i = 1; i < uniq.length; i++) {
                            chain = uniq[i] === uniq[i - 1] + 1 ? chain + 1 : 1;
                            if (chain > bestChain) bestChain = chain;
                        }
                        if (bestChain < 4) return;
                        const copies = found.map((s) => s.addr).sort((a, b) => a - b);
                        const high = found.reduce((a, b) => (a.delta <= b.delta ? a : b));
                        hits.push({
                            fromMind: true,
                            fromStair: true,
                            scatter: true,
                            label: "KILOMETRAJE",
                            name: "STAIR_SCATTER_" + (little ? "LE" : "BE") + width,
                            formula: scale.formula,
                            width,
                            endian: little ? "LE" : "BE",
                            copies,
                            stair: found,
                            step: -1,
                            address: high.addr,
                            addressText: Hunters.range(high.addr, width),
                            hex: MathEngine.hexBytes(bytes.slice(high.addr, high.addr + width)),
                            numeric: knownKm,
                            value: knownKm,
                            writeHow: "Todo el BIN: " + found.length + " huecos con KM, KM-1, KM-2… No son copias idénticas.",
                            confidence: Math.min(94.5, 70 + Math.min(bestChain, 12)),
                            representation: "desglose -1 en todo el archivo"
                        });
                    });
                });
            });
        }

        const uniq = [];
        const seen = new Set();
        hits.sort((a, b) => b.confidence - a.confidence).forEach((hit) => {
            const key = hit.endian + "|" + hit.width + "|" + hit.address + "|" + hit.copies.length;
            if (seen.has(key)) return;
            seen.add(key);
            uniq.push(hit);
        });
        return uniq.slice(0, 12);
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
        parts.push("Recorro el archivo binario completo" + (ctx.size ? " (" + ctx.size + " bytes)" : "") + ". El nombre no cuenta.");
        if (ctx.best && ctx.best.fromStair) {
            parts.push("Rampa ±1 en " + (ctx.best.copies || []).length + " huecos. El KM actual es el más alto; las copias no son iguales.");
        }
        if (ctx.diffWorld && ctx.diffWorld.ranges.length) {
            const kinds = {};
            ctx.diffWorld.ranges.forEach((r) => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
            parts.push("Cambian " + ctx.diffWorld.totalBytes + " bytes en " + ctx.diffWorld.ranges.length +
                " zonas (" + Object.keys(kinds).map((k) => kinds[k] + " " + k).join(", ") + ").");
        }
        if (ctx.familyMatch) parts.push("Estructura = " + ctx.familyMatch.family.id + ".");
        if (ctx.recalled && ctx.recalled.length) {
            parts.push("Memoria: " + ctx.recalled[0].formula + " @ " + ctx.recalled[0].addressText + ".");
        }
        if (ctx.pairHits && ctx.pairHits.length) {
            parts.push("El par demuestra KM = " + ctx.pairHits[0].formula + " en " + ctx.pairHits[0].addressText + ".");
        }
        if (ctx.best) {
            parts.push("Prioridad: " + ctx.best.formula + " · " + (ctx.best.writeHow || "validar copias y checksum") + ".");
        } else {
            parts.push("Siguiente: otro BIN de la misma estructura o un KM conocido.");
        }
        return parts.join(" ");
    },

    spansFrom(list, widthDefault) {
        const spans = [];
        (list || []).forEach((item) => {
            const start = item.address !== undefined ? item.address : item.storedAt;
            const width = item.width || item.size || widthDefault || 1;
            if (start === undefined || start === null) return;
            spans.push({ start, end: start + width - 1, label: item.name || item.label || "" });
        });
        return spans;
    },

    overlap(range, spans) {
        return (spans || []).find((s) => range.start <= s.end && range.end >= s.start) || null;
    },

    diffRanges(bytesA, bytesB) {
        const ranges = [];
        if (!bytesA || !bytesB) return ranges;
        const n = Math.min(bytesA.length, bytesB.length);
        let run = null;
        for (let i = 0; i < n; i++) {
            if (bytesA[i] !== bytesB[i]) {
                if (!run) run = { start: i, end: i, samples: [] };
                run.end = i;
                if (run.samples.length < 8) run.samples.push({ addr: i, a: bytesA[i], b: bytesB[i] });
            } else if (run) {
                ranges.push(run);
                run = null;
            }
        }
        if (run) ranges.push(run);
        return ranges;
    },

    fromUserMarks(bytes, knownKm) {
        if (typeof MarkBook === "undefined") return [];
        const hits = [];
        const transforms = knownKm !== null && knownKm !== undefined ? MathEngine.transforms(knownKm) : [];
        const extraCopies = MarkBook.lessonRanges("COPY").map((range) => range.start);
        MarkBook.lessonRanges("KM").concat(MarkBook.lessonRanges("HINT")).forEach((range) => {
            const width = Math.min(4, Math.max(1, range.size));
            const start = range.start;
            ["LE", "BE"].forEach((endian) => {
                const raw = MathEngine.fromBytes(bytes, start, width, endian !== "BE");
                if (raw === null) return;
                let formula = "X";
                let km = raw;
                let confidence = 94;
                if (knownKm !== null && knownKm !== undefined) {
                    const match = transforms.find((item) => item.value === raw);
                    if (match) {
                        formula = match.name;
                        km = knownKm;
                        confidence = 98.4;
                    } else if (raw === knownKm * 10) { formula = "X * 10"; km = knownKm; confidence = 97.8; }
                    else if (raw === knownKm * 10 - 5) { formula = "X * 10 - 5"; km = knownKm; confidence = 97.2; }
                    else if (raw === knownKm * 100) { formula = "X * 100"; km = knownKm; confidence = 97; }
                    else km = width >= 3 ? Math.round(raw / 10) : raw;
                } else {
                    km = width >= 3 ? Math.round(raw / 10) : raw;
                }
                hits.push({
                    fromMind: true,
                    fromUser: true,
                    fromLesson: MarkBook.hasLessons(),
                    label: "KILOMETRAJE",
                    name: "USER_KM_" + endian + width,
                    formula,
                    width,
                    endian,
                    copies: [start].concat(extraCopies.filter((addr) => addr !== start)),
                    address: start,
                    addressText: Hunters.range(start, width),
                    hex: MathEngine.hexBytes(bytes.slice(start, start + width)),
                    numeric: km,
                    value: km,
                    writeHow: "Zona " + (range.kind === "HINT" ? "pista" : "KM") + " que me mostraste. Pruebo la misma fórmula en cada copia y en el BIN 2.",
                    confidence: MarkBook.hasLessons() ? Math.min(99.4, confidence + 4) : (range.kind === "HINT" ? Math.max(80, confidence - 8) : confidence),
                    representation: "marca usuario " + endian
                });
            });
        });
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    },

    classifyDiffs(bytesA, bytesB, ctx) {
        ctx = ctx || {};
        const ranges = this.diffRanges(bytesA, bytesB);
        const vinSpans = this.spansFrom(ctx.vins, 17).concat(this.spansFrom(ctx.vins2, 17));
        const kmSpans = this.spansFrom(ctx.kmCopies, ctx.kmWidth || 3);
        const chkSpans = this.spansFrom(ctx.checksums, 2);
        if (typeof MarkBook !== "undefined") {
            MarkBook.lessonRanges("KM").forEach((r) => kmSpans.push({ start: r.start, end: r.end, label: "marca KM" }));
            MarkBook.lessonRanges("CHK").forEach((r) => chkSpans.push({ start: r.start, end: r.end, label: "marca SUM" }));
            MarkBook.lessonRanges("CRC").forEach((r) => chkSpans.push({ start: r.start, end: r.end, label: "marca CRC" }));
            MarkBook.lessonRanges("COMP").forEach((r) => chkSpans.push({ start: r.start, end: r.end, label: "marca COMP" }));
        }
        let totalBytes = 0;
        ranges.forEach((range) => {
            range.size = range.end - range.start + 1;
            totalBytes += range.size;
            const vinHit = this.overlap(range, vinSpans);
            const kmHit = this.overlap(range, kmSpans);
            const chkHit = this.overlap(range, chkSpans);
            if (vinHit) {
                range.kind = "VIN";
                range.why = "Zona VIN " + (vinHit.label || "");
            } else if (kmHit) {
                range.kind = "KM";
                range.why = "Kilometraje / copias";
            } else if (chkHit) {
                range.kind = "CHECKSUM";
                range.why = "Checksum " + (chkHit.label || "");
            } else {
                range.kind = "OTRO";
                range.why = "Cambia y no es KM ni VIN";
            }
            range.hexA = MathEngine.hexBytes(bytesA.slice(range.start, Math.min(range.end + 1, range.start + 8)));
            range.hexB = MathEngine.hexBytes(bytesB.slice(range.start, Math.min(range.end + 1, range.start + 8)));
        });
        return { ranges, totalBytes, sizeA: bytesA ? bytesA.length : 0, sizeB: bytesB ? bytesB.length : 0 };
    }
};
