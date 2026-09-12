const WriteMachine = {

    hex(value, size) {
        return Number(value).toString(16).toUpperCase().padStart(size || 2, "0");
    },

    varyOffsets(bytes, addrs, width) {
        const vary = [];
        for (let o = 0; o < width; o++) {
            const set = new Set();
            addrs.forEach((a) => {
                if (a + o < bytes.length) set.add(bytes[a + o]);
            });
            if (set.size > 1) vary.push(o);
        }
        return vary.length ? vary : Array.from({ length: width }, (_, i) => i);
    },

    encodeChk(name, value, size, endian) {
        if (name.indexOf("XOR") !== -1) return MathEngine.toBytes(value, size, endian !== "BE");
        if (name.indexOf("LRC") !== -1) return MathEngine.toBytes(value, 1, true);
        return MathEngine.toBytes(value, size, endian !== "BE");
    },

    calcWindow(bytes, item) {
        const name = String(item.name || "SUM8").toUpperCase();
        if (name.indexOf("XOR") !== -1) return ChecksumEngine.xor8(bytes, item.start, item.end);
        if (name.indexOf("LRC") !== -1) return ChecksumEngine.lrc(bytes, item.start, item.end);
        if ((item.size || 1) >= 2 || name.indexOf("SUM16") !== -1) return ChecksumEngine.sum16(bytes, item.start, item.end);
        return ChecksumEngine.sum8(bytes, item.start, item.end);
    },

    calcChanging(bytes, item) {
        let sum8 = 0;
        let xor8 = 0;
        let sum16 = 0;
        item.addrs.forEach((a) => {
            item.offsets.forEach((o) => {
                const b = bytes[a + o];
                sum8 = (sum8 + b) & 0xFF;
                xor8 ^= b;
                sum16 = (sum16 + b) & 0xFFFF;
            });
        });
        const name = String(item.name || "").toUpperCase();
        if (name.indexOf("XOR") !== -1) return xor8;
        if (name.indexOf("SUM16") !== -1) return sum16;
        return sum8;
    },

    writeChk(bytes, item, value) {
        const stored = this.encodeChk(item.name, value, item.size || 1, item.endian || "LE");
        bytes.set(stored, item.storedAt);
    },

    stillMatches(bytes, item) {
        const calc = item.kind === "CHANGING" ? this.calcChanging(bytes, item) : this.calcWindow(bytes, item);
        const stored = MathEngine.fromBytes(bytes, item.storedAt, item.size || 1, item.endian !== "BE");
        return stored === calc;
    },

    seal(bytes, ctx) {
        ctx = ctx || {};
        const best = ctx.best;
        if (!best || best.address === undefined) {
            return {
                locked: false,
                headline: "SIN MÁQUINA",
                card: "Analiza primero. La máquina se sella cuando el KM y sus sumas están demostrados.",
                slots: [],
                checksums: [],
                mirrors: [],
                kmNow: null
            };
        }
        const width = best.width || 2;
        const addrs = (best.copies && best.copies.length ? best.copies.slice() : [best.address]).sort((a, b) => a - b);
        const little = best.endian !== "BE";
        const decoded = addrs.map((addr) => {
            const raw = MathEngine.fromBytes(bytes, addr, width, little);
            return { addr, raw, km: best.value };
        });
        const highRaw = decoded.reduce((a, b) => ((a.raw || 0) >= (b.raw || 0) ? a : b));
        const slots = decoded.map((s) => ({
            addr: s.addr,
            raw: s.raw,
            role: s.addr === highRaw.addr ? "ACTUAL" : (s.raw === highRaw.raw ? "COPIA" : "RAMPA"),
            hex: MathEngine.hexBytes(bytes.slice(s.addr, s.addr + width))
        }));
        const checksums = [];
        const seen = new Set();
        const addChk = (item) => {
            if (!item || item.storedAt === undefined || item.storedAt === null) return;
            const key = item.kind + "|" + item.storedAt + "|" + item.name;
            if (seen.has(key)) return;
            seen.add(key);
            checksums.push(item);
        };
        if (best.familyId === "YAMAHA_R5F10" && typeof FamilyLibrary !== "undefined") {
            const ring = FamilyLibrary.r5fRingPages(bytes);
            const last = ring.length ? ring[ring.length - 1].addr : (best.address || 0);
            for (let p = 0; p <= last; p += 0x20) {
                addChk({
                    kind: "CLOSED",
                    name: "SUM16",
                    start: p,
                    end: p + 3,
                    storedAt: p + 30,
                    size: 2,
                    endian: "BE"
                });
            }
        } else {
            (ctx.kmChecksums || []).forEach((c) => {
                addChk({
                    kind: "WINDOW",
                    name: c.name,
                    start: c.start,
                    end: c.end,
                    storedAt: c.storedAt,
                    size: c.size || 1,
                    endian: c.endian || "LE"
                });
            });
            (ctx.closed || []).forEach((cell) => {
                if (cell.checksumAt === undefined) return;
                addChk({
                    kind: "CLOSED",
                    name: cell.checksumName || "SUM8",
                    start: cell.address,
                    end: cell.address + (cell.width || width),
                    storedAt: cell.checksumAt,
                    size: /16/.test(cell.checksumName || "") ? 2 : 1,
                    endian: "LE"
                });
            });
            const world = ctx.world;
            if (world && world.worlds && world.worlds[0] && world.worlds[0].checksum) {
                const w = world.worlds[0];
                addChk({
                    kind: "CHANGING",
                    name: w.checksum.name,
                    addrs: w.addrs.slice(),
                    width: w.width,
                    offsets: this.varyOffsets(bytes, w.addrs, w.width),
                    storedAt: w.checksum.storedAt,
                    size: w.checksum.size || 1,
                    endian: "LE"
                });
            }
            if (best.checksumAt !== undefined) {
                addChk({
                    kind: "CLOSED",
                    name: best.checksumName || "SUM8",
                    start: best.address,
                    end: best.address + width,
                    storedAt: best.checksumAt,
                    size: /16/.test(best.checksumName || "") ? 2 : 1,
                    endian: "LE"
                });
            }
        }
        const world = ctx.world;
        const locked = !!(
            best.writable !== false &&
            ctx.truth &&
            (ctx.truth.status === "DEMOSTRADO" || ctx.truth.status === "LUGAR DEMOSTRADO" ||
                best.fromWorld || best.fromClosed || best.fromPair || best.fromFamily)
        );
        const mirrors = (world && world.mirrors) ? world.mirrors : [];
        const machine = {
            locked,
            writable: best.writable !== false,
            kmNow: typeof best.value === "number" ? best.value : null,
            formula: best.formula,
            width,
            endian: best.endian || "LE",
            familyId: best.familyId || null,
            fromWorld: !!best.fromWorld,
            fromStair: !!best.fromStair,
            slots,
            checksums,
            mirrors,
            page: world && world.page ? world.page : null,
            writeHow: best.writeHow || "",
            truth: ctx.truth ? ctx.truth.status : "—"
        };
        machine.headline = (locked ? "SELLADA" : "ABIERTA") + " · " +
            (machine.kmNow !== null ? machine.kmNow + " KM" : "sin KM") + " · " +
            slots.length + " huecos · " + checksums.length + " sumas";
        machine.card = this.card(machine);
        return machine;
    },

    card(machine) {
        if (!machine || !machine.slots.length) {
            return "La máquina espera un análisis demostrado. Nadie más sella el chip así: KM + rampa + sumas + espejos en un solo contrato.";
        }
        const lines = [];
        lines.push(machine.headline);
        lines.push("Fórmula " + machine.formula + " · " + machine.endian + machine.width);
        lines.push("Huecos:");
        machine.slots.forEach((s) => {
            lines.push("  " + s.role + "  0x" + this.hex(s.addr, 4) + "  " + s.hex);
        });
        if (machine.checksums.length) {
            lines.push("Sumas que deben seguir cerrando:");
            machine.checksums.forEach((c) => {
                lines.push("  " + c.name + " @ 0x" + this.hex(c.storedAt, 4) + " · " + c.kind);
            });
        } else {
            lines.push("Sin suma ligada. La máquina escribe solo los huecos del KM.");
        }
        if (machine.mirrors && machine.mirrors[0]) lines.push(machine.mirrors[0].label);
        if (machine.page && machine.page.size) {
            lines.push("Página " + machine.page.size + "B · " + (machine.page.checksum || "sin sum"));
        }
        lines.push(machine.locked
            ? "Contrato cerrado. Escribe un KM fantasma: verás cada byte antes de tocar el archivo."
            : "Aún no se sella. Falta demostrar el lugar o la fórmula.");
        if (machine.writeHow) lines.push(machine.writeHow);
        return lines.join("\n");
    },

    prove(machine, bytes) {
        if (!machine) return { ok: false, broken: ["sin máquina"], notes: [] };
        const broken = [];
        const notes = [];
        machine.checksums.forEach((c) => {
            if (this.stillMatches(bytes, c)) notes.push(c.name + " cierra @ 0x" + this.hex(c.storedAt, 4));
            else broken.push(c.name + " roto @ 0x" + this.hex(c.storedAt, 4));
        });
        return { ok: !broken.length, broken, notes };
    },

    repair(machine, bytes) {
        const repaired = [];
        machine.checksums.forEach((c) => {
            const calc = c.kind === "CHANGING" ? this.calcChanging(bytes, c) : this.calcWindow(bytes, c);
            this.writeChk(bytes, c, calc);
            repaired.push({ name: c.name, storedAt: c.storedAt, value: calc });
        });
        return repaired;
    },

    diffs(before, after) {
        const out = [];
        const n = Math.min(before.length, after.length);
        for (let i = 0; i < n; i++) {
            if (before[i] !== after[i]) {
                out.push({
                    addr: i,
                    from: before[i],
                    to: after[i]
                });
            }
        }
        return out;
    },

    ghost(machine, bytes, newKm, hit) {
        if (!machine || !machine.slots.length) return null;
        if (machine.writable === false) {
            return {
                blocked: true,
                reason: "Lugar demostrado, fórmula de escritura no. No se fabrica fantasma.",
                diffs: [],
                proved: { ok: false, broken: ["no escribible"], notes: [] },
                bytes: new Uint8Array(bytes),
                repaired: [],
                slots: machine.slots.length
            };
        }
        if (!machine.locked) {
            return {
                blocked: true,
                reason: "La máquina no está sellada. Analiza hasta DEMOSTRADO.",
                diffs: [],
                proved: { ok: false, broken: ["sin sello"], notes: [] },
                bytes: new Uint8Array(bytes),
                repaired: [],
                slots: machine.slots.length
            };
        }
        const km = Number(newKm);
        if (!Number.isFinite(km)) return null;
        const applied = EditorEngine.apply(bytes, hit, km);
        const working = applied.bytes;
        const repaired = this.repair(machine, working);
        const proved = this.prove(machine, working);
        if (!proved.ok) {
            this.repair(machine, working);
            const again = this.prove(machine, working);
            proved.ok = again.ok;
            proved.broken = again.broken;
            proved.notes = again.notes.concat(["segundo pase de sello"]);
        }
        return {
            blocked: false,
            bytes: working,
            diffs: this.diffs(bytes, working),
            repaired,
            proved,
            slots: applied.copies || machine.slots.length,
            km
        };
    }
};
