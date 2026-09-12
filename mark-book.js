const MarkBook = {

    brush: "KM",
    painting: false,
    lastPaint: null,
    user: {},
    lessons: { KM: [], CHK: [], CRC: [], COMP: [], COPY: [], HINT: [] },
    guideStep: "KM",
    guideOrder: ["KM", "CHK", "COMP", "LISTO"],
    revealed: false,
    STORAGE: "velocimetros-cdmx-marks-v1",

    kinds: {
        KM: { cls: "hex-user-km", label: "KM", help: "Kilometraje" },
        CHK: { cls: "hex-user-chk", label: "SUM", help: "Checksum / suma" },
        CRC: { cls: "hex-user-crc", label: "CRC", help: "CRC" },
        COMP: { cls: "hex-user-comp", label: "COMP", help: "Complemento del checksum" },
        COPY: { cls: "hex-user-copy", label: "COPIA", help: "Copia espejo" },
        HINT: { cls: "hex-user-hint", label: "PISTA", help: "Otra zona" }
    },

    exclusiveKinds: ["KM", "CHK", "CRC", "COMP"],

    stepHelp() {
        return {
            KM: "Pinta solo el KM. ACEPTO guarda y quita el color para que pintes otro.",
            CHK: "KM guardado. Pinta SUM o CRC en OTRO byte, no encima del KM. ACEPTO limpia el color.",
            COMP: "SUM guardado. Pinta COMP aparte. ACEPTO limpia el color.",
            LISTO: "Tus marcas están guardadas (hex limpio). ANALIZAR las pinta y trabaja solo lo que cambia."
        }[this.guideStep] || "Pinta un color, ACEPTO, luego otro. ANALIZAR las muestra.";
    },

    setBrush(kind) {
        if (!kind) return;
        this.brush = kind;
        document.querySelectorAll(".mark-swatch").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-mark") === kind);
        });
        const label = document.getElementById("markActive");
        if (label) {
            const info = this.kinds[kind];
            label.textContent = kind === "ERASE" ? "Borrar" : (info ? info.label : kind);
        }
        document.body.classList.add("marking-on");
        document.body.setAttribute("data-brush", kind);
        this.renderGuide();
    },

    paint(addr) {
        if (addr === undefined || addr === null || isNaN(addr)) return;
        const key = String(addr);
        if (this.brush === "ERASE") delete this.user[key];
        else this.user[key] = this.brush;
        this.refresh(addr);
    },

    stroke(from, to) {
        if (to === null || to === undefined) return;
        if (from === null || from === undefined || from === to) {
            this.paint(to);
            this.lastPaint = to;
            return;
        }
        const a = Math.min(from, to);
        const b = Math.max(from, to);
        if (b - a > 96) {
            this.paint(to);
            this.lastPaint = to;
            return;
        }
        for (let i = a; i <= b; i++) this.paint(i);
        this.lastPaint = to;
    },

    addrFromEvent(event) {
        const x = event.clientX;
        const y = event.clientY;
        if (x === undefined || y === undefined) return this.addrFrom(event.target);
        const top = document.elementFromPoint(x, y);
        return this.addrFrom(top) !== null ? this.addrFrom(top) : this.addrFrom(event.target);
    },

    emptyLessons() {
        return { KM: [], CHK: [], CRC: [], COMP: [], COPY: [], HINT: [] };
    },

    clear() {
        this.user = {};
        this.lessons = this.emptyLessons();
        this.guideStep = "KM";
        this.revealed = false;
        this.persist();
        this.setBrush("KM");
        this.renderGuide();
    },

    eraseKind(kind) {
        Object.keys(this.user).forEach((key) => {
            if (this.user[key] === kind) delete this.user[key];
        });
    },

    guiding() {
        return !this.revealed;
    },

    recipeText() {
        const el = document.getElementById("helpRecipe");
        return el ? String(el.value || "").trim() : "";
    },

    parseRecipe(text) {
        const raw = String(text || this.recipeText() || "");
        const t = raw.toLowerCase().replace(/×/g, "x").replace(/,/g, " ");
        const rec = { formula: null, width: null, endian: null, chk: null, chkOn: null, raw: raw };
        if (!raw) return rec;
        if (/x\s*10\s*-\s*1|por 10 menos 1/.test(t)) rec.formula = "X * 10 - 1";
        else if (/x\s*10\s*-\s*5|por 10 menos 5/.test(t)) rec.formula = "X * 10 - 5";
        else if (/x\s*10\s*\+\s*5/.test(t)) rec.formula = "X * 10 + 5";
        else if (/x\s*1000|metros|por 1000/.test(t)) rec.formula = "X * 1000";
        else if (/x\s*100|por 100/.test(t)) rec.formula = "X * 100";
        else if (/x\s*16/.test(t)) rec.formula = "X * 16";
        else if (/x\s*10|por\s*10|por diez|multiplicad|veces 10|x10/.test(t)) rec.formula = "X * 10";
        else if (/\bx\b|sin formula|tal cual|directo|tal y como/.test(t) && /rojo|km|kilom/.test(t)) rec.formula = "X";
        if (!rec.formula && /rojo|kilom|\bkm\b/.test(t) && /byte/.test(t)) rec.formula = "X";
        if (/4\s*byte/.test(t)) rec.width = 4;
        else if (/3\s*byte|tres byte/.test(t)) rec.width = 3;
        else if (/2\s*byte|dos byte/.test(t)) rec.width = 2;
        if (/big|be\b|motorola|hi\s*lo|primero el alto/.test(t)) rec.endian = "BE";
        else if (/little|le\b|intel|lo\s*hi|primero el bajo/.test(t)) rec.endian = "LE";
        if (/sum16|suma 16/.test(t)) rec.chk = "SUM16";
        else if (/crc32/.test(t)) rec.chk = "CRC32";
        else if (/crc16/.test(t)) rec.chk = "CRC16";
        else if (/crc8/.test(t)) rec.chk = "CRC8";
        else if (/suma|sum8|sumas|checksum|la sum/.test(t)) rec.chk = "SUM8";
        if (/morado|crc/.test(t) && /escrib|guarda|ahi|allí|dónde|donde/.test(t)) rec.chkOn = "CRC";
        else if (/azul|sum\b/.test(t) && /escrib|guarda|ahi|allí|donde/.test(t)) rec.chkOn = "CHK";
        if (/complemento|\bcomp\b/.test(t)) rec.chkOn = rec.chkOn || "COMP";
        if (!rec.chkOn && rec.chk) {
            if (this.lessonRanges("CRC").length || this.ranges("CRC").length) rec.chkOn = "CRC";
            else if (this.lessonRanges("CHK").length || this.ranges("CHK").length) rec.chkOn = "CHK";
            else if (this.lessonRanges("COMP").length || this.ranges("COMP").length) rec.chkOn = "COMP";
        }
        rec.note = [
            rec.formula ? "KM = " + rec.formula : null,
            rec.width ? rec.width + " bytes" : null,
            rec.endian || null,
            rec.chk ? rec.chk + (rec.chkOn ? " en " + rec.chkOn : "") : null
        ].filter(Boolean).join(" · ");
        return rec;
    },

    recipe() {
        return this.parseRecipe(this.recipeText());
    },

    rivalsOf(kind) {
        if (this.exclusiveKinds.indexOf(kind) < 0) return [];
        return this.exclusiveKinds.filter((key) => key !== kind);
    },

    claimExclusive(kind, ranges) {
        const claimed = new Set();
        (ranges || []).forEach((range) => {
            for (let addr = range.start; addr <= range.end; addr++) claimed.add(addr);
        });
        if (!claimed.size) return;
        this.rivalsOf(kind).forEach((rival) => {
            const kept = [];
            (this.lessons[rival] || []).forEach((range) => {
                for (let addr = range.start; addr <= range.end; addr++) {
                    if (!claimed.has(addr)) kept.push({ addr, kind: rival });
                }
            });
            this.lessons[rival] = this.compact(kept);
        });
    },

    roleSet(kind) {
        const mine = new Set();
        this.lessonRanges(kind).forEach((range) => {
            for (let addr = range.start; addr <= range.end; addr++) mine.add(addr);
        });
        this.rivalsOf(kind).forEach((rival) => {
            this.savedRanges(rival).forEach((range) => {
                for (let addr = range.start; addr <= range.end; addr++) mine.delete(addr);
            });
            this.ranges(rival).forEach((range) => {
                for (let addr = range.start; addr <= range.end; addr++) mine.delete(addr);
            });
        });
        return mine;
    },

    paintedAddrs(kind) {
        return Array.from(this.roleSet(kind)).sort((a, b) => a - b);
    },

    exclusiveRanges(kind) {
        const addrs = this.paintedAddrs(kind);
        const out = [];
        addrs.forEach((addr) => {
            const last = out[out.length - 1];
            if (last && addr === last.end + 1) last.end = addr;
            else out.push({ start: addr, end: addr, kind });
        });
        out.forEach((r) => { r.size = r.end - r.start + 1; });
        return out;
    },

    persist() {
        try {
            localStorage.setItem(this.STORAGE, JSON.stringify({
                lessons: this.lessons,
                guideStep: this.guideStep,
                recipe: this.recipeText()
            }));
        } catch (error) { /* ignore */ }
    },

    loadPersisted() {
        try {
            const raw = localStorage.getItem(this.STORAGE);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.lessons) this.lessons = Object.assign(this.emptyLessons(), data.lessons);
            this.user = {};
            this.revealed = false;
            if (data.guideStep) this.guideStep = data.guideStep;
            if (!this.hasLessons()) this.guideStep = "KM";
            if (data.recipe && document.getElementById("helpRecipe")) {
                document.getElementById("helpRecipe").value = data.recipe;
            }
        } catch (error) { /* ignore */ }
    },

    compact(ranges) {
        const items = [];
        (ranges || []).forEach((range) => {
            for (let addr = range.start; addr <= range.end; addr++) {
                items.push({ addr, kind: range.kind });
            }
        });
        items.sort((a, b) => a.addr - b.addr);
        const out = [];
        items.forEach((item) => {
            const last = out[out.length - 1];
            if (last && item.addr === last.end + 1 && last.kind === item.kind) last.end = item.addr;
            else out.push({ start: item.addr, end: item.addr, kind: item.kind });
        });
        out.forEach((r) => { r.size = r.end - r.start + 1; });
        return out;
    },

    harvest() {
        ["KM", "CHK", "CRC", "COMP", "COPY", "HINT"].forEach((kind) => {
            const live = this.snapshot(kind);
            if (!live.length) return;
            this.lessons[kind] = this.compact((this.lessons[kind] || []).concat(live));
        });
        this.persist();
        return this.hasHelp();
    },

    hasHelp() {
        return this.hasLessons() || !!this.recipeText() || Object.keys(this.user).length > 0;
    },

    savedRanges(kind) {
        return this.lessons[kind] || [];
    },

    allSaved() {
        return ["KM", "CHK", "CRC", "COMP", "COPY", "HINT"].reduce((acc, kind) => acc.concat(this.savedRanges(kind)), []);
    },

    countBytes(kind) {
        return this.savedRanges(kind).reduce((n, r) => n + (r.size || 0), 0);
    },

    nextBrush() {
        if (!this.lessons.KM.length) return "KM";
        if (!this.lessons.CHK.length && !this.lessons.CRC.length) return "CHK";
        if (!this.lessons.COMP.length) return "COMP";
        return "KM";
    },

    restoreAccepted() {
        Object.keys(this.lessons).forEach((kind) => {
            (this.lessons[kind] || []).forEach((range) => {
                for (let addr = range.start; addr <= range.end; addr++) this.user[String(addr)] = kind;
            });
        });
        this.revealed = true;
        this.renderGuide();
    },

    ranges(kind) {
        const addrs = Object.keys(this.user).map(Number).filter((a) => this.user[String(a)] === kind).sort((a, b) => a - b);
        const out = [];
        addrs.forEach((addr) => {
            const last = out[out.length - 1];
            if (last && addr === last.end + 1) last.end = addr;
            else out.push({ start: addr, end: addr, kind });
        });
        out.forEach((r) => { r.size = r.end - r.start + 1; });
        return out;
    },

    snapshot(kind) {
        return this.ranges(kind).map((r) => ({ start: r.start, end: r.end, size: r.size, kind: r.kind }));
    },

    lessonRanges(kind) {
        return this.compact((this.lessons[kind] || []).concat(this.ranges(kind)));
    },

    allRanges() {
        return ["KM", "CHK", "CRC", "COMP", "COPY", "HINT"].reduce((acc, kind) => acc.concat(this.lessonRanges(kind)), []);
    },

    hasLessons() {
        return ["KM", "CHK", "CRC", "COMP"].some((kind) => (this.lessons[kind] || []).length);
    },

    accept() {
        const kinds = ["KM", "CHK", "CRC", "COMP", "COPY", "HINT"].filter((kind) => this.snapshot(kind).length);
        if (!kinds.length) {
            if (this.guideStep === "LISTO" && this.hasLessons()) {
                this.renderGuide();
                return { ok: true, step: "LISTO", analyze: false, message: "Ya está guardado. Pulsa ANALIZAR para ver tus colores." };
            }
            return { ok: false, step: this.guideStep, message: "Pinta el color y luego ACEPTO. Arrastra por todos los bytes." };
        }
        kinds.forEach((kind) => {
            const snap = this.snapshot(kind);
            this.lessons[kind] = this.compact((this.lessons[kind] || []).concat(snap));
            this.claimExclusive(kind, snap);
            this.eraseKind(kind);
        });
        const next = this.nextBrush();
        this.guideStep = !this.lessons.KM.length ? "KM"
            : (!this.lessons.CHK.length && !this.lessons.CRC.length ? "CHK"
                : (!this.lessons.COMP.length ? "COMP" : "LISTO"));
        this.revealed = false;
        this.persist();
        this.setBrush(next);
        this.renderGuide();
        const bits = kinds.map((kind) => {
            const n = this.countBytes(kind);
            return (this.kinds[kind] ? this.kinds[kind].label : kind) + " " + n + " B";
        });
        return {
            ok: true,
            step: this.guideStep,
            analyze: false,
            message: "Guardado: " + bits.join(" · ") + ". Color quitado. Ahora pinta " +
                (this.kinds[next] ? this.kinds[next].label : next) + " o pulsa ANALIZAR."
        };
    },

    skip() {
        if (this.guideStep === "KM") {
            this.eraseKind("KM");
            this.guideStep = "CHK";
            this.persist();
            this.setBrush("CHK");
            return { ok: true, message: "Sin KM. Hex limpio. Ahora SUM." };
        }
        if (this.guideStep === "CHK") {
            this.eraseKind("CHK");
            this.eraseKind("CRC");
            this.guideStep = "COMP";
            this.persist();
            this.setBrush("COMP");
            return { ok: true, message: "Sin checksum. Hex limpio. Ahora COMP." };
        }
        if (this.guideStep === "COMP") {
            this.eraseKind("COMP");
            this.guideStep = "LISTO";
            this.persist();
            this.renderGuide();
            return { ok: true, analyze: false, message: this.hasLessons() ? "Con tu ayuda (sin COMP). Pulsa ANALIZAR." : "Sin complemento. Pulsa ANALIZAR." };
        }
        return { ok: true, message: "Listo." };
    },

    renderGuide() {
        const guide = document.getElementById("markGuide");
        const lessons = document.getElementById("markLessons");
        if (guide) guide.textContent = this.stepHelp();
        if (lessons) {
            const bits = [];
            if (this.lessons.KM.length) bits.push("KM " + this.countBytes("KM") + " B");
            if (this.lessons.CHK.length || this.lessons.CRC.length) bits.push("SUM/CRC " + (this.countBytes("CHK") + this.countBytes("CRC")) + " B");
            if (this.lessons.COMP.length) bits.push("COMP " + this.countBytes("COMP") + " B");
            lessons.textContent = bits.length ? "Guardado: " + bits.join(" · ") : "Nada aceptado aún.";
        }
        const accept = document.getElementById("markAcceptBtn");
        if (accept) accept.textContent = "ACEPTO";
    },

    bindPaint(el) {
        if (!el || el.getAttribute("data-mark-bound")) return;
        el.setAttribute("data-mark-bound", "1");
        const down = (event) => {
            const addr = this.addrFromEvent(event);
            if (addr === null) return;
            event.preventDefault();
            this.painting = true;
            this.lastPaint = addr;
            if (event.currentTarget && event.currentTarget.setPointerCapture && event.pointerId !== undefined) {
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
            }
            this.paint(addr);
        };
        const move = (event) => {
            if (!this.painting) return;
            const addr = this.addrFromEvent(event);
            if (addr === null) return;
            this.stroke(this.lastPaint, addr);
        };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointermove", move);
    },

    refresh(addr) {
        const kind = this.user[String(addr)];
        document.querySelectorAll("[data-addr=\"" + addr + "\"]").forEach((node) => {
            Object.keys(this.kinds).forEach((key) => node.classList.remove(this.kinds[key].cls));
            if (kind && this.kinds[kind]) node.classList.add(this.kinds[kind].cls);
        });
    },

    pickSwatch(event) {
        const btn = event.target && event.target.closest ? event.target.closest(".mark-swatch") : null;
        if (!btn) return false;
        event.preventDefault();
        event.stopPropagation();
        this.setBrush(btn.getAttribute("data-mark"));
        return true;
    },

    init() {
        if (this._ready) {
            this.setBrush(this.brush);
            this.bindPaint(document.getElementById("hexViewer"));
            this.bindPaint(document.getElementById("hexViewer2"));
            this.renderGuide();
            return;
        }
        this._ready = true;
        this.loadPersisted();
        document.addEventListener("pointerdown", (event) => { this.pickSwatch(event); }, true);
        document.addEventListener("click", (event) => { this.pickSwatch(event); }, true);
        this.setBrush(this.brush);
        this.bindPaint(document.getElementById("hexViewer"));
        this.bindPaint(document.getElementById("hexViewer2"));
        this.renderGuide();
    },

    addrFrom(node) {
        const el = node && node.closest ? node.closest("[data-addr]") : null;
        if (!el) return null;
        const addr = Number(el.getAttribute("data-addr"));
        return Number.isFinite(addr) ? addr : null;
    }
};

document.addEventListener("pointerup", () => {
    MarkBook.painting = false;
    MarkBook.lastPaint = null;
    MarkBook.persist();
});
document.addEventListener("mouseup", () => {
    MarkBook.painting = false;
    MarkBook.lastPaint = null;
});
