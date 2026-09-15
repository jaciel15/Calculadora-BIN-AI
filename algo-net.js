const AlgoNet = {
    last: { formulas: [], notes: [], sources: [], when: 0 },
    busy: false,

    queries(ctx) {
        const chip = String((ctx && ctx.chip) || "");
        const name = String((ctx && ctx.fileName) || "");
        const q = [];
        q.push("CRC-16-CCITT checksum");
        q.push("binary-coded decimal");
        q.push("Gray code");
        q.push("endianness little-endian");
        if (/93C|93c/.test(chip + name)) q.push("Serial EEPROM 93C86");
        if (/R5F|RH850/.test(chip + name)) q.push("Renesas RH850 flash checksum");
        return q.slice(0, 4);
    },

    local(ctx) {
        const out = { formulas: [], notes: [], sources: [] };
        const size = (ctx && ctx.size) || 0;
        const chip = String((ctx && (ctx.chip || ctx.fileName)) || "").toUpperCase();
        const seen = {};
        const push = (formula, note, source) => {
            if (!formula || seen[formula]) return;
            seen[formula] = true;
            out.formulas.push(formula);
            if (note) out.notes.push(note);
            if (source) out.sources.push(source);
        };
        if (typeof CodeBook !== "undefined") {
            CodeBook.list().forEach((code) => {
                const id = String(code.id || "") + " " + String(code.name || "");
                let score = 0;
                if (size === 2048 && /93C86|MT09/.test(id)) score += 5;
                if (size === 8192 && /R5F10/.test(id)) score += 5;
                if (chip && id.indexOf(chip.replace(/\s+/g, "")) >= 0) score += 3;
                if (/GEN_/.test(code.id)) score += 1;
                if (score < 1 && !/GEN_/.test(code.id)) return;
                push(code.formula, code.name + " · " + (code.recipe || code.writeHow || ""), code.origin || "CodeBook");
            });
        }
        if (typeof KnowledgeBase !== "undefined" && KnowledgeBase.load) {
            try {
                (KnowledgeBase.load().algorithms || []).forEach((algo) => {
                    if (algo.formula) push(algo.formula, "Guardado: " + (algo.name || algo.formula), "cerebro");
                });
            } catch (error) { /* */ }
        }
        ["X", "X * 10", "X / 4", "SWAP16(X)", "BCD", "GRAY(X)"].forEach((f) => push(f, "", "base"));
        return out;
    },

    fromWikiText(text) {
        const t = String(text || "").toLowerCase();
        const formulas = [];
        const notes = [];
        if (/crc-16|crc16|ccitt/.test(t)) {
            formulas.push("X");
            notes.push("Wikipedia: CRC-16/CCITT es común al lado del valor, no es el KM.");
        }
        if (/checksum|sum of|additive/.test(t)) notes.push("Wikipedia: a menudo hay suma o CRC aparte del contador.");
        if (/binary-coded decimal|bcd/.test(t)) {
            formulas.push("BCD");
            notes.push("Wikipedia: BCD guarda cada dígito en un nibble.");
        }
        if (/gray code/.test(t)) {
            formulas.push("GRAY(X)");
            notes.push("Wikipedia: Gray cambia un bit por paso; sirve en contadores.");
        }
        if (/little-endian|least significant byte first/.test(t)) notes.push("Wikipedia: little-endian = primero el byte bajo.");
        if (/big-endian|most significant byte first/.test(t)) notes.push("Wikipedia: big-endian = primero el byte alto.");
        if (/one.?s complement|inverted/.test(t)) {
            formulas.push("~X");
            notes.push("Wikipedia: a veces el valor se guarda invertido (NOT).");
        }
        return { formulas: formulas, notes: notes };
    },

    async wikiOne(query) {
        const url = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*" +
            "&srlimit=4&srsearch=" + encodeURIComponent(query);
        const res = await fetch(url);
        if (!res.ok) return { formulas: [], notes: [], sources: [] };
        const data = await res.json();
        const hits = (data && data.query && data.query.search) || [];
        const pack = { formulas: [], notes: [], sources: [] };
        hits.forEach((row) => {
            const blob = (row.title || "") + " " + String(row.snippet || "").replace(/<[^>]+>/g, " ");
            const parsed = this.fromWikiText(blob);
            parsed.formulas.forEach((f) => { if (pack.formulas.indexOf(f) < 0) pack.formulas.push(f); });
            parsed.notes.forEach((n) => pack.notes.push(n));
            if (row.title) pack.sources.push("Wikipedia: " + row.title);
        });
        return pack;
    },

    merge(into, extra) {
        if (!extra) return into;
        (extra.formulas || []).forEach((f) => {
            if (f && into.formulas.indexOf(f) < 0) into.formulas.push(f);
        });
        (extra.notes || []).forEach((n) => {
            if (n && into.notes.indexOf(n) < 0) into.notes.push(n);
        });
        (extra.sources || []).forEach((s) => {
            if (s && into.sources.indexOf(s) < 0) into.sources.push(s);
        });
        return into;
    },

    hunt(ctx) {
        const local = this.local(ctx || {});
        this.last = Object.assign({ when: Date.now() }, local);
        if (this.busy) return Promise.resolve(this.last);
        this.busy = true;
        const self = this;
        const jobs = this.queries(ctx || {}).map(function (q) {
            return self.wikiOne(q).catch(function () { return { formulas: [], notes: [], sources: [] }; });
        });
        const timed = Promise.race([
            Promise.all(jobs),
            new Promise(function (resolve) { setTimeout(function () { resolve([]); }, 2800); })
        ]);
        return timed.then(function (packs) {
            (packs || []).forEach(function (pack) { self.merge(self.last, pack); });
            self.last.when = Date.now();
            self.busy = false;
            return self.last;
        }).catch(function () {
            self.busy = false;
            return self.last;
        });
    },

    speak() {
        const n = this.last || { formulas: [], notes: [], sources: [] };
        const bits = [];
        if (n.formulas.length) bits.push("Algoritmos que puedo probar: " + n.formulas.slice(0, 8).join(", ") + ".");
        if (n.notes.length) bits.push(n.notes.slice(0, 4).join(" "));
        if (n.sources.length) bits.push("Fuentes: " + n.sources.slice(0, 4).join(" · ") + ".");
        if (!bits.length) bits.push("No hallé nada nuevo. Sigo con el codebook y los diffs del par.");
        return bits.join(" ");
    }
};
