const Hunters = {

    hexAddr(value) {
        return value.toString(16).toUpperCase().padStart(4, "0");
    },

    range(addr, width) {
        return this.hexAddr(addr) + " - " + this.hexAddr(addr + width - 1);
    },

    scoreHit(hits, width, fromMemory) {
        let score = 40 + width * 6;
        if (hits.length >= 2 && hits.length <= 8) score += 28;
        else if (hits.length === 1) score += 8;
        else if (hits.length > 20) score -= 25;
        if (fromMemory) score += 18;
        return Math.max(8, Math.min(99.7, score));
    },

    huntValue(bytes, knownValue, label, preferAddrs) {
        if (knownValue === null || knownValue === undefined || knownValue === "") return [];
        const value = Number(String(knownValue).replace(/[^\d.]/g, ""));
        if (!Number.isFinite(value) || value < 0) return [];

        const known = KnowledgeBase.applyKnown(bytes, value);
        const found = [];
        const seen = new Set();
        const index = MathEngine.indexFile(bytes);

        known.forEach((item) => {
            const key = item.formula + "|" + item.hex;
            seen.add(key);
            found.push(item);
        });

        MathEngine.variantsForValue(value).forEach((variant) => {
            const key = variant.formula + "|" + variant.hex;
            if (seen.has(key)) return;
            let hits = MathEngine.lookupIndex(index, variant.bytes);
            if (preferAddrs && preferAddrs.size) {
                const filtered = hits.filter((addr) => {
                    for (let i = 0; i < variant.width; i++) {
                        if (preferAddrs.has(addr + i)) return true;
                    }
                    return false;
                });
                if (filtered.length) hits = filtered;
            }
            if (!hits.length) return;
            if (variant.width <= 2 && hits.length > 12) return;
            seen.add(key);
            found.push({
                fromMemory: false,
                name: KnowledgeBase.algorithmName(variant.formula, variant.width, variant.endian),
                formula: variant.formula,
                width: variant.width,
                endian: variant.endian,
                copies: hits,
                address: hits[0],
                hex: variant.hex,
                numeric: variant.numeric,
                writeHow: MathEngine.encodeWriteup(variant.formula, variant.endian, variant.width),
                confidence: this.scoreHit(hits, variant.width, false)
            });
        });

        return found
            .map((item) => Object.assign({}, item, {
                label,
                value,
                addressText: this.range(item.address, item.width),
                copiesText: item.copies.map((addr) => this.hexAddr(addr)).join(", "),
                confidence: Number(item.confidence.toFixed(1))
            }))
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 30);
    },

    huntVIN(bytes) {
        return MindEngine.extractVins(bytes);
    },

    huntSerial(bytes) {
        const results = [];
        let current = "";
        let start = 0;
        for (let i = 0; i <= bytes.length; i++) {
            const b = bytes[i];
            const ok = b >= 48 && b <= 57 || b >= 65 && b <= 90 || b >= 97 && b <= 122;
            if (ok) {
                if (!current) start = i;
                current += String.fromCharCode(b);
            } else if (current.length >= 6 && current.length <= 20) {
                results.push({
                    name: "SERIAL",
                    value: current,
                    address: start,
                    addressText: this.range(start, current.length),
                    width: current.length,
                    type: "ASCII",
                    confidence: current.length >= 8 ? 78 : 62
                });
                current = "";
            } else {
                current = "";
            }
        }
        return results.slice(0, 8);
    },

    hiddenCopies(hits) {
        if (!hits.length) return [];
        const best = hits[0];
        return (best.copies || []).map((addr, index) => ({
            name: index === 0 ? "PRINCIPAL" : "COPIA " + index,
            address: addr,
            addressText: this.range(addr, best.width),
            hex: best.hex,
            formula: best.formula
        }));
    },

    memoryMap(bytes, counters, vins, checksums) {
        const regions = [];
        const push = (name, start, size, desc, copies) => {
            regions.push({
                id: "R" + String(regions.length + 1).padStart(2, "0"),
                name,
                start,
                end: start + size - 1,
                size,
                description: desc,
                copies
            });
        };

        counters.forEach((item) => {
            push(item.label || item.name, item.address, item.width, item.formula + " · " + item.endian, (item.copies || []).length);
        });
        vins.forEach((item) => {
            push("VIN", item.address, item.width, item.value, 1);
        });
        checksums.filter((c) => c.status === "VALIDO").forEach((item) => {
            push(item.name, item.storedAt, item.size, "ventana " + item.window, 1);
        });

        if (!regions.length) {
            push("DATOS", 0, Math.min(bytes.length, 64), "SIN CLASIFICAR", 0);
        }

        regions.sort((a, b) => a.start - b.start);
        return regions;
    },

    detectChip(size) {
        const chips = {
            256: "24C02",
            512: "24C04",
            1024: "24C08",
            2048: "24C16",
            4096: "24C32",
            8192: "24C64",
            16384: "24C128",
            32768: "25LC256",
            65536: "25LC512"
        };
        return chips[size] || "EEPROM " + size + "B";
    }

};
