const DeepAttack = {
    running: false,
    timer: null,
    started: 0,
    MAX_MS: 10 * 60 * 1000,
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
        if (typeof CodeBook !== "undefined") return CodeBook.encode(code, km);
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
            if (raw3 != null && km3 != null) {
                const e3 = MathEngine.applyFormula(km3, code.formula);
                if (Math.abs(e3 - raw3) > 40) continue;
            }
            return { formula: code.formula, n: 0, off: 0, name: code.name, familyId: code.familyId, fromKnown: true };
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
        if (expect === null || Math.abs(expect - raws[2]) > 40) return null;
        return match;
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
            bits.push("Checksum " + hit.checksum.name + " " + hit.checksum.endian +
                " de esos " + hit.width + " bytes, escrito en " + this.hex(hit.checksum.storedAt) + ".");
        }
        bits.push("No toqué el resto del archivo: solo las líneas que cambian.");
        return bits.join(" ");
    },

    buildBest(hit) {
        const copies = (hit.copies && hit.copies.length ? hit.copies : [hit.addr]).slice(0, 32);
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
            operation: (hit.formula || "X") + " · " + hit.width + "B " + (hit.endian || "LE") +
                (hit.checksum ? " · " + hit.checksum.name + " @" + this.hex(hit.checksum.storedAt) : "")
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
        if (copies.length < 1 || copies.length > 32) return false;
        if (hit.fromSaved && copies.length <= 32) return !!(hit.checksum || copies.length >= 2);
        if (hit.fromKnown && hit.familyId && this._ctx && this.recipeFitsFile({ id: hit.familyId, familyId: hit.familyId }, this._ctx.bytes)) {
            return copies.length <= 32;
        }
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

    checksumsNear(bytes, addr, width) {
        const found = [];
        if (!bytes || addr < 0) return found;
        const page = addr & ~0x0F;
        const spots = [];
        for (let at = page; at < page + 16; at++) spots.push(at);
        spots.push(addr + width);
        spots.push(page + 16);
        const fill = { 0x00: 1, 0xFF: 1, 0xEB: 1, 0xAA: 1 };
        const tryPush = (name, storedAt, size, endian, calc) => {
            if (storedAt < 0 || storedAt + size > bytes.length) return;
            if (storedAt >= addr && storedAt < addr + width) return;
            if (size === 1 && fill[bytes[storedAt]]) return;
            const stored = MathEngine.fromBytes(bytes, storedAt, size, endian === "LE");
            if (stored === calc) found.push({ name: name, storedAt: storedAt, endian: endian, value: calc, size: size });
        };
        const sum8 = ChecksumEngine.sum8(bytes, addr, addr + width);
        const sum16 = ChecksumEngine.sum16(bytes, addr, addr + width);
        const crc8 = ChecksumEngine.crc8(bytes, addr, addr + width);
        const crc16 = ChecksumEngine.crc16(bytes, addr, addr + width);
        let xor8 = 0;
        for (let i = 0; i < width; i++) xor8 ^= bytes[addr + i];
        const comp8 = (0x100 - sum8) & 0xFF;
        spots.forEach((at) => {
            tryPush("SUM8", at, 1, "LE", sum8);
            tryPush("CRC8", at, 1, "LE", crc8);
            tryPush("XOR8", at, 1, "LE", xor8);
            tryPush("COMP8", at, 1, "LE", comp8);
            tryPush("SUM16", at, 2, "BE", sum16);
            tryPush("SUM16", at, 2, "LE", sum16);
            tryPush("CRC16", at, 2, "BE", crc16);
            tryPush("CRC16", at, 2, "LE", crc16);
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
        if (copies.length > 32) {
            copies = copies.filter((p) => Math.abs(p - addr) <= 0x800).slice(0, 24);
        }
        if (copies.indexOf(addr) < 0) copies.unshift(addr);
        return Array.from(new Set(copies)).slice(0, 32);
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

    trySavedAlgos(a, b, c, km1, km2, km3, diffs) {
        const hits = [];
        const recipes = this.knownRecipes();
        recipes.forEach((code) => {
            if (/YAMAHA_|ODYSSEY_/i.test(String(code.familyId || code.name || "")) && !this.recipeFitsFile(code, a)) return;
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
            let locs = MathEngine.findPattern(a, pat1).filter((addr) => {
                if (diffs && diffs.size) {
                    let touch = false;
                    for (let i = 0; i < pat1.length; i++) if (diffs.has(addr + i)) touch = true;
                    if (!touch) return false;
                }
                if (pat2 && !this.patternFits(b, addr, pat2)) return false;
                if (pat3 && !this.patternFits(c, addr, pat3)) return false;
                return true;
            });
            if (!locs.length) return;
            if (locs.length > 32) {
                locs = locs.filter((addr) => {
                    for (let i = 0; i < pat1.length; i++) if (diffs && diffs.has(addr + i)) return true;
                    return false;
                });
            }
            if (!locs.length || locs.length > 32) return;
            locs.forEach((addr) => {
                const same = this.checksumsThatMove(a, b, addr, code.width)[0] || null;
                const little = code.endian !== "BE" && code.endian !== "BCD";
                const copies = this.copiesFor(a, b, c, addr, code.width, little, diffs);
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
                    score: 92 + (same ? 8 : 0) + Math.min(copies.length, 8),
                    familyId: code.familyId || "",
                    fromSaved: true,
                    fromKnown: !!code.familyId,
                    fromPair: true,
                    name: code.name
                });
            });
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
        return {
            line: hit.offset & ~0x0F,
            addr: hit.offset,
            width: width,
            endian: little ? "LE" : "BE",
            formula: hit.expression,
            raw: this.read(bytes, hit.offset, width, little),
            km: ctx.km1,
            hex: MathEngine.hexBytes(bytes.slice(hit.offset, hit.offset + width)),
            checksum: null,
            copies: [hit.offset],
            stair: 1,
            score: Number(hit.confidence) || 80,
            fromKnown: hit.status === "VALIDATED",
            name: hit.expression,
            familyId: ""
        };
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
            self._ctx = { bytes: a, bytes2: b, bytes3: c, km1: km1, km2: km2, km3: km3 };
            self._recipes = self.knownRecipes();
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
                if (opts.onTick) {
                    opts.onTick({
                        pct: solid ? 100 : Math.min(99, (elapsed / self.MAX_MS) * 100),
                        elapsed: elapsed,
                        line: info.line || 0,
                        tested: tested,
                        hits: hits.length,
                        lines: lines.length,
                        found: !!solid,
                        formula: info.formula || "",
                        phase: info.phase || "scan"
                    });
                }
            };

            const scanJob = function (job) {
                const raw1 = self.read(a, job.addr, job.width, job.en.little);
                const raw2 = self.read(b, job.addr, job.width, job.en.little);
                const raw3 = c ? self.read(c, job.addr, job.width, job.en.little) : null;
                tested++;
                const match = self.matchKnown(raw1, raw2, raw3, km1, km2, km3, job) ||
                    self.matchMany([raw1, raw2, raw3], [km1, km2, km3]);
                if (!match || !km1 || !raw1) return;
                const same = self.checksumsThatMove(a, b, job.addr, job.width);
                const copies = self.copiesFor(a, b, c, job.addr, job.width, job.en.little, self._diffs);
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
                    score: (match.fromKnown ? 94 : 88) + (same[0] ? 8 : 0) + Math.min(copies.length, 10) + (c && km3 ? 4 : 0),
                    fromKnown: !!match.fromKnown,
                    fromPair: true,
                    name: match.name || match.formula,
                    familyId: match.familyId || ""
                });
            };

            const startDiscovery = function () {
                emit({ phase: "invent", line: lines[0] || 0 });
                const probe = [];
                diffs.forEach((addr) => {
                    if (probe.length < 400) probe.push(addr);
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
                        found: !!(best && self.isSolid(best)),
                        formula: best ? best.formula : "",
                        line: best ? best.line : 0
                    });
                    done(false);
                };
                if (typeof DiscoveryManager !== "undefined") {
                    DiscoveryManager.start({
                        useWorker: true,
                        bytes: a,
                        bytes2: b,
                        bytes3: c,
                        km1: km1,
                        km2: km2,
                        km3: km3,
                        addrs: probe
                    }, function (ev) {
                        if (settled) return;
                        if (ev.type === "DISCOVERY_COMPLETE") takeDisc(ev.payload && ev.payload.results);
                    });
                }
                self._clock = setInterval(function () {
                    if (settled) return;
                    emit({ phase: "invent", line: lines[0] || 0 });
                    if (Date.now() - self.started >= self.MAX_MS) {
                        const extra = typeof DiscoveryManager !== "undefined" ? DiscoveryManager.getResults() : [];
                        if (typeof DiscoveryManager !== "undefined") DiscoveryManager.cancel();
                        takeDisc(extra);
                    }
                }, 250);
            };

            if (typeof Notification !== "undefined" && Notification.permission === "default") {
                Notification.requestPermission().catch(function () { /* ignore */ });
            }

            self.timer = setTimeout(function begin() {
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
                const saved = self.trySavedAlgos(a, b, c, km1, km2, km3, diffs);
                saved.forEach((hit) => hits.push(hit));
                const solidSaved = hits.find((h) => self.isSolid(h));
                if (solidSaved) {
                    emit({ found: true, phase: "known", formula: solidSaved.formula, line: solidSaved.line });
                    done(false);
                    return;
                }
                const widths = [2, 3, 4];
                const endians = [{ id: "LE", little: true }, { id: "BE", little: false }];
                const jobMap = {};
                diffs.forEach((addr) => {
                    widths.forEach((width) => {
                        const maxStart = addr;
                        const minStart = Math.max(0, addr - width + 1);
                        for (let start = minStart; start <= maxStart; start++) {
                            if ((start & ~0x0F) !== (addr & ~0x0F)) continue;
                            if (start + width > a.length) continue;
                            endians.forEach((en) => {
                                const key = start + "|" + width + "|" + en.id;
                                if (jobMap[key]) return;
                                jobMap[key] = { line: start & ~0x0F, addr: start, width: width, en: en };
                            });
                        }
                    });
                });
                const jobs = Object.keys(jobMap).map((k) => jobMap[k]);
                let ji = 0;
                const tick = function () {
                    if (settled) return;
                    if (!self.running) {
                        done(true);
                        return;
                    }
                    const sliceEnd = Date.now() + 45;
                    while (Date.now() < sliceEnd && ji < jobs.length) {
                        scanJob(jobs[ji]);
                        ji++;
                    }
                    const solid = hits.find((h) => self.isSolid(h));
                    const job = jobs[Math.min(ji, Math.max(0, jobs.length - 1))] || {};
                    emit({
                        phase: "scan",
                        found: !!solid,
                        formula: solid ? solid.formula : "",
                        line: job.line || 0
                    });
                    if (solid) {
                        done(false);
                        return;
                    }
                    if (Date.now() - self.started >= self.MAX_MS) {
                        done(false);
                        return;
                    }
                    if (ji >= jobs.length) {
                        startDiscovery();
                        return;
                    }
                    self.timer = setTimeout(tick, 16);
                };
                tick();
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
            message: best
                ? "TERMINÓ. Desencriptó el kilometraje en la línea " + this.hex(best.line) +
                    " con " + best.formula + (best.checksum ? " y " + best.checksum.name + " en " + this.hex(best.checksum.storedAt) : "") +
                    ". " + this.decodeHow(best)
                : "TERMINÓ. Atacé " + (lines || []).length + " líneas que cambian (" + tested +
                    " pruebas). Ningún algoritmo guardado calzó en los bytes distintos, y no salió un KM limpio. Revisa KM 1 y KM 2."
        };
        report.discoveries = [];
        this.lastReport = report;
        this.notify("VELOCÍMETROS CDMX", report.message);
        return report;
    }
};
