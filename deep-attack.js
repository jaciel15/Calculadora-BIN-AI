const DeepAttack = {
    running: false,
    timer: null,
    started: 0,
    MIN_MS: 5 * 60 * 1000,
    SIM_MS: 2 * 60 * 1000,
    MAX_MS: 10 * 60 * 1000,
    HARD_MS: 15 * 60 * 1000,
    lastReport: null,

    hex(value, size) {
        return Number(value).toString(16).toUpperCase().padStart(size || 4, "0");
    },

    saneKm(value) {
        return Number.isFinite(value) && value >= 500 && value <= 2000000 && value === Math.round(value);
    },

    changedLines(a, b) {
        return this.changedLinesMany(a, [b]);
    },

    changedLinesMany(a, others) {
        const seen = [];
        const have = new Set();
        (others || []).forEach((b) => {
            if (!b) return;
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i++) {
                if (a[i] === b[i]) continue;
                const line = i & ~0x0F;
                if (!have.has(line)) {
                    have.add(line);
                    seen.push(line);
                }
            }
        });
        return seen;
    },

    read(bytes, addr, width, little) {
        if (addr < 0 || addr + width > bytes.length) return null;
        return MathEngine.fromBytes(bytes, addr, width, little);
    },

    matchPair(raw1, raw2, km1, km2) {
        if (raw1 === null || raw2 === null || !km1 || !km2) return null;
        if (Number(km1) !== Number(km2) && raw1 === raw2) return null;
        const slack = 40;
        const n = Math.round(raw1 / km1);
        if (n >= 1 && n <= 1000000 && Math.abs(raw1 - km1 * n) <= slack && Math.abs(raw2 - km2 * n) <= slack) {
            const off = raw1 - km1 * n;
            return { formula: n === 1 ? "X" : "X * " + n, n: n, off: off };
        }
        const add = raw1 - km1;
        if (add === (raw2 - km2) && add >= 1 && add <= 1000000) {
            return { formula: "X + " + add, n: 1, off: add };
        }
        const xor = raw1 ^ km1;
        if (xor === (raw2 ^ km2) && xor > 0 && xor <= 0xFFFFFF) {
            return { formula: "X XOR " + xor.toString(16).toUpperCase(), n: xor, off: 0 };
        }
        if (raw1 && raw2 && km1 % raw1 === 0 && km2 % raw2 === 0 && (km1 / raw1) === (km2 / raw2)) {
            const d = km1 / raw1;
            if (d >= 1 && d <= 1000000) return { formula: "X / " + d, n: d, off: 0 };
        }
        const d1 = Math.round(km1 / raw1);
        if (raw1 && d1 >= 1 && d1 <= 1000000 &&
            Math.abs(raw1 - (km1 / d1)) <= slack &&
            Math.abs(raw2 - (km2 / d1)) <= slack) {
            return { formula: "X / " + d1, n: d1, off: 0 };
        }
        return null;
    },

    recipeFitsFile(item, bytes) {
        if (typeof CodeBook !== "undefined" && CodeBook.fitsFile) return CodeBook.fitsFile(item, bytes);
        return true;
    },

    knownRecipes() {
        const out = [];
        const seen = new Set();
        const bytes = this._ctx && this._ctx.bytes;
        const push = (item) => {
            if (!item || !item.formula || item.formula === "FINO") return;
            if (typeof KnowledgeBase !== "undefined" && KnowledgeBase.isHidden(item)) return;
            if (bytes && !this.recipeFitsFile(item, bytes)) return;
            const width = Number(item.width || item.length) || 0;
            if (width < 2 || width > 4) return;
            const endian = item.endian === "BE" || item.endian === "BIG_ENDIAN" ? "BE"
                : (item.endian === "BCD" ? "BCD" : "LE");
            const familyId = item.familyId || item.id || item.codeId || "";
            const familyLocked = /YAMAHA_|ODYSSEY_/i.test(String(familyId));
            const key = String(item.formula) + "|" + width + "|" + endian + (familyLocked ? "|" + familyId : "");
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                name: item.name || item.id || item.expression || key,
                familyId: familyLocked ? familyId : "",
                formula: item.formula,
                width: width,
                endian: endian,
                chk: item.chk || (item.checksums && item.checksums[0] && item.checksums[0].name) || ""
            });
        };
        if (typeof CodeBook !== "undefined") {
            CodeBook.list().filter((c) => !/YAMAHA_|ODYSSEY_/i.test(c.id)).forEach(push);
            CodeBook.list().filter((c) => /YAMAHA_|ODYSSEY_/i.test(c.id)).forEach(push);
        }
        if (typeof KnowledgeBase !== "undefined") {
            const db = KnowledgeBase.load();
            (db.algorithms || []).forEach(push);
            (db.discoveries || []).forEach((d) => push({
                name: d.expression,
                formula: d.expression,
                width: d.length,
                endian: d.endian
            }));
        }
        return out;
    },

    encodeRecipe(code, km) {
        if (typeof EditorEngine !== "undefined" && EditorEngine.encodeValue) {
            return EditorEngine.encodeValue(km, {
                formula: code.formula,
                width: code.width,
                endian: code.endian
            });
        }
        if (code.endian === "BCD" || code.formula === "BCD") return MathEngine.toBCD(Number(km), code.width);
        return MathEngine.toBytes(MathEngine.applyFormula(Number(km), code.formula), code.width, code.endian !== "BE");
    },

    patternFits(bytes, addr, pattern) {
        if (!bytes || !pattern || addr < 0 || addr + pattern.length > bytes.length) return false;
        for (let i = 0; i < pattern.length; i++) {
            if (bytes[addr + i] !== pattern[i]) return false;
        }
        return true;
    },

    seedFromRecipes(a, b, c, km1, km2, km3, lines) {
        const hits = [];
        const zone = new Set();
        (lines || []).forEach((line) => {
            for (let i = 0; i < 16; i++) zone.add(line + i);
        });
        this.knownRecipes().forEach((code) => {
            let pat1;
            let pat2 = null;
            let pat3 = null;
            try {
                pat1 = this.encodeRecipe(code, km1);
                if (b && km2 != null) pat2 = this.encodeRecipe(code, km2);
                if (c && km3 != null) pat3 = this.encodeRecipe(code, km3);
            } catch (error) {
                return;
            }
            const locs = MathEngine.findPattern(a, pat1).filter((addr) => {
                if (zone.size && !zone.has(addr)) return false;
                if (pat2 && !this.patternFits(b, addr, pat2)) return false;
                if (pat3 && !this.patternFits(c, addr, pat3)) return false;
                return true;
            });
            if (!locs.length) return;
            locs.forEach((addr) => {
                const line = addr & ~0x0F;
                const chk1 = this.checksumsOnLine(a, line, addr, code.width);
                hits.push({
                    line: line,
                    addr: addr,
                    width: code.width,
                    endian: code.endian,
                    formula: code.formula,
                    raw: this.read(a, addr, code.width, code.endian !== "BE" && code.endian !== "BCD"),
                    km: km1,
                    hex: MathEngine.hexBytes(a.slice(addr, addr + code.width)),
                    checksum: chk1[0] || null,
                    copies: locs,
                    stair: locs.length,
                    score: (/YAMAHA_|ODYSSEY_/i.test(String(code.familyId)) ? 97 : 86) + (chk1[0] ? 2 : 0),
                    familyId: /YAMAHA_|ODYSSEY_/i.test(String(code.familyId)) ? code.familyId : "",
                    fromKnown: /YAMAHA_|ODYSSEY_/i.test(String(code.familyId)),
                    name: code.name
                });
            });
        });
        return hits;
    },

    matchKnown(raw1, raw2, raw3, km1, km2, km3, job) {
        const recipes = this._recipes || [];
        for (let i = 0; i < recipes.length; i++) {
            const code = recipes[i];
            if (code.width !== job.width) continue;
            if (code.endian === "BE" && job.en.little) continue;
            if (code.endian === "LE" && !job.en.little) continue;
            const e1 = MathEngine.applyFormula(km1, code.formula);
            const e2 = MathEngine.applyFormula(km2, code.formula);
            if (Math.abs(e1 - raw1) > 40 || Math.abs(e2 - raw2) > 40) continue;
            const hit = { formula: code.formula, n: 0, off: 0, name: code.name, familyId: code.familyId, fromKnown: true };
            if (raw3 != null && km3 != null) {
                const e3 = MathEngine.applyFormula(km3, code.formula);
                if (Math.abs(e3 - raw3) > 40) hit.cMiss = true;
            }
            return hit;
        }
        return null;
    },

    matchMany(raws, kms) {
        const match = this.matchPair(raws[0], raws[1], kms[0], kms[1]);
        if (!match) return null;
        if (raws[2] == null || kms[2] == null) return match;
        const expect = typeof MathEngine !== "undefined"
            ? MathEngine.applyFormula(kms[2], match.formula)
            : null;
        if (expect !== null && Math.abs(expect - raws[2]) <= 40) return match;
        match.cMiss = true;
        return match;
    },

    xorKeyHex(keys) {
        return Array.from(keys).map((b) => this.hex(b, 2)).join("-");
    },

    matchXorBytes(a, b, c, addr, width, little, km1, km2, km3) {
        if (!a || !b || km1 == null || km2 == null) return null;
        const formulas = ["X", "X * 10", "X * 100", "X / 4", "X / 10", "X / 16", "X / 64", "X * 4", "X * 64", "~X", "NIBBLE_SWAP(X)", "BCD"];
        if (this._help && this._help.formula && formulas.indexOf(this._help.formula) < 0) {
            formulas.unshift(this._help.formula.replace(/\s+XORBYTES?\s+.*/i, "").trim() || "X");
        }
        const slice = (bytes) => bytes.slice(addr, addr + width);
        const keyOf = (stored, plain) => {
            const k = new Uint8Array(width);
            for (let i = 0; i < width; i++) k[i] = stored[i] ^ plain[i];
            return k;
        };
        const sameKey = (k1, k2) => {
            for (let i = 0; i < k1.length; i++) if (k1[i] !== k2[i]) return false;
            return true;
        };
        const stored1 = slice(a);
        const stored2 = slice(b);
        const stored3 = c ? slice(c) : null;
        for (let fi = 0; fi < formulas.length; fi++) {
            const f = formulas[fi];
            let p1;
            let p2;
            let p3 = null;
            try {
                if (f === "BCD") {
                    p1 = MathEngine.toBCD(km1, width);
                    p2 = MathEngine.toBCD(km2, width);
                    if (km3 != null) p3 = MathEngine.toBCD(km3, width);
                } else {
                    p1 = MathEngine.toBytes(MathEngine.applyFormula(km1, f), width, little);
                    p2 = MathEngine.toBytes(MathEngine.applyFormula(km2, f), width, little);
                    if (km3 != null) p3 = MathEngine.toBytes(MathEngine.applyFormula(km3, f), width, little);
                }
            } catch (error) {
                continue;
            }
            const k1 = keyOf(stored1, p1);
            const k2 = keyOf(stored2, p2);
            if (!sameKey(k1, k2)) continue;
            if (stored3 && p3 && km3 != null) {
                const k3 = keyOf(stored3, p3);
                if (!sameKey(k1, k3)) {
                    /* el tercer dump no calzó; sigo con el par */
                }
            }
            let allZero = true;
            let oneByte = true;
            for (let i = 0; i < k1.length; i++) {
                if (k1[i]) allZero = false;
                if (k1[i] !== k1[0]) oneByte = false;
            }
            if (allZero) return { formula: f, fromXor: false, name: f };
            const formula = oneByte
                ? (f + " XORBYTE " + this.hex(k1[0], 2))
                : (f + " XORBYTES " + this.xorKeyHex(k1));
            return { formula: formula, fromXor: true, xorKeys: k1, name: formula };
        }
        return null;
    },

    copiesOnDiffOffset(diffs, addr, fileLen, width) {
        const off = addr & 0x0F;
        const out = [];
        const seen = new Set();
        (diffs || []).forEach((i) => {
            if ((i & 0x0F) < off || (i & 0x0F) >= off + width) return;
            const start = (i & ~0x0F) + off;
            if (start + width > fileLen || seen.has(start)) return;
            seen.add(start);
            out.push(start);
        });
        if (!seen.has(addr)) out.unshift(addr);
        return out.slice(0, 64);
    },

    huntVins(a, b, c) {
        const vins = [];
        const vinByte = function (b) {
            return (b >= 48 && b <= 57) || (b >= 65 && b <= 90 && b !== 73 && b !== 79 && b !== 81);
        };
        const scan = function (bytes, tag) {
            if (!bytes) return;
            const limit = Math.min(bytes.length, 262144);
            for (let i = 0; i + 17 <= limit && vins.length < 12; i++) {
                let ok = true;
                let text = "";
                for (let k = 0; k < 17; k++) {
                    const b = bytes[i + k];
                    if (!vinByte(b)) {
                        ok = false;
                        break;
                    }
                    text += String.fromCharCode(b);
                }
                if (ok && /[A-Z]/.test(text) && /[0-9]/.test(text) && !/^P{8}/.test(text)) {
                    vins.push({ file: tag, value: text, address: i, layout: "PACKED" });
                    i += 16;
                }
            }
        };
        scan(a, "BIN1");
        scan(b, "BIN2");
        scan(c, "BIN3");
        return vins;
    },

    simulateHit(hit, bytes, kmNow) {
        const logs = [];
        if (!hit || !bytes || typeof EditorEngine === "undefined") return logs;
        const best = this.buildBest(hit);
        const trials = [];
        const seen = new Set();
        [kmNow, 10000, 12000, 33123, 50000, 80000].forEach((km) => {
            const n = Number(km);
            if (!Number.isFinite(n) || n <= 0 || seen.has(n)) return;
            seen.add(n);
            trials.push(n);
        });
        trials.forEach((km) => {
            try {
                const ghost = EditorEngine.apply(bytes, best, km);
                let changed = 0;
                for (let i = 0; i < bytes.length; i++) if (bytes[i] !== ghost.bytes[i]) changed++;
                logs.push({
                    km: km,
                    hex: ghost.hex,
                    copies: ghost.copies,
                    bytes: changed,
                    ok: changed > 0 && changed <= Math.max(
                        best.copies.length * ((best.width || 2) + 4),
                        (best.scatter && best.scatter.length ? best.scatter.length + 24 : 0),
                        24
                    )
                });
            } catch (error) {
                logs.push({ km: km, hex: "error", copies: 0, bytes: 0, ok: false });
            }
        });
        return logs;
    },

    sameChkSlot(a, b) {
        return a.name === b.name && (a.storedAt - (a.storedAt & ~0x0F)) === (b.storedAt - (b.storedAt & ~0x0F));
    },

    checksumsOnLine(bytes, line, kmAddr, kmWidth) {
        const found = [];
        const algos = ChecksumEngine.algorithms();
        const end = Math.min(bytes.length, line + 32);
        algos.forEach((algo) => {
            const calc = algo.fn(bytes, kmAddr, kmAddr + kmWidth);
            for (let at = line; at + algo.size <= end; at++) {
                if (at >= kmAddr && at < kmAddr + kmWidth) continue;
                const stored = MathEngine.fromBytes(bytes, at, algo.size, false);
                const storedLe = MathEngine.fromBytes(bytes, at, algo.size, true);
                if (stored === calc) found.push({ name: algo.name, storedAt: at, endian: "BE", value: calc });
                else if (storedLe === calc) found.push({ name: algo.name, storedAt: at, endian: "LE", value: calc });
            }
        });
        return found;
    },

    decodeHow(hit) {
        const bits = [];
        bits.push("Línea " + this.hex(hit.line) + " @ " + this.hex(hit.addr) + " guarda el KM en " + hit.width + " bytes " + hit.endian + ".");
        bits.push("Fórmula: " + hit.formula + ".");
        if (hit.fromKnown && hit.name) bits.push("Usó el algoritmo que ya tenía: " + hit.name + ".");
        if (hit.stair) bits.push("Hacia 0000 el valor baja de 1 en 1 (" + hit.stair + " páginas).");
        if (hit.checksum) {
            bits.push("Checksum " + hit.checksum.name + " " + (hit.checksum.endian || "") +
                (hit.checksum.start != null ? " de " + this.hex(hit.checksum.start) + "-" + this.hex(hit.checksum.end - 1) : " de esos " + hit.width + " bytes") +
                ", escrito en " + this.hex(hit.checksum.storedAt) + ".");
        } else {
            bits.push("Aún no ligó SUM/CRC de ese KM.");
        }
        if (hit.scatter && hit.scatter.length) {
            bits.push("BIN 1 original vs BIN 2 editado: el KM se igualó en " + hit.scatter.length +
                " bytes y no toqué lo que se queda igual (ni lo que hay que dejar).");
        }
        return bits.join(" ");
    },

    buildBest(hit) {
        const copies = (hit.copies && hit.copies.length ? hit.copies : [hit.addr]).slice(0, 64);
        return {
            fromPair: true,
            fromAttack: true,
            familyId: hit.familyId || "",
            label: "KILOMETRAJE",
            name: hit.name || ("ATAQUE_" + String(hit.formula).replace(/\s+/g, "_")),
            fromKnown: !!hit.fromKnown,
            fromSaved: !!hit.fromSaved,
            formula: hit.formula,
            width: hit.width,
            endian: hit.endian,
            copies: copies,
            address: hit.addr,
            addressText: this.hex(hit.addr) + "-" + this.hex(hit.addr + hit.width - 1),
            hex: hit.hex,
            numeric: hit.km,
            value: hit.km,
            writeHow: this.decodeHow(hit),
            confidence: hit.score,
            representation: hit.formula + " · solo variación",
            writable: true,
            checksumAt: hit.checksum ? hit.checksum.storedAt : undefined,
            checksumName: hit.checksum ? hit.checksum.name : undefined,
            checksumEndian: hit.checksum ? hit.checksum.endian : undefined,
            checksumSize: hit.checksum ? hit.checksum.size : undefined,
            checksumStart: hit.checksum && hit.checksum.start != null ? hit.checksum.start : undefined,
            checksumEnd: hit.checksum && hit.checksum.end != null ? hit.checksum.end : undefined,
            scatter: hit.scatter && hit.scatter.length ? hit.scatter.slice(0, 96) : undefined,
            equalize: !!hit.equalize,
            operation: (hit.formula || "X") + " · " + hit.width + "B " + (hit.endian || "LE") +
                (hit.checksum ? " · " + hit.checksum.name + " @" + this.hex(hit.checksum.storedAt) : ""),
            vin: (this._vins && this._vins[0] && this._vins[0].value) || ""
        };
    },

    notify(title, body) {
        try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(title, { body: body, silent: false });
            }
        } catch (error) { /* ignore */ }
    },

    isSolid(hit) {
        if (!hit || !hit.formula) return false;
        const copies = hit.copies || [];
        if (copies.length < 1 || copies.length > 64) return false;
        if (hit.fromUser && copies.length >= 1) return true;
        if (hit.fromHelp && copies.length >= 1) return true;
        if (hit.fromSaved && copies.length <= 64) return !!(hit.checksum || copies.length >= 2 || hit.fromXor);
        if (hit.fromKnown && hit.familyId && this._ctx && this.recipeFitsFile({ id: hit.familyId, familyId: hit.familyId }, this._ctx.bytes)) {
            return copies.length <= 64;
        }
        if (hit.fromXor && copies.length >= 1) return true;
        if (hit.scatter && hit.scatter.length >= 4) return true;
        if (hit.checksum && copies.length >= 1) return true;
        return !!(hit.fromPair && copies.length >= 2);
    },

    diffBytes(a, others) {
        const set = new Set();
        (others || []).forEach((b) => {
            if (!b) return;
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i++) {
                if (a[i] !== b[i]) set.add(i);
            }
        });
        return set;
    },

    checksumFns() {
        return [
            { name: "SUM8", size: 1, fn: (b, s, e) => ChecksumEngine.sum8(b, s, e) },
            { name: "CRC8", size: 1, fn: (b, s, e) => ChecksumEngine.crc8(b, s, e) },
            { name: "XOR8", size: 1, fn: (b, s, e) => ChecksumEngine.xor8(b, s, e) },
            { name: "COMP8", size: 1, fn: (b, s, e) => (0x100 - ChecksumEngine.sum8(b, s, e)) & 0xFF },
            { name: "SUM16", size: 2, fn: (b, s, e) => ChecksumEngine.sum16(b, s, e) },
            { name: "XOR16", size: 2, fn: (b, s, e) => ChecksumEngine.xor16(b, s, e) },
            { name: "CRC16", size: 2, fn: (b, s, e) => ChecksumEngine.crc16(b, s, e) },
            { name: "CRC16-0", size: 2, fn: (b, s, e) => ChecksumEngine.crc16(b, s, e, 0x1021, 0) },
            { name: "CRC16-IBM", size: 2, fn: (b, s, e) => ChecksumEngine.crc16IBM(b, s, e) },
            { name: "FLETCHER16", size: 2, fn: (b, s, e) => ChecksumEngine.fletcher16(b, s, e) }
        ];
    },

    checksumsNear(bytes, addr, width) {
        const found = [];
        if (!bytes || addr < 0) return found;
        const page = addr & ~0x0F;
        const spots = [];
        for (let at = page; at < page + 16; at++) spots.push(at);
        spots.push(page + 17);
        spots.push(page + 18);
        spots.push(page + 16 + 1);
        spots.push(page + 16 + 2);
        const fill = { 0x00: 1, 0xFF: 1, 0xEB: 1, 0xAA: 1 };
        const tryPush = (name, storedAt, size, endian, calc, start, end) => {
            if (storedAt < 0 || storedAt + size > bytes.length) return;
            if (storedAt >= addr && storedAt < addr + width) return;
            if (size === 1 && fill[bytes[storedAt]]) return;
            const stored = MathEngine.fromBytes(bytes, storedAt, size, endian === "LE");
            if (stored === calc) {
                found.push({
                    name: name,
                    storedAt: storedAt,
                    endian: endian,
                    value: calc,
                    size: size,
                    start: start,
                    end: end
                });
            }
        };
        const windows = [
            [addr, addr + width],
            [addr, page + 17],
            [Math.max(0, addr - 1), page + 17],
            [page + 13, page + 17],
            [page + 13, page + 16],
            [page + 12, page + 16],
            [page + 4, page + 16]
        ];
        if ((addr & 0x0F) === 0x0E && width === 2) {
            windows.push([addr - 1, addr + width]);
            windows.push([addr - 1, page + 16]);
        }
        windows.forEach((win) => {
            const start = win[0];
            const end = win[1];
            if (start < 0 || end > bytes.length || end <= start) return;
            this.checksumFns().forEach((algo) => {
                const calc = algo.fn(bytes, start, end);
                spots.forEach((at) => {
                    if (algo.size === 1) tryPush(algo.name, at, 1, "LE", calc, start, end);
                    else {
                        tryPush(algo.name, at, 2, "BE", calc, start, end);
                        tryPush(algo.name, at, 2, "LE", calc, start, end);
                    }
                });
            });
        });
        return found;
    },

    checksumsThatMove(a, b, addr, width) {
        const chk1 = this.checksumsNear(a, addr, width);
        const chk2 = b ? this.checksumsNear(b, addr, width) : [];
        if (!b) return chk1;
        return chk1.filter((item) => chk2.some((other) =>
            other.name === item.name &&
            (other.storedAt & 0x0F) === (item.storedAt & 0x0F) &&
            other.value !== item.value
        ));
    },

    movingStores(a, b, addr, width) {
        const stores = [];
        if (!a || !b) return stores;
        const page = addr & ~0x0F;
        const seen = new Set();
        const push = (at, size) => {
            if (at < 0 || at + size > a.length) return;
            if (at >= addr && at < addr + width) return;
            const key = at + "|" + size;
            if (seen.has(key)) return;
            let move = false;
            for (let i = 0; i < size; i++) if (a[at + i] !== b[at + i]) move = true;
            if (!move) return;
            seen.add(key);
            stores.push(at);
        };
        for (let at = page; at < page + 34 && at < a.length; at++) {
            push(at, 1);
            push(at, 2);
        }
        push(page + 17, 2);
        push(page + 16 + 1, 2);
        return stores;
    },

    inventChecksum(a, b, addr, width) {
        if (!a || !b) return null;
        const page = addr & ~0x0F;
        const stores = this.movingStores(a, b, addr, width);
        const windows = [
            [addr, addr + width],
            [addr, page + 17],
            [Math.max(0, addr - 1), page + 17],
            [page + 13, page + 17],
            [page + 12, page + 17],
            [page + 4, page + 16]
        ];
        stores.forEach((storeAt) => {
            if (storeAt > addr) windows.push([addr, storeAt]);
            if (storeAt > addr - 1) windows.push([Math.max(0, addr - 1), storeAt]);
            if ((addr & 0x0F) >= 0x0D) windows.push([page + 13, storeAt]);
        });
        const algos = this.checksumFns();
        for (let si = 0; si < stores.length; si++) {
            const storeAt = stores[si];
            for (let wi = 0; wi < windows.length; wi++) {
                const start = windows[wi][0];
                const end = windows[wi][1];
                if (end <= start || end > a.length || start < 0) continue;
                if (storeAt >= start && storeAt < end) continue;
                for (let ai = 0; ai < algos.length; ai++) {
                    const algo = algos[ai];
                    if (storeAt + algo.size > a.length) continue;
                    const calcA = algo.fn(a, start, end);
                    const calcB = algo.fn(b, start, end);
                    if (calcA === calcB) continue;
                    const le = (endian) => MathEngine.fromBytes(a, storeAt, algo.size, endian === "LE") === calcA &&
                        MathEngine.fromBytes(b, storeAt, algo.size, endian === "LE") === calcB;
                    const endian = le("LE") ? "LE" : (le("BE") ? "BE" : null);
                    if (!endian) continue;
                    return {
                        name: algo.name,
                        storedAt: storeAt,
                        endian: endian,
                        value: calcA,
                        size: algo.size,
                        start: start,
                        end: end
                    };
                }
            }
        }
        return null;
    },

    attachChecksum(hit, a, b, c) {
        if (!hit) return hit;
        let same = this.checksumsThatMove(a, b, hit.addr, hit.width);
        if (!same.length && hit.width === 2 && (hit.addr & 0x0F) === 0x0E) {
            same = this.checksumsThatMove(a, b, hit.addr - 1, 3);
        }
        if (!same.length && hit.width === 2) {
            same = this.checksumsThatMove(a, b, Math.max(0, hit.addr - 1), hit.width + 1);
        }
        let chk = same[0] || this.inventChecksum(a, b, hit.addr, hit.width) || this.userChecksum(hit.addr, hit.width);
        if (chk && c && chk.start != null && chk.end != null) {
            const fn = this.checksumFns().find((algo) => algo.name === chk.name);
            if (fn) {
                const calcC = fn.fn(c, chk.start, chk.end);
                const storedC = MathEngine.fromBytes(c, chk.storedAt, chk.size || fn.size, chk.endian === "LE");
                chk.cOk = storedC === calcC;
            }
        }
        if (chk) {
            hit.checksum = chk;
            hit.score = (hit.score || 80) + 10;
        }
        return hit;
    },

    learnScatter(hit, a, b, c, km1, km2, km3) {
        if (!hit || !a || !b || !this._diffs || !this._diffs.size) return hit;
        if (typeof EditorEngine === "undefined" || !EditorEngine.encodeValue) return hit;
        let e1;
        let e2;
        let e3 = null;
        try {
            e1 = EditorEngine.encodeValue(km1, { formula: hit.formula, width: hit.width, endian: hit.endian });
            e2 = EditorEngine.encodeValue(km2, { formula: hit.formula, width: hit.width, endian: hit.endian });
            if (c && km3 != null) e3 = EditorEngine.encodeValue(km3, { formula: hit.formula, width: hit.width, endian: hit.endian });
        } catch (error) {
            return hit;
        }
        if (!e1 || !e2) return hit;
        const map = [];
        this._diffs.forEach((i) => {
            for (let k = 0; k < e1.length; k++) {
                if (a[i] !== e1[k] || b[i] !== e2[k]) continue;
                if (e3 && c[i] !== e3[k]) continue;
                map.push({ addr: i, part: k });
                break;
            }
        });
        if (map.length >= 4 && map.length >= this._diffs.size * 0.45) {
            hit.scatter = map;
            hit.equalize = true;
            hit.score = (hit.score || 80) + 14;
            if (hit.checksum && map.some((s) => s.addr === hit.checksum.storedAt ||
                (hit.checksum.storedAt != null && s.addr === hit.checksum.storedAt + 1))) {
                hit.checksum = null;
            }
        }
        return hit;
    },

    copiesFor(a, b, c, addr, width, little, diffs) {
        const raw1 = this.read(a, addr, width, little);
        const raw2 = b ? this.read(b, addr, width, little) : null;
        const raw3 = c ? this.read(c, addr, width, little) : null;
        if (raw1 === null) return [addr];
        const off = addr & 0x0F;
        const found = [];
        for (let p = off; p + width <= a.length; p += 16) {
            if (this.read(a, p, width, little) !== raw1) continue;
            if (b && this.read(b, p, width, little) !== raw2) continue;
            if (c && raw3 != null && this.read(c, p, width, little) !== raw3) continue;
            found.push(p);
        }
        const onDiff = found.filter((p) => {
            if (!diffs || !diffs.size) return true;
            for (let i = 0; i < width; i++) if (diffs.has(p + i)) return true;
            return false;
        });
        let copies = onDiff.length ? onDiff : [addr];
        if (copies.length > 64) {
            copies = copies.filter((p) => Math.abs(p - addr) <= 0x1000).slice(0, 48);
        }
        if (copies.indexOf(addr) < 0) copies.unshift(addr);
        return Array.from(new Set(copies)).slice(0, 64);
    },

    paintedDump(a, lines, diffs) {
        const totalLines = Math.ceil(a.length / 16);
        if ((lines || []).length > Math.max(120, totalLines * 0.12)) return true;
        if (!diffs || diffs.size < 400) return false;
        const offHit = new Array(16).fill(0);
        diffs.forEach((i) => { offHit[i & 0x0F]++; });
        const top = offHit.slice().sort((x, y) => y - x);
        return top[0] + top[1] > diffs.size * 0.75;
    },

    markAddrs() {
        const out = [];
        const seen = new Set();
        if (typeof MarkBook === "undefined") return out;
        const push = (addr) => {
            const n = Number(addr);
            if (!Number.isFinite(n) || n < 0 || seen.has(n)) return;
            seen.add(n);
            out.push(n);
        };
        ["KM", "HINT", "COPY"].forEach((kind) => {
            (MarkBook.paintedAddrs(kind) || []).forEach(push);
            (MarkBook.lessonRanges(kind) || []).forEach((range) => {
                for (let i = range.start; i <= range.end; i++) push(i);
            });
        });
        return out;
    },

    kmFields() {
        const fields = [];
        const seen = new Set();
        const push = (start, width) => {
            const w = Math.min(4, Math.max(2, Number(width) || 2));
            const key = start + "|" + w;
            if (start < 0 || seen.has(key)) return;
            seen.add(key);
            fields.push({ start: start, width: w });
        };
        if (typeof MarkBook === "undefined") return fields;
        ["KM", "HINT"].forEach((kind) => {
            const ranges = (MarkBook.exclusiveRanges ? MarkBook.exclusiveRanges(kind) : []).concat(MarkBook.lessonRanges(kind) || []);
            ranges.forEach((range) => {
                const size = (range.end - range.start + 1) || range.size || 1;
                if (size >= 2 && size <= 4) push(range.start, size);
                else {
                    push(range.start, 2);
                    push(range.start, 3);
                }
            });
        });
        return fields;
    },

    readHelp() {
        const addrs = this.markAddrs();
        const notes = [];
        let formula = null;
        let width = null;
        let endian = null;
        let chk = null;
        let text = "";
        if (typeof MarkBook !== "undefined") {
            const rec = MarkBook.recipe();
            text = rec.raw || MarkBook.recipeText() || "";
            formula = rec.formula || null;
            width = rec.width || null;
            endian = rec.endian || null;
            chk = rec.chk || null;
            if (rec.note) notes.push(rec.note);
            if (MarkBook.hasHelp()) notes.push("Hay colores o texto de ayuda");
        }
        const raw = String(text);
        const low = raw.toLowerCase();
        if (!formula) {
            if (/x\s*\/\s*4|entre\s*4/.test(low)) formula = "X / 4";
            else if (/x\s*\*\s*10|x\s*10/.test(low)) formula = "X * 10";
            else if (/xorbytes\s+/i.test(raw)) formula = "X XORBYTES " + (raw.match(/xorbytes\s+([0-9A-Fa-f\-]{5,})/i) || [])[1];
        }
        (raw.match(/0x[0-9A-Fa-f]{3,6}\b|\b[0-9A-Fa-f]{4}\b/g) || []).forEach((h) => {
            const n = parseInt(String(h).replace(/^0x/i, ""), 16);
            if (Number.isFinite(n) && n >= 0 && n < 0x200000 && addrs.indexOf(n) < 0) addrs.push(n);
        });
        this.kmFields().forEach((f) => {
            if (addrs.indexOf(f.start) < 0) addrs.push(f.start);
        });
        if (formula) notes.push("Fórmula que me dijiste: " + formula);
        if (width) notes.push(width + " bytes");
        if (endian) notes.push(endian);
        if (chk) notes.push("Checksum " + chk);
        if (addrs.length) notes.push(addrs.length + " direcciones de tu ayuda");
        if (!notes.length) notes.push("Sin ayuda extra: pienso solo con los diffs");
        return {
            addrs: addrs,
            fields: this.kmFields(),
            formula: formula,
            width: width,
            endian: endian,
            chk: chk,
            text: raw,
            notes: notes
        };
    },

    hitsFromHelp(a, b, c, km1, km2, km3) {
        const hits = [];
        const help = this._help || this.readHelp();
        const starts = [];
        (help.fields || []).forEach((f) => starts.push(f));
        (help.addrs || []).forEach((addr) => {
            const widths = help.width ? [help.width, 2, 3, 4] : [2, 3, 4];
            widths.forEach((w) => starts.push({ start: addr, width: w }));
        });
        const formulas = [];
        if (help.formula) formulas.push(help.formula);
        ["X", "X / 4", "X * 10", "X * 100", "X / 10", "X * 4"].forEach((f) => {
            if (formulas.indexOf(f) < 0) formulas.push(f);
        });
        const endians = help.endian === "BE"
            ? [{ id: "BE", little: false }, { id: "LE", little: true }]
            : [{ id: "LE", little: true }, { id: "BE", little: false }];
        const seen = new Set();
        starts.slice(0, 96).forEach((field) => {
            endians.forEach((en) => {
                formulas.forEach((formula) => {
                    const key = field.start + "|" + field.width + "|" + en.id + "|" + formula;
                    if (seen.has(key) || field.start + field.width > a.length) return;
                    seen.add(key);
                    let pat1;
                    let pat2;
                    try {
                        pat1 = this.encodeRecipe({ formula: formula, width: field.width, endian: en.id }, km1);
                        pat2 = b && km2 != null ? this.encodeRecipe({ formula: formula, width: field.width, endian: en.id }, km2) : null;
                    } catch (error) {
                        return;
                    }
                    if (!this.patternFits(a, field.start, pat1)) return;
                    if (pat2 && !this.patternFits(b, field.start, pat2)) return;
                    const copies = this._diffs && this._diffs.size
                        ? this.copiesOnDiffOffset(this._diffs, field.start, a.length, field.width)
                        : [field.start];
                    const row = {
                        line: field.start & ~0x0F,
                        addr: field.start,
                        width: field.width,
                        endian: en.id,
                        formula: formula,
                        raw: this.read(a, field.start, field.width, en.little),
                        km: km1,
                        hex: MathEngine.hexBytes(a.slice(field.start, field.start + field.width)),
                        checksum: this.userChecksum(field.start, field.width),
                        copies: copies,
                        stair: copies.length,
                        score: 99 + (help.formula === formula ? 4 : 0),
                        fromHelp: true,
                        fromPair: true,
                        name: "AYUDA_" + formula
                    };
                    this.attachChecksum(row, a, b, c);
                    hits.push(row);
                });
            });
        });
        return hits;
    },

    userChecksum(addr, width) {
        if (typeof MarkBook === "undefined") return null;
        const stores = [];
        ["CHK", "CRC", "COMP"].forEach((kind) => {
            (MarkBook.lessonRanges(kind) || []).forEach((range) => {
                stores.push({ kind: kind, start: range.start, size: range.size || 1 });
            });
            (MarkBook.paintedAddrs(kind) || []).forEach((start) => {
                stores.push({ kind: kind, start: start, size: 1 });
            });
        });
        if (!stores.length) return null;
        const page = addr & ~0x0F;
        const near = stores.find((s) =>
            s.start >= page &&
            s.start <= page + 34 &&
            !(s.start >= addr && s.start < addr + width)
        ) || stores[0];
        if (!near) return null;
        const name = (this._help && this._help.chk)
            ? this._help.chk
            : (near.kind === "COMP" ? "COMP8" : (near.kind === "CRC" ? "CRC16" : "SUM8"));
        return {
            name: name,
            storedAt: near.start,
            endian: "LE",
            size: near.kind === "CRC" ? 2 : 1,
            fromUser: true
        };
    },

    findOnDiffs(bytes, pattern, diffs) {
        const out = [];
        const seen = new Set();
        if (!bytes || !pattern || !pattern.length) return out;
        const width = pattern.length;
        const visit = (addr) => {
            const minStart = Math.max(0, addr - width + 1);
            for (let start = minStart; start <= addr; start++) {
                if (start + width > bytes.length || seen.has(start)) continue;
                if (!this.patternFits(bytes, start, pattern)) continue;
                seen.add(start);
                out.push(start);
            }
        };
        if (diffs && diffs.forEach) diffs.forEach(visit);
        this.markAddrs().forEach(visit);
        return out;
    },

    tryOneSaved(a, b, c, km1, km2, km3, diffs, code) {
        const hits = [];
        if (!code || !code.formula) return hits;
        const notable = !!(code.familyId || /YAMAHA_|ODYSSEY_|Aprendida|USER_/i.test(String(code.name || "")));
        const skip = function (self) {
            if (!notable) return;
            if (!self._skipped) self._skipped = [];
            self._skipped.push(code.name || code.formula);
        };
        if (/YAMAHA_|ODYSSEY_/i.test(String(code.familyId || code.name || "")) && !this.recipeFitsFile(code, a)) {
            skip(this);
            return hits;
        }
        let pat1;
        let pat2 = null;
        let pat3 = null;
        try {
            pat1 = this.encodeRecipe(code, km1);
            if (b && km2 != null) pat2 = this.encodeRecipe(code, km2);
            if (c && km3 != null) pat3 = this.encodeRecipe(code, km3);
        } catch (error) {
            skip(this);
            return hits;
        }
        let locs = this.findOnDiffs(a, pat1, diffs).filter((addr) => {
            if (pat2 && !this.patternFits(b, addr, pat2)) return false;
            return true;
        });
        if (!locs.length) {
            skip(this);
            return hits;
        }
        if (locs.length > 32) {
            locs = locs.filter((addr) => {
                for (let i = 0; i < pat1.length; i++) if (diffs && diffs.has && diffs.has(addr + i)) return true;
                return false;
            });
        }
        if (!locs.length || locs.length > 32) {
            skip(this);
            return hits;
        }
        locs.slice(0, 12).forEach((addr) => {
            const same = this.checksumsThatMove(a, b, addr, code.width)[0] || this.userChecksum(addr, code.width);
            const little = code.endian !== "BE" && code.endian !== "BCD";
            let copies = this.copiesFor(a, b, c, addr, code.width, little, diffs);
            if (diffs && diffs.size) {
                const offCopies = this.copiesOnDiffOffset(diffs, addr, a.length, code.width);
                if (offCopies.length > copies.length) copies = offCopies;
            }
            const cOk = !(pat3 && !this.patternFits(c, addr, pat3));
            hits.push({
                line: addr & ~0x0F,
                addr: addr,
                width: code.width,
                endian: code.endian,
                formula: code.formula,
                raw: this.read(a, addr, code.width, little),
                km: km1,
                hex: MathEngine.hexBytes(a.slice(addr, addr + code.width)),
                checksum: same,
                copies: copies,
                stair: copies.length,
                score: 92 + (same ? 8 : 0) + Math.min(copies.length, 8) + (cOk ? 4 : 0) + (same && same.fromUser ? 6 : 0),
                familyId: code.familyId || "",
                fromSaved: true,
                fromKnown: !!code.familyId,
                fromPair: true,
                name: code.name
            });
        });
        return hits;
    },

    trySavedAlgos(a, b, c, km1, km2, km3, diffs) {
        const hits = [];
        (this.knownRecipes() || []).forEach((code) => {
            this.tryOneSaved(a, b, c, km1, km2, km3, diffs, code).forEach((hit) => hits.push(hit));
        });
        return hits;
    },

    fromDiscovery(hit) {
        if (!hit || hit.offset == null) return null;
        const little = /LITTLE|^LE$/i.test(String(hit.endian || ""));
        const width = Number(hit.length) || 2;
        const ctx = this._ctx || {};
        const bytes = ctx.bytes;
        if (!bytes) return null;
        let copies = [hit.offset];
        if (this._diffs && this._diffs.size) {
            copies = this.copiesOnDiffOffset(this._diffs, hit.offset, bytes.length, width);
        }
        const built = {
            line: hit.offset & ~0x0F,
            addr: hit.offset,
            width: width,
            endian: little ? "LE" : "BE",
            formula: hit.expression,
            raw: this.read(bytes, hit.offset, width, little),
            km: ctx.km1,
            hex: MathEngine.hexBytes(bytes.slice(hit.offset, hit.offset + width)),
            checksum: null,
            copies: copies,
            stair: copies.length,
            score: (Number(hit.confidence) || 80) + Math.min(copies.length, 10),
            fromKnown: hit.status === "VALIDATED",
            fromPair: true,
            name: hit.expression,
            familyId: ""
        };
        this.attachChecksum(built, bytes, ctx.bytes2, ctx.bytes3);
        return built;
    },

    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this._clock) {
            clearInterval(this._clock);
            this._clock = null;
        }
        if (typeof DiscoveryManager !== "undefined") DiscoveryManager.cancel();
    },

    run(opts) {
        const self = this;
        return new Promise((resolve) => {
            const a = opts.bytes;
            const b = opts.bytes2;
            const c = opts.bytes3;
            const km1 = opts.km1;
            const km2 = opts.km2;
            const km3 = opts.km3;
            if (!a || !b) {
                resolve({ ok: false, message: "Falta el par." });
                return;
            }
            self.stop();
            self.running = true;
            self.started = Date.now();
            self.MIN_MS = Number(opts.minMs) > 0 ? Number(opts.minMs) : 5 * 60 * 1000;
            self.SIM_MS = Number(opts.simMs) > 0 ? Number(opts.simMs) : 2 * 60 * 1000;
            self.MAX_MS = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 10 * 60 * 1000;
            self.HARD_MS = Number(opts.hardMs) > 0 ? Number(opts.hardMs)
                : (Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 15 * 60 * 1000);
            if (self.SIM_MS >= self.MIN_MS) self.SIM_MS = Math.max(40, Math.floor(self.MIN_MS * 0.4));
            if (self.MIN_MS > self.MAX_MS) self.MAX_MS = self.MIN_MS;
            if (self.MAX_MS > self.HARD_MS) self.HARD_MS = self.MAX_MS;
            self._ctx = { bytes: a, bytes2: b, bytes3: c, km1: km1, km2: km2, km3: km3 };
            self._recipes = self.knownRecipes();
            self._simLog = [];
            self._vins = [];
            self._inventStarted = false;
            self._diffs = null;
            self._skipped = [];
            self._help = null;
            self._chkI = null;
            self._chkList = [];
            self._ctx = { bytes: a, bytes2: b, bytes3: c, km1: km1, km2: km2, km3: km3 };
            self._recipes = self.knownRecipes();
            self._simLog = [];
            self._vins = [];
            self._inventStarted = false;
            self._diffs = null;
            let settled = false;
            const hits = [];
            let lines = [];
            let tested = 0;

            const done = function (stopped) {
                if (settled) return;
                settled = true;
                if (self._clock) {
                    clearInterval(self._clock);
                    self._clock = null;
                }
                if (self.timer) {
                    clearTimeout(self.timer);
                    self.timer = null;
                }
                self.running = false;
                resolve(self.finish(hits, lines, tested, !!stopped));
            };

            const emit = function (info) {
                const elapsed = Date.now() - self.started;
                const solid = info.found || hits.some((h) => self.isSolid(h));
                const cap = elapsed < self.MIN_MS ? self.MIN_MS : (hits.some((h) => self.isSolid(h)) ? self.MAX_MS : self.HARD_MS);
                if (opts.onTick) {
                    opts.onTick({
                        pct: Math.min(99, (elapsed / self.HARD_MS) * 100),
                        elapsed: elapsed,
                        line: info.line || 0,
                        tested: tested,
                        hits: hits.length,
                        lines: lines.length,
                        found: false,
                        formula: info.formula || (hits[0] && hits[0].formula) || "",
                        phase: info.phase || "scan",
                        sim: self._simLog || [],
                        vins: self._vins || [],
                        skipped: (self._skipped || []).slice(-8),
                        help: (self._help && self._help.notes) || [],
                        minMs: self.MIN_MS,
                        maxMs: cap,
                        hardMs: self.HARD_MS,
                        solid: !!solid
                    });
                }
            };

            const scanJob = function (job) {
                try {
                    const raw1 = self.read(a, job.addr, job.width, job.en.little);
                    const raw2 = self.read(b, job.addr, job.width, job.en.little);
                    const raw3 = c ? self.read(c, job.addr, job.width, job.en.little) : null;
                    tested++;
                    const match = self.matchKnown(raw1, raw2, raw3, km1, km2, km3, job) ||
                        self.matchMany([raw1, raw2, raw3], [km1, km2, km3]) ||
                        self.matchXorBytes(a, b, c, job.addr, job.width, job.en.little, km1, km2, km3);
                    if (!match || !km1 || (raw1 === null && !match.fromXor)) return;
                    let same = self.checksumsThatMove(a, b, job.addr, job.width);
                    if (!same.length && job.width === 2 && (job.addr & 0x0F) === 0x0E) {
                        same = self.checksumsThatMove(a, b, job.addr - 1, 3);
                    }
                    if (!same.length) {
                        const painted = self.userChecksum(job.addr, job.width);
                        if (painted) same = [painted];
                    }
                    let copies = self.copiesFor(a, b, c, job.addr, job.width, job.en.little, self._diffs);
                    if (self._diffs && self._diffs.size) {
                        const offCopies = self.copiesOnDiffOffset(self._diffs, job.addr, a.length, job.width);
                        if (offCopies.length > copies.length) copies = offCopies;
                    }
                    hits.push({
                        line: job.line,
                        addr: job.addr,
                        width: job.width,
                        endian: job.en.id,
                        formula: match.formula,
                        raw: raw1,
                        km: km1,
                        hex: MathEngine.hexBytes(a.slice(job.addr, job.addr + job.width)),
                        checksum: same[0] || null,
                        copies: copies,
                        stair: copies.length,
                        score: (match.fromXor ? 96 : (match.fromKnown ? 94 : 88)) + (same[0] ? 8 : 0) + Math.min(copies.length, 10) + (c && km3 && !match.cMiss ? 4 : 0),
                        fromKnown: !!match.fromKnown,
                        fromXor: !!match.fromXor,
                        fromPair: true,
                        name: match.name || match.formula,
                        familyId: match.familyId || ""
                    });
                } catch (error) { /* sigo con el siguiente hueco */ }
            };

            const startDiscovery = function () {
                if (self._inventStarted) return;
                self._inventStarted = true;
                emit({ phase: "invent", line: lines[0] || 0 });
                const probe = [];
                ((self._help && self._help.addrs) || []).forEach((addr) => {
                    if (probe.indexOf(addr) < 0) probe.push(addr);
                });
                const cap = probe.length ? 800 : 400;
                (self._diffs || new Set()).forEach((addr) => {
                    if (probe.length < cap) probe.push(addr);
                });
                const takeDisc = function (results) {
                    if (settled) return;
                    (results || []).forEach((row) => {
                        const hit = self.fromDiscovery(row);
                        if (hit) hits.push(hit);
                    });
                    if (typeof KnowledgeBase !== "undefined") {
                        (results || []).forEach((hit) => KnowledgeBase.rememberValidatedDiscovery(hit));
                    }
                    const best = hits.filter((h) => self.isSolid(h))[0] || hits[0];
                    emit({
                        phase: "invent",
                        formula: best ? best.formula : "",
                        line: best ? best.line : 0
                    });
                };
                const watch = function () {
                    if (settled) return;
                    const elapsed = Date.now() - self.started;
                    const solid = hits.some((h) => self.isSolid(h));
                    const best = hits.filter((h) => self.isSolid(h))[0] || hits[0];
                    emit({
                        phase: "invent",
                        formula: best ? best.formula : "",
                        line: best ? best.line : (lines[0] || 0)
                    });
                    if (elapsed >= self.HARD_MS) {
                        if (typeof DiscoveryManager !== "undefined") {
                            takeDisc(DiscoveryManager.getResults());
                            DiscoveryManager.cancel();
                        }
                        done(false);
                        return;
                    }
                    if (elapsed >= self.MIN_MS && solid) {
                        if (typeof DiscoveryManager !== "undefined") DiscoveryManager.cancel();
                        done(false);
                        return;
                    }
                    self.timer = setTimeout(watch, 250);
                };
                if (typeof DiscoveryManager !== "undefined") {
                    try {
                        DiscoveryManager.start({
                            useWorker: true,
                            bytes: a,
                            bytes2: b,
                            bytes3: c,
                            km1: km1,
                            km2: km2,
                            km3: km3,
                            addrs: probe,
                            maximumCandidates: self._help && self._help.addrs && self._help.addrs.length ? 480 : 320,
                            maximumDepth: self._help && self._help.formula ? 4 : 3,
                            timeout: 900
                        }, function (ev) {
                            if (settled) return;
                            if (ev.type === "DISCOVERY_COMPLETE") takeDisc(ev.payload && ev.payload.results);
                        });
                    } catch (error) {
                        takeDisc([]);
                    }
                }
                watch();
            };

            if (typeof Notification !== "undefined" && Notification.permission === "default") {
                Notification.requestPermission().catch(function () { /* ignore */ });
            }

            self.timer = setTimeout(function begin() {
                try {
                const diffs = self.diffBytes(a, [b, c]);
                self._diffs = diffs;
                lines = self.changedLinesMany(a, [b, c]);
                emit({ phase: "scan", line: lines[0] || 0 });
                if (self.paintedDump(a, lines, diffs)) {
                    resolve({
                        ok: false,
                        message: "BIN 1 y BIN 2 cambian en casi todo el archivo (" +
                            lines.length + " líneas). Eso no es un par de kilometraje: suele ser un dump ya pintado con el algoritmo viejo. Carga dos lecturas originales con KM distinto.",
                        best: null,
                        lines: lines.length,
                        tested: 0,
                        hits: []
                    });
                    self.running = false;
                    settled = true;
                    return;
                }
                self._vins = self.huntVins(a, b, c);
                self._help = self.readHelp();
                emit({ phase: "help", line: lines[0] || 0 });
                const widths = [2, 3, 4];
                const endians = [{ id: "LE", little: true }, { id: "BE", little: false }];
                const jobMap = {};
                const markSet = new Set((self._help.addrs || []).concat(self.markAddrs()));
                const addJobAddr = function (addr) {
                    widths.forEach((width) => {
                        const maxStart = addr;
                        const minStart = Math.max(0, addr - width + 1);
                        for (let start = minStart; start <= maxStart; start++) {
                            if ((start & ~0x0F) !== (addr & ~0x0F)) continue;
                            if (start + width > a.length) continue;
                            endians.forEach((en) => {
                                const key = start + "|" + width + "|" + en.id;
                                if (jobMap[key]) return;
                                jobMap[key] = {
                                    line: start & ~0x0F,
                                    addr: start,
                                    width: width,
                                    en: en,
                                    marked: markSet.has(start)
                                };
                            });
                        }
                    });
                };
                diffs.forEach(addJobAddr);
                markSet.forEach(addJobAddr);
                const jobs = Object.keys(jobMap).map((k) => jobMap[k]).sort((x, y) => (y.marked - x.marked) || (x.addr - y.addr));
                const recipes = self._recipes || [];
                let ri = 0;
                let ji = 0;
                let phase = "help";
                let simStarted = 0;
                const tick = function () {
                    if (settled) return;
                    if (!self.running) {
                        done(true);
                        return;
                    }
                    const elapsed = Date.now() - self.started;
                    if (elapsed >= self.HARD_MS) {
                        done(false);
                        return;
                    }
                    if (phase === "help") {
                        try {
                            self.hitsFromHelp(a, b, c, km1, km2, km3).forEach((hit) => hits.push(hit));
                        } catch (error) { /* sigo pensando sin esa ayuda */ }
                        emit({
                            phase: "help",
                            formula: (hits[0] && hits[0].formula) || (self._help && self._help.formula) || "",
                            line: lines[0] || 0
                        });
                        phase = "saved";
                        self.timer = setTimeout(tick, 16);
                        return;
                    }
                    if (phase === "saved") {
                        const sliceEnd = Date.now() + 40;
                        while (Date.now() < sliceEnd && ri < recipes.length) {
                            try {
                                self.tryOneSaved(a, b, c, km1, km2, km3, diffs, recipes[ri]).forEach((hit) => hits.push(hit));
                            } catch (error) {
                                if (!self._skipped) self._skipped = [];
                                self._skipped.push((recipes[ri] && recipes[ri].name) || "algo");
                            }
                            ri++;
                        }
                        emit({
                            phase: "saved",
                            formula: (hits[0] && hits[0].formula) || "",
                            line: lines[0] || 0
                        });
                        if (ri >= recipes.length) phase = "scan";
                        self.timer = setTimeout(tick, 16);
                        return;
                    }
                    if (phase === "scan") {
                        const sliceEnd = Date.now() + 40;
                        while (Date.now() < sliceEnd && ji < jobs.length) {
                            scanJob(jobs[ji]);
                            ji++;
                        }
                        const job = jobs[Math.min(ji, Math.max(0, jobs.length - 1))] || {};
                        emit({
                            phase: "scan",
                            formula: (hits[0] && hits[0].formula) || "",
                            line: job.line || 0
                        });
                        if (ji >= jobs.length) phase = "chk";
                        self.timer = setTimeout(tick, 16);
                        return;
                    }
                    if (phase === "chk") {
                        if (self._chkI == null) {
                            self._chkList = hits.filter((h) => h && h.addr != null);
                            self._chkI = 0;
                        }
                        const sliceEnd = Date.now() + 40;
                        while (Date.now() < sliceEnd && self._chkI < self._chkList.length) {
                            const row = self._chkList[self._chkI];
                            if (!row.checksum || !row.checksum.name) self.attachChecksum(row, a, b, c);
                            self.learnScatter(row, a, b, c, km1, km2, km3);
                            self._chkI++;
                        }
                        const linked = hits.filter((h) => h.checksum && h.checksum.name).length;
                        emit({
                            phase: "chk",
                            formula: (hits[0] && hits[0].formula) || "",
                            line: hits[0] ? hits[0].line : 0
                        });
                        if (self._chkI >= self._chkList.length) {
                            hits.forEach((h) => {
                                if (h.checksum && h.checksum.name) h.score = (h.score || 80) + 2;
                            });
                            phase = "sim";
                        }
                        self.timer = setTimeout(tick, 16);
                        return;
                    }
                    if (phase === "sim") {
                        if (!simStarted) {
                            simStarted = Date.now();
                            const best = hits.filter((h) => self.isSolid(h))[0] || hits[0];
                            self._simLog = best ? self.simulateHit(best, a, km1) : [];
                            if (best && typeof KnowledgeBase !== "undefined") {
                                try {
                                    KnowledgeBase.rememberValidatedDiscovery({
                                        offset: best.addr,
                                        expression: best.formula,
                                        length: best.width,
                                        endian: best.endian,
                                        confidence: best.score,
                                        status: self.isSolid(best) ? "VALIDATED" : "HYPOTHESIS"
                                    });
                                } catch (error) { /* ignore */ }
                            }
                        }
                        emit({
                            phase: "sim",
                            formula: (hits[0] && hits[0].formula) || "",
                            line: hits[0] ? hits[0].line : 0
                        });
                        if (Date.now() - simStarted >= self.SIM_MS) phase = "invent";
                        self.timer = setTimeout(tick, 180);
                        return;
                    }
                    emit({
                        phase: "invent",
                        formula: (hits[0] && hits[0].formula) || "",
                        line: lines[0] || 0
                    });
                    startDiscovery();
                    return;
                };
                tick();
                } catch (error) {
                    if (settled) return;
                    settled = true;
                    self.running = false;
                    resolve({
                        ok: false,
                        message: "El ataque se detuvo: " + (error && error.message ? error.message : String(error)),
                        best: null,
                        lines: lines.length,
                        tested: tested,
                        hits: hits,
                        sim: self._simLog || [],
                        vins: self._vins || []
                    });
                }
            }, 40);
        });
    },

    finish(hits, lines, tested, stopped) {
        this.running = false;
        hits = (hits || []).slice().sort((a, b) => (b.score - a.score) || (b.line - a.line));
        const solid = hits.filter((h) => this.isSolid(h));
        const best = solid[0] || null;
        const report = {
            ok: !!best,
            stopped: stopped,
            lines: (lines || []).length,
            tested: tested,
            hits: hits,
            best: best ? this.buildBest(best) : null,
            sim: this._simLog || [],
            vins: this._vins || [],
            skipped: this._skipped || [],
            help: (this._help && this._help.notes) || [],
            message: best
                ? "TERMINÓ. Desencriptó el kilometraje en la línea " + this.hex(best.line) +
                    " con " + best.formula +
                    (best.checksum
                        ? " y " + best.checksum.name + " en " + this.hex(best.checksum.storedAt)
                        : " y no hallé SUM/CRC de ese KM") +
                    (this._vins && this._vins[0] ? ". VIN " + this._vins[0].value : "") +
                    ". " + this.decodeHow(best)
                    : "TERMINÓ. Atacé " + (lines || []).length + " líneas que cambian (" + tested +
                    " pruebas). El cerebro siguió 5–15 min. Los algoritmos que no calzaron se descartaron y siguió."
        };
        report.discoveries = [];
        this.lastReport = report;
        this.notify("VELOCÍMETROS CDMX", report.message);
        return report;
    }
};
