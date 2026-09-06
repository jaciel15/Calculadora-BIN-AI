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

    identify(bytes) {
        return this.detectYamaha(bytes) || this.detectOdyssey(bytes) || null;
    },

    list() {
        return this.families;
    }
};
