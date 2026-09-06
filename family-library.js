const FamilyLibrary = {

    families: [
        {
            id: "YAMAHA_MT09_93C86",
            name: "YAMAHA MT-09 93C86",
            manufacturer: "YAMAHA",
            chip: "93C86",
            version: "MT-09 LCD",
            size: 2048,
            status: "DEMOSTRADO",
            writable: true,
            writeHow: "Escribe 00 00 lo hi (uint16) en las 6 ranuras 0000–0017. Si el dump está swapeado, usa big-endian en el word.",
            binsProven: 4
        },
        {
            id: "ODYSSEY_DENSO_93C86",
            name: "HONDA ODYSSEY DENSO 93C86",
            manufacturer: "DENSO / HONDA",
            chip: "93C86",
            version: "V1",
            size: 2048,
            status: "LUGAR DEMOSTRADO",
            writable: false,
            writeHow: "NO escribir. El fino está en 0062 (AF xx yy FF × 3) y hay sellos 80/FF. Fórmula pendiente de un tercer BIN.",
            binsProven: 2
        },
        {
            id: "YAMAHA_R5F10",
            name: "YAMAHA MT-07 R5F10",
            manufacturer: "YAMAHA",
            chip: "R5F10",
            version: "RL78 data flash 8K",
            size: 8192,
            status: "DEMOSTRADO",
            writable: true,
            writeHow: "Reescribe TODO el anillo del banco: páginas de 32 B en cadena +1. La última es KM×10 LE24. Cada página: lo mid hi + SUM16 BE en 30–31. No toca páginas FF.",
            binsProven: 8
        }
    ],

    ffRatio(bytes, start) {
        if (start >= bytes.length) return 1;
        let n = 0;
        for (let i = start; i < bytes.length; i++) {
            if (bytes[i] === 0xFF) n++;
        }
        return n / (bytes.length - start);
    },

    tripleMatch(bytes, addr, template) {
        if (addr + 12 > bytes.length) return false;
        for (let copy = 0; copy < 3; copy++) {
            const base = addr + copy * 4;
            for (let i = 0; i < 4; i++) {
                if (template[i] !== null && bytes[base + i] !== template[i]) return false;
            }
        }
        return true;
    },

    yamahaSlots(bytes) {
        const slots = [];
        for (let i = 0; i < 6; i++) {
            const addr = i * 4;
            slots.push({
                addr,
                prefix: bytes[addr] === 0x00 && bytes[addr + 1] === 0x00,
                le: bytes[addr + 2] + (bytes[addr + 3] << 8),
                be: (bytes[addr + 2] << 8) + bytes[addr + 3],
                wordAddr: addr + 2
            });
        }
        return slots;
    },

    scoreEndian(values) {
        const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
        if (!uniq.length) return 0;
        let score = 0;
        uniq.forEach((v) => {
            if (v >= 500 && v <= 120000) score += 20;
            const hi = (v >> 8) & 0xFF;
            if (hi >= 0x08 && hi <= 0x7F) score += 8;
        });
        if (uniq.length === 2 && Math.abs(uniq[1] - uniq[0]) <= 16) score += 40;
        if (uniq.length === 1) score += 10;
        return score;
    },

    detectYamaha(bytes) {
        if (bytes.length !== 2048) return null;
        if (this.ffRatio(bytes, 0x18) < 0.90) return null;
        const slots = this.yamahaSlots(bytes);
        const prefixed = slots.filter((s) => s.prefix).length;
        if (prefixed < 4) return null;
        const leVals = slots.map((s) => s.le);
        const beVals = slots.map((s) => s.be);
        const leScore = this.scoreEndian(leVals);
        const beScore = this.scoreEndian(beVals);
        if (leScore < 20 && beScore < 20) return null;
        const swapped = beScore > leScore;
        const values = swapped ? beVals : leVals;
        const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
        const km = uniq[uniq.length - 1];
        const backup = uniq.length > 1 ? uniq[0] : km;
        const endian = swapped ? "BE" : "LE";
        const copies = slots.map((s) => s.wordAddr);
        const hit = {
            fromMemory: true,
            fromFamily: true,
            familyId: "YAMAHA_MT09_93C86",
            label: "KILOMETRAJE",
            name: "YAMAHA_MT09_X_16" + endian,
            formula: "X",
            width: 2,
            endian,
            copies,
            address: copies[0],
            addressText: Hunters.range(copies[0], 2),
            hex: MathEngine.hexBytes(bytes.slice(copies[0], copies[0] + 2)),
            numeric: km,
            value: km,
            writeHow: "00 00 + uint16 " + endian + " en 6 ranuras. Banco sombra ≈ " + backup + " KM.",
            confidence: 99.2,
            representation: "00 00 + uint16 " + endian,
            writable: true,
            swapped
        };
        const backupHit = Object.assign({}, hit, {
            label: "KILOMETRAJE BCK",
            value: backup,
            numeric: backup,
            confidence: 97.5,
            copies: slots.filter((s) => (swapped ? s.be : s.le) === backup).map((s) => s.wordAddr)
        });
        return {
            family: this.families[0],
            decodedKm: km,
            backupKm: backup,
            swapped,
            hits: backup !== km ? [hit, backupHit] : [hit],
            confidence: 99.2
        };
    },

    detectOdyssey(bytes) {
        if (bytes.length !== 2048) return null;
        if (!(bytes[0] === 0x80 && bytes[1] === 0xFF)) return null;
        if (!this.tripleMatch(bytes, 0x62, [0xAF, null, null, 0xFF])) return null;
        if (!this.tripleMatch(bytes, 0x76, [0x7F, 0x8D, 0xFE, 0xFF])) return null;
        const fine = MathEngine.hexBytes(bytes.slice(0x62, 0x66));
        const stamps = [];
        for (let i = 0; i < 0x80; i += 2) {
            if (bytes[i] === 0x80 && bytes[i + 1] === 0xFF) stamps.push(i);
        }
        const hit = {
            fromMemory: true,
            fromFamily: true,
            familyId: "ODYSSEY_DENSO_93C86",
            label: "KILOMETRAJE",
            name: "ODYSSEY_DENSO_FINO",
            formula: "DENSO_FINO",
            width: 4,
            endian: "RAW",
            copies: [0x62, 0x66, 0x6A],
            address: 0x62,
            addressText: Hunters.range(0x62, 4),
            hex: fine,
            numeric: null,
            value: fine,
            writeHow: "NO escribir. Fórmula no demostrada. Campo fino " + fine + " · sellos 80=" + stamps.length,
            confidence: 96.4,
            representation: "AF + word fino + FF × 3",
            writable: false
        };
        return {
            family: this.families[1],
            decodedKm: null,
            backupKm: null,
            swapped: false,
            hits: [hit],
            stamps: stamps.length,
            confidence: 96.4
        };
    },

    le24(bytes, i) {
        return bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16);
    },

    r5fPages(bytes) {
        const pages = [];
        for (let p = 0; p + 32 <= bytes.length; p += 0x20) {
            let pad = 0;
            for (let i = 3; i < 30; i++) {
                if (bytes[p + i] === 0) pad++;
            }
            if (pad < 25) continue;
            const value = this.le24(bytes, p);
            if (value < 50 || value > 2500000) continue;
            const sum16 = bytes[p] + bytes[p + 1] + bytes[p + 2];
            const stored = (bytes[p + 30] << 8) | bytes[p + 31];
            pages.push({
                addr: p,
                value,
                sum16,
                stored,
                ok: stored === sum16
            });
        }
        return pages;
    },

    detectR5F(bytes) {
        if (bytes.length !== 8192) return null;
        const pages = this.r5fPages(bytes);
        const valid = pages.filter((p) => p.ok);
        if (valid.length < 6) return null;
        const last = valid.reduce((a, b) => (a.value >= b.value ? a : b));
        const km = Math.round(last.value / 10);
        const hex = MathEngine.hexBytes(bytes.slice(last.addr, last.addr + 3));
        const hit = {
            fromMemory: true,
            fromFamily: true,
            familyId: "YAMAHA_R5F10",
            label: "KILOMETRAJE",
            name: "YAMAHA_R5F10_LE24_X10",
            formula: "X * 10",
            width: 3,
            endian: "LE",
            copies: [last.addr],
            address: last.addr,
            addressText: Hunters.range(last.addr, 3),
            hex,
            numeric: km,
            value: km,
            writeHow: "Reescribe las " + valid.filter((p) => (p.addr & ~0x3FF) === (last.addr & ~0x3FF)).length +
                " páginas del banco: última = KM×10 LE24, las anteriores −1, −2… SUM16 en cada cola.",
            confidence: 99.1,
            representation: "anillo LE24 de décimas · última = KM×10 · SUM16 BE @ +30",
            writable: true,
            checksumAt: last.addr + 30,
            checksumName: "SUM16"
        };
        return {
            family: this.families[2],
            decodedKm: km,
            backupKm: null,
            swapped: false,
            hits: [hit],
            confidence: 99.1
        };
    },

    fingerprint(bytes) {
        let ff = 0;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0xFF) ff++;
        let hash = bytes.length;
        const take = Math.min(64, bytes.length);
        for (let i = 0; i < take; i++) hash = ((hash * 33) ^ bytes[i]) >>> 0;
        for (let i = Math.max(0, bytes.length - take); i < bytes.length; i++) hash = ((hash * 33) ^ bytes[i]) >>> 0;
        return {
            size: bytes.length,
            ffRatio: bytes.length ? ff / bytes.length : 0,
            hash: hash.toString(16)
        };
    },

    detectLearned(bytes) {
        if (typeof KnowledgeBase === "undefined") return null;
        const fp = this.fingerprint(bytes);
        const list = KnowledgeBase.learnedFamilies();
        for (let i = 0; i < list.length; i++) {
            const fam = list[i];
            if (fam.size !== bytes.length) continue;
            if (fam.fingerprint && Math.abs((fam.fingerprint.ffRatio || 0) - fp.ffRatio) > 0.15) continue;
            const copies = fam.copies || [];
            const width = fam.width || 2;
            if (!copies.length || copies[0] + width > bytes.length) continue;
            const raw = MathEngine.fromBytes(bytes, copies[0], width, fam.endian !== "BE");
            if (raw === null) continue;
            let km = raw;
            if (fam.formula === "X * 10") km = Math.round(raw / 10);
            else if (fam.formula === "X * 10 - 1") km = Math.round((raw + 1) / 10);
            else if (fam.formula === "X * 10 - 5") km = Math.round((raw + 5) / 10);
            else if (fam.formula === "X * 100") km = Math.round(raw / 100);
            const hit = {
                fromMemory: true,
                fromFamily: true,
                fromLearned: true,
                familyId: fam.key,
                label: "KILOMETRAJE",
                name: fam.key,
                formula: fam.formula,
                width,
                endian: fam.endian || "LE",
                copies: copies.slice(),
                stair: fam.fromStair ? copies.map((addr) => ({ addr, value: MathEngine.fromBytes(bytes, addr, width, fam.endian !== "BE") })) : null,
                step: fam.step,
                address: copies[0],
                addressText: Hunters.range(copies[0], width),
                hex: MathEngine.hexBytes(bytes.slice(copies[0], copies[0] + width)),
                numeric: km,
                value: km,
                writeHow: fam.writeHow || "Familia aprendida del par / marcas.",
                confidence: Math.min(98.8, 90 + Math.min(fam.hits || 1, 6)),
                representation: fam.fromStair ? "rampa aprendida" : "familia aprendida",
                writable: true,
                fromStair: !!fam.fromStair
            };
            return {
                family: {
                    id: fam.key,
                    name: "APRENDIDA",
                    manufacturer: "ESTRUCTURA",
                    chip: Hunters.detectChip(bytes.length),
                    version: "cerebro",
                    status: "APRENDIDA",
                    writable: true,
                    writeHow: hit.writeHow,
                    binsProven: fam.hits || 1
                },
                decodedKm: km,
                backupKm: null,
                swapped: false,
                hits: [hit],
                confidence: hit.confidence
            };
        }
        return null;
    },

    identify(bytes) {
        return this.detectYamaha(bytes) || this.detectR5F(bytes) || this.detectOdyssey(bytes) || this.detectLearned(bytes) || null;
    },

    writeStair(bytes, hit, newKm) {
        const working = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
        const width = hit.width || 2;
        const little = hit.endian !== "BE";
        const stair = (hit.stair && hit.stair.length)
            ? hit.stair
            : (hit.copies || [hit.address]).map((addr) => ({
                addr,
                value: MathEngine.fromBytes(working, addr, width, little)
            }));
        const newHigh = MathEngine.applyFormula(Number(newKm), hit.formula || "X");
        const high = stair.reduce((a, b) => (Number(a.value) >= Number(b.value) ? a : b), stair[0]);
        if (!high || high.value === null) return { bytes: working, encoded: new Uint8Array(width), count: 0 };
        const delta = newHigh - high.value;
        stair.forEach((slot) => {
            if (slot.value === null || slot.addr === undefined) return;
            const value = (slot.value + delta) >>> 0;
            working.set(MathEngine.toBytes(value, width, little), slot.addr);
        });
        return {
            bytes: working,
            encoded: MathEngine.toBytes(newHigh, width, little),
            count: stair.length
        };
    },

    r5fBank(bytes, lastAddr) {
        return this.r5fPages(bytes)
            .filter((p) => p.ok && ((p.addr & ~0x3FF) === (lastAddr & ~0x3FF)))
            .sort((a, b) => a.addr - b.addr);
    },

    writeR5FRing(bytes, lastAddr, km) {
        const working = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const run = this.r5fBank(working, lastAddr);
        const lastVal = Number(km) * 10;
        if (!run.length || !Number.isFinite(lastVal) || lastVal < 50) return { bytes: working, encoded: new Uint8Array(3), count: 0 };
        run.forEach((page, index) => {
            const value = lastVal - (run.length - 1 - index);
            working[page.addr] = value & 0xFF;
            working[page.addr + 1] = (value >> 8) & 0xFF;
            working[page.addr + 2] = (value >> 16) & 0xFF;
            for (let i = 3; i < 30; i++) working[page.addr + i] = 0;
            const sum16 = working[page.addr] + working[page.addr + 1] + working[page.addr + 2];
            working[page.addr + 30] = (sum16 >> 8) & 0xFF;
            working[page.addr + 31] = sum16 & 0xFF;
        });
        const last = run[run.length - 1];
        return {
            bytes: working,
            encoded: working.slice(last.addr, last.addr + 3),
            count: run.length
        };
    },

    list() {
        return this.families;
    }
};
