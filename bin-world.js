const BinWorld = {

    SCALES: [
        { formula: "X", enc: (k) => k, inv: (v) => v },
        { formula: "X * 10", enc: (k) => k * 10, inv: (v) => v / 10 },
        { formula: "X * 10 - 1", enc: (k) => k * 10 - 1, inv: (v) => (v + 1) / 10 },
        { formula: "X * 10 + 1", enc: (k) => k * 10 + 1, inv: (v) => (v - 1) / 10 },
        { formula: "X * 10 - 5", enc: (k) => k * 10 - 5, inv: (v) => (v + 5) / 10 },
        { formula: "X * 16", enc: (k) => k * 16, inv: (v) => v / 16 },
        { formula: "X * 100", enc: (k) => k * 100, inv: (v) => v / 100 },
        { formula: "X * 1000", enc: (k) => k * 1000, inv: (v) => v / 1000 }
    ],

    hex(value, size) {
        return Number(value).toString(16).toUpperCase().padStart(size || 4, "0");
    },

    range(start, width) {
        return "0x" + this.hex(start) + "–0x" + this.hex(start + width - 1);
    },

    looksLikeKm(value) {
        if (typeof MindEngine !== "undefined" && MindEngine.looksLikeKm) return MindEngine.looksLikeKm(value);
        return Number.isFinite(value) && value >= 15 && value <= 400000 && Math.abs(value - Math.round(value)) < 0.51;
    },

    emptyWorld(bytes) {
        return {
            size: bytes ? bytes.length : 0,
            page: { size: 0, score: 0, checksum: null, hits: 0 },
            mirrors: [],
            domains: [],
            worlds: [],
            hits: [],
            living: 0,
            dead: 0,
            empty: 0,
            kinds: new Uint8Array(bytes ? bytes.length : 0),
            strip: [],
            passport: "Carga un BIN. El mundo lee el chip entero: páginas, espejos, bytes vivos y el universo del KM.",
            headline: "SIN MUNDO"
        };
    },

    chkFns(bytes) {
        return [
            { name: "SUM8", size: 1, fn: (s, e) => ChecksumEngine.sum8(bytes, s, e) },
            { name: "XOR8", size: 1, fn: (s, e) => ChecksumEngine.xor8(bytes, s, e) },
            { name: "LRC", size: 1, fn: (s, e) => ChecksumEngine.lrc(bytes, s, e) },
            { name: "SUM16", size: 2, fn: (s, e) => ChecksumEngine.sum16(bytes, s, e) }
        ];
    },

    storedMatch(bytes, at, size, calc) {
        if (at < 0 || at + size > bytes.length) return null;
        const le = MathEngine.fromBytes(bytes, at, size, true);
        const be = MathEngine.fromBytes(bytes, at, size, false);
        if (le === calc) return "LE";
        if (be === calc) return "BE";
        return null;
    },

    classify(bytes, pair) {
        const kinds = new Uint8Array(bytes.length);
        const n = bytes.length;
        for (let i = 0; i < n; i++) {
            const b = bytes[i];
            if (b === 0x00 || b === 0xFF) {
                let run = 1;
                let p = i;
                while (p > 0 && bytes[p - 1] === b && run < 12) { p--; run++; }
                p = i;
                while (p + 1 < n && bytes[p + 1] === b && run < 12) { p++; run++; }
                if (run >= 8) {
                    kinds[i] = 1;
                    continue;
                }
            }
            if (pair && i < pair.length && pair[i] !== b) {
                kinds[i] = 3;
                continue;
            }
            kinds[i] = 2;
        }
        if (!pair) {
            const win = 16;
            for (let start = 0; start < n; start += win) {
                const end = Math.min(n, start + win);
                const uniq = new Set();
                for (let i = start; i < end; i++) if (kinds[i] !== 1) uniq.add(bytes[i]);
                const live = uniq.size >= 6;
                for (let i = start; i < end; i++) {
                    if (kinds[i] === 1) continue;
                    kinds[i] = live ? 3 : 2;
                }
            }
        }
        let empty = 0, dead = 0, living = 0;
        for (let i = 0; i < n; i++) {
            if (kinds[i] === 1) empty++;
            else if (kinds[i] === 3) living++;
            else dead++;
        }
        return { kinds, empty, dead, living };
    },

    detectPage(bytes) {
        const sizes = [8, 16, 32, 64];
        let best = { size: 0, score: 0, checksum: null, hits: 0, pages: 0 };
        const chks = this.chkFns(bytes);
        sizes.forEach((ps) => {
            if (bytes.length < ps * 4) return;
            const pages = Math.floor(bytes.length / ps);
            chks.forEach((chk) => {
                let ok = 0;
                for (let p = 0; p < pages; p++) {
                    const start = p * ps;
                    const payloadEnd = start + ps - chk.size;
                    if (payloadEnd <= start) continue;
                    const calc = chk.fn(start, payloadEnd);
                    if (this.storedMatch(bytes, payloadEnd, chk.size, calc)) ok++;
                }
                const score = ok / pages;
                if (score > best.score || (score === best.score && ok > best.hits)) {
                    best = { size: ps, score, checksum: chk.name, hits: ok, pages };
                }
            });
        });
        if (best.score < 0.28) return { size: 0, score: 0, checksum: null, hits: 0, pages: 0 };
        return best;
    },

    matchPct(bytes, a, b, len) {
        if (a < 0 || b < 0 || a + len > bytes.length || b + len > bytes.length || len <= 0) return 0;
        let same = 0;
        for (let i = 0; i < len; i++) if (bytes[a + i] === bytes[b + i]) same++;
        return same / len;
    },

    detectMirrors(bytes) {
        const out = [];
        const n = bytes.length;
        if (n >= 128 && n % 2 === 0) {
            const half = n / 2;
            const same = this.matchPct(bytes, 0, half, half);
            if (same >= 0.82) {
                out.push({ kind: "MITAD", offset: half, match: same, label: "Espejo a 0x" + this.hex(half) + " · " + Math.round(same * 100) + "%" });
            }
            let xor = 0;
            for (let i = 0; i < half; i++) if ((bytes[i] ^ 0xFF) === bytes[half + i]) xor++;
            const xorPct = xor / half;
            if (xorPct >= 0.82) {
                out.push({ kind: "MITAD XOR FF", offset: half, match: xorPct, label: "Espejo XOR 0xFF a 0x" + this.hex(half) + " · " + Math.round(xorPct * 100) + "%" });
            }
        }
        if (n >= 256 && n % 4 === 0) {
            const q = n / 4;
            let pct = 1;
            for (let k = 1; k < 4; k++) pct = Math.min(pct, this.matchPct(bytes, 0, k * q, q));
            if (pct >= 0.82) {
                out.push({ kind: "4 ESPEJOS", offset: q, match: pct, label: "4 copias de 0x" + this.hex(q) + " · " + Math.round(pct * 100) + "%" });
            }
        }
        [0x100, 0x200, 0x400, 0x800].forEach((off) => {
            if (off >= n / 2) return;
            const len = Math.min(off, n - off);
            if (len < 64) return;
            const same = this.matchPct(bytes, 0, off, len);
            if (same >= 0.9 && !out.some((m) => m.offset === off)) {
                out.push({ kind: "COPIA", offset: off, match: same, label: "Copia a 0x" + this.hex(off) + " · " + Math.round(same * 100) + "%" });
            }
        });
        return out;
    },

    solveDomains(bytes, page) {
        const domains = [];
        if (!page.size) return domains;
        const chk = this.chkFns(bytes).find((c) => c.name === page.checksum);
        if (!chk) return domains;
        const pages = Math.floor(bytes.length / page.size);
        let ok = 0;
        for (let p = 0; p < pages; p++) {
            const start = p * page.size;
            const storedAt = start + page.size - chk.size;
            const calc = chk.fn(start, storedAt);
            if (this.storedMatch(bytes, storedAt, chk.size, calc)) ok++;
        }
        if (ok) {
            domains.push({
                name: page.checksum,
                window: "cada página " + page.size + "B",
                storedAt: page.size - chk.size,
                size: chk.size,
                pages: ok,
                total: pages
            });
        }
        return domains;
    },

    decodeSlot(bytes, addr, width, little) {
        return MathEngine.fromBytes(bytes, addr, width, little);
    },

    scaleFor(raw, knownKm) {
        if (raw === null) return null;
        if (knownKm !== null && knownKm !== undefined) {
            const hit = this.SCALES.find((s) => Math.abs(raw - s.enc(knownKm)) <= 1);
            return hit ? { formula: hit.formula, km: knownKm } : null;
        }
        for (let i = 0; i < this.SCALES.length; i++) {
            const km = this.SCALES[i].inv(raw);
            if (this.looksLikeKm(km)) return { formula: this.SCALES[i].formula, km: Math.round(km) };
        }
        return null;
    },

    stairQuality(values) {
        if (values.length < 3) return { chain: 0, rising: false };
        const uniq = Array.from(new Set(values.filter((v) => v !== null))).sort((a, b) => a - b);
        if (uniq.length < 3) return { chain: 0, rising: false };
        let chain = 1;
        let best = 1;
        for (let i = 1; i < uniq.length; i++) {
            const d = uniq[i] - uniq[i - 1];
            if (d === 1 || d === 2 || d === 10 || d === 16) {
                chain++;
                if (chain > best) best = chain;
            } else chain = 1;
        }
        return { chain: best, rising: uniq[uniq.length - 1] > uniq[0] };
    },

    linkChangingSum(bytes, addrs, width) {
        if (!addrs.length) return null;
        const vary = [];
        for (let o = 0; o < width; o++) {
            const set = new Set();
            addrs.forEach((a) => {
                if (a + o < bytes.length) set.add(bytes[a + o]);
            });
            if (set.size > 1) vary.push(o);
        }
        const offsets = vary.length ? vary : Array.from({ length: width }, (_, i) => i);
        let sum8 = 0;
        let xor8 = 0;
        let sum16 = 0;
        addrs.forEach((a) => {
            offsets.forEach((o) => {
                const b = bytes[a + o];
                sum8 = (sum8 + b) & 0xFF;
                xor8 ^= b;
                sum16 = (sum16 + b) & 0xFFFF;
            });
        });
        const last = addrs[addrs.length - 1] + width;
        const probes = [
            { name: "SUM8 de bytes que cambian", size: 1, value: sum8 },
            { name: "XOR8 de bytes que cambian", size: 1, value: xor8 },
            { name: "SUM16 de bytes que cambian", size: 2, value: sum16 }
        ];
        const zoneStart = Math.max(0, addrs[0] - 16);
        const zoneEnd = Math.min(bytes.length - 1, last + 32);
        for (let i = 0; i < probes.length; i++) {
            const p = probes[i];
            for (let at = zoneStart; at <= zoneEnd - p.size + 1; at++) {
                if (addrs.some((a) => at >= a && at < a + width)) continue;
                if (this.storedMatch(bytes, at, p.size, p.value)) {
                    return { name: p.name, storedAt: at, size: p.size, value: p.value };
                }
            }
        }
        return null;
    },

    makeHit(bytes, world) {
        const addrs = world.addrs;
        const high = world.high;
        const width = world.width;
        return {
            fromMind: true,
            fromWorld: true,
            fromStair: addrs.length >= 3,
            label: "KILOMETRAJE",
            name: "MUNDO_" + world.formula.replace(/\s+/g, "") + "_" + world.endian + width,
            formula: world.formula,
            width,
            endian: world.endian,
            copies: addrs,
            address: high,
            addressText: this.range(high, width),
            hex: MathEngine.hexBytes(bytes.slice(high, high + width)),
            numeric: world.km,
            value: world.km,
            step: world.stride,
            stair: addrs.map((addr) => ({
                addr,
                value: this.decodeSlot(bytes, addr, width, world.endian !== "BE")
            })),
            writeHow: world.writeHow,
            confidence: world.confidence,
            representation: "mundo " + (world.stride ? world.stride + "B" : "isla"),
            checksumAt: world.checksum ? world.checksum.storedAt : undefined,
            checksumName: world.checksum ? world.checksum.name : undefined,
            writable: true,
            worldId: world.id
        };
    },

    isBlank(raw, width) {
        if (raw === null) return true;
        if (raw === 0) return true;
        if (width === 2 && raw === 0xFFFF) return true;
        if (width === 3 && raw === 0xFFFFFF) return true;
        if (width === 4 && raw === 0xFFFFFFFF) return true;
        return false;
    },

    collectRuns(slots, stride) {
        const runs = [];
        if (slots.length < 3) return runs;
        let run = [slots[0]];
        for (let i = 1; i < slots.length; i++) {
            const prev = run[run.length - 1];
            const step = Math.abs(slots[i].raw - prev.raw);
            if (slots[i].addr === prev.addr + stride && (step === 1 || step === 10 || step === 16)) {
                run.push(slots[i]);
            } else {
                if (run.length >= 4) runs.push(run);
                run = [slots[i]];
            }
        }
        if (run.length >= 4) runs.push(run);
        return runs;
    },

    pushWorld(worlds, bytes, spec) {
        if (spec.addrs.length < 3 && spec.kind !== "PAR") return;
        const checksum = spec.checksum || this.linkChangingSum(bytes, spec.addrs, spec.width);
        worlds.push({
            id: spec.id,
            kind: spec.kind,
            formula: spec.formula,
            endian: spec.endian,
            width: spec.width,
            stride: spec.stride,
            addrs: spec.addrs,
            high: spec.high,
            km: spec.km,
            chain: spec.chain,
            checksum,
            confidence: spec.confidence + (checksum ? 8 : 0),
            writeHow: spec.writeHow + (checksum ? " Checksum: " + checksum.name + " @ 0x" + this.hex(checksum.storedAt) + "." : " Sin suma de bytes vivos demostrada.")
        });
    },

    findGridWorlds(bytes, knownKm, page) {
        const worlds = [];
        const strides = [];
        if (page.size) strides.push(page.size);
        [4, 8, 16, 32, 64].forEach((s) => {
            if (strides.indexOf(s) < 0 && bytes.length >= s * 4) strides.push(s);
        });
        const widths = [2, 3, 4];
        strides.forEach((stride) => {
            widths.forEach((width) => {
                if (width > stride) return;
                const offsets = [0, 1, 2];
                if (stride >= 8) offsets.push(4, Math.max(0, stride - width - 2), stride - width);
                const seenOff = new Set();
                offsets.forEach((off) => {
                    if (off < 0 || off + width > stride || seenOff.has(off)) return;
                    seenOff.add(off);
                    [true, false].forEach((little) => {
                        const slots = [];
                        for (let a = off; a + width <= bytes.length; a += stride) {
                            const raw = this.decodeSlot(bytes, a, width, little);
                            if (this.isBlank(raw, width)) continue;
                            slots.push({ addr: a, raw });
                        }
                        if (slots.length < 3) return;
                        const endian = little ? "LE" : "BE";
                        const addGrid = (picked, kind, extraConf) => {
                            if (picked.length < 3) return;
                            const high = picked.reduce((a, b) => (a.raw >= b.raw ? a : b));
                            const scaled = this.scaleFor(high.raw, knownKm);
                            if (!scaled || !this.looksLikeKm(scaled.km)) return;
                            if (knownKm !== null && knownKm !== undefined && scaled.km !== knownKm) return;
                            const quality = this.stairQuality(picked.map((s) => s.raw));
                            this.pushWorld(worlds, bytes, {
                                id: kind[0] + stride + "_" + off + "_" + endian + width,
                                kind,
                                formula: scaled.formula,
                                endian,
                                width,
                                stride,
                                addrs: picked.map((s) => s.addr),
                                high: high.addr,
                                km: scaled.km,
                                chain: quality.chain,
                                confidence: Math.min(91, 68 + picked.length * 2 + quality.chain + extraConf + (page.size === stride ? 6 : 0) + (knownKm !== null ? 10 : 0)),
                                writeHow: "Mundo del chip: " + kind.toLowerCase() + " " + stride + "B, " + picked.length +
                                    " huecos " + endian + width + " = " + scaled.formula +
                                    ". El KM actual es el más alto (" + scaled.km + ")."
                            });
                        };

                        this.collectRuns(slots, stride).forEach((run) => addGrid(run, "RAMPA", 8));

                        if (knownKm !== null && knownKm !== undefined) {
                            this.SCALES.forEach((scale) => {
                                const target = scale.enc(knownKm);
                                const near = slots.filter((s) => s.raw <= target + 1 && s.raw >= target - 64);
                                const exact = near.filter((s) => Math.abs(s.raw - target) <= 1);
                                if (exact.length && near.length >= 3) addGrid(near, "COPIAS", 12);
                            });
                        } else {
                            const groups = new Map();
                            slots.forEach((s) => {
                                if (!this.looksLikeKm(s.raw) && !this.looksLikeKm(s.raw / 10)) return;
                                const key = String(s.raw);
                                if (!groups.has(key)) groups.set(key, []);
                                groups.get(key).push(s);
                            });
                            groups.forEach((group) => {
                                if (group.length >= 3) addGrid(group, "COPIAS", 4);
                            });
                        }
                    });
                });
            });
        });
        return worlds;
    },

    findPairWorlds(bytes, pair, km1, km2) {
        const worlds = [];
        if (!pair || km1 === null || km1 === undefined || km2 === null || km2 === undefined) return worlds;
        const n = Math.min(bytes.length, pair.length);
        const diffs = [];
        for (let i = 0; i < n; i++) if (bytes[i] !== pair[i]) diffs.push(i);
        if (diffs.length < 2 || diffs.length > Math.min(400, n * 0.35)) return worlds;
        const islands = [];
        let run = [diffs[0]];
        for (let i = 1; i < diffs.length; i++) {
            if (diffs[i] <= run[run.length - 1] + 4) run.push(diffs[i]);
            else {
                islands.push(run);
                run = [diffs[i]];
            }
        }
        islands.push(run);
        islands.forEach((isle) => {
            const start = isle[0];
            const end = isle[isle.length - 1];
            const span = end - start + 1;
            if (span < 2 || span > 8) return;
            [2, 3, 4].forEach((width) => {
                if (start + width > bytes.length) return;
                [true, false].forEach((little) => {
                    const raw1 = this.decodeSlot(bytes, start, width, little);
                    const raw2 = this.decodeSlot(pair, start, width, little);
                    if (raw1 === null || raw2 === null || raw1 === raw2) return;
                    const s1 = this.scaleFor(raw1, km1);
                    const s2 = this.scaleFor(raw2, km2);
                    if (!s1 || !s2 || s1.formula !== s2.formula) return;
                    const checksum = this.linkChangingSum(bytes, [start], width);
                    worlds.push({
                        id: "P" + start + "_" + (little ? "LE" : "BE") + width,
                        kind: "PAR",
                        formula: s1.formula,
                        endian: little ? "LE" : "BE",
                        width,
                        stride: 0,
                        addrs: [start],
                        high: start,
                        km: s1.km,
                        chain: 2,
                        checksum,
                        confidence: checksum ? 99.3 : 97.6,
                        writeHow: "Mundo del par: misma celda 0x" + this.hex(start) + " guarda " +
                            km1 + " y " + km2 + " como " + s1.formula + " " + (little ? "LE" : "BE") + width +
                            (checksum ? ". " + checksum.name + " @ 0x" + this.hex(checksum.storedAt) : ".")
                    });
                });
            });
        });
        return worlds;
    },

    rankWorlds(worlds) {
        const ranked = worlds.slice().sort((a, b) => {
            const sa = (a.confidence || 0) + (a.addrs.length * 0.4) + (a.checksum ? 8 : 0) + (a.kind === "PAR" ? 6 : 0);
            const sb = (b.confidence || 0) + (b.addrs.length * 0.4) + (b.checksum ? 8 : 0) + (b.kind === "PAR" ? 6 : 0);
            return sb - sa;
        });
        const uniq = [];
        const seen = new Set();
        ranked.forEach((w) => {
            const key = w.high + "|" + w.formula + "|" + w.width + "|" + w.endian + "|" + w.kind;
            if (seen.has(key)) return;
            seen.add(key);
            uniq.push(w);
        });
        return uniq;
    },

    buildStrip(bytes, kinds, worlds, mirrors) {
        const cells = 192;
        const bpp = Math.max(1, Math.ceil(bytes.length / cells));
        const kmSet = new Set();
        const chkSet = new Set();
        worlds.slice(0, 3).forEach((w) => {
            w.addrs.forEach((a) => {
                for (let i = 0; i < w.width; i++) kmSet.add(a + i);
            });
            if (w.checksum) {
                for (let i = 0; i < w.checksum.size; i++) chkSet.add(w.checksum.storedAt + i);
            }
        });
        const mirrorAt = mirrors.length ? mirrors[0].offset : -1;
        const strip = [];
        for (let c = 0; c < cells; c++) {
            const start = c * bpp;
            if (start >= bytes.length) break;
            const end = Math.min(bytes.length, start + bpp);
            let tag = "empty";
            let empty = 0, dead = 0, live = 0, km = 0, chk = 0;
            for (let i = start; i < end; i++) {
                if (chkSet.has(i)) chk++;
                else if (kmSet.has(i)) km++;
                else if (kinds[i] === 3) live++;
                else if (kinds[i] === 1) empty++;
                else dead++;
            }
            if (km) tag = "km";
            else if (chk) tag = "chk";
            else if (live) tag = "live";
            else if (mirrorAt >= 0 && start >= mirrorAt && start < mirrorAt + bpp) tag = "mirror";
            else if (dead >= empty) tag = "dead";
            strip.push({ start, tag });
        }
        return strip;
    },

    passport(bytes, page, mirrors, anatomy, worlds) {
        const lines = [];
        lines.push("PASAPORTE · " + bytes.length + " bytes");
        if (page.size) {
            lines.push("Página " + page.size + "B · " + page.checksum + " en " + page.hits + "/" + page.pages + " páginas (" + Math.round(page.score * 100) + "%)");
        } else {
            lines.push("Sin página con checksum regular. Sigo por rampas e islas vivas.");
        }
        if (mirrors.length) lines.push(mirrors.map((m) => m.label).join(" · "));
        else lines.push("Sin espejo de mitad/cuartos.");
        lines.push("Vivos " + anatomy.living + " · Fijos " + anatomy.dead + " · Vacíos " + anatomy.empty);
        if (worlds[0]) {
            const w = worlds[0];
            lines.push("MUNDO KM: " + w.km + " · " + w.formula + " " + w.endian + w.width + " · " + w.addrs.length + " huecos · " + this.range(w.high, w.width));
            if (w.checksum) lines.push("Suma del mundo: " + w.checksum.name + " @ 0x" + this.hex(w.checksum.storedAt));
        } else {
            lines.push("Aún no hay universo de KM. Pinta el rojo o carga el par.");
        }
        return lines.join("\n");
    },

    map(bytes, options) {
        options = options || {};
        if (!bytes || bytes.length < 16) return this.emptyWorld(bytes);
        const knownKm = options.knownKm;
        const pair = options.pairBytes || null;
        const km2 = options.knownKm2;
        const anatomy = this.classify(bytes, pair);
        const page = this.detectPage(bytes);
        const mirrors = this.detectMirrors(bytes);
        const domains = this.solveDomains(bytes, page);
        const grid = this.findGridWorlds(bytes, knownKm, page);
        const pairWorlds = this.findPairWorlds(bytes, pair, knownKm, km2);
        const worlds = this.rankWorlds(pairWorlds.concat(grid)).slice(0, 8);
        const hits = worlds.map((w) => this.makeHit(bytes, w));
        const strip = this.buildStrip(bytes, anatomy.kinds, worlds, mirrors);
        const text = this.passport(bytes, page, mirrors, anatomy, worlds);
        return {
            size: bytes.length,
            page,
            mirrors,
            domains,
            worlds,
            hits,
            living: anatomy.living,
            dead: anatomy.dead,
            empty: anatomy.empty,
            kinds: anatomy.kinds,
            strip,
            passport: text,
            headline: worlds[0] ? ("MUNDO " + worlds[0].km + " KM") : "CHIP MAPEADO"
        };
    },

    hintAt(world, addr) {
        if (!world || !world.worlds || addr === undefined) return "";
        for (let i = 0; i < world.worlds.length; i++) {
            const w = world.worlds[i];
            if (w.addrs.some((a) => addr >= a && addr < a + w.width)) {
                return "MUNDO KM " + w.km + " · " + w.formula + " " + w.endian + w.width;
            }
            if (w.checksum && addr >= w.checksum.storedAt && addr < w.checksum.storedAt + w.checksum.size) {
                return "SUMA DEL MUNDO · " + w.checksum.name;
            }
        }
        if (world.kinds && world.kinds[addr] === 3) return "byte vivo";
        if (world.kinds && world.kinds[addr] === 1) return "vacío";
        return "";
    }
};
