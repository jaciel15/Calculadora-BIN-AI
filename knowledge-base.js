const CodeBook = {

    list() {
        return [
            {
                id: "YAMAHA_MT09_93C86",
                name: "Yamaha MT-09 93C86",
                origin: "DEMOSTRADO aquí · 4 BIN",
                formula: "X",
                width: 2,
                endian: "LE",
                chk: "",
                recipe: "Rojo es KM tal cual (X) en 2 bytes little-endian. Seis ranuras de 4 bytes: 00 00 lo hi. Si el dump está swapeado, usa big-endian en el word.",
                writeHow: "Escribe 00 00 lo hi en 0000–0017."
            },
            {
                id: "YAMAHA_R5F10",
                name: "Yamaha R5F10 anillo 32B",
                origin: "DEMOSTRADO aquí · 8 BIN",
                formula: "X * 10",
                width: 3,
                endian: "LE",
                chk: "SUM16",
                recipe: "Rojo es KM multiplicado x10 en 3 bytes little-endian (décimas). Morado es SUM16 big-endian de esos 3 bytes y se escribe en los 2 últimos de la página (offset +30). Rampa +1 en páginas de 32 bytes. No toques páginas FF.",
                writeHow: "Reescribe todo el anillo del banco. Última página = KM×10."
            },
            {
                id: "ODYSSEY_DENSO_93C86",
                name: "Odyssey Denso 93C86 fino",
                origin: "LUGAR DEMOSTRADO · no escribir",
                formula: "FINO",
                width: 2,
                endian: "LE",
                chk: "",
                recipe: "Rojo marca el fino AF xx yy FF × 3 en 0062. Aún no hay fórmula de escritura. No generar BIN.",
                writeHow: "NO escribir. Falta un tercer BIN."
            },
            {
                id: "GEN_X10_LE24_SUM16",
                name: "Genérico KM×10 LE24 + SUM16",
                origin: "Patrón público EEPROM",
                formula: "X * 10",
                width: 3,
                endian: "LE",
                chk: "SUM16",
                recipe: "Rojo es KM multiplicado x10 en 3 bytes little-endian. Morado es la suma de esos 3 bytes (SUM16) y ahí se escribe el checksum.",
                writeHow: "Codifica KM×10 en 3 bytes LE y recalcula SUM16."
            },
            {
                id: "GEN_X_LE16",
                name: "Genérico KM uint16 LE",
                origin: "Patrón público EEPROM",
                formula: "X",
                width: 2,
                endian: "LE",
                chk: "",
                recipe: "Rojo es KM tal cual en 2 bytes little-endian (lo hi).",
                writeHow: "Escribe el KM en lo + hi."
            },
            {
                id: "GEN_X_BE16",
                name: "Genérico KM uint16 BE",
                origin: "Patrón público EEPROM",
                formula: "X",
                width: 2,
                endian: "BE",
                chk: "",
                recipe: "Rojo es KM tal cual en 2 bytes big-endian (hi lo).",
                writeHow: "Escribe el KM en hi + lo."
            },
            {
                id: "GEN_X10_LE24",
                name: "Genérico KM×10 LE24",
                origin: "Patrón público EEPROM",
                formula: "X * 10",
                width: 3,
                endian: "LE",
                chk: "",
                recipe: "Rojo es KM multiplicado x10 en 3 bytes little-endian. Sin checksum dicho.",
                writeHow: "KM×10 en lo mid hi."
            },
            {
                id: "GEN_BCD",
                name: "Genérico KM BCD",
                origin: "Patrón público EEPROM",
                formula: "BCD",
                width: 3,
                endian: "BCD",
                chk: "",
                recipe: "Rojo es KM en BCD: cada nibble es un dígito decimal.",
                writeHow: "Escribe el KM en BCD."
            },
            {
                id: "GEN_X10_SUM8",
                name: "Genérico KM×10 + SUM8",
                origin: "Patrón público EEPROM",
                formula: "X * 10",
                width: 3,
                endian: "LE",
                chk: "SUM8",
                recipe: "Rojo es KM multiplicado x10 en 3 bytes. Azul o morado es la suma de esos 3 bytes (SUM8) y ahí se escribe.",
                writeHow: "KM×10 LE24 y SUM8 al lado."
            },
            {
                id: "GEN_X10_M1_LE24_SUM16",
                name: "Genérico KM×10-1 LE24 + SUM16",
                origin: "Patrón público EEPROM",
                formula: "X * 10 - 1",
                width: 3,
                endian: "LE",
                chk: "SUM16",
                recipe: "Rojo es KM×10-1 en 3 bytes LE. Morado es SUM16 de esos 3 bytes.",
                writeHow: "KM×10-1 LE24 y SUM16."
            },
            {
                id: "GEN_X_LE16_SUM8",
                name: "Genérico KM uint16 LE + SUM8",
                origin: "Patrón público EEPROM",
                formula: "X",
                width: 2,
                endian: "LE",
                chk: "SUM8",
                recipe: "Rojo es KM en 2 bytes LE. Azul es SUM8 de esos 2 bytes.",
                writeHow: "uint16 LE y SUM8 al lado."
            },
            {
                id: "GEN_X10_BE24",
                name: "Genérico KM×10 BE24",
                origin: "Patrón público EEPROM",
                formula: "X * 10",
                width: 3,
                endian: "BE",
                chk: "",
                recipe: "Rojo es KM×10 en 3 bytes big-endian.",
                writeHow: "KM×10 hi mid lo."
            }
        ];
    },

    find(id) {
        return this.list().find((item) => item.id === id) || null;
    },

    encode(code, km) {
        if (code.formula === "BCD") return MathEngine.toBCD(Number(km), code.width);
        const value = MathEngine.applyFormula(Number(km), code.formula);
        return MathEngine.toBytes(value, code.width, code.endian !== "BE" && code.endian !== "BCD");
    },

    checksumAt(bytes, addr, code) {
        const width = code.width || 3;
        if (addr + width > bytes.length) return null;
        if (code.chk === "SUM8") {
            const calc = ChecksumEngine.sum8(bytes, addr, addr + width);
            const spots = [addr + width];
            if (spots[0] < bytes.length && bytes[spots[0]] === calc) {
                return { name: "SUM8", storedAt: spots[0], calc, size: 1, endian: "LE" };
            }
            return null;
        }
        if (code.chk === "SUM16") {
            const calc = ChecksumEngine.sum16(bytes, addr, addr + width);
            const hi = (calc >> 8) & 0xFF;
            const lo = calc & 0xFF;
            const trials = [
                { at: addr + width, a: lo, b: hi, endian: "LE" },
                { at: addr + width, a: hi, b: lo, endian: "BE" },
                { at: addr + 30, a: hi, b: lo, endian: "BE" }
            ];
            for (let i = 0; i < trials.length; i++) {
                const t = trials[i];
                if (t.at + 1 >= bytes.length) continue;
                if (bytes[t.at] === t.a && bytes[t.at + 1] === t.b) {
                    return { name: "SUM16", storedAt: t.at, calc, size: 2, endian: t.endian };
                }
            }
            return null;
        }
        return null;
    },

    hunt(bytes, knownKm, bytes2, km2) {
        if (knownKm === null || knownKm === undefined || !bytes) return [];
        const index = MathEngine.indexFile(bytes);
        const hits = [];
        const codes = this.list().filter((c) => c.formula && c.formula !== "FINO");
        if (typeof KnowledgeBase !== "undefined") {
            KnowledgeBase.learnedFamilies().forEach((fam) => {
                if (!fam.formula) return;
                codes.push({
                    id: fam.key,
                    name: "Aprendida " + fam.formula,
                    formula: fam.formula,
                    width: fam.width || 3,
                    endian: fam.endian || "LE",
                    chk: (fam.checksums && fam.checksums[0] && fam.checksums[0].name) || "",
                    writeHow: fam.writeHow || "",
                    recipe: "Familia aprendida: " + fam.formula
                });
            });
        }
        codes.forEach((code) => {
            let pattern;
            try {
                pattern = this.encode(code, knownKm);
            } catch (error) {
                return;
            }
            let locs = MathEngine.lookupIndex(index, pattern);
            if (!locs.length) locs = MathEngine.findPattern(bytes, pattern);
            if (!locs.length || locs.length > 40) return;
            if (bytes2 && km2 !== null && km2 !== undefined) {
                const pat2 = this.encode(code, km2);
                locs = locs.filter((addr) => {
                    if (addr + pat2.length > bytes2.length) return false;
                    for (let i = 0; i < pat2.length; i++) {
                        if (bytes2[addr + i] !== pat2[i]) return false;
                    }
                    return true;
                });
                if (!locs.length) return;
            }
            let chkHits = 0;
            let chk = null;
            if (code.chk) {
                locs.forEach((addr) => {
                    const found = this.checksumAt(bytes, addr, code);
                    if (found) {
                        chkHits++;
                        if (!chk) chk = found;
                    }
                });
            }
            const pair = !!(bytes2 && km2 !== null && km2 !== undefined);
            hits.push({
                fromMind: true,
                fromCodeBook: true,
                fromPair: pair,
                label: "KILOMETRAJE",
                name: code.id,
                familyId: code.id,
                formula: code.formula,
                width: code.width,
                endian: code.endian,
                copies: locs,
                address: locs[0],
                addressText: Hunters.range(locs[0], code.width),
                hex: MathEngine.hexBytes(bytes.slice(locs[0], locs[0] + code.width)),
                numeric: knownKm,
                value: knownKm,
                writeHow: (code.writeHow || code.recipe || code.formula) +
                    (chk ? " Checksum " + chk.name + " @ " + Hunters.hexAddr(chk.storedAt) : ""),
                confidence: Math.min(99.5, 86 + Math.min(locs.length, 6) * 1.4 + (chkHits ? 8 : 0) + (pair ? 6 : 0)),
                representation: "libro " + code.id,
                checksumAt: chk ? chk.storedAt : null,
                checksumName: chk ? chk.name : "",
                writable: code.formula !== "FINO"
            });
        });
        return hits.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
    }
};

