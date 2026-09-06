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

    transforms(value) {
        const items = [];
        const push = (name, val) => {
            if (!Number.isFinite(val) || val < 0 || val > 0xFFFFFFFF) return;
            items.push({ name, value: val >>> 0 });
        };

        push("X", value);
        push("~X", (~value) >>> 0);
        push("NOT8(X)", (~value) & 0xFF);
        push("SWAP16(X)", this.swap16(value));
        push("SWAP32(X)", this.swap32(value));
        push("NIBBLE_SWAP(X)", this.nibbleSwap(value));

        this.FACTORS.forEach((factor) => {
            push("X * " + factor, value * factor);
            if (factor !== 1 && value % factor === 0) {
                push("X / " + factor, value / factor);
            }
            push("X + " + factor, value + factor);
            if (value >= factor) push("X - " + factor, value - factor);
        });

        const xorMasks = [0xFF, 0xFFFF, 0xFFFFFFFF, 0x55, 0xAA];
        const xorFactors = [1, 8, 10, 16, 100];
        const xorAdds = [0, 1, 3];

        xorMasks.forEach((mask) => {
            const xored = value ^ mask;
            push("X XOR " + mask.toString(16).toUpperCase(), xored);
            xorFactors.forEach((factor) => {
                xorAdds.forEach((add) => {
                    const label = add
                        ? "(X XOR " + mask.toString(16).toUpperCase() + ") * " + factor + " + " + add
                        : (factor === 1 ? "X XOR " + mask.toString(16).toUpperCase() : "(X XOR " + mask.toString(16).toUpperCase() + ") * " + factor);
                    push(label, xored * factor + add);
                });
            });
        });

        [1, 3, 16, 100].forEach((add) => {
            [1, 10, 16].forEach((factor) => {
                push("(X + " + add + ") * " + factor, (value + add) * factor);
                push("X * " + factor + " + " + add, value * factor + add);
            });
        });

        [8, 16, 32].forEach((width) => {
            [1, 4, 8].forEach((bits) => {
                push("ROL" + width + "(" + bits + ")", this.rol(value, bits, width));
                push("ROR" + width + "(" + bits + ")", this.ror(value, bits, width));
            });
        });

        return items;
    },

    variantsForValue(value) {
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

        this.transforms(value).forEach((item) => {
            [2, 3, 4].forEach((width) => {
                const max = Math.pow(256, width);
                if (item.value >= max && width < 4) return;
                if (width < 4 && item.value >= max) return;
                addBytes(item.name, this.toBytes(item.value, width, true), { endian: "LE", numeric: item.value });
                addBytes(item.name, this.toBytes(item.value, width, false), { endian: "BE", numeric: item.value });
            });
        });

        [2, 3, 4].forEach((width) => {
            const text = String(value);
            if (text.length <= width * 2) {
                addBytes("BCD", this.toBCD(value, width), { endian: "BCD", numeric: value });
            }
        });

        return variants;
    }

};
