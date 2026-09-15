const AiCoach = {
    alive: false,
    compiled: "",
    memory: null,
    woke: false,
    _lastNotice: "",
    _lastNoticeAt: 0,

    blank() {
        return {
            km: { ranges: [], color: "" },
            chk: { ranges: [], kind: "", color: "", none: false },
            invert: null,
            endian: "",
            formula: "",
            width: null,
            notes: [],
            ban: { formulas: [], addrs: [] }
        };
    },

    bind() {
        const self = this;
        this.memory = this.blank();
        this.alive = true;
        const how = document.getElementById("helpHowBtn");
        if (how) {
            how.addEventListener("click", function (event) {
                event.preventDefault();
                self.start();
            });
        }
        const box = this.talkBox();
        if (box) {
            box.addEventListener("keydown", function (event) {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    self.send();
                }
            });
        }
        const send = document.getElementById("aiSendBtn");
        if (send) {
            send.addEventListener("click", function (event) {
                event.preventDefault();
                self.send();
            });
        }
        this.clearButtons();
        this.wake(true);
    },

    talkBox() {
        return document.getElementById("aiTalk") || document.getElementById("helpRecipe");
    },

    recipeBox() {
        return document.getElementById("helpRecipe");
    },

    start() {
        this.alive = true;
        const box = this.talkBox();
        if (box) {
            box.focus();
            box.placeholder = "Háblame suelto: el KM está en 0010-0012 rojo, no hay checksum, empieza el ataque…";
        }
        const panel = document.getElementById("aiChat");
        if (panel && typeof panel.scrollIntoView === "function") {
            panel.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        if (!this.woke || !this.logCount()) this.wake(true);
        else this.pulse();
    },

    wake(force) {
        this.alive = true;
        if (this.woke && !force) return;
        this.woke = true;
        this.say(this.wakeUp());
    },

    wakeUp() {
        const seen = this.look();
        let text = "Ya estoy viva. No te voy a poner Sí/No ni un cuestionario. Háblame como me hablas a mí.\n\n";
        if (!seen.bin1) {
            text += "Carga el BIN 1 (original) y el BIN 2 (editado). Si ya sabes dónde está el KM o el checksum, suéltalo de un golpe: dirección y color. Si no sabes, dímelo igual: yo miro lo que cambia entre los dos archivos.";
        } else if (!seen.bin2) {
            text += "Ya veo el BIN 1 (" + seen.bin1 + "). Falta el BIN 2 con otro KM. Cuando lo subas te digo qué bytes se movieron.";
        } else if (seen.km1 == null || seen.km2 == null) {
            text += "Tengo los dos BIN. " + this.diffLine(seen) + " Falta que me digas KM 1 y KM 2 (o los escribas arriba).";
        } else {
            text += "Tengo BIN 1, BIN 2, KM 1 = " + seen.km1 + " y KM 2 = " + seen.km2 + ". " + this.diffLine(seen) +
                " Dime dónde ves el KM/checksum, o escribe empieza el ataque y los saco yo.";
        }
        const have = this.whatIHave();
        if (have) text += "\n\n" + have;
        return text;
    },

    look() {
        const out = {
            bin1: "",
            bin2: "",
            size: 0,
            km1: null,
            km2: null,
            family: "",
            diffs: 0,
            zones: []
        };
        try {
            if (typeof currentBIN !== "undefined" && currentBIN && currentBIN.original) {
                out.bin1 = currentBIN.fileName || "BIN 1";
                out.size = currentBIN.original.length;
                const fam = currentBIN.family && currentBIN.family.family;
                if (fam && fam.id) out.family = fam.id;
            }
            if (typeof OmegaKernel !== "undefined" && OmegaKernel.compareBins && OmegaKernel.compareBins[0]) {
                out.bin2 = OmegaKernel.compareBins[0].fileName || "BIN 2";
            }
            if (typeof pairKm1 === "function") out.km1 = pairKm1();
            if (typeof pairKm2 === "function") out.km2 = pairKm2();
            if (out.bin1 && out.bin2) {
                const pair = this.scanDiffs();
                out.diffs = pair.n;
                out.zones = pair.zones;
            }
        } catch (error) { /* sin dump aún */ }
        return out;
    },

    scanDiffs() {
        const empty = { n: 0, zones: [] };
        try {
            const a = currentBIN && currentBIN.original;
            const b = OmegaKernel.compareBins && OmegaKernel.compareBins[0] && OmegaKernel.compareBins[0].bytes;
            if (!a || !b) return empty;
            const len = Math.min(a.length, b.length);
            let n = 0;
            const zones = [];
            let start = -1;
            let last = -1;
            const cap = Math.min(len, 262144);
            for (let i = 0; i < cap; i++) {
                if (a[i] === b[i]) {
                    if (start >= 0) {
                        if (zones.length < 6) zones.push({ start: start, end: last });
                        start = -1;
                    }
                    continue;
                }
                n++;
                if (start < 0) start = i;
                last = i;
            }
            if (start >= 0 && zones.length < 6) zones.push({ start: start, end: last });
            return { n: n, zones: zones };
        } catch (error) {
            return empty;
        }
    },

    diffLine(seen) {
        const view = seen || this.look();
        if (!view.diffs) return "Aún no veo bytes distintos.";
        const z = (view.zones || []).map((r) => this.fmtRange(r)).join(", ");
        return "Cambian " + view.diffs + " bytes" + (z ? " (zonas " + z + ")" : "") + ".";
    },

    scene() {
        const seen = this.look();
        const bits = [];
        if (seen.bin1) bits.push("BIN 1 " + seen.bin1);
        if (seen.bin2) bits.push("BIN 2 " + seen.bin2);
        if (seen.km1 != null) bits.push("KM 1 = " + seen.km1);
        if (seen.km2 != null) bits.push("KM 2 = " + seen.km2);
        if (seen.family) bits.push("familia " + seen.family);
        return bits.join(" · ");
    },

    whatIHave() {
        const mem = this.memory || this.blank();
        const bits = [];
        if (mem.km.ranges.length) bits.push("KM en " + this.fmtRanges(mem.km.ranges));
        if (mem.chk.ranges.length) bits.push((mem.chk.kind === "CRC" ? "CRC" : "SUM") + " en " + this.fmtRanges(mem.chk.ranges));
        if (mem.invert === true) bits.push("bytes invertidos");
        if (mem.invert === false) bits.push("orden normal");
        if (mem.formula) bits.push("fórmula " + mem.formula);
        if (!bits.length) return "";
        return "Ya anoté: " + bits.join(" · ") + ".";
    },

    notice(kind, extra) {
        if (!this.alive) this.alive = true;
        const payload = extra == null ? "" : String(extra);
        const key = String(kind || "") + ":" + payload.slice(0, 80);
        const now = Date.now();
        if (this._lastNotice === key && now - this._lastNoticeAt < 5000) return;
        this._lastNotice = key;
        this._lastNoticeAt = now;
        const seen = this.look();
        if (kind === "bin1") {
            if (this.memory) {
                this.memory.km.ranges = [];
                this.memory.chk.ranges = [];
                this.memory.chk.none = false;
                this.memory.formula = "";
                this.compile();
            }
            this.say("Ya tengo el BIN 1" + (seen.bin1 ? " (" + seen.bin1 + ", " + seen.size + " bytes)" : "") +
                (seen.family ? ". Parece familia " + seen.family : "") +
                ". Sube el BIN 2 con otro kilometraje. Yo voy a mirar solo lo que cambie.");
            return;
        }
        if (kind === "bin2") {
            let text = "BIN 2 cargado" + (seen.bin2 ? " (" + seen.bin2 + ")" : "") + ". " + this.diffLine(seen);
            if (seen.km1 == null || seen.km2 == null) text += " Pon KM 1 y KM 2, o dímelos aquí.";
            else text += " Con KM 1 = " + seen.km1 + " y KM 2 = " + seen.km2 + " ya puedo atacar. Dime empieza el ataque, o dime dónde ves el KM.";
            this.say(text);
            return;
        }
        if (kind === "bin3") {
            this.say("BIN 3 también está. Si pones su KM 3, el ataque confirma el checksum en un tercer entorno.");
            return;
        }
        if (kind === "km") {
            if (seen.km1 == null && seen.km2 == null) return;
            let text = "Anoté ";
            const bits = [];
            if (seen.km1 != null) bits.push("KM 1 = " + seen.km1);
            if (seen.km2 != null) bits.push("KM 2 = " + seen.km2);
            text += bits.join(" y ") + ".";
            if (seen.bin1 && seen.bin2 && seen.km1 != null && seen.km2 != null) {
                text += " " + this.diffLine(seen) + " Si no sabes la línea, escríbeme empieza el ataque.";
            } else if (!seen.bin2) {
                text += " Aún falta el BIN 2.";
            }
            this.say(text);
            return;
        }
        if (kind === "attack") {
            this.say("Ya entré al ataque. Voy a picar las líneas que cambian. Al rato te cuento qué leí y cómo lo descifré.");
            return;
        }
        if (kind === "family" && payload) {
            this.fromText(payload);
            this.say("Esa familia ya la conozco. Tomé la receta y la dejo en mi memoria. Si no cuadra, me lo dices.");
            return;
        }
        if (kind === "recipe" && payload) {
            this.fromText(payload);
            this.say("Guardé esa receta. Pinta o dime empieza el ataque.");
        }
    },

    send() {
        const box = this.talkBox();
        const raw = box ? String(box.value || "").trim() : "";
        this.alive = true;
        if (!raw) {
            this.say("Te escucho. Dime dónde está el KM, el checksum, o simplemente empieza el ataque.");
            return;
        }
        this.pushLog("yo", raw);
        if (box) box.value = "";
        this.hear(raw);
    },

    fromText(raw) {
        const facts = this.parse(raw);
        this.merge(facts);
        this.applyMarks(facts);
        this.compile();
    },

    hear(raw) {
        const text = String(raw || "").trim();
        if (!text) return;
        if (!this.memory) this.memory = this.blank();
        const facts = this.parse(text);
        this.merge(facts);
        this.applyMarks(facts);
        this.compile();
        if (facts.wantHunt && !facts.wantAttack) {
            this.huntNet();
            return;
        }
        if (facts.wantAttack && !facts.wrong) {
            this.applySpokenKm(facts);
            this.tryAttack();
            return;
        }
        if (this.lastReport && (facts.wrong || this.isCorrection(text, facts))) {
            this.correctAndRetry(text, facts);
            return;
        }
        this.say(this.reply(facts, text));
    },

    huntNet() {
        const self = this;
        const ctx = {
            size: this.dumpSize(),
            chip: (typeof currentBIN !== "undefined" && currentBIN && currentBIN.chip) || "",
            fileName: (typeof currentBIN !== "undefined" && currentBIN && currentBIN.fileName) || "",
            km1: typeof pairKm1 === "function" ? pairKm1() : null,
            km2: typeof pairKm2 === "function" ? pairKm2() : null
        };
        this.say("Busco algoritmos que nos puedan ayudar: codebook local y Wikipedia (CRC, BCD, Gray, endian). No uso sitios de dumps.");
        if (typeof AlgoNet === "undefined") {
            this.say("No está el buscador. Sigo con lo que ya hay en el codebook.");
            return;
        }
        AlgoNet.hunt(ctx).then(function (pack) {
            const forms = (pack && pack.formulas) || [];
            if (forms[0] && !self.memory.formula) self.memory.formula = forms[0];
            self.compile();
            self.say(AlgoNet.speak() + "\n\nSi te encaja alguno, dímelo y atacamos. O escribe empieza el ataque.");
        });
    },

    parse(raw) {
        const t = this.norm(raw);
        const facts = {
            km: [],
            chk: [],
            crc: [],
            comp: [],
            invert: null,
            endian: "",
            formula: "",
            width: null,
            wantAttack: false,
            km1: null,
            km2: null,
            noCheck: false,
            wrong: false,
            wantHunt: false,
            chat: "",
            notes: []
        };
        if (this.wantsAttack(t)) facts.wantAttack = true;
        const spoken = this.spokenKm(t);
        if (spoken.km1 != null) facts.km1 = spoken.km1;
        if (spoken.km2 != null) facts.km2 = spoken.km2;
        if (/busca|internet|wikipedia|algoritm/.test(t) && !facts.wantAttack) {
            facts.wantHunt = true;
        }
        if (/te equivoc|equivocada|esta mal|está mal|incorrect|error en|no cierra|no es esa|no es la formula|no es la linea|no es el km|mal esa|mal la |descarta|cambialo|cámbi[ao]lo|corrige/.test(t)) {
            facts.wrong = true;
        }
        if (/no hay (sum|crc|checksum|check)|sin (sum|crc|checksum)|no tiene (sum|crc|checksum)|no viene checksum/.test(t)) {
            facts.noCheck = true;
        }
        if (/invertid|al reves|al revés|swapead|byte.?invert|big.?endian|\bbe\b/.test(t) &&
            !/no\s+(est[aá]n\s+)?invert|sin invert|no invert|little/.test(t)) {
            facts.invert = true;
            facts.endian = /big.?endian|\bbe\b/.test(t) ? "BE" : facts.endian;
        }
        if (/little.?endian|\ble\b|orden normal|no invert|sin invert|no est[aá]n invert/.test(t)) {
            facts.invert = false;
            facts.endian = "LE";
        }
        const form = t.match(/\b(swap16\s*\([^)]+\)|nibble_swap\s*\([^)]+\)|~\s*\([^)]+\)|x\s*\/\s*\d+|x\s*\*\s*\d+|x\s*10|gray\s*\(\s*x\s*\)|bcd|x)\b/i);
        if (form) facts.formula = form[1].replace(/\s+/g, " ").replace(/\bx\b/gi, "X");
        const w = t.match(/\b([234])\s*bytes?\b/);
        if (w) facts.width = Number(w[1]);
        if (/^(hola|buenas|hey|ey|que onda|qué onda|buenos dias|buenos días|ya estas|ya estás|estas ahi|estás ahí)\b/.test(t)) facts.chat = "hi";
        else if (/no se|no sé|donde esta|dónde está|que hago|qué hago|como empiezo|cómo empiezo|ayudame|ayúdame|explica|no se donde|no sé dónde/.test(t)) facts.chat = "help";
        else if (/^(gracias|sale|ok|va|perfecto|listo|dale|hazlo|ando|sigue)$/.test(t)) {
            facts.chat = "ok";
            if (this.readyToAttack()) facts.wantAttack = true;
        }

        const clauses = t.split(/\s*(?:,|;|\.| y |\n)\s*/);
        clauses.forEach((clause) => {
            if (!clause) return;
            const ranges = this.rangesIn(clause);
            if (!ranges.length) return;
            const kind = this.kindIn(clause);
            ranges.forEach((range) => {
                if (kind === "CRC") facts.crc.push(range);
                else if (kind === "CHK") facts.chk.push(range);
                else if (kind === "COMP") facts.comp.push(range);
                else facts.km.push(range);
            });
        });
        if (!facts.km.length && !facts.chk.length && !facts.crc.length) {
            const loose = this.rangesIn(t);
            const kind = this.kindIn(t) || "KM";
            loose.forEach((range) => {
                if (kind === "CRC") facts.crc.push(range);
                else if (kind === "CHK") facts.chk.push(range);
                else facts.km.push(range);
            });
        }
        return facts;
    },

    norm(raw) {
        return String(raw || "")
            .toLowerCase()
            .replace(/[áà]/g, "a")
            .replace(/[éè]/g, "e")
            .replace(/[íì]/g, "i")
            .replace(/[óò]/g, "o")
            .replace(/[úù]/g, "u")
            .replace(/×/g, "x");
    },

    kindIn(clause) {
        if (/crc|morado|lila|violeta/.test(clause)) return "CRC";
        if (/checksum|check sum|\bsum\b|\bazul\b|\bsuma\b/.test(clause)) return "CHK";
        if (/complemento|\bcomp\b|\bverde\b/.test(clause)) return "COMP";
        if (/\bkm\b|kilometr|odometr|\brojo\b/.test(clause)) return "KM";
        return "";
    },

    rangesIn(clause) {
        const out = [];
        const re = /(?:0x)?([0-9a-f]{3,4})\s*(?:-|–|a|al|hasta)\s*(?:0x)?([0-9a-f]{3,4})/gi;
        let m;
        while ((m = re.exec(clause))) {
            out.push(this.range(m[1], m[2]));
        }
        const single = /(?:@|dir(?:eccion)?|linea|offset|byte|en|desde)\s*(?:0x)?([0-9a-f]{2,4})\b/gi;
        while ((m = single.exec(clause))) {
            const n = parseInt(m[1], 16);
            if (!out.some((r) => r.start === n)) out.push(this.range(m[1], m[1]));
        }
        if (!out.length) {
            const bare = clause.match(/\b(?:0x)?([0-9a-f]{4})\b/gi) || [];
            bare.forEach((h) => {
                const hex = String(h).replace(/^0x/i, "");
                if (/^[0-9]+$/.test(hex) && hex.length === 4 && Number(hex) > 4095) return;
                out.push(this.range(hex, hex));
            });
        }
        return out.filter(Boolean);
    },

    range(a, b) {
        const start = parseInt(String(a).replace(/^0x/i, ""), 16);
        const end = parseInt(String(b).replace(/^0x/i, ""), 16);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        if (lo < 0 || hi - lo > 32) return null;
        const cap = this.dumpSize();
        if (cap && lo >= cap) return null;
        return { start: lo, end: cap ? Math.min(hi, cap - 1) : hi };
    },

    dumpSize() {
        try {
            if (typeof currentBIN !== "undefined" && currentBIN && currentBIN.original) return currentBIN.original.length;
        } catch (error) { /* */ }
        return 0;
    },

    merge(facts) {
        const mem = this.memory;
        (facts.km || []).forEach((r) => this.pushRange(mem.km.ranges, r));
        if (facts.km.length) mem.km.color = "rojo";
        (facts.chk || []).forEach((r) => this.pushRange(mem.chk.ranges, r));
        (facts.crc || []).forEach((r) => this.pushRange(mem.chk.ranges, r));
        if (facts.crc.length) {
            mem.chk.kind = "CRC";
            mem.chk.color = "morado";
        } else if (facts.chk.length) {
            mem.chk.kind = mem.chk.kind || "CHK";
            mem.chk.color = mem.chk.color || "azul";
        }
        if (facts.noCheck) {
            mem.chk.none = true;
            mem.chk.kind = "";
        }
        if (facts.invert === true || facts.invert === false) mem.invert = facts.invert;
        if (facts.endian) mem.endian = facts.endian;
        if (facts.formula) mem.formula = facts.formula;
        if (facts.width) mem.width = facts.width;
        const box = document.getElementById("hintInvertBytes");
        if (box && mem.invert === true) box.checked = true;
        if (box && mem.invert === false) box.checked = false;
    },

    pushRange(list, range) {
        if (!range) return;
        if (list.some((r) => r.start === range.start && r.end === range.end)) return;
        list.push(range);
    },

    applyMarks(facts) {
        if (typeof MarkBook === "undefined" || typeof MarkBook.applyRange !== "function") return;
        (facts.km || []).forEach((r) => MarkBook.applyRange("KM", r.start, r.end));
        (facts.chk || []).forEach((r) => MarkBook.applyRange("CHK", r.start, r.end));
        (facts.crc || []).forEach((r) => MarkBook.applyRange("CRC", r.start, r.end));
        (facts.comp || []).forEach((r) => MarkBook.applyRange("COMP", r.start, r.end));
    },

    compile() {
        const mem = this.memory;
        const lines = [];
        mem.km.ranges.forEach((r) => lines.push("KM " + this.fmtRange(r) + " rojo"));
        mem.chk.ranges.forEach((r) => {
            const tag = mem.chk.kind === "CRC" ? "CRC" : "SUM";
            lines.push(tag + " " + this.fmtRange(r) + (mem.chk.color ? " " + mem.chk.color : ""));
        });
        if (mem.formula) lines.push(mem.formula);
        if (mem.width) lines.push(mem.width + " bytes");
        if (mem.endian) lines.push(mem.endian);
        if (mem.invert === true) lines.push("bytes invertidos");
        if (mem.invert === false) lines.push("little endian");
        this.compiled = lines.join("\n");
        const hidden = this.recipeBox();
        if (hidden && hidden.id === "helpRecipe") hidden.value = this.compiled;
        if (typeof MarkBook !== "undefined") MarkBook.persist();
    },

    fmtRange(r) {
        const a = this.hex4(r.start);
        const b = this.hex4(r.end);
        return a === b ? a : a + "-" + b;
    },

    fmtRanges(list) {
        return (list || []).map((r) => this.fmtRange(r)).join(", ");
    },

    hex4(n) {
        return Number(n).toString(16).toUpperCase().padStart(4, "0");
    },

    reply(facts, raw) {
        const got = [];
        if (facts.km.length) got.push("el KM en " + this.fmtRanges(facts.km) + " lo pinto rojo");
        if (facts.chk.length) got.push("el SUM en " + this.fmtRanges(facts.chk) + " lo pinto azul");
        if (facts.crc.length) got.push("el CRC en " + this.fmtRanges(facts.crc) + " lo pinto morado");
        if (facts.comp.length) got.push("el COMP en " + this.fmtRanges(facts.comp) + " lo pinto verde");
        if (facts.noCheck) got.push("sin SUM/CRC pintado; el ataque lo busca solo");
        if (facts.invert === true) got.push("probaré invertidos");
        if (facts.invert === false) got.push("orden normal, little-endian");
        if (facts.formula) got.push("fórmula " + facts.formula);
        if (facts.width) got.push(facts.width + " bytes");

        if (got.length) {
            let text = "Te entendí: " + got.join("; ") + ".";
            if (this.readyToAttack()) text += " Dime atacar y arranco, no te voy a seguir preguntando.";
            else {
                const next = this.nextMove();
                if (next) text += " " + next;
            }
            return text;
        }

        if (facts.chat === "hi") {
            return this.wakeUp();
        }
        if (facts.chat === "ok") {
            const next = this.nextMove();
            return next || "Va. Dime qué sigue o empieza el ataque.";
        }
        if (facts.chat === "help") {
            const seen = this.look();
            if (!seen.bin1 || !seen.bin2) {
                return "Primero los dos archivos: BIN 1 original y BIN 2 editado, cada uno con su KM. Yo miro los bytes que cambian. No necesito que sepas la línea.";
            }
            return "No pasa nada si no sabes la dirección. " + this.diffLine(seen) +
                " Esas zonas son las sospechosas. Dime atacar y las pruebo yo, o dime la línea si la ves.";
        }

        const seen = this.look();
        let text = "Te oí. ";
        if (seen.bin1 && seen.bin2) text += this.diffLine(seen) + " ";
        else if (!seen.bin1) text += "Aún no veo ningún BIN. ";
        else text += "Tengo BIN 1, falta BIN 2. ";
        const next = this.nextMove();
        if (next) text += next;
        else text += "Puedes decirme una dirección (0010-0012), un color, o empieza el ataque.";
        if (raw.length < 8) text += " Cuéntame más suelto, como me lo dirías a mí.";
        return text.trim();
    },

    nextMove() {
        const seen = this.look();
        if (!seen.bin1) return "Carga el BIN 1 original.";
        if (!seen.bin2) return "Sube el BIN 2 con otro KM.";
        if (seen.km1 == null || seen.km2 == null) return "Escribe KM 1 y KM 2 (o dímelos aquí).";
        const have = this.whatIHave();
        if (have) return have + " Dime atacar y arranco.";
        return "Ya tengo el par y los KM. Dime atacar y arranco, sin más preguntas.";
    },

    stillNeed() {
        const mem = this.memory;
        const miss = [];
        if (!mem.km.ranges.length) miss.push("dónde viene el KM (dirección y color)");
        if (!mem.chk.ranges.length && !mem.chk.none) miss.push("dónde viene el checksum o CRC, o dime que no hay");
        if (mem.invert === null) miss.push("si los bytes van invertidos o normal");
        return miss;
    },

    missingBins() {
        const miss = [];
        if (typeof currentBIN === "undefined" || !currentBIN || !currentBIN.original) miss.push("BIN 1");
        if (typeof OmegaKernel === "undefined" || !OmegaKernel.compareBins || !OmegaKernel.compareBins[0]) miss.push("BIN 2");
        if (typeof pairKm1 === "function" && pairKm1() == null) miss.push("KM 1");
        if (typeof pairKm2 === "function" && pairKm2() == null) miss.push("KM 2");
        return miss;
    },

    missing() {
        return this.missingBins();
    },

    readyToAttack() {
        return this.missingBins().length === 0;
    },

    wantsAttack(t) {
        const s = this.norm(t);
        if (/atacar|ataqu[eo]|ataca\b|atacalo|atacale|atacamos|atacando|atacr/.test(s)) return true;
        if (/empez(a|ar|amos|ale)|arranc(a|ar|ale|amos)|adelante/.test(s)) return true;
        if (/dale con|vamos al ataque|vamos a atac|10\s*min|ataque\s*10/.test(s)) return true;
        if (/vuelve a atac|otra vez el ataque|repite el ataque/.test(s)) return true;
        return false;
    },

    spokenKm(t) {
        const out = { km1: null, km2: null };
        const one = String(t || "").match(/km\s*1\s*(?:es|=|:)?\s*(\d{3,7})/);
        const two = String(t || "").match(/km\s*2\s*(?:es|=|:)?\s*(\d{3,7})/);
        if (one) out.km1 = Number(one[1]);
        if (two) out.km2 = Number(two[1]);
        return out;
    },

    applySpokenKm(facts) {
        const fill = function (id, km) {
            if (km == null || !Number.isFinite(km)) return;
            const el = document.getElementById(id);
            if (el) el.value = String(km);
        };
        if (facts && facts.km1 != null) {
            fill("knownKm1", facts.km1);
            fill("knownKm", facts.km1);
        }
        if (facts && facts.km2 != null) fill("knownKm2", facts.km2);
        if (typeof refreshKmReadout === "function") refreshKmReadout();
    },

    tryAttack() {
        if ((typeof DeepAttack !== "undefined" && DeepAttack.running) ||
            (typeof startDeepAttack === "function" && startDeepAttack.busy)) {
            this.say("Ya estoy atacando. Cuando termine te cuento qué leí. No te voy a seguir preguntando.");
            return;
        }
        const miss = this.missingBins();
        if (miss.length) {
            this.say("Quiero atacar, pero aún falta " + miss.join(", ") + ". Cárgalo y dime otra vez atacar. Yo ya guardé lo que me dijiste.");
            return;
        }
        this.say("Empezamos el ataque. Uso lo que me diste y lo que cambia entre los BIN. Al final te cuento qué línea leí, qué bytes y cómo lo descifré. Si me equivoco, me lo dices y vuelvo.");
        this.clearButtons();
        this._attackSaid = true;
        if (typeof startDeepAttack === "function") startDeepAttack();
    },

    say(text) {
        this.paint(text);
        this.pushLog("ia", text);
        this.clearButtons();
        this.pulse();
    },

    pulse() {
        const el = document.getElementById("aiPulse");
        if (el) {
            el.classList.remove("beat");
            void el.offsetWidth;
            el.classList.add("beat");
        }
    },

    paint(text) {
        const el = document.getElementById("aiReply");
        if (el) el.textContent = text;
    },

    logCount() {
        const log = document.getElementById("aiChatLog");
        return log ? log.children.length : 0;
    },

    pushLog(who, text) {
        const log = document.getElementById("aiChatLog");
        if (!log) return;
        const row = document.createElement("p");
        row.className = "ai-line ai-" + who;
        row.textContent = (who === "ia" ? "IA: " : "Tú: ") + String(text || "").trim();
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
    },

    clearButtons() {
        const box = document.getElementById("aiChatBtns");
        if (box) box.innerHTML = "";
    },

    buttons() {
        this.clearButtons();
    },

    answer() {
        /* chat libre, sin Sí/No */
    },

    onAccepted(kinds) {
        const list = kinds || [];
        if (!list.length) return;
        this.alive = true;
        const names = list.map((k) => k === "KM" ? "KM rojo" : (k === "CRC" ? "CRC morado" : (k === "CHK" ? "SUM azul" : k)));
        let text = "Vi que aceptaste " + names.join(" y ") + " en el hex. ";
        if (list.indexOf("KM") >= 0 && !this.memory.km.ranges.length && typeof MarkBook !== "undefined") {
            (MarkBook.lessonRanges("KM") || []).forEach((r) => this.pushRange(this.memory.km.ranges, { start: r.start, end: r.end }));
            this.memory.km.color = "rojo";
        }
        if ((list.indexOf("CHK") >= 0 || list.indexOf("CRC") >= 0) && typeof MarkBook !== "undefined") {
            const kind = list.indexOf("CRC") >= 0 ? "CRC" : "CHK";
            (MarkBook.lessonRanges(kind) || []).forEach((r) => this.pushRange(this.memory.chk.ranges, { start: r.start, end: r.end }));
            this.memory.chk.kind = kind;
            this.memory.chk.color = kind === "CRC" ? "morado" : "azul";
        }
        this.compile();
        text += this.nextMove();
        this.say(text);
    },

    lastBest() {
        const r = this.lastReport;
        if (r && r.best) return r.best;
        if (typeof DeepAttack !== "undefined" && DeepAttack.lastReport && DeepAttack.lastReport.best) {
            return DeepAttack.lastReport.best;
        }
        return null;
    },

    lastAddr(best) {
        if (!best) return null;
        if (best.addr != null) return best.addr;
        if (best.address != null) return best.address;
        return null;
    },

    banFormula(formula) {
        if (!formula) return;
        if (!this.memory.ban) this.memory.ban = { formulas: [], addrs: [] };
        if (this.memory.ban.formulas.indexOf(formula) < 0) this.memory.ban.formulas.push(formula);
    },

    banAddr(addr) {
        if (addr == null || !Number.isFinite(Number(addr))) return;
        if (!this.memory.ban) this.memory.ban = { formulas: [], addrs: [] };
        const n = Number(addr);
        if (this.memory.ban.addrs.indexOf(n) < 0) this.memory.ban.addrs.push(n);
    },

    isCorrection(text, facts) {
        if (facts.wrong) return true;
        if (facts.wantAttack) return true;
        if (facts.formula || (facts.km && facts.km.length) || (facts.chk && facts.chk.length) || (facts.crc && facts.crc.length)) return true;
        return false;
    },

    correctAndRetry(text, facts) {
        const last = this.lastBest();
        const changed = [];
        if (!this.memory.ban) this.memory.ban = { formulas: [], addrs: [] };
        const oldAddr = this.lastAddr(last);
        const oldF = last && last.formula;
        if (facts.wrong && oldF && (!facts.formula || facts.formula === oldF)) {
            this.banFormula(oldF);
            this.memory.formula = "";
            changed.push("descarto la fórmula " + oldF + " porque me dijiste que estaba mal");
        }
        if (facts.formula && facts.formula !== oldF) {
            if (oldF) this.banFormula(oldF);
            changed.push("ahora pruebo " + facts.formula);
        }
        if (facts.wrong && oldAddr != null && !facts.km.length && /linea|línea|direccion|dirección|offset/.test(this.norm(text))) {
            this.banAddr(oldAddr);
            changed.push("descarto la dirección " + this.hex4(oldAddr));
        }
        if (facts.km.length && oldAddr != null && facts.km[0].start !== oldAddr) {
            this.banAddr(oldAddr);
            changed.push("el KM lo busco en " + this.fmtRanges(facts.km) + ", no en " + this.hex4(oldAddr));
        } else if (facts.km.length) {
            changed.push("KM en " + this.fmtRanges(facts.km));
        }
        if (facts.chk.length || facts.crc.length) {
            changed.push("checksum en " + this.fmtRanges((facts.crc || []).concat(facts.chk || [])));
        }
        if (facts.invert === true) changed.push("probaré invertidos");
        if (facts.invert === false) changed.push("orden normal");
        this.compile();
        let msg = "Te oí. ";
        msg += changed.length ? (changed.join("; ") + ". ") : "Sin repetir lo que rechazaste. ";
        msg += "Vuelvo a atacar con tu corrección. Al final te cuento otra vez qué leí y cómo lo descifré.";
        this.say(msg);
        this.tryAttack();
    },

    hearAttack(report) {
        this.alive = true;
        if (report && typeof report === "object") this.lastReport = report;
        else this.lastReport = { reply: String(report || ""), message: String(report || "") };
        const text = String(this.lastReport.message || this.lastReport.reply || "").trim();
        const box = this.talkBox();
        if (box) {
            box.placeholder = "Si me equivoqué, dímelo: te equivocaste en la línea / no es esa fórmula / el KM está en 0002…";
        }
        this.say((text || "El ataque terminó.") +
            "\n\nSigo aquí. Si algo quedó mal, platica conmigo y vuelvo a atacar.");
    }
};
