const MathEngine = {

    FACTORS: [1, 2, 4, 8, 10, 16, 32, 64, 100, 160, 256, 1000],
    XOR_MASKS: [0xFF, 0xFFFF, 0xFFFFFF, 0xFFFFFFFF, 0x55, 0xAA, 0x5A, 0xA5],
    ADD_CONSTS: [0, 1, 3, 5, 7, 8, 16, 32, 64, 100, 256],

    toBytes(value, width, littleEndian) {
        const bytes = new Uint8Array(width);
        let n = value >>> 0;
        if (width >= 5) {
            const big = BigInt(value);
            for (let i = 0; i < width; i++) {
                const shift = littleEndian ? BigInt(i * 8) : BigInt((width - 1 - i) * 8);
                bytes[i] = Number((big >> shift) & 0xFFn);
            }
            return bytes;
        }
        for (let i = 0; i < width; i++) {
            const shift = littleEndian ? i * 8 : (width - 1 - i) * 8;
            bytes[i] = (n >>> shift) & 0xFF;
        }
        return bytes;
    },

    fromBytes(bytes, offset, width, littleEndian) {
        if (offset + width > bytes.length) return null;
        let n = 0;
        for (let i = 0; i < width; i++) {
            const b = bytes[offset + (littleEndian ? i : width - 1 - i)];
            n += b * Math.pow(256, i);
        }
        return n;
    },

    toBCD(value, width) {
        const text = String(Math.max(0, value | 0)).padStart(width * 2, "0").slice(-(width * 2));
        const bytes = new Uint8Array(width);
        for (let i = 0; i < width; i++) {
            bytes[i] = parseInt(text.substr(i * 2, 2), 16);
        }
        return bytes;
    },

    fromBCD(bytes, offset, width) {
        if (offset + width > bytes.length) return null;
        let text = "";
        for (let i = 0; i < width; i++) {
            const b = bytes[offset + i];
            const hi = b >> 4;
            const lo = b & 0x0F;
            if (hi > 9 || lo > 9) return null;
            text += hi.toString() + lo.toString();
        }
        return parseInt(text, 10);
    },

    swap16(value) {
        return ((value & 0xFF) << 8) | ((value >> 8) & 0xFF);
    },

    swap32(value) {
        return (
            ((value & 0xFF) << 24) |
            ((value & 0xFF00) << 8) |
            ((value >> 8) & 0xFF00) |
            ((value >> 24) & 0xFF)
        ) >>> 0;
    },

    nibbleSwap(value) {
        let out = 0;
        let shift = 0;
        let n = value >>> 0;
        while (n > 0 || shift === 0) {
            const lo = n & 0x0F;
            const hi = (n >> 4) & 0x0F;
            out |= ((lo << 4) | hi) << shift;
            n >>>= 8;
            shift += 8;
            if (shift >= 32) break;
        }
        return out >>> 0;
    },

    rol(value, bits, widthBits) {
        const mask = widthBits === 32 ? 0xFFFFFFFF : (1 << widthBits) - 1;
        const v = value & mask;
        const b = bits % widthBits;
        return ((v << b) | (v >>> (widthBits - b))) & mask;
    },

    ror(value, bits, widthBits) {
        const mask = widthBits === 32 ? 0xFFFFFFFF : (1 << widthBits) - 1;
        const v = value & mask;
        const b = bits % widthBits;
        return ((v >>> b) | (v << (widthBits - b))) & mask;
    },

    hexBytes(bytes) {
        return Array.from(bytes).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    },

    indexFile(bytes) {
        const idx = { 2: new Map(), 3: new Map(), 4: new Map() };
        [2, 3, 4].forEach((width) => {
            for (let i = 0; i <= bytes.length - width; i++) {
                const key = this.hexBytes(bytes.subarray(i, i + width));
                let list = idx[width].get(key);
                if (!list) {
                    list = [];
                    idx[width].set(key, list);
                }
                if (list.length < 24) list.push(i);
            }
        });
        return idx;
    },

    lookupIndex(index, pattern) {
        if (!pattern || !pattern.length || !index || !index[pattern.length]) return [];
        const hits = index[pattern.length].get(this.hexBytes(pattern));
        return hits ? hits.slice() : [];
    },

    findPattern(bytes, pattern) {
        const hits = [];
        if (!pattern.length || pattern.length > bytes.length) return hits;
        for (let i = 0; i <= bytes.length - pattern.length; i++) {
            let ok = true;
            for (let j = 0; j < pattern.length; j++) {
                if (bytes[i + j] !== pattern[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) hits.push(i);
        }
        return hits;
    },

    encodeWriteup(formula, endian, width) {
        const order = endian === "BE" ? "big-endian" : "little-endian";
        return "Codifica el valor con " + formula + ", luego escríbelo en " + width + " bytes " + order + ".";
    },

    lastComboCount: 0,
    COMBO_CAP: 350000,

    transforms(value) {
        const items = [];
        const seen = new Set();
        const cap = this.COMBO_CAP;
        const push = (name, val) => {
            if (items.length >= cap) return false;
            if (!Number.isFinite(val) || val < 0 || val > 0xFFFFFFFF) return false;
            const key = name + "|" + (val >>> 0);
            if (seen.has(key)) return false;
            seen.add(key);
            items.push({ name, value: val >>> 0 });
            return true;
        };

        const factors = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256, 500, 512, 1000, 1024, 1609, 10000, 100000];
        const xorMasks = [0x01, 0x0F, 0xF0, 0x7F, 0x80, 0xFF, 0x55, 0xAA, 0x5A, 0xA5, 0x3C, 0xC3, 0x69, 0x96, 0x0F0F, 0xF0F0, 0x3333, 0xCCCC, 0xFF00, 0x00FF, 0xFFFF, 0xFF0000, 0xFFFFFF, 0xFFFFFFFF, 0x0101, 0x1010, 0x1111, 0x00FF00FF];
        const adds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 20, 32, 50, 64, 100, 128, 255, 256, 1000];
        const mods = [10, 16, 100, 128, 255, 256, 1000, 4096, 65536];
        const rolls = [1, 2, 3, 4, 5, 6, 7, 8];

        push("X", value);
        push("~X", (~value) >>> 0);
        push("NOT8(X)", (~value) & 0xFF);
        push("NOT16(X)", (~value) & 0xFFFF);
        push("SWAP16(X)", this.swap16(value));
        push("SWAP32(X)", this.swap32(value));
        push("NIBBLE_SWAP(X)", this.nibbleSwap(value));
        push("GRAY(X)", (value ^ (value >>> 1)) >>> 0);
        push("X*10+1", value * 10 + 1);
        push("X*10-1", value * 10 - 1);
        push("X*10+5", value * 10 + 5);
        push("X*1000", value * 1000);
        push("SWAP16(X*10)", this.swap16(value * 10));
        push("(X<<8)|LO", ((value << 8) | (value & 0xFF)) >>> 0);

        factors.forEach((factor) => {
            push("X * " + factor, value * factor);
            if (factor !== 1 && value % factor === 0) push("X / " + factor, value / factor);
            push("X + " + factor, value + factor);
            if (value >= factor) push("X - " + factor, value - factor);
            push("X MOD " + factor, value % factor);
        });

        xorMasks.forEach((mask) => {
            push("X XOR " + mask.toString(16).toUpperCase(), value ^ mask);
        });

        [8, 16, 24, 32].forEach((width) => {
            rolls.forEach((bits) => {
                push("ROL" + width + "(" + bits + ")", this.rol(value, bits, width));
                push("ROR" + width + "(" + bits + ")", this.ror(value, bits, width));
                push("SHL" + width + "(" + bits + ")", (value << bits) >>> 0);
                push("SHR" + width + "(" + bits + ")", value >>> bits);
            });
        });

        adds.forEach((add) => {
            factors.forEach((factor) => {
                push("(X + " + add + ") * " + factor, (value + add) * factor);
                push("X * " + factor + " + " + add, value * factor + add);
                if (add) push("X * " + factor + " - " + add, value * factor - add);
            });
        });

        xorMasks.forEach((mask) => {
            const xored = value ^ mask;
            const m = mask.toString(16).toUpperCase();
            factors.forEach((factor) => {
                adds.forEach((add) => {
                    if (items.length >= cap) return;
                    const core = xored * factor + add;
                    const label = add
                        ? "(X XOR " + m + ") * " + factor + " + " + add
                        : (factor === 1 ? "X XOR " + m : "(X XOR " + m + ") * " + factor);
                    push(label, core);
                    rolls.forEach((bits) => {
                        push("(" + label + ") ROL8 " + bits, this.rol(core, bits, 8));
                        push("(" + label + ") ROL16 " + bits, this.rol(core, bits, 16));
                        push("(" + label + ") ROL24 " + bits, this.rol(core, bits, 24));
                        push("(" + label + ") ROL32 " + bits, this.rol(core, bits, 32));
                        push("(" + label + ") ROR8 " + bits, this.ror(core, bits, 8));
                        push("(" + label + ") ROR16 " + bits, this.ror(core, bits, 16));
                    });
                    mods.forEach((mod) => {
                        push("(" + label + ") MOD " + mod, core % mod);
                    });
                });
            });
        });

        this.lastComboCount = items.length;
        return items;
    },

    applyFormula(value, formula) {
        const f = String(formula || "X");
        const n = Number(value);
        if (f === "X") return n >>> 0;
        if (f === "~X") return (~n) >>> 0;
        if (f === "NOT8(X)") return (~n) & 0xFF;
        if (f === "SWAP16(X)") return this.swap16(n);
        if (f === "SWAP32(X)") return this.swap32(n);
        if (f === "NIBBLE_SWAP(X)") return this.nibbleSwap(n);
        if (f === "GRAY(X)") return (n ^ (n >>> 1)) >>> 0;
        if (f === "BCD") return n >>> 0;
        let m = f.match(/^X\s*\*\s*(\d+)\s*\+\s*(\d+)$/);
        if (m) return (n * Number(m[1]) + Number(m[2])) >>> 0;
        m = f.match(/^X\s*\*\s*(\d+)\s*-\s*(\d+)$/);
        if (m) return (n * Number(m[1]) - Number(m[2])) >>> 0;
        if (f === "X*10+5" || f === "X * 10 + 5") return (n * 10 + 5) >>> 0;
        if (f === "X*1000" || f === "X * 1000") return (n * 1000) >>> 0;
        if (f === "SWAP16(X*10)") return this.swap16(n * 10);
        m = f.match(/^X\s*\*\s*(\d+)$/);
        if (m) return (n * Number(m[1])) >>> 0;
        m = f.match(/^X\s*\/\s*(\d+)$/);
        if (m) return Number(m[1]) ? (n / Number(m[1])) >>> 0 : n;
        m = f.match(/^X\s*\+\s*(\d+)$/);
        if (m) return (n + Number(m[1])) >>> 0;
        m = f.match(/^X\s*-\s*(\d+)$/);
        if (m) return (n - Number(m[1])) >>> 0;
        m = f.match(/^X XOR ([0-9A-F]+)$/i);
        if (m) return (n ^ parseInt(m[1], 16)) >>> 0;
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+) \+ (\d+)$/i);
        if (m) return (((n ^ parseInt(m[1], 16)) * Number(m[2])) + Number(m[3])) >>> 0;
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (m) return ((n ^ parseInt(m[1], 16)) * Number(m[2])) >>> 0;
        m = f.match(/^\(X \+ (\d+)\) \* (\d+)$/);
        if (m) return ((n + Number(m[1])) * Number(m[2])) >>> 0;
        m = f.match(/^ROL(\d+)\((\d+)\)$/);
        if (m) return this.rol(n, Number(m[2]), Number(m[1]));
        m = f.match(/^ROR(\d+)\((\d+)\)$/);
        if (m) return this.ror(n, Number(m[2]), Number(m[1]));
        m = f.match(/^SHL(\d+)\((\d+)\)$/);
        if (m) return (n << Number(m[2])) >>> 0;
        m = f.match(/^SHR(\d+)\((\d+)\)$/);
        if (m) return n >>> Number(m[2]);
        if (f === "GRAY(X)") return (n ^ (n >>> 1)) >>> 0;
        if (f === "NIBBLE_SWAP(X)") return this.nibbleSwap(n);
        if (f === "NOT16(X)") return (~n) & 0xFFFF;
        return n >>> 0;
    },

    invertFormula(stored, formula) {
        const f = String(formula || "X");
        const n = Number(stored);
        if (f === "X" || f === "BCD") return n;
        if (f === "~X") return (~n) >>> 0;
        let m = f.match(/^X\s*\*\s*(\d+)\s*-\s*(\d+)$/);
        if (m) return (n + Number(m[2])) / Number(m[1]);
        m = f.match(/^X\s*\*\s*(\d+)\s*\+\s*(\d+)$/);
        if (m) return (n - Number(m[2])) / Number(m[1]);
        m = f.match(/^X\s*\*\s*(\d+)$/);
        if (m) return n / Number(m[1]);
        m = f.match(/^X\s*\/\s*(\d+)$/);
        if (m) return n * Number(m[1]);
        m = f.match(/^X\s*\+\s*(\d+)$/);
        if (m) return n - Number(m[1]);
        m = f.match(/^X\s*-\s*(\d+)$/);
        if (m) return n + Number(m[1]);
        m = f.match(/^X XOR ([0-9A-F]+)$/i);
        if (m) return (n ^ parseInt(m[1], 16)) >>> 0;
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+) \+ (\d+)$/i);
        if (m) {
            const factor = Number(m[2]);
            if (!factor) return n;
            return ((n - Number(m[3])) / factor) ^ parseInt(m[1], 16);
        }
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (m) {
            const factor = Number(m[2]);
            if (!factor) return n;
            return (n / factor) ^ parseInt(m[1], 16);
        }
        return n;
    },

    variantsForValue(value) {
        if (this._variantCache && this._variantCache.value === value) return this._variantCache.items;
        const variants = [];
        const seen = new Set();

        const addBytes = (formula, bytes, extra) => {
            const key = formula + "|" + this.hexBytes(bytes);
            if (seen.has(key)) return;
            seen.add(key);
            variants.push(Object.assign({
                formula,
                bytes,
                hex: this.hexBytes(bytes),
                width: bytes.length
            }, extra || {}));
        };

        const transforms = this.transforms(value);
        transforms.forEach((item) => {
            [2, 3, 4].forEach((width) => {
                if (variants.length >= this.COMBO_CAP) return;
                const max = Math.pow(256, width);
                if (width < 4 && item.value >= max) return;
                addBytes(item.name, this.toBytes(item.value, width, true), { endian: "LE", numeric: item.value });
                addBytes(item.name, this.toBytes(item.value, width, false), { endian: "BE", numeric: item.value });
                if (width >= 2) {
                    const le = this.toBytes(item.value, width, true);
                    const sw = new Uint8Array(le.length);
                    for (let i = 0; i + 1 < le.length; i += 2) {
                        sw[i] = le[i + 1];
                        sw[i + 1] = le[i];
                    }
                    if (le.length % 2) sw[le.length - 1] = le[le.length - 1];
                    addBytes(item.name, sw, { endian: "SWAP16", numeric: item.value });
                }
            });
        });

        [2, 3, 4].forEach((width) => {
            const text = String(value);
            if (text.length <= width * 2) {
                addBytes("BCD", this.toBCD(value, width), { endian: "BCD", numeric: value });
            }
        });

        this.lastComboCount = variants.length;
        this._variantCache = { value, items: variants };
        return variants;
    }

};