const KnowledgeBase = {

    KEY: "velocimetros-cdmx-kb-v1",

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            if (!raw) return this.empty();
            const data = JSON.parse(raw);
            if (!data.algorithms) data.algorithms = [];
            if (!data.graph) data.graph = [];
            if (!data.learned) data.learned = [];
            return data;
        } catch (error) {
            return this.empty();
        }
    },

    empty() {
        return {
            version: 1,
            algorithms: [],
            files: [],
            graph: [],
            learned: [],
            updated: null
        };
    },

    save(data) {
        data.updated = new Date().toISOString();
        localStorage.setItem(this.KEY, JSON.stringify(data));
        return data;
    },

    algorithmName(formula, width, endian) {
        const clean = String(formula).replace(/[^A-Z0-9]+/gi, "_").replace(/^_|_$/g, "");
        return (clean + "_" + width + endian).toUpperCase();
    },

    packChecksums(list) {
        return (list || [])
            .filter((c) => c && c.status !== "SIN_MATCH" && c.storedAt !== null && c.storedAt !== undefined)
            .slice(0, 8)
            .map((c) => ({
                name: c.name,
                start: c.start,
                end: c.end,
                storedAt: c.storedAt,
                size: c.size || 2,
                endian: c.endian || "LE",
                window: c.window || ""
            }));
    },

    rememberAlgorithm(hit, fileName, fileSize, checksums) {
        const db = this.load();
        const name = hit.displayName || this.algorithmName(hit.formula, hit.width, hit.endian);
        let item = db.algorithms.find((a) => a.name === name || (a.formula === hit.formula && a.width === hit.width && a.endian === hit.endian && a.familyId === hit.familyId));
        if (!item) {
            item = {
                name,
                formula: hit.formula,
                width: hit.width,
                endian: hit.endian,
                writeHow: MathEngine.encodeWriteup(hit.formula, hit.endian, hit.width),
                copies: hit.copies || [],
                checksums: [],
                hits: 0,
                files: [],
                created: new Date().toISOString()
            };
            db.algorithms.push(item);
        }
        item.hits += 1;
        item.lastSeen = new Date().toISOString();
        item.lastFile = fileName;
        item.fileSize = fileSize;
        item.addresses = hit.copies && hit.copies.length ? hit.copies.slice(0, 12) : (hit.address !== undefined ? [hit.address] : item.addresses);
        if (hit.copies) item.copies = hit.copies;
        if (hit.familyId) item.familyId = hit.familyId;
        if (hit.vinWmi) item.vinWmi = hit.vinWmi;
        if (hit.chip) item.chip = hit.chip;
        if (fileName && item.files.indexOf(fileName) === -1) item.files.push(fileName);
        const packed = this.packChecksums(checksums || hit.checksums);
        if (packed.length) item.checksums = packed;
        item.steps = this.recipe(hit);
        item.howManual = item.steps.map((s) => s.n + ". " + s.title + ": " + s.text).join(" ");
        this.save(db);
        return item;
    },

    upsertManual(fields) {
        const db = this.load();
        const name = String(fields.name || "").trim();
        if (!name) return null;
        let item = db.algorithms.find((a) => a.name === fields.oldName || a.name === name);
        if (!item) {
            item = { name, hits: 0, files: [], checksums: [], created: new Date().toISOString() };
            db.algorithms.push(item);
        }
        item.name = name;
        item.formula = fields.formula || "X";
        item.width = Number(fields.width) || 2;
        item.endian = fields.endian || "LE";
        item.addresses = (fields.addresses || []).map(Number).filter((n) => Number.isFinite(n));
        item.copies = item.addresses.slice();
        item.checksums = this.packChecksums(fields.checksums || item.checksums);
        item.familyId = fields.familyId || item.familyId || "";
        item.chip = fields.chip || item.chip || "";
        item.writeHow = MathEngine.encodeWriteup(item.formula, item.endian, item.width);
        item.savedByUser = true;
        item.userSaved = new Date().toISOString();
        item.steps = this.recipe(item);
        this.save(db);
        return item;
    },

    renameAlgorithm(oldName, newName) {
        const db = this.load();
        const item = db.algorithms.find((a) => a.name === oldName);
        if (!item || !newName) return null;
        item.name = String(newName).trim();
        item.savedByUser = true;
        this.save(db);
        return item;
    },

    removeAlgorithm(name) {
        const db = this.load();
        db.algorithms = (db.algorithms || []).filter((a) => a.name !== name);
        this.save(db);
        return true;
    },

    userAlgorithms() {
        return this.load().algorithms.filter((a) => a.savedByUser);
    },

    recipe(hit) {
        const hex = hit.hex || "—";
        const addr = hit.addressText || (hit.address !== undefined ? "0x" + Number(hit.address).toString(16).toUpperCase() : "—");
        const copies = (hit.copies && hit.copies.length) ? hit.copies.length : ((hit.addresses && hit.addresses.length) ? hit.addresses.length : 1);
        const chk = (hit.checksums && hit.checksums[0])
            ? hit.checksums[0].name + " @ 0x" + Number(hit.checksums[0].storedAt).toString(16).toUpperCase()
            : "si hay complemento, recálculalo";
        const endian = hit.endian === "BE" ? "big-endian (primero el byte alto)" : hit.endian === "BCD" ? "BCD" : "little-endian (primero el byte bajo)";
        return [
            { n: 1, title: "Identidad", text: "Busca un VIN de 17 caracteres dentro del dump. El nombre del archivo no cuenta. WMI: " + (hit.vinWmi || "si no hay VIN, usa solo la estructura.") },
            { n: 2, title: "Dónde está", text: "El dato vive en " + addr + ", " + (hit.width || "?") + " bytes, " + endian + ". Copias: " + copies + "." },
            { n: 3, title: "Fórmula", text: "Operación: " + (hit.formula || "X") + ". Ejemplo: valor " + (hit.value !== undefined ? hit.value : "?") + " se guarda como " + hex + "." },
            { n: 4, title: "A mano", text: "1) Toma el KM. 2) Aplica " + (hit.formula || "X") + ". 3) Parte el resultado en bytes " + endian + ". 4) Escríbelos en las " + copies + " copias. 5) Complemento: " + chk + "." },
            { n: 5, title: "Cómo se encontró", text: hit.fromPair ? "Comparando dos BIN: la misma dirección cambia con los dos KM." : (hit.fromFamily ? "Familia de kernel reconocida por estructura." : (hit.fromMemory ? "La memoria ya había visto esta regla." : "Búsqueda matemática + copias + checksum.")) },
            { n: 6, title: "Escritura", text: hit.writeHow || MathEngine.encodeWriteup(hit.formula || "X", hit.endian || "LE", hit.width || 2) }
        ];
    },

    markUserSaved(name) {
        const db = this.load();
        const item = db.algorithms.find((a) => a.name === name);
        if (!item) return null;
        item.savedByUser = true;
        item.userSaved = new Date().toISOString();
        this.save(db);
        return item;
    },

    rememberFile(fileName, dna, counters) {
        const db = this.load();
        db.files = db.files.filter((f) => f.fileName !== fileName).slice(0, 40);
        db.files.unshift({
            fileName,
            dna: dna || {},
            counters: (counters || []).map((c) => ({
                name: c.name,
                formula: c.formula,
                address: c.address,
                confidence: c.confidence
            })),
            saved: new Date().toISOString()
        });
        this.save(db);
    },

    applyKnown(bytes, knownKm) {
        const db = this.load();
        const matches = [];
        const index = MathEngine.indexFile(bytes);
        db.algorithms.forEach((algo) => {
            if (!knownKm && knownKm !== 0) return;
            const variants = MathEngine.variantsForValue(knownKm).filter((v) => {
                return v.formula === algo.formula && v.width === algo.width && v.endian === algo.endian;
            });
            variants.forEach((variant) => {
                const hits = MathEngine.lookupIndex(index, variant.bytes);
                if (!hits.length) return;
                matches.push({
                    fromMemory: true,
                    name: algo.name,
                    formula: algo.formula,
                    width: algo.width,
                    endian: algo.endian,
                    copies: hits,
                    address: hits[0],
                    hex: variant.hex,
                    numeric: variant.numeric,
                    writeHow: algo.writeHow,
                    confidence: Math.min(99.4, 88 + Math.min(hits.length, 4) * 2.5)
                });
            });
        });
        return matches.sort((a, b) => b.confidence - a.confidence);
    },

    rememberLearnedFamily(rec) {
        if (!rec || !rec.size || !rec.formula) return null;
        const db = this.load();
        if (!db.learned) db.learned = [];
        const key = rec.size + "|" + rec.formula + "|" + rec.width + "|" + rec.endian + "|" + ((rec.copies || [])[0] || 0);
        let item = db.learned.find((a) => a.key === key);
        if (!item) {
            item = { key, hits: 0, created: new Date().toISOString() };
            db.learned.push(item);
        }
        item.size = rec.size;
        item.formula = rec.formula;
        item.width = rec.width;
        item.endian = rec.endian;
        item.copies = rec.copies || item.copies || [];
        item.fromStair = !!rec.fromStair;
        item.step = rec.step;
        item.writeHow = rec.writeHow;
        item.fingerprint = rec.fingerprint || item.fingerprint;
        item.checksums = this.packChecksums(rec.checksums || item.checksums);
        item.hits += 1;
        item.lastSeen = new Date().toISOString();
        this.save(db);
        return item;
    },

    learnedFamilies() {
        return this.load().learned || [];
    },

    exportBrain() {
        return JSON.stringify(this.load(), null, 2);
    },

    importBrain(raw) {
        const incoming = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!incoming || typeof incoming !== "object") return null;
        const db = this.load();
        (incoming.algorithms || []).forEach((algo) => {
            if (!algo || !algo.name) return;
            const exists = db.algorithms.find((a) => a.name === algo.name);
            if (exists) Object.assign(exists, algo);
            else db.algorithms.push(algo);
        });
        if (!db.learned) db.learned = [];
        (incoming.learned || []).forEach((fam) => {
            if (!fam || !fam.key) return;
            const exists = db.learned.find((a) => a.key === fam.key);
            if (exists) Object.assign(exists, fam);
            else db.learned.push(fam);
        });
        this.save(db);
        return db;
    },

    rememberGraph(node) {
        const db = this.load();
        if (!db.graph) db.graph = [];
        db.graph.unshift(Object.assign({ saved: new Date().toISOString() }, node));
        db.graph = db.graph.slice(0, 80);
        this.save(db);
        return node;
    }

};
