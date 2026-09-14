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
        const copies = hit.copies && hit.copies.length ? hit.copies : [hit.addr];
        return {
            fromPair: true,
            fromAttack: true,
            familyId: hit.familyId || "",
            label: "KILOMETRAJE",
            name: hit.name || ("ATAQUE_" + String(hit.formula).replace(/\s+/g, "_")),
            fromKnown: !!hit.fromKnown,
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
            checksumName: hit.checksum ? hit.checksum.name : undefined
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
        return !!(hit && (hit.fromKnown || hit.checksum));
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
                const chk1 = self.checksumsOnLine(a, job.line, job.addr, job.width);
                const chk2 = self.checksumsOnLine(b, job.line, job.addr, job.width);
                const chk3 = c ? self.checksumsOnLine(c, job.line, job.addr, job.width) : [];
                let same = chk1.filter((item) => chk2.some((d) => self.sameChkSlot(item, d)));
                if (chk3.length) same = same.filter((item) => chk3.some((d) => self.sameChkSlot(item, d)));
                const copies = [];
                for (let p = 0; p + job.width <= a.length; p += 0x20) {
                    const r = self.read(a, p, job.width, job.en.little);
                    if (r === null) break;
                    if (p > 0 && Math.abs(r - self.read(a, p - 0x20, job.width, job.en.little)) > 8) {
                        if (p > job.line) break;
                    }
                    if (a[p] !== 0xFF) copies.push(p);
                    if (p > 0x400) break;
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
                    copies: copies.length ? copies : [job.addr],
                    stair: copies.length,
                    score: (match.fromKnown ? 97 : 90) + (same[0] ? 8 : 0) + (copies.length > 4 ? 2 : 0) + (c && km3 ? 4 : 0),
                    fromKnown: !!match.fromKnown,
                    name: match.name,
                    familyId: match.familyId
                });
            };

            const startDiscovery = function () {
                emit({ phase: "invent", line: lines[0] || 0 });
                const probe = [];
                (lines || []).slice(0, 24).forEach((line) => {
                    [0, 1, 2, 4, 6, 8].forEach((off) => probe.push(line + off));
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
                lines = self.changedLinesMany(a, [b, c]);
                const seeded = self.seedFromRecipes(a, b, c, km1, km2, km3, lines);
                seeded.forEach((hit) => hits.push(hit));
                if (hits.some((h) => self.isSolid(h))) {
                    emit({
                        found: true,
                        phase: "known",
                        formula: hits[0].formula,
                        line: hits[0].line
                    });
                    done(false);
                    return;
                }
                const widths = [2, 3, 4];
                const endians = [{ id: "LE", little: true }, { id: "BE", little: false }];
                const jobs = [];
                lines.forEach((line) => {
                    for (let off = 0; off <= 14; off++) {
                        widths.forEach((width) => {
                            if (off + width > 16) return;
                            endians.forEach((en) => jobs.push({ line: line, addr: line + off, width: width, en: en }));
                        });
                    }
                });
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
        const best = hits[0] || null;
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
                    " pruebas). No hay un KM limpio con los KM conocidos. Revisa KM 1 y KM 2."
        };
        report.discoveries = [];
        this.lastReport = report;
        this.notify("VELOCÍMETROS CDMX", report.message);
        return report;
    }
};
