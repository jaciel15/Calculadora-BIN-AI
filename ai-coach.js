const AiCoach = {
    step: "idle",
    answers: {
        kmColor: "",
        hasCheck: null,
        checkKind: "",
        invert: null
    },

    bind() {
        const self = this;
        const how = document.getElementById("helpHowBtn") || document.getElementById("helpRecipe");
        if (how) {
            how.addEventListener("click", function () { self.start(); });
            how.addEventListener("focus", function () { self.start(); });
        }
        const box = document.getElementById("helpRecipe");
        if (box) {
            box.addEventListener("keydown", function (event) {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    self.fromText(box.value);
                }
            });
        }
        this.paint("Pulsa CÓMO LO HAGO. Te voy a preguntar el color del KM, si hay SUM o CRC, y si los bytes van invertidos. Tú respondes Sí o No. Al final te digo: empezamos el ataque.");
    },

    start() {
        if (this.step === "ready") {
            this.askReady();
            return;
        }
        if (this.step !== "idle" && this.step !== "done") return;
        this.step = "km_color";
        this.say("Vamos a trabajar juntos. ¿De qué color es el kilometraje en el hex? Lo normal es rojo (KM). Si ya lo pintaste, dime Sí.");
        this.buttons([
            { id: "rojo", label: "Rojo · KM" },
            { id: "si", label: "Sí, ya lo pinté" },
            { id: "no", label: "Aún no" }
        ]);
    },

    say(text) {
        this.paint(text);
        this.pushLog("ia", text);
    },

    paint(text) {
        const el = document.getElementById("aiReply");
        if (el) el.textContent = text;
    },

    pushLog(who, text) {
        const log = document.getElementById("aiChatLog");
        if (!log) return;
        const row = document.createElement("p");
        row.className = "ai-line ai-" + who;
        row.textContent = (who === "ia" ? "IA: " : "Tú: ") + text;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
    },

    buttons(list) {
        const box = document.getElementById("aiChatBtns");
        if (!box) return;
        box.innerHTML = "";
        const self = this;
        (list || []).forEach((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ai-yesno" + (item.id === "ataque" ? " ai-go" : "");
            btn.textContent = item.label;
            btn.addEventListener("click", function () { self.answer(item.id, item.label); });
            box.appendChild(btn);
        });
    },

    answer(id, label) {
        this.pushLog("yo", label || id);
        if (this.step === "km_color") this.onKm(id);
        else if (this.step === "has_chk") this.onHasChk(id);
        else if (this.step === "chk_kind") this.onChkKind(id);
        else if (this.step === "invert") this.onInvert(id);
        else if (this.step === "ready") this.onReady(id);
    },

    fromText(raw) {
        const t = String(raw || "").toLowerCase();
        if (/sí|si\b|rojo|km/.test(t) && this.step === "km_color") return this.answer("si", raw);
        if (/no\b/.test(t) && (this.step === "has_chk" || this.step === "invert" || this.step === "km_color")) return this.answer("no", raw);
        if (/sí|si\b/.test(t) && (this.step === "has_chk" || this.step === "invert" || this.step === "ready")) return this.answer("si", raw);
        if (/crc/.test(t) && this.step === "chk_kind") return this.answer("crc", raw);
        if (/sum|checksum/.test(t) && this.step === "chk_kind") return this.answer("sum", raw);
        if (/invert/.test(t) && this.step === "invert") return this.answer("si", raw);
        if (/ataque/.test(t) && this.step === "ready") return this.answer("ataque", raw);
        if (this.step === "idle") this.start();
    },

    onKm(id) {
        this.answers.kmColor = "rojo";
        if (typeof MarkBook !== "undefined") MarkBook.setBrush("KM");
        if (id === "no") {
            this.say("Está bien. El pincel quedó en KM rojo. Pinta los bytes del kilometraje en el hex y pulsa ACEPTO. Mientras tanto: ¿hay checksum o CRC aparte del KM?");
        } else {
            this.say("Anoté: el kilometraje es rojo (KM). ¿Hay checksum o CRC aparte, en otro color? Responde Sí o No.");
        }
        this.step = "has_chk";
        this.buttons([
            { id: "si", label: "Sí" },
            { id: "no", label: "No" },
            { id: "nose", label: "No sé" }
        ]);
    },

    onHasChk(id) {
        if (id === "no") {
            this.answers.hasCheck = false;
            this.answers.checkKind = "";
            this.askInvert("Sin SUM/CRC aparte. El ataque lo buscará solo.");
            return;
        }
        this.answers.hasCheck = id !== "nose";
        this.step = "chk_kind";
        this.say("¿Es SUM (azul) o CRC (morado)? Si hay los dos, pulsa Ambos.");
        this.buttons([
            { id: "sum", label: "SUM azul" },
            { id: "crc", label: "CRC morado" },
            { id: "ambos", label: "Ambos" },
            { id: "nose", label: "No sé" }
        ]);
    },

    onChkKind(id) {
        this.answers.checkKind = id;
        if (typeof MarkBook !== "undefined") {
            if (id === "crc") MarkBook.setBrush("CRC");
            else if (id === "sum" || id === "ambos") MarkBook.setBrush("CHK");
        }
        const name = id === "crc" ? "CRC morado" : (id === "sum" ? "SUM azul" : (id === "ambos" ? "SUM y CRC" : "SUM/CRC si aparece"));
        this.askInvert("Anoté: " + name + ". Píntalo en otro byte, no encima del KM, y ACEPTO.");
    },

    askInvert(prefix) {
        this.step = "invert";
        this.say((prefix ? prefix + " " : "") + "Última: ¿tal vez los bytes están invertidos (al revés, SWAP, big-endian)? Sí o No.");
        this.buttons([
            { id: "si", label: "Sí" },
            { id: "no", label: "No" },
            { id: "nose", label: "No sé, pruébalo" }
        ]);
    },

    onInvert(id) {
        this.answers.invert = id === "si" ? true : (id === "no" ? false : null);
        const box = document.getElementById("hintInvertBytes");
        if (box) box.checked = id !== "no";
        if (typeof MarkBook !== "undefined") MarkBook.persist();
        this.askReady();
    },

    summary() {
        const bits = ["KM rojo"];
        if (this.answers.hasCheck === false) bits.push("sin SUM/CRC pintado");
        else if (this.answers.checkKind === "crc") bits.push("CRC morado");
        else if (this.answers.checkKind === "sum") bits.push("SUM azul");
        else if (this.answers.checkKind === "ambos") bits.push("SUM y CRC");
        else if (this.answers.hasCheck) bits.push("hay checksum");
        if (this.answers.invert === true) bits.push("bytes tal vez invertidos");
        else if (this.answers.invert === false) bits.push("orden normal");
        else bits.push("probaré invertidos por si acaso");
        return bits.join(" · ");
    },

    missing() {
        const miss = [];
        if (typeof currentBIN === "undefined" || !currentBIN || !currentBIN.original) miss.push("BIN 1");
        if (typeof OmegaKernel === "undefined" || !OmegaKernel.compareBins || !OmegaKernel.compareBins[0]) miss.push("BIN 2");
        if (typeof pairKm1 === "function" && pairKm1() == null) miss.push("KM 1");
        if (typeof pairKm2 === "function" && pairKm2() == null) miss.push("KM 2");
        return miss;
    },

    askReady() {
        this.step = "ready";
        const miss = this.missing();
        if (!miss.length) {
            this.say("Anoté: " + this.summary() + ". Ya hay par y KM. Empezamos el ataque.");
            this.buttons([
                { id: "ataque", label: "Sí, empieza el ataque" },
                { id: "no", label: "Ahora no" }
            ]);
            return;
        }
        this.say("Anoté: " + this.summary() + ". Falta " + miss.join(", ") + ". Cuando estén, pulsa Sí y empezamos el ataque.");
        this.buttons([
            { id: "ataque", label: "Sí, empieza el ataque" },
            { id: "no", label: "Ahora no" }
        ]);
    },

    onReady(id) {
        if (id === "no") {
            this.say("De acuerdo. Cuando quieras, pulsa CÓMO LO HAGO o ATAQUE 10 MIN.");
            this.buttons([{ id: "ataque", label: "Empezamos el ataque" }]);
            return;
        }
        const miss = this.missing();
        if (miss.length) {
            this.say("Aún falta " + miss.join(", ") + ". Cárgalo y te digo de nuevo: empezamos el ataque.");
            return;
        }
        this.say("Empezamos el ataque. Voy a leer tus colores, el Sí/No del checksum y si los bytes van invertidos. No se traba.");
        this.buttons([]);
        if (typeof startDeepAttack === "function") startDeepAttack();
    },

    onAccepted(kinds) {
        const list = kinds || [];
        if (list.indexOf("KM") >= 0 && (this.step === "idle" || this.step === "km_color")) {
            this.answers.kmColor = "rojo";
            this.step = "has_chk";
            this.say("Vi el KM rojo que aceptaste. ¿Hay checksum o CRC en otro color? Sí o No.");
            this.buttons([
                { id: "si", label: "Sí" },
                { id: "no", label: "No" },
                { id: "nose", label: "No sé" }
            ]);
            return;
        }
        if ((list.indexOf("CHK") >= 0 || list.indexOf("CRC") >= 0) && this.step === "has_chk") {
            this.answers.hasCheck = true;
            this.answers.checkKind = list.indexOf("CRC") >= 0 ? "crc" : "sum";
            this.askInvert("Guardé el " + (this.answers.checkKind === "crc" ? "CRC morado" : "SUM azul") + ".");
        }
    },

    hearAttack(text) {
        this.say(text);
        this.step = "ready";
        this.buttons([{ id: "ataque", label: "Atacar otra vez" }]);
    }
};
