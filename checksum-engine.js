const ChecksumEngine = {

    crc8(bytes, start, end, poly, init) {
        poly = poly === undefined ? 0x07 : poly;
        init = init === undefined ? 0x00 : init;
        let crc = init;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                crc = (crc & 0x80) ? ((crc << 1) ^ poly) & 0xFF : (crc << 1) & 0xFF;
            }
        }
        return crc;
    },

    crc16(bytes, start, end, poly, init) {
        poly = poly === undefined ? 0x1021 : poly;
        init = init === undefined ? 0xFFFF : init;
        let crc = init;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i] << 8;
            for (let b = 0; b < 8; b++) {
                crc = (crc & 0x8000) ? ((crc << 1) ^ poly) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
        }
        return crc;
    },

    crc16IBM(bytes, start, end) {
        let crc = 0x0000;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
            }
        }
        return crc;
    },

    crc24(bytes, start, end) {
        let crc = 0xB704CE;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i] << 16;
            for (let b = 0; b < 8; b++) {
                crc = (crc & 0x800000) ? ((crc << 1) ^ 0x864CFB) & 0xFFFFFF : (crc << 1) & 0xFFFFFF;
            }
        }
        return crc;
    },

    crc32(bytes, start, end) {
        let crc = 0xFFFFFFFF;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    },

    crc64(bytes, start, end) {
        let crc = 0xFFFFFFFF;
        for (let i = start; i < end; i++) {
            crc ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                crc = (crc & 1) ? (crc >>> 1) ^ 0xD8000001 : crc >>> 1;
            }
        }
        return crc >>> 0;
    },

    sum8(bytes, start, end) {
        let sum = 0;
        for (let i = start; i < end; i++) sum = (sum + bytes[i]) & 0xFF;
        return sum;
    },

    sum16(bytes, start, end) {
        let sum = 0;
        for (let i = start; i < end; i++) sum = (sum + bytes[i]) & 0xFFFF;
        return sum;
    },

    xor8(bytes, start, end) {
        let x = 0;
        for (let i = start; i < end; i++) x ^= bytes[i];
        return x;
    },

    xor16(bytes, start, end) {
        let x = 0;
        for (let i = start; i + 1 < end; i += 2) {
            x ^= bytes[i] | (bytes[i + 1] << 8);
        }
        return x & 0xFFFF;
    },

    lrc(bytes, start, end) {
        return ((0x100 - this.sum8(bytes, start, end)) & 0xFF);
    },

    bcc(bytes, start, end) {
        return this.xor8(bytes, start, end);
    },

    fletcher16(bytes, start, end) {
        let sum1 = 0;
        let sum2 = 0;
        for (let i = start; i < end; i++) {
            sum1 = (sum1 + bytes[i]) % 255;
            sum2 = (sum2 + sum1) % 255;
        }
        return (sum2 << 8) | sum1;
    },

    adler32(bytes, start, end) {
        let a = 1;
        let b = 0;
        for (let i = start; i < end; i++) {
            a = (a + bytes[i]) % 65521;
            b = (b + a) % 65521;
        }
        return ((b << 16) | a) >>> 0;
    },

    storeMatches(bytes, value, size, littleEndian) {
        const pattern = MathEngine.toBytes(value, size, littleEndian);
        return MathEngine.findPattern(bytes, pattern);
    },

    algorithms() {
        return [
            { name: "CRC8", size: 1, fn: (b, s, e) => this.crc8(b, s, e) },
            { name: "CRC16", size: 2, fn: (b, s, e) => this.crc16(b, s, e) },
            { name: "CRC16-IBM", size: 2, fn: (b, s, e) => this.crc16IBM(b, s, e) },
            { name: "CRC24", size: 3, fn: (b, s, e) => this.crc24(b, s, e) },
            { name: "CRC32", size: 4, fn: (b, s, e) => this.crc32(b, s, e) },
            { name: "CRC64", size: 4, fn: (b, s, e) => this.crc64(b, s, e) },
            { name: "SUM8", size: 1, fn: (b, s, e) => this.sum8(b, s, e) },
            { name: "SUM16", size: 2, fn: (b, s, e) => this.sum16(b, s, e) },
            { name: "XOR8", size: 1, fn: (b, s, e) => this.xor8(b, s, e) },
            { name: "XOR16", size: 2, fn: (b, s, e) => this.xor16(b, s, e) },
            { name: "LRC", size: 1, fn: (b, s, e) => this.lrc(b, s, e) },
            { name: "BCC", size: 1, fn: (b, s, e) => this.bcc(b, s, e) },
            { name: "FLETCHER16", size: 2, fn: (b, s, e) => this.fletcher16(b, s, e) },
            { name: "ADLER32", size: 4, fn: (b, s, e) => this.adler32(b, s, e) }
        ];
    },

    describeKmOrder(hit, bytes) {
        if (!hit) {
            return { layout: "Sin KM", hex: "----", copies: 0, endian: "----" };
        }
        const raw = bytes.slice(hit.address, hit.address + hit.width);
        const hex = MathEngine.hexBytes(raw);
        let layout = hit.endian || "RAW";
        if (hit.endian === "LE") layout = "lo + hi  (little-endian: primero el byte bajo)";
        if (hit.endian === "BE") layout = "hi + lo  (big-endian: primero el byte alto)";
        if (hit.endian === "BCD") layout = "BCD  (cada nibble es un dígito decimal)";
        if (hit.familyId === "YAMAHA_MT09_93C86") {
            layout = (hit.swapped ? "DUMP SWAP 16: hi+lo en el word" : "00 00 + KM uint16 LE (lo hi)") +
                " · 6 ranuras de 4 bytes";
        }
        if (hit.familyId === "ODYSSEY_DENSO_93C86") {
            layout = "AF + word fino + FF · 3 copias seguidas. Orden interno aún no demostrado";
        }
        if (hit.familyId === "YAMAHA_R5F10") {
            layout = "anillo 32 B: lo mid hi LE24 de décimas · última = KM×10 · bytes 30–31 = SUM16 BE";
        }
        return {
            layout,
            hex,
            copies: (hit.copies || [hit.address]).length,
            endian: hit.endian || "RAW",
            formula: hit.formula,
            address: hit.addressText
        };
    },

    linkToKm(bytes, hit) {
        if (!hit || hit.address === undefined) return [];
        if (hit.familyId === "YAMAHA_R5F10") {
            const start = hit.address;
            const calc = bytes[start] + bytes[start + 1] + bytes[start + 2];
            const stored = (bytes[start + 30] << 8) | bytes[start + 31];
            return [{
                name: "SUM16",
                start,
                end: start + 3,
                storedAt: start + 30,
                valueBin: calc,
                calculated: calc,
                endian: "BE",
                size: 2,
                status: stored === calc ? "VALIDO" : "ROTO",
                confidence: 99,
                window: "payload-LE24",
                linkedTo: "KM"
            }];
        }
        const copies = hit.copies && hit.copies.length ? hit.copies : [hit.address];
        const width = hit.width || 2;
        const found = [];
        const seen = new Set();
        const windows = [];
        const regionStart = Math.min.apply(null, copies);
        const regionEnd = Math.max.apply(null, copies) + width;
        windows.push({ start: regionStart, end: regionEnd, label: "bloque-KM" });
        copies.forEach((addr) => {
            windows.push({ start: addr, end: addr + width, label: "slot-" + addr.toString(16) });
            if (addr >= 2) windows.push({ start: addr - 2, end: addr + width, label: "prefijo-" + addr.toString(16) });
        });
        this.algorithms().forEach((algo) => {
            windows.forEach((win) => {
                if (win.end - win.start < 1) return;
                const calc = algo.fn(bytes, win.start, win.end);
                const spots = [win.end, win.end + 0];
                copies.forEach((addr) => spots.push(addr + width));
                ["LE", "BE"].forEach((endian) => {
                    const hits = this.storeMatches(bytes, calc, algo.size, endian === "LE")
                        .filter((addr) => spots.indexOf(addr) !== -1 || (addr >= win.end && addr <= win.end + 4));
                    hits.forEach((addr) => {
                        const key = algo.name + "|" + win.start + "|" + addr;
                        if (seen.has(key)) return;
                        seen.add(key);
                        found.push({
                            name: algo.name,
                            start: win.start,
                            end: win.end,
                            storedAt: addr,
                            valueBin: calc,
                            calculated: calc,
                            endian,
                            size: algo.size,
                            status: "VALIDO",
                            confidence: 90,
                            window: win.label,
                            linkedTo: "KM"
                        });
                    });
                });
            });
        });
        return found.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    },

    fromUserMarks(bytes, kmHit) {
        if (typeof MarkBook === "undefined") return [];
        const found = [];
        const seen = new Set();
        const stores = MarkBook.ranges("CHK").concat(MarkBook.ranges("CRC"));
        if (!stores.length) return found;
        const windows = [];
        if (kmHit && kmHit.address !== undefined) {
            const copies = kmHit.copies && kmHit.copies.length ? kmHit.copies : [kmHit.address];
            const width = kmHit.width || 3;
            copies.forEach((addr) => windows.push({ start: addr, end: addr + width, label: "km-" + addr.toString(16) }));
        }
        MarkBook.ranges("KM").forEach((range) => {
            windows.push({ start: range.start, end: range.end + 1, label: "marca-km" });
        });
        stores.forEach((store) => {
            windows.push({ start: Math.max(0, store.start - 64), end: store.start, label: "antes-marca" });
            windows.push({ start: Math.max(0, store.start - store.size), end: store.start, label: "pegado" });
        });
        const algos = this.algorithms();
        stores.forEach((store) => {
            const size = Math.min(4, Math.max(1, store.size));
            const preferCrc = store.kind === "CRC";
            const storedLE = MathEngine.fromBytes(bytes, store.start, size, true);
            const storedBE = MathEngine.fromBytes(bytes, store.start, size, false);
            windows.forEach((win) => {
                if (win.end <= win.start) return;
                algos.forEach((algo) => {
                    if (algo.size !== size) return;
                    if (preferCrc && algo.name.indexOf("CRC") === -1) return;
                    if (!preferCrc && algo.name.indexOf("CRC") !== -1 && store.kind === "CHK") return;
                    const calc = algo.fn(bytes, win.start, win.end);
                    const endian = calc === storedBE && calc !== storedLE ? "BE" : (calc === storedLE ? "LE" : null);
                    if (!endian) return;
                    const key = algo.name + "|" + win.start + "|" + store.start;
                    if (seen.has(key)) return;
                    seen.add(key);
                    found.push({
                        name: algo.name,
                        start: win.start,
                        end: win.end,
                        storedAt: store.start,
                        valueBin: calc,
                        calculated: calc,
                        endian,
                        size: algo.size,
                        status: "VALIDO",
                        confidence: preferCrc ? 96 : 95,
                        window: win.label,
                        linkedTo: "MARCA " + store.kind,
                        fromUser: true
                    });
                });
            });
        });
        return found.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    },

    fromMemory(bytes) {
        if (typeof KnowledgeBase === "undefined") return [];
        const found = [];
        const seen = new Set();
        KnowledgeBase.load().algorithms.forEach((algo) => {
            (algo.checksums || []).forEach((item) => {
                if (item.storedAt === null || item.storedAt === undefined) return;
                const spec = this.algorithms().find((a) => a.name === item.name);
                if (!spec || item.end === undefined || item.start === undefined) return;
                if (item.end > bytes.length || item.storedAt + (item.size || spec.size) > bytes.length) return;
                const calc = spec.fn(bytes, item.start, item.end);
                const stored = MathEngine.fromBytes(bytes, item.storedAt, item.size || spec.size, item.endian !== "BE");
                const key = item.name + "|" + item.storedAt;
                if (seen.has(key)) return;
                seen.add(key);
                found.push({
                    name: item.name,
                    start: item.start,
                    end: item.end,
                    storedAt: item.storedAt,
                    valueBin: stored,
                    calculated: calc,
                    endian: item.endian || "LE",
                    size: item.size || spec.size,
                    status: stored === calc ? "VALIDO" : "MEMORIA",
                    confidence: stored === calc ? 96 : 78,
                    window: item.window || "memoria",
                    linkedTo: algo.name,
                    fromMemory: true
                });
            });
        });
        return found;
    },

    hunt(bytes, hotAddresses) {
        const results = [];
        const seen = new Set();
        const windows = this.buildWindows(bytes, hotAddresses);
        const algos = this.algorithms();

        windows.forEach((win) => {
            algos.forEach((algo) => {
                if (win.end - win.start < 2) return;
                const calc = algo.fn(bytes, win.start, win.end);
                const near = (addr) => addr === win.end || addr === win.start - algo.size;
                const leHits = this.storeMatches(bytes, calc, algo.size, true).filter(near);
                const beHits = this.storeMatches(bytes, calc, algo.size, false).filter(near);
                const hits = leHits.length ? leHits : beHits;
                const endian = leHits.length ? "LE" : "BE";
                if (!hits.length) return;
                const key = algo.name + "|" + win.start + "|" + win.end + "|" + hits[0];
                if (seen.has(key)) return;
                seen.add(key);
                results.push({
                    name: algo.name,
                    start: win.start,
                    end: win.end,
                    storedAt: hits[0],
                    valueBin: calc,
                    calculated: calc,
                    endian,
                    size: algo.size,
                    status: "VALIDO",
                    confidence: win.priority ? 92 : 74,
                    window: win.label
                });
            });
        });

        if (!results.length) {
            ["CRC16", "CRC32", "SUM16", "XOR8", "LRC"].forEach((name) => {
                results.push({
                    name,
                    start: 0,
                    end: bytes.length,
                    storedAt: null,
                    valueBin: null,
                    calculated: null,
                    status: "SIN_MATCH",
                    confidence: 0,
                    window: "archivo"
                });
            });
        }

        return results.sort((a, b) => b.confidence - a.confidence);
    },

    buildWindows(bytes, hotAddresses) {
        const size = bytes.length;
        const windows = [
            { start: 0, end: size, label: "archivo", priority: false }
        ];
        [16, 32, 64, 128, 256].forEach((len) => {
            if (len >= size) return;
            windows.push({ start: 0, end: len, label: "0-" + len.toString(16), priority: false });
            windows.push({ start: size - len, end: size, label: "cola-" + len, priority: false });
        });
        (hotAddresses || []).forEach((addr) => {
            [8, 16, 32, 64].forEach((len) => {
                const start = Math.max(0, addr - (addr % len));
                const end = Math.min(size, start + len);
                if (end - start >= 4) {
                    windows.push({
                        start,
                        end,
                        label: start.toString(16).toUpperCase() + "-" + (end - 1).toString(16).toUpperCase(),
                        priority: true
                    });
                }
            });
        });
        return windows;
    },

    recalculate(bytes, checksums) {
        const repaired = [];
        checksums.forEach((item) => {
            if (item.status !== "VALIDO" || item.storedAt === null) return;
            const algo = this.algorithms().find((a) => a.name === item.name);
            if (!algo) return;
            const calc = algo.fn(bytes, item.start, item.end);
            const stored = MathEngine.toBytes(calc, item.size, item.endian !== "BE");
            bytes.set(stored, item.storedAt);
            repaired.push(Object.assign({}, item, { calculated: calc, valueBin: calc }));
        });
        return repaired;
    }

};
