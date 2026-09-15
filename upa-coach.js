const UpaCoach = {
    alive: false,
    want: { kind: "auto", chip: "", name: "" },

    bind() {
        const self = this;
        const send = document.getElementById("upaAiSend");
        if (send && !send._upaBound) {
            send._upaBound = true;
            send.addEventListener("click", function (event) {
                event.preventDefault();
                self.send();
            });
        }
        const box = document.getElementById("upaAiText");
        if (box && !box._upaBound) {
            box._upaBound = true;
            box.addEventListener("keydown", function (event) {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    self.send();
                }
            });
        }
        this.alive = true;
        this.paint(this.idleHint());
    },

    idleHint() {
        return "Los botones de arriba siguen igual: lectura, escritura o AUTODETECT para UPA. Yo solo te ayudo: te explico el .PSC, el chip, o el error del programador. Escribe y pulsa DECIRLE.";
    },

    send() {
        const box = document.getElementById("upaAiText");
        const raw = box ? String(box.value || "").trim() : "";
        if (!raw) {
            this.say("Dime qué parte del script UPA no entiendes, el chip, o pega el error del programador.");
            return;
        }
        this.pushLog("yo", raw);
        if (box) box.value = "";
        this.hear(raw);
    },

    hear(raw) {
        const t = this.norm(raw);
        if (/error|cc error|certificate|gethexedit|nil|programdevice|readdevice|undeclared|verify|failed|exception/.test(t) && raw.length > 12) {
            const tip = (typeof EditorEngine !== "undefined")
                ? EditorEngine.analyzeError(raw)
                : "Pega el error del UPA.";
            const err = document.getElementById("upaErrorBox");
            if (err && !String(err.value || "").trim()) err.value = raw;
            const out = document.getElementById("upaErrorOut");
            if (out) out.textContent = tip;
            this.say("Ese error es del programador UPA. " + tip + " Los botones de lectura/escritura no se tocan: si hace falta otro .PSC, pulsa otra vez CREAR CÓDIGO o dime qué versión usar.");
            return;
        }
        if (/\b(93c\w+|24c\w+|25c\w+|25lc\w+|95\w+|r5f\w+|rh850)\b/.test(t)) {
            this.want.chip = (t.match(/\b(93c\w+|24c\w+|25c\w+|25lc\w+|95\w+|r5f\w+|rh850)\b/) || [])[1].toUpperCase();
        }
        if (/autodetect|los dos|lectura y escritura/.test(t)) this.want.kind = "auto";
        else if (/escritura|escribir|programar|write/.test(t)) this.want.kind = "write";
        else if (/lectura|leer|read/.test(t)) this.want.kind = "read";
        if (/crea|genera|arma|haz el script|dame el psc/.test(t)) {
            if (typeof buildUpaScript === "function") {
                const script = buildUpaScript(this.want.kind || "auto", this.want.kind === "write" ? "ESCRITURA KM" : (this.want.kind === "read" ? "LECTURA KM" : "AUTODETECT LECTURA ESCRITURA"));
                if (script) return;
            }
            this.say("Usa los botones de arriba: CREAR CÓDIGO LECTURA, ESCRITURA o AUTODETECT. Eso arma el script de UPA. Si no hay algoritmo, primero guarda uno.");
            return;
        }
        if (/explica|que hace|qué hace|este codigo|este código|psc/.test(t)) {
            const src = document.getElementById("upaSource") ? document.getElementById("upaSource").value : "";
            if (src) {
                this.say(this.explain(src, this.want.kind || "auto"));
                return;
            }
        }
        this.say(this.reply());
    },

    reply() {
        const src = document.getElementById("upaSource") ? document.getElementById("upaSource").value : "";
        let text = this.want.chip ? ("Chip anotado: " + this.want.chip + ". ") : "";
        text += "Este recuadro es solo ayuda. El script de UPA se hace con CREAR CÓDIGO LECTURA, ESCRITURA o AUTODETECT, luego DESCARGAR .PSC.\n";
        if (src) text += "Ya hay un .PSC en el recuadro. Pregúntame qué hace o pega un error de UPA.";
        else text += "Aún no hay código. Pulsa un botón de crear y te explico el Pascal.";
        return text;
    },

    seenScript(script, kind) {
        this.alive = true;
        this.want.kind = kind || this.want.kind;
        this.say(this.explain(script, kind));
    },

    seenError(tip) {
        this.alive = true;
        this.say("Analicé el error de UPA. " + tip + " Si quieres otro .PSC, usa los botones de crear código; yo te digo qué cambiar.");
    },

    explain(script, kind) {
        const src = String(script || "");
        const nRead = (src.match(/procedure ReadAlgo/g) || []).length;
        const nWrite = (src.match(/procedure WriteAlgo/g) || []).length;
        const chip = (src.match(/AddDeviceEx\('([^']+)'/) || [])[1] || this.want.chip || "el chip del BIN";
        const label = kind === "auto" ? "AUTODETECT (lectura + escritura)" : (kind === "write" ? "escritura" : (kind === "read" ? "lectura" : kind));
        let text = "Script UPA listo (" + label + "). Los botones siguen siendo los que generan el .PSC.\n";
        text += "• Chip heredado: " + chip + "\n";
        if (nRead) text += "• " + nRead + " lectura(s): ReadDevice + GetByteHexEdit\n";
        if (nWrite) text += "• " + nWrite + " escritura(s): SetByteHexEdit + ProgramDevice\n";
        if (/DetectVersion/.test(src)) text += "• DetectVersion elige la versión por tamaño y primer byte.\n";
        text += "Descárgalo con DESCARGAR .PSC. Si UPA falla, pega el error aquí o en ANALIZAR ERROR.";
        return text;
    },

    norm(raw) {
        return String(raw || "")
            .toLowerCase()
            .replace(/[áà]/g, "a")
            .replace(/[éè]/g, "e")
            .replace(/[íì]/g, "i")
            .replace(/[óò]/g, "o")
            .replace(/[úù]/g, "u");
    },

    say(text) {
        this.paint(text);
        this.pushLog("ia", text);
    },

    paint(text) {
        const el = document.getElementById("upaAiReply");
        if (el) el.textContent = text;
    },

    pushLog(who, text) {
        const log = document.getElementById("upaAiLog");
        if (!log) return;
        const row = document.createElement("p");
        row.className = "ai-line ai-" + who;
        row.textContent = (who === "ia" ? "IA: " : "Tú: ") + String(text || "").replace(/\s+/g, " ").trim();
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
    }
};
