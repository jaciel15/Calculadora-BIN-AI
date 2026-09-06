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
        if (hit.copies) item.copies = hit.copies;
        if (fileName && item.files.indexOf(fileName) === -1) item.files.push(fileName);
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
