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
            familyId: hit.familyId || "YAMAHA_R5F10",
            label: "KILOMETRAJE",
            name: "ATAQUE_" + String(hit.formula).replace(/\s+/g, "_"),
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

    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
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
            const lines = self.changedLinesMany(a, [b, c]);
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
            const hits = [];
            let ji = 0;
            let tested = 0;

            const tick = function () {
                if (!self.running) {
                    resolve(self.finish(hits, lines, tested, true));
                    return;
                }
                const elapsed = Date.now() - self.started;
                const sliceEnd = Date.now() + 45;
                while (Date.now() < sliceEnd && ji < jobs.length) {
                    const job = jobs[ji];
                    const raw1 = self.read(a, job.addr, job.width, job.en.little);
                    const raw2 = self.read(b, job.addr, job.width, job.en.little);
                    const raw3 = c ? self.read(c, job.addr, job.width, job.en.little) : null;
                    tested++;
                    const match = self.matchMany([raw1, raw2, raw3], [km1, km2, km3]);
                    if (match && km1 && raw1) {
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
                            checksum: same[0] || chk1[0] || null,
                            copies: copies.length ? copies : [job.addr],
                            stair: copies.length,
                            score: 90 + (same[0] ? 8 : 0) + (copies.length > 4 ? 2 : 0) + (c && km3 ? 4 : 0)
                        });
                    }
                    ji++;
                }
                const pct = Math.min(99, Math.max(
                    (elapsed / self.MAX_MS) * 100,
                    jobs.length ? (ji / jobs.length) * 100 : 0
                ));
                if (opts.onTick) {
                    opts.onTick({
                        pct: pct,
                        elapsed: elapsed,
                        line: jobs[Math.min(ji, jobs.length - 1)] ? jobs[Math.min(ji, jobs.length - 1)].line : (lines[0] || 0),
                        tested: tested,
                        hits: hits.length,
                        lines: lines.length
                    });
                }
                if (elapsed >= self.MAX_MS || ji >= jobs.length) {
                    resolve(self.finish(hits, lines, tested, false));
                    return;
                }
                self.timer = setTimeout(tick, 16);
            };

            if (typeof Notification !== "undefined" && Notification.permission === "default") {
                Notification.requestPermission().catch(function () { /* ignore */ });
            }
            self.timer = setTimeout(tick, 20);
        });
    },

    finish(hits, lines, tested, stopped) {
        this.running = false;
        hits.sort((a, b) => (b.score - a.score) || (b.line - a.line));
        let discovered = [];
        if (typeof DiscoveryManager !== "undefined" && this._ctx) {
            const probe = [];
            (lines || []).forEach((line) => {
                [0, 1, 2, 4, 6, 8].forEach((off) => probe.push(line + off));
            });
            discovered = DiscoveryManager.discoverSync({
                bytes: this._ctx.bytes,
                bytes2: this._ctx.bytes2,
                bytes3: this._ctx.bytes3,
                km1: this._ctx.km1,
                km2: this._ctx.km2,
                km3: this._ctx.km3,
                addrs: probe
            });
            if (typeof KnowledgeBase !== "undefined") {
                discovered.forEach((hit) => KnowledgeBase.rememberValidatedDiscovery(hit));
            }
        }
        const best = hits[0] || null;
        const top = discovered[0];
        const extra = top
            ? " Motor V1: " + top.expression + " · " + top.status + " · " + top.confidence + "% · " + (top.evidence || "")
            : "";
        const report = {
            ok: !!best,
            stopped: stopped,
            lines: lines.length,
            tested: tested,
            hits: hits,
            best: best ? this.buildBest(best) : null,
            message: best
                ? "TERMINÓ. Desencriptó el kilometraje en la línea " + this.hex(best.line) +
                    " con " + best.formula + (best.checksum ? " y " + best.checksum.name + " en " + this.hex(best.checksum.storedAt) : "") +
                    ". " + this.decodeHow(best) + extra
                : "TERMINÓ. Atacé " + lines.length + " líneas que cambian (" + tested +
                    " pruebas). No hay un KM limpio con los KM conocidos. Revisa KM 1 y KM 2." + extra
        };
        report.discoveries = discovered;
        this.lastReport = report;
        this.notify("VELOCÍMETROS CDMX", report.message);
        return report;
    }
};
