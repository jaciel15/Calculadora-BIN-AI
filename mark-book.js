const MarkBook = {

    brush: "KM",
    painting: false,
    user: {},

    kinds: {
        KM: { cls: "hex-user-km", label: "KM", help: "Kilometraje" },
        CHK: { cls: "hex-user-chk", label: "SUM", help: "Checksum / suma" },
        CRC: { cls: "hex-user-crc", label: "CRC", help: "CRC" },
        COPY: { cls: "hex-user-copy", label: "COPIA", help: "Copia espejo" },
        HINT: { cls: "hex-user-hint", label: "PISTA", help: "Otra zona" }
    },

    setBrush(kind) {
        this.brush = kind;
        document.querySelectorAll(".mark-swatch").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-mark") === kind);
        });
    },

    paint(addr) {
        if (addr === undefined || addr === null || isNaN(addr)) return;
        if (this.brush === "ERASE") delete this.user[addr];
        else this.user[addr] = this.brush;
    },

    clear() {
        this.user = {};
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

    allRanges() {
        return ["KM", "CHK", "CRC", "COPY", "HINT"].reduce((acc, kind) => acc.concat(this.ranges(kind)), []);
    },

    bindPaint(el) {
        if (!el || el.getAttribute("data-mark-bound")) return;
        el.setAttribute("data-mark-bound", "1");
        el.addEventListener("mousedown", (event) => {
            const addr = this.addrFrom(event.target);
            if (addr === null) return;
            event.preventDefault();
            this.painting = true;
            this.paint(addr);
            this.refresh(addr);
        });
        el.addEventListener("mouseover", (event) => {
            if (!this.painting) return;
            const addr = this.addrFrom(event.target);
            if (addr === null) return;
            this.paint(addr);
            this.refresh(addr);
        });
    },

    refresh(addr) {
        const kind = this.user[addr];
        document.querySelectorAll("[data-addr=\"" + addr + "\"]").forEach((node) => {
            Object.keys(this.kinds).forEach((key) => node.classList.remove(this.kinds[key].cls));
            if (kind && this.kinds[kind]) node.classList.add(this.kinds[kind].cls);
        });
    },

    init() {
        document.querySelectorAll(".mark-swatch").forEach((btn) => {
            btn.onclick = () => this.setBrush(btn.getAttribute("data-mark"));
        });
        this.setBrush(this.brush);
        this.bindPaint(document.getElementById("hexViewer"));
        this.bindPaint(document.getElementById("hexViewer2"));
    },

    addrFrom(node) {
        const el = node && node.closest ? node.closest("[data-addr]") : null;
        if (!el) return null;
        const addr = Number(el.getAttribute("data-addr"));
        return Number.isFinite(addr) ? addr : null;
    }
};

document.addEventListener("mouseup", () => { MarkBook.painting = false; });
