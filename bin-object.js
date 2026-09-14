class BINObject {

    constructor(file, bytes, meta) {
        meta = meta || {};
        this.fileName = file ? file.name : (meta.fileName || "");
        this.extension = this.fileName.includes(".")
            ? this.fileName.split(".").pop().toUpperCase()
            : "";
        this.diskSize = file && file.size != null ? file.size : (meta.diskSize || (bytes ? bytes.length : 0));
        this.bytes = bytes ? new Uint8Array(bytes) : new Uint8Array();
        this.fileSize = this.bytes.length;
        this.created = new Date();
        this.original = new Uint8Array(this.bytes);
        this.working = new Uint8Array(this.bytes);
        this.totalBytes = this.bytes.length;
        this.chip = Hunters.detectChip(this.totalBytes);
        this.loaded = this.bytes.length > 0;
        this.complete = !!meta.complete;
        this.format = meta.format || "BIN";
        this.loadNote = meta.note || "";
        this.version = "1.0";
        this.status = this.loaded ? "LOADED" : "EMPTY";
        this.knownKm = null;
        this.knownHours = null;
        this.analysis = null;
    }

}

const DumpLoader = {
    MAX_IMAGE: 16 * 1024 * 1024,

    copyBuffer(buffer) {
        const src = new Uint8Array(buffer);
        const out = new Uint8Array(src.length);
        out.set(src);
        return out;
    },

    readAllBytes(file) {
        const self = this;
        return new Promise(function (resolve, reject) {
            const finish = function (buffer) {
                resolve(self.copyBuffer(buffer));
            };
            if (file.arrayBuffer) {
                file.arrayBuffer().then(finish).catch(function () {
                    const fr = new FileReader();
                    fr.onload = function () { finish(fr.result); };
                    fr.onerror = function () { reject(fr.error || new Error("No se pudo leer el archivo.")); };
                    fr.readAsArrayBuffer(file);
                });
                return;
            }
            const fr = new FileReader();
            fr.onload = function () { finish(fr.result); };
            fr.onerror = function () { reject(fr.error || new Error("No se pudo leer el archivo.")); };
            fr.readAsArrayBuffer(file);
        });
    },

    isAsciiDump(bytes) {
        if (!bytes || !bytes.length) return false;
        let ok = 0;
        const n = Math.min(bytes.length, 800);
        for (let i = 0; i < n; i++) {
            const b = bytes[i];
            if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) ok++;
        }
        return ok / n > 0.98;
    },

    asText(bytes) {
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s.replace(/^\uFEFF/, "");
    },

    extOf(name) {
        const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
        return m ? m[1] : "";
    },

    decodeIntelHex(text) {
        let ela = 0;
        let esa = 0;
        const map = [];
        let max = -1;
        const lines = String(text).split(/\r?\n/);
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim();
            if (!line) continue;
            if (line.charAt(0) !== ":") continue;
            if (line.length < 11) continue;
            const len = parseInt(line.substr(1, 2), 16);
            const addr = parseInt(line.substr(3, 4), 16);
            const type = parseInt(line.substr(7, 2), 16);
            if (!Number.isFinite(len) || !Number.isFinite(addr) || !Number.isFinite(type)) continue;
            if (type === 0) {
                const base = ((ela << 16) + (esa << 4) + addr) >>> 0;
                for (let i = 0; i < len; i++) {
                    const at = 9 + i * 2;
                    const v = parseInt(line.substr(at, 2), 16);
                    if (!Number.isFinite(v)) break;
                    const pos = base + i;
                    if (pos > this.MAX_IMAGE) return null;
                    map.push([pos, v]);
                    if (pos > max) max = pos;
                }
            } else if (type === 1) {
                break;
            } else if (type === 2) {
                esa = parseInt(line.substr(9, 4), 16) || 0;
            } else if (type === 4) {
                ela = parseInt(line.substr(9, 4), 16) || 0;
            }
        }
        if (max < 0) return null;
        const out = new Uint8Array(max + 1).fill(0xFF);
        for (let i = 0; i < map.length; i++) out[map[i][0]] = map[i][1];
        return out;
    },

    decodeSrec(text) {
        const map = [];
        let max = -1;
        const lines = String(text).split(/\r?\n/);
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim().toUpperCase();
            if (!line || line.charAt(0) !== "S") continue;
            const type = line.charAt(1);
            const addrLen = type === "1" ? 4 : (type === "2" ? 6 : (type === "3" ? 8 : 0));
            if (!addrLen) continue;
            const count = parseInt(line.substr(2, 2), 16);
            if (!Number.isFinite(count)) continue;
            const addr = parseInt(line.substr(4, addrLen), 16);
            const dataChars = (count - addrLen / 2 - 1) * 2;
            const start = 4 + addrLen;
            for (let i = 0; i < dataChars; i += 2) {
                const v = parseInt(line.substr(start + i, 2), 16);
                if (!Number.isFinite(v)) break;
                const pos = addr + i / 2;
                if (pos > this.MAX_IMAGE) return null;
                map.push([pos, v]);
                if (pos > max) max = pos;
            }
        }
        if (max < 0) return null;
        const out = new Uint8Array(max + 1).fill(0xFF);
        for (let i = 0; i < map.length; i++) out[map[i][0]] = map[i][1];
        return out;
    },

    decodeIfTextDump(raw, fileName) {
        const ext = this.extOf(fileName);
        const wantText = /^(hex|s19|s28|s37|srec|mot|txt)$/.test(ext);
        if (!wantText && !this.isAsciiDump(raw)) {
            return { bytes: raw, format: "BIN", fromText: false };
        }
        if (!this.isAsciiDump(raw)) {
            return { bytes: raw, format: "BIN", fromText: false };
        }
        const text = this.asText(raw).replace(/^\uFEFF/, "");
        const first = text.trim().charAt(0);
        if (first === ":" || ext === "hex") {
            const intel = this.decodeIntelHex(text);
            if (intel && intel.length) return { bytes: intel, format: "INTEL_HEX", fromText: true };
        }
        if (first === "S" || /^(s19|s28|s37|srec|mot)$/.test(ext)) {
            const srec = this.decodeSrec(text);
            if (srec && srec.length) return { bytes: srec, format: "SREC", fromText: true };
        }
        return { bytes: raw, format: "BIN", fromText: false };
    },

    async readFile(file) {
        if (!file) return null;
        const raw = await this.readAllBytes(file);
        if (!raw.length) {
            throw new Error("El archivo está vacío.");
        }
        const decoded = this.decodeIfTextDump(raw, file.name);
        const complete = decoded.fromText
            ? decoded.bytes.length > 0
            : decoded.bytes.length === file.size;
        const note = decoded.fromText
            ? ("Decodificado " + decoded.format + " → " + decoded.bytes.length + " bytes de imagen (disco " + file.size + " B).")
            : (complete
                ? ("Cargado completo: " + decoded.bytes.length + " bytes.")
                : ("Leí " + decoded.bytes.length + " de " + file.size + " bytes. Revisa el archivo."));
        return {
            fileName: file.name,
            diskSize: file.size,
            bytes: decoded.bytes,
            loaded: decoded.bytes.length,
            complete: complete,
            format: decoded.format,
            note: note
        };
    },

    label(name, size, complete) {
        return (name || "BIN") + " · " + size + " B" + (complete ? " COMPLETO" : " INCOMPLETO");
    }
};
