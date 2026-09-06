const MarkBook = {

    brush: "KM",
    painting: false,
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

    stepHelp() {
        return {
            KM: "Si me ayudas: pinta KM en rojo y ACEPTO. Si no, solo ANALIZAR.",
            CHK: "2. KM guardado. Ahora pinta SUM o CRC. ACEPTO.",
            COMP: "3. SUM guardado. Ahora pinta COMP. ACEPTO.",
            LISTO: "4. Me ayudaste. ACEPTO otra vez o ANALIZAR: recoloreo y analizo."
        }[this.guideStep] || "Pinta y pulsa ACEPTO.";
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
        if (this.brush === "ERASE") delete this.user[addr];
        else this.user[addr] = this.brush;
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

    persist() {
        try {
            localStorage.setItem(this.STORAGE, JSON.stringify({
                lessons: this.lessons,
                guideStep: this.guideStep
            }));
        } catch (error) { /* ignore */ }
    },

    loadPersisted() {
        try {
            const raw = localStorage.getItem(this.STORAGE);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.lessons) this.lessons = Object.assign(this.emptyLessons(), data.lessons);
            if (data.guideStep) this.guideStep = data.guideStep;
        } catch (error) { /* ignore */ }
    },

    restoreAccepted() {
        Object.keys(this.lessons).forEach((kind) => {
            (this.lessons[kind] || []).forEach((range) => {
                for (let addr = range.start; addr <= range.end; addr++) this.user[addr] = kind;
            });
        });
        this.revealed = true;
        this.renderGuide();
    },

    ranges(kind) {
        const addrs = Object.keys(this.user).map(Number).filter((a) => this.user[a] === kind).sort((a, b) => a - b);
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
        const accepted = this.lessons[kind] || [];
        return accepted.length ? accepted : this.ranges(kind);
    },

    allRanges() {
        return ["KM", "CHK", "CRC", "COMP", "COPY", "HINT"].reduce((acc, kind) => acc.concat(this.lessonRanges(kind)), []);
    },

    hasLessons() {
        return ["KM", "CHK", "CRC", "COMP"].some((kind) => (this.lessons[kind] || []).length);
    },

    accept() {
        const step = this.guideStep;
        if (step === "LISTO") {
            this.renderGuide();
            return { ok: true, step, analyze: true, message: "Uso tu ayuda. Recoloreo y analizo." };
        }
        if (step === "KM") {
            const ranges = this.snapshot("KM");
            if (!ranges.length) return { ok: false, step, message: "Pinta primero el KM en rojo." };
            this.lessons.KM = ranges;
            this.eraseKind("KM");
            this.guideStep = "CHK";
            this.revealed = false;
            this.persist();
            this.setBrush("CHK");
            return { ok: true, step: "KM", message: "KM guardado y quitado. Ahora pinta SUM." };
        }
        if (step === "CHK") {
            const sum = this.snapshot("CHK");
            const crc = this.snapshot("CRC");
            if (!sum.length && !crc.length) return { ok: false, step, message: "Pinta SUM (azul) o CRC (morado)." };
            this.lessons.CHK = sum;
            this.lessons.CRC = crc;
            this.eraseKind("CHK");
            this.eraseKind("CRC");
            this.guideStep = "COMP";
            this.revealed = false;
            this.persist();
            this.setBrush("COMP");
            return { ok: true, step: "CHK", message: "Checksum guardado y quitado. Ahora pinta COMP." };
        }
        if (step === "COMP") {
            const ranges = this.snapshot("COMP");
            if (!ranges.length) return { ok: false, step, message: "Pinta el complemento (COMP)." };
            this.lessons.COMP = ranges;
            this.eraseKind("COMP");
            this.guideStep = "LISTO";
            this.revealed = false;
            this.persist();
            this.renderGuide();
            return { ok: true, step: "COMP", analyze: true, message: "Ayuda completa. Recoloreo y analizo." };
        }
        return { ok: false, step, message: "Paso no válido." };
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
            return { ok: true, analyze: this.hasLessons(), message: this.hasLessons() ? "Con tu ayuda (sin COMP). Analizo." : "Sin complemento. Pulsa ANALIZAR." };
        }
        return { ok: true, message: "Listo." };
    },

    renderGuide() {
        const guide = document.getElementById("markGuide");
        const lessons = document.getElementById("markLessons");
        if (guide) guide.textContent = this.stepHelp();
        if (lessons) {
            const bits = [];
            if (this.lessons.KM.length) bits.push("KM " + this.lessons.KM.length);
            if (this.lessons.CHK.length || this.lessons.CRC.length) bits.push("SUM/CRC");
            if (this.lessons.COMP.length) bits.push("COMP");
            lessons.textContent = bits.length ? "Aceptado: " + bits.join(" · ") : "Nada aceptado aún.";
        }
        const accept = document.getElementById("markAcceptBtn");
        if (accept) accept.textContent = this.guideStep === "LISTO" ? "LISTO" : "ACEPTO";
    },

    bindPaint(el) {
        if (!el || el.getAttribute("data-mark-bound")) return;
        el.setAttribute("data-mark-bound", "1");
        const down = (event) => {
            const addr = this.addrFrom(event.target);
            if (addr === null) return;
            event.preventDefault();
            this.painting = true;
            this.paint(addr);
            this.refresh(addr);
        };
        const move = (event) => {
            if (!this.painting) return;
            const addr = this.addrFrom(event.target);
            if (addr === null) return;
            this.paint(addr);
            this.refresh(addr);
        };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointermove", move);
        el.addEventListener("mousedown", down);
        el.addEventListener("mouseover", move);
    },

    refresh(addr) {
        const kind = this.user[addr];
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

document.addEventListener("pointerup", () => { MarkBook.painting = false; });
document.addEventListener("mouseup", () => { MarkBook.painting = false; });
