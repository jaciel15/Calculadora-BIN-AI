const KnowledgeBase = {

    KEY: "velocimetros-cdmx-kb-v1",

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            if (!raw) return this.empty();
            const data = JSON.parse(raw);
            if (!data.algorithms) data.algorithms = [];
            if (!data.graph) data.graph = [];
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

    rememberAlgorithm(hit, fileName, fileSize) {
        const db = this.load();
        const name = this.algorithmName(hit.formula, hit.width, hit.endian);
        let item = db.algorithms.find((a) => a.name === name);
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
        item.addresses = hit.copies && hit.copies.length ? hit.copies.slice(0, 8) : (hit.address !== undefined ? [hit.address] : item.addresses);
        if (hit.copies) item.copies = hit.copies;
        if (hit.familyId) item.familyId = hit.familyId;
        if (hit.vinWmi) item.vinWmi = hit.vinWmi;
        if (fileName && item.files.indexOf(fileName) === -1) item.files.push(fileName);
        item.steps = this.recipe(hit);
        item.howManual = item.steps.map((s) => s.n + ". " + s.title + ": " + s.text).join(" ");
        this.save(db);
        return item;
    },

    recipe(hit) {
        const hex = hit.hex || "—";
        const addr = hit.addressText || (hit.address !== undefined ? "0x" + Number(hit.address).toString(16).toUpperCase() : "—");
        const copies = (hit.copies && hit.copies.length) ? hit.copies.length : 1;
        const endian = hit.endian === "BE" ? "big-endian (primero el byte alto)" : hit.endian === "BCD" ? "BCD" : "little-endian (primero el byte bajo)";
        return [
            { n: 1, title: "Identidad", text: "Busca un VIN de 17 caracteres dentro del dump. El nombre del archivo no cuenta. WMI: " + (hit.vinWmi || "si no hay VIN, usa solo la estructura.") },
            { n: 2, title: "Dónde está", text: "El dato vive en " + addr + ", " + (hit.width || "?") + " bytes, " + endian + ". Copias: " + copies + "." },
            { n: 3, title: "Fórmula", text: "Operación: " + (hit.formula || "X") + ". Ejemplo: valor " + (hit.value !== undefined ? hit.value : "?") + " se guarda como " + hex + "." },
            { n: 4, title: "A mano", text: "1) Toma el KM. 2) Aplica " + (hit.formula || "X") + ". 3) Parte el resultado en bytes " + endian + ". 4) Escríbelos en las " + copies + " copias. 5) Si hay checksum pegado, recálculalo (SUM8/SUM16/CRC) y escríbelo al lado." },
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
        db.algorithms.forEach((algo) => {
            if (!knownKm && knownKm !== 0) return;
            const variants = MathEngine.variantsForValue(knownKm).filter((v) => {
                return v.formula === algo.formula && v.width === algo.width && v.endian === algo.endian;
            });
            variants.forEach((variant) => {
                const hits = MathEngine.findPattern(bytes, variant.bytes);
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

    rememberGraph(node) {
        const db = this.load();
        if (!db.graph) db.graph = [];
        db.graph.unshift(Object.assign({ saved: new Date().toISOString() }, node));
        db.graph = db.graph.slice(0, 80);
        this.save(db);
        return node;
    }

};
