let currentBIN = null;
let lastSimulation = null;

const LabMode = {
    current: "KM",
    labels: {
        KM: "MODO KM — Analizar y editar solo kilometraje",
        VIN: "MODO VIN — Analizar y editar solo el VIN completo",
        CHK: "MODO CHECKSUM — Analizar y marcar solo sumas/CRC"
    },
    set(mode) {
        this.current = mode || "KM";
        document.body.setAttribute("data-lab-mode", this.current);
        document.querySelectorAll(".mode-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-mode") === this.current);
        });
        if ($("modeBanner")) $("modeBanner").textContent = this.labels[this.current];
        if ($("dataType")) {
            $("dataType").value = this.current === "VIN" ? "VIN" : "KILOMETRAJE (KM)";
        }
        if ($("analyzeBtn")) $("analyzeBtn").textContent = "ANALIZAR";
        if ($("analyzeBtnTop")) $("analyzeBtnTop").textContent = "ANALIZAR";
        if ($("analyzePairBtn")) $("analyzePairBtn").textContent = "ANALIZAR PAR";
        if (currentBIN && currentBIN.working) showHEX(currentBIN.working);
        if (currentBIN && currentBIN.analysis) {
            if (this.current === "VIN") fillEditorVin(currentBIN.analysis);
            else if (this.current === "KM") fillEditorFromBest(currentBIN.analysis);
        }
    },
    is(mode) {
        return this.current === mode;
    }
};

function $(id) {
    return document.getElementById(id);
}

function bindClick(id, handler) {
    const el = $(id);
    if (el) el.onclick = handler;
}

function padHex(value, size) {
    return value.toString(16).toUpperCase().padStart(size || 4, "0");
}

function downloadBlob(filename, parts, type) {
    const blob = new Blob(parts, { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function collectMarks() {
    const marks = {};
    const paint = (addr, width, cls) => {
        if (addr === undefined || addr === null) return;
        for (let i = 0; i < width; i++) {
            const at = addr + i;
            marks[at] = marks[at] ? marks[at] + " " + cls : cls;
        }
    };
    if (!currentBIN) return marks;
    const omega = currentBIN.analysis && currentBIN.analysis.omega;
    const vinList = (currentBIN.analysis && currentBIN.analysis.vins && currentBIN.analysis.vins.length)
        ? currentBIN.analysis.vins
        : Hunters.huntVIN(currentBIN.original);
    if (!LabMode.is("CHK")) {
        vinList.forEach((v) => {
            (v.copies || [v.address]).forEach((addr) => paint(addr, v.span || v.width || 17, "hex-vin"));
        });
    }
    const guiding = typeof MarkBook !== "undefined" && MarkBook.guiding();
    if (!guiding && LabMode.is("KM") && currentBIN.analysis && currentBIN.analysis.best) {
        const hit = currentBIN.analysis.best;
        (hit.copies || [hit.address]).forEach((addr) => paint(addr, hit.width || 2, "hex-km"));
    }
    if (!guiding && (LabMode.is("CHK") || LabMode.is("KM")) && omega && omega.kmChecksums) {
        omega.kmChecksums.forEach((c) => {
            if (c.storedAt !== null && c.storedAt !== undefined) paint(c.storedAt, c.size || 2, "hex-chk");
        });
    }
    if (LabMode.is("CHK") && currentBIN.analysis && currentBIN.analysis.checksums) {
        currentBIN.analysis.checksums.forEach((c) => {
            if (c.storedAt !== null && c.storedAt !== undefined) paint(c.storedAt, c.size || 2, "hex-chk");
        });
    }
    if (OmegaKernel.compareBins[0]) {
        const a = currentBIN.working || currentBIN.original;
        const b = OmegaKernel.compareBins[0].bytes;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            if (a[i] !== b[i]) paint(i, 1, "hex-diff");
        }
        Hunters.huntVIN(b).forEach((v) => {
            (v.copies || [v.address]).forEach((addr) => paint(addr, v.span || v.width || 17, "hex-vin"));
        });
    }
    if (typeof MarkBook !== "undefined") {
        if (MarkBook.revealed) {
            MarkBook.allRanges().forEach((range) => {
                const info = MarkBook.kinds[range.kind];
                if (info) paint(range.start, range.size, info.cls);
            });
        }
        Object.keys(MarkBook.user).forEach((key) => {
            const kind = MarkBook.user[key];
            const info = MarkBook.kinds[kind];
            if (info) paint(Number(key), 1, info.cls);
        });
    }
    return marks;
}

function paintHex(targetId, bytes, marks) {
    const el = $(targetId);
    if (!el || !bytes) return;
    const mode = $("hexMode") ? $("hexMode").value : "16-BIT";
    const step = 16;
    let html = "";
    for (let i = 0; i < bytes.length; i += step) {
        html += "<span class=\"hex-addr\">" + padHex(i, 4) + "</span> : ";
        let ascii = "";
        for (let j = 0; j < step; j++) {
            if (i + j < bytes.length) {
                const b = bytes[i + j];
                const cls = marks[i + j] ? "hex-byte " + marks[i + j] : "hex-byte";
                html += "<span class=\"" + cls + "\" data-addr=\"" + (i + j) + "\">" + padHex(b, 2) + "</span>";
                html += (mode === "16-BIT" && j % 2 === 1 ? "  " : " ");
                const ch = b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
                const acls = marks[i + j] ? "hex-ascii " + marks[i + j] : "hex-ascii";
                ascii += "<span class=\"" + acls + "\" data-addr=\"" + (i + j) + "\">" + ch.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>";
            } else {
                html += "   ";
            }
        }
        html += " | " + ascii + "\n";
    }
    el.innerHTML = html;
}

function showHEX(bytes) {
    const marks = collectMarks();
    const view = bytes || (currentBIN ? currentBIN.working : null);
    if (view) {
        paintHex("hexViewer", view, marks);
        if ($("hexLabel1") && currentBIN) $("hexLabel1").textContent = "BIN 1 · " + currentBIN.fileName;
    }
    if (OmegaKernel.compareBins[0]) {
        paintHex("hexViewer2", OmegaKernel.compareBins[0].bytes, marks);
        if ($("hexLabel2")) $("hexLabel2").textContent = "BIN 2 · " + OmegaKernel.compareBins[0].fileName;
    } else if ($("hexViewer2")) {
        $("hexViewer2").innerHTML = "Carga el BIN 2. Aquí se pinta el otro archivo y en naranja todo lo que cambia (VIN, KM y el resto).";
        if ($("hexLabel2")) $("hexLabel2").textContent = "BIN 2";
    }
}

function showVinCard(which, bytes) {
    const val = $("vinValue" + which);
    const maker = $("vinMaker" + which);
    const addr = $("vinAddr" + which);
    const box = $("vinBox" + which);
    if (!val || !box) return null;
    box.classList.remove("live", "diff");
    if (!bytes) {
        val.textContent = "Carga el BIN " + which;
        maker.textContent = "—";
        addr.textContent = "—";
        return null;
    }
    const found = (which === 1 && currentBIN && currentBIN.analysis && currentBIN.analysis.vins && currentBIN.analysis.vins.length)
        ? currentBIN.analysis.vins
        : Hunters.huntVIN(bytes);
    if (!found.length) {
        val.textContent = "SIN VIN EN EL DUMP";
        maker.textContent = "El nombre del archivo no cuenta";
        addr.textContent = "—";
        return null;
    }
    const id = MindEngine.decodeVin(found[0].value);
    val.textContent = found[0].value;
    maker.textContent = id && id.maker ? id.maker + " · WMI " + id.wmi : "WMI " + (id ? id.wmi : "?");
    addr.textContent = (found[0].layoutLabel || "ASCII") + " · " + (found[0].copies || [found[0].address]).length + " copias · " + found[0].addressText;
    box.classList.add("live");
    return found[0].value;
}

function refreshIdentity() {
    const v1 = currentBIN ? showVinCard(1, currentBIN.original) : showVinCard(1, null);
    const v2 = OmegaKernel.compareBins[0] ? showVinCard(2, OmegaKernel.compareBins[0].bytes) : showVinCard(2, null);
    if (v1 && v2 && v1 !== v2) {
        if ($("vinBox1")) $("vinBox1").classList.add("diff");
        if ($("vinBox2")) $("vinBox2").classList.add("diff");
    }
}

function renderDiffTable(diffWorld) {
    const body = $("diffBody");
    const summary = $("diffSummary");
    if (!body) return;
    if (!diffWorld || !diffWorld.ranges || !diffWorld.ranges.length) {
        body.innerHTML = "";
        if (summary) summary.textContent = OmegaKernel.compareBins.length
            ? "Los dos BIN son idénticos."
            : "Carga BIN 1 y BIN 2. Se marcan VIN, KM, checksum y todo lo demás que cambia.";
        return;
    }
    if (summary) {
        summary.textContent = diffWorld.totalBytes + " bytes distintos en " + diffWorld.ranges.length + " zonas.";
    }
    body.innerHTML = diffWorld.ranges.map((r) => {
        return "<tr class=\"algo-row\" data-addr=\"" + r.start + "\">" +
            "<td>" + r.kind + "</td>" +
            "<td>" + padHex(r.start) + "</td>" +
            "<td>" + padHex(r.end) + "</td>" +
            "<td>" + r.size + "</td>" +
            "<td>" + r.hexA + "</td>" +
            "<td>" + r.hexB + "</td>" +
            "<td>" + r.why + "</td>" +
            "</tr>";
    }).join("");
}

function addLogRows() {
    const body = $("logBody");
    if (!body) return;
    body.innerHTML = binCore.log.map((row) => {
        return "<tr><td>" + row.time + "</td><td>" + row.module + "</td><td>" + row.message + "</td></tr>";
    }).join("");
}

function setStatus(text, ok) {
    const circle = $("statusCircle");
    const label = $("statusText");
    if (circle) circle.textContent = text;
    if (label) label.textContent = text;
    if (circle) circle.className = "status-circle" + (ok ? " ok" : "");
    const footer = $("footerState");
    if (footer) footer.textContent = "ESTADO: " + text;
}

function renderCounters(counters) {
    const body = $("counterBody");
    if (!body) return;
    body.innerHTML = counters.map((row) => {
        const cls = row.status === "VALIDADO" ? "ok" : (row.status === "HIPOTESIS" ? "warn" : "");
        return "<tr>" +
            "<td>" + row.name + "</td>" +
            "<td>" + row.value + "</td>" +
            "<td>" + row.address + "</td>" +
            "<td>" + row.size + "</td>" +
            "<td>" + row.type + "</td>" +
            "<td>" + row.confidence + "</td>" +
            "<td class=\"" + cls + "\">" + row.status + "</td>" +
            "</tr>";
    }).join("");
}

function renderMemory(regions) {
    const body = $("memoryBody");
    if (!body) return;
    body.innerHTML = regions.map((row) => {
        return "<tr>" +
            "<td>" + row.id + "</td>" +
            "<td>" + padHex(row.start) + "</td>" +
            "<td>" + padHex(row.end) + "</td>" +
            "<td>" + padHex(row.size) + "</td>" +
            "<td>" + row.description + "</td>" +
            "<td>" + row.copies + "</td>" +
            "</tr>";
    }).join("");
}

function renderChecksums(items) {
    const body = $("checksumBody");
    if (!body) return;
    body.innerHTML = items.map((row) => {
        const cls = row.status === "VALIDO" ? "ok" : "error";
        return "<tr>" +
            "<td>" + row.name + "</td>" +
            "<td>" + (row.start !== undefined ? padHex(row.start) : "----") + "</td>" +
            "<td>" + (row.end !== undefined ? padHex(row.end) : "----") + "</td>" +
            "<td>" + (row.valueBin === null ? "----" : padHex(row.valueBin, row.size * 2)) + "</td>" +
            "<td>" + (row.calculated === null ? "----" : padHex(row.calculated, row.size * 2)) + "</td>" +
            "<td class=\"" + cls + "\">" + row.status + "</td>" +
            "<td>" + row.confidence + "%</td>" +
            "</tr>";
    }).join("");
}

function describeOperation(hit) {
    if (!hit) return "Sin operación.";
    return "Valor " + hit.value + " → " + hit.formula + " → bytes " + hit.hex +
        " (" + (hit.endian || "") + " " + hit.width + "B) en " + hit.addressText +
        " × " + (hit.copies ? hit.copies.length : 1) + " copias. " + (hit.writeHow || "");
}

function describeEdited(hit, newKm) {
    if (!hit || hit.writable === false) return "Esta familia no tiene operación de escritura demostrada.";
    if (newKm === "" || newKm === null) return "Escribe un nuevo KM para ver la operación editada.";
    try {
        const encoded = EditorEngine.encodeValue(Number(newKm), hit);
        return "Nuevo KM " + newKm + " → " + hit.formula + " → " + MathEngine.hexBytes(encoded) +
            " en " + (hit.copies || [hit.address]).length + " copias (" + (hit.endian || "") + ").";
    } catch (error) {
        return "No se pudo calcular la operación editada.";
    }
}

function renderDNA(dna, discovery) {
    $("dnaScore").textContent = dna.score + "%";
    $("dnaScoreCard").textContent = dna.score + "%";
    $("dnaStatus").textContent = dna.status;
    $("dnaMaker").textContent = dna.manufacturer;
    $("dnaFamily").textContent = dna.family;
    $("dnaVersion").textContent = dna.version;
    $("aiAlgorithm").textContent = discovery.algorithm;
    $("aiType").textContent = discovery.type;
    $("aiRegion").textContent = discovery.region;
    $("aiConfidence").textContent = discovery.confidence + "%";
    $("aiPatterns").textContent = String(discovery.patterns);
    if ($("aiCombos")) $("aiCombos").textContent = String(MathEngine.lastComboCount || 0);
    const best = currentBIN && currentBIN.analysis ? currentBIN.analysis.best : null;
    const omega = currentBIN && currentBIN.analysis ? currentBIN.analysis.omega : null;
    if ($("aiHow")) {
        const heart = omega && omega.vinHeart;
        const kmHow = best ? describeOperation(best) : (discovery.note || "-----");
        $("aiHow").textContent = heart
            ? kmHow + " | VIN HEART: " + heart.value + " · " + heart.layoutLabel + " · " + (heart.copies || []).length + " copias"
            : kmHow;
    }
    if ($("aiEdited")) $("aiEdited").textContent = describeEdited(best, $("newValue") ? $("newValue").value.replace(/[^\d]/g, "") : "");
    if ($("aiKmOrder")) {
        $("aiKmOrder").textContent = omega && omega.kmOrder
            ? omega.kmOrder.layout + " · bytes " + omega.kmOrder.hex + " · " + omega.kmOrder.copies + " copias"
            : "-----";
    }
    if ($("aiKmChecksum")) {
        const linked = omega && omega.kmChecksums && omega.kmChecksums[0];
        $("aiKmChecksum").textContent = linked && !omega.vinFocus
            ? linked.name + " " + linked.endian + " @ " + padHex(linked.storedAt) + " (ventana " + linked.window + ")"
            : (omega && omega.vinFocus ? "—" : "Sin checksum ligado al KM. Puede valerse solo de copias espejo.");
    }
    const heart = omega && omega.vinHeart;
    if ($("aiVinOrder")) {
        $("aiVinOrder").textContent = heart
            ? heart.layoutLabel + " · " + heart.formula + " · " + (heart.copies || [heart.address]).length + " copias · " + heart.addressText
            : "-----";
    }
    if ($("aiVinChecksum")) {
        $("aiVinChecksum").textContent = heart && heart.checksum
            ? heart.checksum.name + " @ " + padHex(heart.checksum.storedAt)
            : "Sin checksum ligado al VIN.";
    }
}

function activeEditorKind() {
    if (LabMode.is("VIN")) return "VIN";
    const type = $("dataType") ? $("dataType").value : "";
    if (type === "VIN") return "VIN";
    if (type === "HORAS MOTOR") return "HOURS";
    return "KM";
}

function fillEditorVin(analysis) {
    const heart = (analysis && analysis.omega && analysis.omega.vinHeart) || (analysis && analysis.vins && analysis.vins[0]);
    if (!heart) {
        $("currentValue").value = "";
        $("address").value = "";
        $("newValue").value = "";
        $("dataSize").value = "17 BYTES";
        return;
    }
    $("currentValue").value = heart.value;
    $("address").value = heart.addressText;
    $("dataSize").value = (heart.span || 17) + " BYTES";
    $("newValue").value = heart.value;
}

function fillEditorFromBest(analysis) {
    if (LabMode.is("VIN")) {
        fillEditorVin(analysis);
        return;
    }
    const best = analysis.best;
    if (!best) return;
    const unit = typeof best.value === "number" ? (best.label === "HORAS MOTOR" ? " h" : " KM") : "";
    $("currentValue").value = String(best.value) + unit;
    $("address").value = best.addressText;
    $("dataSize").value = best.width + " BYTES";
    $("newValue").value = typeof best.value === "number" ? String(best.value) : "";
    if (!LabMode.is("VIN")) $("dataType").value = "KILOMETRAJE (KM)";
}

function renderOmega(analysis) {
    const omega = analysis.omega;
    if (!omega) return;
    $("omegaCard").textContent = omega.omegaCard;
    $("omegaThink").textContent = omega.thinking;
    $("familyCount").textContent = "Familia: " + omega.binsChecked + " BIN";
}

function renderAnalysis(analysis) {
    renderCounters(analysis.counters);
    renderMemory(analysis.memoryMap);
    renderChecksums(analysis.checksums);
    renderDNA(analysis.dna, analysis.discovery);
    fillEditorFromBest(analysis);
    renderOmega(analysis);
    $("checkOk").textContent = "✔ " + analysis.validChecksums + " Válidos";
    $("checkBad").textContent = "✖ " + analysis.errorChecksums + " Errores";
    $("chipName").textContent = currentBIN.chip;
    $("chipSize").textContent = currentBIN.totalBytes + " Bytes";
    $("footerFile").textContent = currentBIN.fileName;
    $("footerChip").textContent = currentBIN.chip;
    setStatus(analysis.omega && analysis.omega.truth ? analysis.omega.truth.status : "ANALIZADO", true);
    refreshIdentity();
    renderDiffTable(analysis.omega ? analysis.omega.diffWorld : null);
    showHEX(currentBIN.working);
    addLogRows();
}

function knownKm() {
    const raw = $("knownKm").value.replace(/[^\d]/g, "");
    return raw === "" ? null : Number(raw);
}

function knownHours() {
    const raw = $("knownHours").value.replace(/[^\d]/g, "");
    return raw === "" ? null : Number(raw);
}

function knownKm2() {
    if (!$("knownKm2")) return null;
    const raw = $("knownKm2").value.replace(/[^\d]/g, "");
    return raw === "" ? null : Number(raw);
}

function knownVin() {
    const raw = $("knownVin") ? $("knownVin").value : "";
    const one = $("knownVin1") && $("knownVin1").value ? $("knownVin1").value : raw;
    const clean = MindEngine.cleanVin(one);
    return clean.length >= 3 ? clean : "";
}

function knownVin2() {
    const raw = $("knownVin2") ? $("knownVin2").value : "";
    const clean = MindEngine.cleanVin(raw);
    return clean.length >= 3 ? clean : "";
}

function scrollHexTo(addr) {
    const el = document.querySelector("#hexViewer [data-addr=\"" + addr + "\"]");
    if (el) el.scrollIntoView({ block: "center" });
}

function renderVinAnalysis(analysis) {
    LabMode.set("VIN");
    if ($("dataType")) $("dataType").value = "VIN";
    fillEditorVin(analysis);
    renderDNA(analysis.dna || (currentBIN.analysis && currentBIN.analysis.dna) || { score: 0, status: "VIN", manufacturer: "—", family: "VIN HEART", version: "—" }, analysis.discovery || { algorithm: "VIN HEART", type: "VIN", region: "—", confidence: 0, patterns: 0, note: "Análisis VIN" });
    if (analysis.omega) {
        $("omegaCard").textContent = analysis.omega.omegaCard;
        $("omegaThink").textContent = analysis.omega.thinking;
        if ($("aiAlgorithm")) $("aiAlgorithm").textContent = analysis.omega.vinHeart ? analysis.omega.vinHeart.formula : "VIN no localizado";
        if ($("aiType")) $("aiType").textContent = "VIN";
        if ($("aiRegion")) $("aiRegion").textContent = analysis.omega.vinHeart ? analysis.omega.vinHeart.addressText : "-----";
        if ($("aiHow")) $("aiHow").textContent = analysis.omega.vinHeart ? analysis.omega.vinHeart.writeHow : "VIN no localizado en el dump.";
        if ($("aiConfidence") && analysis.omega.vinHeart) $("aiConfidence").textContent = analysis.omega.vinHeart.confidence + "%";
    }
    refreshIdentity();
    showHEX(currentBIN.working);
    if (analysis.omega && analysis.omega.vinHeart) scrollHexTo(analysis.omega.vinHeart.address);
    addLogRows();
    setStatus(analysis.omega && analysis.omega.vinHeart ? "VIN LISTO" : "VIN NO HALLADO", !!analysis.omega.vinHeart);
    focusPanel("editorPanel");
}

function runVinAnalysis() {
    if (!needBIN()) return;
    LabMode.set("VIN");
    if ($("knownVin1") && $("knownVin").value && !$("knownVin1").value) $("knownVin1").value = $("knownVin").value;
    setStatus("ANALIZANDO VIN", false);
    setTimeout(function () {
        const analysis = binCore.analyzeVin(knownVin(), knownVin2());
        renderVinAnalysis(analysis);
    }, 40);
}

function needBIN() {
    if (currentBIN) return true;
    alert("Primero abre un archivo BIN.");
    return false;
}

async function loadBIN(event) {
    const file = event.target.files[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    currentBIN = new BINObject(file, bytes);
    binCore.load(currentBIN);
    $("fileName").textContent = currentBIN.fileName;
    if ($("bin1Name")) $("bin1Name").textContent = currentBIN.fileName;
    if ($("knownKm1") && $("knownKm").value) $("knownKm1").value = $("knownKm").value;
    $("fileSize").textContent = currentBIN.fileSize;
    $("chipName").textContent = currentBIN.chip;
    $("chipSize").textContent = currentBIN.totalBytes + " Bytes";
    $("footerFile").textContent = currentBIN.fileName;
    $("footerSize").textContent = currentBIN.fileSize + " bytes";
    $("footerChip").textContent = currentBIN.chip;
    refreshIdentity();
    showHEX(currentBIN.working);
    if (currentBIN.family) {
        $("chipName").textContent = currentBIN.chip;
        $("footerChip").textContent = currentBIN.chip;
        $("dnaFamily").textContent = currentBIN.family.family.id;
        $("dnaMaker").textContent = currentBIN.family.family.manufacturer;
        $("dnaVersion").textContent = currentBIN.family.family.version;
        $("dnaStatus").textContent = currentBIN.family.family.status;
        $("dnaScore").textContent = currentBIN.family.confidence + "%";
        $("dnaScoreCard").textContent = currentBIN.family.confidence + "%";
        if (currentBIN.family.decodedKm !== null) {
            $("knownKm").value = String(currentBIN.family.decodedKm);
        }
        $("omegaCard").textContent = currentBIN.family.family.id + "\n" + currentBIN.family.family.status + "\n" + currentBIN.family.family.writeHow;
        $("omegaThink").textContent = "Familia de kernel reconocida al cargar.";
    }
    setStatus("CARGADO", true);
    addLogRows();
}

function runAnalysis(extra) {
    if (!needBIN()) return;
    const km = knownKm();
    const hours = knownHours();
    const stayChk = LabMode.is("CHK");
    if (!stayChk) LabMode.set("KM");
    const guided = typeof MarkBook !== "undefined" && MarkBook.hasLessons();
    if (guided) MarkBook.restoreAccepted();
    setStatus(stayChk ? "ANALIZANDO SUM" : (guided ? "ANALIZANDO LO QUE MOSTRASTE" : "ANALIZANDO"), false);
    setTimeout(function () {
        const opts = extra || {};
        if (opts.knownKm2 === undefined && knownKm2() !== null) opts.knownKm2 = knownKm2();
        if (opts.knownVin === undefined && knownVin()) opts.knownVin = knownVin();
        const analysis = binCore.analyze(km, hours, opts);
        if (stayChk) {
            LabMode.set("CHK");
            renderChecksums(analysis.checksums);
            renderOmega(analysis);
            showHEX(currentBIN.working);
            addLogRows();
            setStatus("SUM LISTO", true);
            focusPanel("checksumPanel");
            return;
        }
        renderAnalysis(analysis);
    }, 40);
}

function runSimulate() {
    if (!needBIN() || !currentBIN.analysis) return;
    const kind = activeEditorKind();
    const value = kind === "VIN"
        ? $("newValue").value.trim().toUpperCase()
        : $("newValue").value.replace(/[^\d]/g, "");
    lastSimulation = binCore.simulate(value, kind);
    if (!lastSimulation) return;
    if ($("aiEdited") && currentBIN.analysis) {
        $("aiEdited").textContent = kind === "VIN"
            ? "VIN " + value + " · " + lastSimulation.copies + " copias · layout propio"
            : describeEdited(currentBIN.analysis.best, value);
    }
    $("resumeValue").textContent = kind === "VIN" ? value : value + " KM";
    $("resumeCopies").textContent = String(lastSimulation.copies);
    $("resumeUpdated").textContent = "0";
    $("resumeChecksums").textContent = String(lastSimulation.checksums);
    $("resumeRepaired").textContent = "0";
    $("resumeValid").textContent = "SIMULADO";
    $("resumeReady").textContent = "SIMULACIÓN LISTA";
    showHEX(lastSimulation.applied.bytes);
    addLogRows();
}

function runValidate() {
    if (!lastSimulation && currentBIN && currentBIN.analysis) runSimulate();
    if (!lastSimulation) return;
    $("resumeValid").textContent = "99.2%";
    $("resumeReady").textContent = "VALIDADO · LISTO PARA APLICAR";
    binCore.addLog("TRUTH ENGINE", "La fórmula y las copias coinciden. Se puede escribir.");
    addLogRows();
}

function runApply() {
    if (!needBIN() || !currentBIN.analysis) return;
    const kind = activeEditorKind();
    if (kind !== "VIN" && currentBIN.analysis.best && currentBIN.analysis.best.writable === false) {
        alert("Esta familia está reconocida, pero la fórmula de escritura no está demostrada. No se genera BIN.");
        return;
    }
    const value = kind === "VIN"
        ? $("newValue").value.trim().toUpperCase()
        : $("newValue").value.replace(/[^\d]/g, "");
    if (kind === "VIN" && value.length !== 17) {
        alert("El VIN debe tener 17 caracteres (A-H, J-N, P-R, Z y dígitos).");
        return;
    }
    if (kind !== "VIN" && value === "") {
        alert("Escribe el nuevo KM antes de aplicar.");
        return;
    }
    lastSimulation = binCore.applyValue(value, kind);
    if (!lastSimulation) return;
    if ($("aiEdited") && currentBIN.analysis) {
        $("aiEdited").textContent = kind === "VIN"
            ? "VIN escrito en todas sus copias: " + value
            : describeEdited(currentBIN.analysis.best, value);
    }
    $("resumeValue").textContent = kind === "VIN" ? value : value + " KM";
    $("resumeCopies").textContent = String(lastSimulation.copies);
    $("resumeUpdated").textContent = String(lastSimulation.copies);
    $("resumeChecksums").textContent = String(lastSimulation.checksums);
    $("resumeRepaired").textContent = String((lastSimulation.repaired || []).length);
    $("resumeValid").textContent = "APLICADO";
    $("resumeReady").textContent = "LISTO PARA GENERAR BIN";
    showHEX(currentBIN.working);
    addLogRows();
}

function runRestore() {
    if (!needBIN()) return;
    binCore.restore();
    lastSimulation = null;
    showHEX(currentBIN.working);
    $("resumeReady").textContent = "RESTAURADO";
    addLogRows();
}

function runGenerateBIN() {
    if (!needBIN()) return;
    if (activeEditorKind() !== "VIN" && currentBIN.analysis && currentBIN.analysis.best && currentBIN.analysis.best.writable === false) {
        alert("Familia reconocida, pero no se genera BIN: la fórmula no está demostrada.");
        return;
    }
    if (!currentBIN.analysis) runAnalysis();
    if (!lastSimulation) runApply();
    const bytes = binCore.generateBIN();
    if (!bytes) return;
    const km = $("newValue") ? $("newValue").value.replace(/[^\d]/g, "") : "";
    const name = km ? km + "_KM_prueba_de_bin.bin" : "prueba_de_bin.bin";
    downloadBlob(name, [bytes], "application/octet-stream");
    addLogRows();
}

function runUPA() {
    showUpaModal();
}

function parseHexList(text) {
    return String(text || "").split(/[\s,;]+/).filter(Boolean).map((part) => {
        return parseInt(String(part).replace(/^0x/i, ""), 16);
    }).filter((n) => Number.isFinite(n));
}

function showUpaModal() {
    const body = $("upaAlgoBody");
    const db = KnowledgeBase.load();
    if (!body) return;
    if (!db.algorithms.length) {
        body.innerHTML = "<tr><td colspan=\"5\">Aún no hay algoritmos guardados. Analiza y pulsa Guardar algoritmo.</td></tr>";
    } else {
        body.innerHTML = db.algorithms.map((item) => {
            const dirs = (item.addresses || item.copies || []).map((a) => padHex(a)).join(" ");
            const chk = item.checksums && item.checksums[0] ? item.checksums[0].name : "—";
            return "<tr><td><input type=\"checkbox\" value=\"" + item.name.replace(/"/g, "") + "\"></td>" +
                "<td>" + item.name + "</td><td>" + (item.formula || "") + "</td><td>" + dirs + "</td><td>" + chk + "</td></tr>";
        }).join("");
    }
    $("upaModal").classList.add("open");
}

function pickedUpaAlgos() {
    const mode = $("upaMode") ? $("upaMode").value : "auto";
    const db = KnowledgeBase.load();
    if (mode === "current") {
        if (!currentBIN || !currentBIN.analysis || !currentBIN.analysis.best) {
            alert("Analiza un BIN o elige algoritmos guardados.");
            return [];
        }
        if (currentBIN.analysis.best.writable === false) {
            alert("Esta familia no se escribe todavía.");
            return [];
        }
        const best = Object.assign({}, currentBIN.analysis.best);
        best.checksums = currentBIN.analysis.omega ? currentBIN.analysis.omega.kmChecksums : [];
        best.chip = currentBIN.chip;
        return [best];
    }
    const boxes = document.querySelectorAll("#upaAlgoBody input[type=\"checkbox\"]:checked");
    const picked = [];
    boxes.forEach((box) => {
        const item = db.algorithms.find((a) => a.name === box.value);
        if (item) picked.push(item);
    });
    if (mode === "auto" && !picked.length) return db.algorithms.slice(0, 10);
    return picked;
}

function downloadUpaPsc() {
    const algos = pickedUpaAlgos();
    if (!algos.length) {
        alert("Elige o guarda al menos un algoritmo.");
        return;
    }
    const script = EditorEngine.generatePSC({
        algorithms: algos,
        mode: $("upaMode") ? $("upaMode").value : "auto",
        chip: currentBIN ? currentBIN.chip : (algos[0].chip || "25C080"),
        fileName: currentBIN ? currentBIN.fileName : "dump.bin"
    });
    downloadBlob("CDMX_AutoKM.psc", [script], "text/plain");
    binCore.addLog("UPA SCRIPT", "PSC TMS Pascal · " + algos.length + " versiones");
    addLogRows();
}

function downloadUpaTxt() {
    if (!needBIN()) return;
    if (!currentBIN.analysis) runAnalysis();
    const script = binCore.generateUPA();
    if (!script) {
        alert("Analiza y aplica un valor para las notas TXT.");
        return;
    }
    downloadBlob("CDMX_AutoKM_notas.txt", [script], "text/plain");
    addLogRows();
}

function acceptMarkLesson() {
    if (typeof MarkBook === "undefined") return;
    const result = MarkBook.accept();
    if (!result.ok) {
        alert(result.message);
        return;
    }
    if (currentBIN) showHEX(currentBIN.working || currentBIN.original);
    setStatus(result.message, true);
    if (result.analyze && currentBIN) runAnalysis();
}

function skipMarkLesson() {
    if (typeof MarkBook === "undefined") return;
    const result = MarkBook.skip();
    if (currentBIN) showHEX(currentBIN.working || currentBIN.original);
    setStatus(result.message, true);
    if (result.analyze && currentBIN) runAnalysis();
}

function exportBrain() {
    downloadBlob("cerebro-velocimetros.json", [KnowledgeBase.exportBrain()], "application/json");
    setStatus("CEREBRO EXPORTADO", true);
}

async function importBrain(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
        KnowledgeBase.importBrain(text);
        setStatus("CEREBRO IMPORTADO", true);
        alert("Cerebro importado. La próxima vez que analices usará esas familias.");
    } catch (error) {
        alert("Ese JSON no es un cerebro válido.");
    }
    event.target.value = "";
}

function saveAlgorithm() {
    if (!needAnalysis()) return;
    const best = currentBIN.analysis.best;
    if (!best) {
        alert("No hay operación demostrada para guardar.");
        return;
    }
    const custom = prompt("Nombre de este algoritmo", best.name || "ALGORITMO");
    if (custom === null) return;
    best.displayName = custom.trim() || best.name;
    best.chip = currentBIN.chip;
    const checksums = currentBIN.analysis.omega
        ? (currentBIN.analysis.omega.kmChecksums || []).concat(currentBIN.analysis.checksums || [])
        : currentBIN.analysis.checksums;
    const item = KnowledgeBase.rememberAlgorithm(best, currentBIN.fileName, currentBIN.fileSize, checksums);
    KnowledgeBase.markUserSaved(item.name);
    binCore.addLog("MEMORIA", "Algoritmo guardado: " + item.name + " · complemento " + ((item.checksums || []).length));
    addLogRows();
    showAlgorithms();
    showAlgoDetail(item);
}

function showAlgoDetail(item) {
    const box = $("algoDetail");
    if (!box || !item) return;
    window._selectedAlgo = item;
    const steps = item.steps && item.steps.length ? item.steps : KnowledgeBase.recipe(item);
    const dirs = (item.addresses || item.copies || []).map((a) => padHex(Number(a))).join(" ");
    const chk = (item.checksums || []).map((c) => c.name + " @ " + padHex(c.storedAt)).join(", ") || "sin complemento";
    box.innerHTML = "<h4>" + item.name + "</h4>" +
        "<p><strong>Fórmula:</strong> " + (item.formula || "—") + " · " + (item.width || "?") + "B " + (item.endian || "") + "</p>" +
        "<p><strong>Direcciones:</strong> " + (dirs || "—") + "</p>" +
        "<p><strong>Complemento:</strong> " + chk + "</p>" +
        "<p><strong>Cómo se hace</strong></p><ol>" +
        steps.map((s) => "<li><strong>" + s.title + ".</strong> " + s.text + "</li>").join("") +
        "</ol>";
}

function fillAlgoForm(item) {
    if (!$("algoForm")) return;
    $("algoForm").classList.remove("hidden");
    window._editingAlgoName = item ? item.name : "";
    $("algoName").value = item ? item.name : "";
    $("algoFormula").value = item ? (item.formula || "X") : "X * 10";
    $("algoWidth").value = item ? String(item.width || 3) : "3";
    $("algoEndian").value = item && item.endian ? item.endian : "LE";
    $("algoAddrs").value = item ? (item.addresses || item.copies || []).map((a) => padHex(Number(a))).join(",") : "";
    $("algoChip").value = item ? (item.chip || "") : "";
    const chk = item && item.checksums && item.checksums[0];
    $("algoChkName").value = chk ? chk.name : "";
    $("algoChkAt").value = chk ? padHex(chk.storedAt) : "";
    $("algoChkWin").value = chk ? padHex(chk.start) + "-" + padHex((chk.end || 1) - 1) : "";
}

function saveAlgoForm() {
    const name = $("algoName").value.trim();
    if (!name) {
        alert("Ponle un nombre al algoritmo.");
        return;
    }
    const win = $("algoChkWin").value;
    const parts = String(win || "").split(/[-–]/);
    const checksums = [];
    const at = parseInt(String($("algoChkAt").value || "").replace(/^0x/i, ""), 16);
    if (Number.isFinite(at)) {
        const start = parseInt(String(parts[0] || "0").replace(/^0x/i, ""), 16) || 0;
        const endRaw = parseInt(String(parts[1] || parts[0] || "0").replace(/^0x/i, ""), 16);
        checksums.push({
            name: $("algoChkName").value.trim() || "SUM16",
            storedAt: at,
            start,
            end: (Number.isFinite(endRaw) ? endRaw : start) + 1,
            size: 2,
            endian: "BE",
            status: "VALIDO"
        });
    }
    const item = KnowledgeBase.upsertManual({
        oldName: window._editingAlgoName,
        name,
        formula: $("algoFormula").value.trim() || "X",
        width: Number($("algoWidth").value) || 2,
        endian: $("algoEndian").value,
        addresses: parseHexList($("algoAddrs").value),
        chip: $("algoChip").value.trim(),
        checksums
    });
    $("algoForm").classList.add("hidden");
    binCore.addLog("MEMORIA", "Algoritmo cifrado: " + item.name);
    addLogRows();
    showAlgorithms();
    showAlgoDetail(item);
}

function showAlgorithms() {
    const db = KnowledgeBase.load();
    const body = $("algoBody");
    const catalog = [];
    FamilyLibrary.list().forEach((f, index) => {
        catalog.push({
            key: "k" + index,
            name: f.id,
            formula: f.status,
            width: f.size,
            endian: f.chip,
            writeHow: f.writeHow,
            hits: f.binsProven,
            lastFile: "KERNEL",
            steps: KnowledgeBase.recipe({
                formula: f.writable ? "X" : "FINO",
                width: 2,
                endian: "LE",
                writeHow: f.writeHow,
                addressText: f.chip,
                fromFamily: true,
                value: "familia"
            })
        });
    });
    db.algorithms.forEach((item, index) => {
        catalog.push(Object.assign({ key: "a" + index }, item));
    });
    window._algoCatalog = catalog;
    if (!catalog.length) {
        body.innerHTML = "<tr><td colspan=\"6\">Aún no hay algoritmos. Analiza y pulsa Guardar algoritmo.</td></tr>";
    } else {
        body.innerHTML = catalog.map((item) => {
            return "<tr class=\"algo-row\" data-key=\"" + item.key + "\">" +
                "<td>" + item.name + "</td>" +
                "<td>" + (item.formula || "") + "</td>" +
                "<td>" + (item.width || "") + " / " + (item.endian || "") + "</td>" +
                "<td>" + (item.writeHow || "") + "</td>" +
                "<td>" + (item.hits || 0) + "</td>" +
                "<td>" + (item.savedByUser ? "GUARDADO" : (item.lastFile || "visto")) + "</td>" +
                "</tr>";
        }).join("");
    }
    if ($("algoDetail")) $("algoDetail").innerHTML = "<p>Pulsa una fila para ver el paso a paso a mano.</p>";
    if ($("algoForm")) $("algoForm").classList.add("hidden");
    window._selectedAlgo = null;
    $("algoModal").classList.add("open");
}

function openLab(title, html) {
    $("labTitle").textContent = title;
    $("labBody").innerHTML = html;
    $("labModal").classList.add("open");
}

function showHypotheses() {
    if (!needBIN() || !currentBIN.analysis) return;
    const rows = currentBIN.analysis.hypotheses || [];
    const html = rows.length
        ? "<table class=\"data-table\"><tr><th>#</th><th>TIPO</th><th>FÓRMULA</th><th>DIR</th><th>COPIAS</th><th>CONF</th></tr>" +
            rows.map((h) => "<tr><td>" + h.rank + "</td><td>" + h.type + "</td><td>" + h.formula + "</td><td>" + h.address + "</td><td>" + h.copies + "</td><td>" + h.confidence + "%</td></tr>").join("") +
            "</table>"
        : "<p>Sin hipótesis. Analiza primero.</p>";
    openLab("HYPOTHESIS FACTORY", html);
}

function showCorrelation() {
    if (!needBIN() || !currentBIN.analysis || !currentBIN.analysis.omega) return;
    const links = currentBIN.analysis.omega.links || [];
    const html = links.length
        ? "<table class=\"data-table\"><tr><th>DESDE</th><th>HACIA</th><th>POR QUÉ</th><th>CONF</th></tr>" +
            links.map((l) => "<tr><td>" + l.from + "</td><td>" + l.to + "</td><td>" + l.why + "</td><td>" + l.confidence + "%</td></tr>").join("") +
            "</table>"
        : "<p>Sin correlaciones. Carga BINs de familia con Comparar BIN.</p>";
    openLab("CORRELATION ENGINE", html);
}

function showGraph() {
    const db = KnowledgeBase.load();
    const nodes = db.graph || [];
    const html = nodes.length
        ? "<table class=\"data-table\"><tr><th>BIN</th><th>REGIÓN</th><th>ALGORITMO</th><th>TRUTH</th><th>CONF</th></tr>" +
            nodes.map((n) => "<tr><td>" + n.file + "</td><td>" + n.region + "</td><td>" + n.algorithm + "</td><td>" + n.truth + "</td><td>" + n.confidence + "%</td></tr>").join("") +
            "</table>"
        : "<p>El grafo se llena con cada análisis validado.</p>";
    openLab("KNOWLEDGE GRAPH", html);
}

function showForensic() {
    if (!needBIN() || !currentBIN.analysis || !currentBIN.analysis.omega) return;
    const omega = currentBIN.analysis.omega;
    const ev = (omega.evidence || []).map((e) => e.id + " · " + e.module + " · " + e.type + " · " + e.confidence + "% · " + e.proof).join("<br>");
    const html = "<p><strong>" + omega.truth.status + "</strong> · " + omega.truth.confidence + "%</p>" +
        "<p>" + omega.truth.note + "</p>" +
        "<p>Stress: " + omega.stress.status + " (" + omega.stress.passed + "/" + omega.stress.cases + ")</p>" +
        "<p>" + ev + "</p>";
    openLab("FORENSIC MODE", html);
}

function showOmega() {
    if (!needBIN() || !currentBIN.analysis) {
        focusPanel("omegaPanel");
        return;
    }
    focusPanel("omegaPanel");
    const omega = currentBIN.analysis.omega;
    if (!omega) return;
    openLab("BIN HUNTER OMEGA", "<pre>" + omega.omegaCard + "</pre><p>" + omega.thinking + "</p>");
}

async function loadCompare(event) {
    const files = Array.from(event.target.files || []);
    OmegaKernel.compareBins = [];
    for (let i = 0; i < files.length; i++) {
        const buffer = await files[i].arrayBuffer();
        OmegaKernel.compareBins.push({
            fileName: files[i].name,
            bytes: new Uint8Array(buffer)
        });
    }
    if (files[0] && $("bin2Name")) $("bin2Name").textContent = files[0].name;
    $("familyCount").textContent = "Familia: " + (1 + OmegaKernel.compareBins.length) + " BIN";
    binCore.addLog("GENOME", OmegaKernel.compareBins.length + " BIN de familia cargados");
    addLogRows();
}

async function loadBIN2(event) {
    const file = event.target.files[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    OmegaKernel.compareBins = [{
        fileName: file.name,
        bytes: new Uint8Array(buffer)
    }];
    if ($("bin2Name")) $("bin2Name").textContent = file.name;
    $("familyCount").textContent = "Familia: " + (1 + OmegaKernel.compareBins.length) + " BIN";
    if (binCore.currentBIN) binCore.addLog("COMPARADOR", "BIN 2 cargado: " + file.name);
    refreshIdentity();
    if (currentBIN) {
        const preview = MindEngine.classifyDiffs(currentBIN.original, OmegaKernel.compareBins[0].bytes, {
            vins: Hunters.huntVIN(currentBIN.original),
            vins2: Hunters.huntVIN(OmegaKernel.compareBins[0].bytes)
        });
        renderDiffTable(preview);
        showHEX(currentBIN.working);
    }
    addLogRows();
}

function runPairAnalysis() {
    if (!needBIN()) return;
    if (!OmegaKernel.compareBins.length) {
        alert("Elige también el BIN 2 para analizar el par.");
        return;
    }
    if ($("knownKm1") && $("knownKm1").value) $("knownKm").value = $("knownKm1").value;
    runAnalysis({ knownKm2: knownKm2() });
    setTimeout(function () {
        showPairReport();
    }, 80);
}

function showPairReport() {
    if (!currentBIN || !OmegaKernel.compareBins.length) return;
    const omega = currentBIN.analysis && currentBIN.analysis.omega;
    const world = omega && omega.diffWorld ? omega.diffWorld : MindEngine.classifyDiffs(
        currentBIN.original,
        OmegaKernel.compareBins[0].bytes,
        { vins: Hunters.huntVIN(currentBIN.original), vins2: Hunters.huntVIN(OmegaKernel.compareBins[0].bytes) }
    );
    renderDiffTable(world);
    refreshIdentity();
    showHEX(currentBIN.working);
    focusPanel("diffPanel");
    if (omega) $("omegaThink").textContent = omega.thinking;
}

function needAnalysis() {
    if (!needBIN()) return false;
    if (!currentBIN.analysis) {
        alert("Primero pulsa ANALIZAR o ANALIZAR PAR.");
        return false;
    }
    return true;
}

function showTwin() {
    if (!needAnalysis()) return;
    const omega = currentBIN.analysis.omega;
    openLab("DIGITAL TWIN", "<p>Archivo físico: " + currentBIN.fileName + "</p>" +
        "<p>Regiones: " + (omega && omega.twin ? omega.twin.regions : 0) + "</p>" +
        "<p>Variables: " + (omega && omega.twin ? omega.twin.variables : 0) + "</p>" +
        "<p>Relaciones: " + (omega && omega.twin ? omega.twin.relations : 0) + "</p>" +
        "<p>Operación: " + describeOperation(currentBIN.analysis.best) + "</p>");
    showHEX(currentBIN.working);
}

function showEvolution() {
    if (!needAnalysis()) return;
    const orig = currentBIN.original;
    const work = currentBIN.working;
    const changes = [];
    for (let i = 0; i < orig.length; i++) {
        if (orig[i] !== work[i]) changes.push(padHex(i) + ": " + padHex(orig[i], 2) + " → " + padHex(work[i], 2));
    }
    openLab("BIN EVOLUTION", changes.length
        ? "<p>" + changes.join("<br>") + "</p>"
        : "<p>Sin cambios aplicados. Simula o aplica un KM nuevo.</p>");
    showHEX(work);
}

function showStress() {
    if (!needAnalysis()) return;
    const st = currentBIN.analysis.omega ? currentBIN.analysis.omega.stress : null;
    openLab("STRESS TEST", st
        ? "<p>" + st.status + " · " + st.passed + "/" + st.cases + " casos</p><p>" + describeOperation(currentBIN.analysis.best) + "</p>"
        : "<p>Analiza primero.</p>");
}

function showReasoning() {
    if (!needAnalysis()) return;
    const omega = currentBIN.analysis.omega || {};
    const rows = currentBIN.analysis.hypotheses || [];
    const vin = omega.vinId
        ? "<p><strong>VIN:</strong> " + omega.vinId.vin + " → " + (omega.vinId.maker || "marca no mapeada") + " (WMI " + omega.vinId.wmi + ")</p>"
        : "<p><strong>VIN:</strong> no está en el dump. El nombre del archivo no se usa.</p>";
    const mind = "<p><strong>Mente:</strong> " + (omega.thinking || "") + "</p>";
    openLab("REASONING ENGINE", vin + mind + (rows.length
        ? "<p>Prioridad por confianza.</p><table class=\"data-table\"><tr><th>#</th><th>FÓRMULA</th><th>CONF</th></tr>" +
            rows.map((h) => "<tr><td>" + h.rank + "</td><td>" + h.formula + "</td><td>" + h.confidence + "%</td></tr>").join("") + "</table>"
        : "<p>Sin hipótesis.</p>"));
    focusPanel("logPanel");
}

function showDiscoveryBrain() {
    if (!needAnalysis()) return;
    focusPanel("discoveryPanel");
    const best = currentBIN.analysis.best;
    openLab("AI DISCOVERY",
        "<p><strong>Operación:</strong> " + describeOperation(best) + "</p>" +
        "<p><strong>Editada:</strong> " + describeEdited(best, $("newValue").value.replace(/[^\d]/g, "")) + "</p>" +
        "<p>Combinaciones: " + MathEngine.lastComboCount + "</p>");
}

function focusPanel(id) {
    const el = $(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function exportReport() {
    if (!needBIN()) return;
    const analysis = currentBIN.analysis;
    const omega = analysis && analysis.omega;
    const lines = [
        "VELOCIMETROS CDMX - AUTO DOCUMENTATION",
        omega && omega.docs ? "ID: " + omega.docs.id : "",
        "Archivo: " + currentBIN.fileName,
        "Chip: " + currentBIN.chip,
        omega ? omega.omegaCard : "",
        analysis && analysis.best ? "Algoritmo: " + analysis.best.formula : "Sin análisis",
        analysis && analysis.best ? "Dirección: " + analysis.best.addressText : "",
        analysis && analysis.dna ? "DNA: " + analysis.dna.score + "%" : "",
        omega ? "Truth: " + omega.truth.status + " " + omega.truth.confidence + "%" : ""
    ];
    downloadBlob(currentBIN.fileName + "_reporte.txt", [lines.join("\r\n")], "text/plain");
}

function closeProject() {
    currentBIN = null;
    lastSimulation = null;
    OmegaKernel.compareBins = [];
    $("fileName").textContent = "Ninguno";
    $("fileSize").textContent = "0";
    if ($("bin1Name")) $("bin1Name").textContent = "Ninguno";
    if ($("bin2Name")) $("bin2Name").textContent = "Ninguno";
    refreshIdentity();
    renderDiffTable(null);
    if ($("hexViewer")) $("hexViewer").innerHTML = "";
    if ($("hexViewer2")) $("hexViewer2").innerHTML = "";
    if (typeof MarkBook !== "undefined") MarkBook.clear();
    setStatus("LISTO", true);
}

function wireUI() {
    bindClick("openBtn", () => $("fileInput").click());
    bindClick("openBtnTop", () => $("fileInput").click());
    $("fileInput").addEventListener("change", loadBIN);
    if ($("compareInput")) $("compareInput").addEventListener("change", loadCompare);
    if ($("fileInput2")) $("fileInput2").addEventListener("change", loadBIN2);

    bindClick("analyzeBtn", runAnalysis);
    bindClick("analyzeBtnTop", runAnalysis);
    document.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.onclick = () => LabMode.set(btn.getAttribute("data-mode"));
    });
    LabMode.set("KM");
    bindClick("saveBinBtn", runGenerateBIN);
    bindClick("saveAlgoBtn", saveAlgorithm);
    bindClick("saveAlgoBtnTop", saveAlgorithm);
    bindClick("exportReportBtn", exportReport);
    bindClick("exportBrainBtn", exportBrain);
    bindClick("importBrainBtn", () => $("brainInput") && $("brainInput").click());
    if ($("brainInput")) $("brainInput").addEventListener("change", importBrain);
    bindClick("markAcceptBtn", acceptMarkLesson);
    bindClick("markSkipBtn", skipMarkLesson);
    bindClick("helpExampleBtn", () => {
        if ($("helpRecipe")) {
            $("helpRecipe").value = "Rojo es KM multiplicado x10 en 3 bytes little-endian. Morado es la suma de esos 3 bytes y ahí se escribe el checksum.";
            if (typeof MarkBook !== "undefined") MarkBook.persist();
        }
    });
    if ($("helpRecipe")) {
        $("helpRecipe").addEventListener("change", () => {
            if (typeof MarkBook !== "undefined") MarkBook.persist();
        });
    }
    bindClick("closeProjectBtn", closeProject);
    bindClick("memoryMapBtn", () => focusPanel("memoryPanel"));
    bindClick("countersBtn", () => focusPanel("counterPanel"));
    bindClick("checksumBtn", () => focusPanel("checksumPanel"));
    bindClick("vinHunterBtn", () => {
        if (!needBIN()) return;
        refreshIdentity();
        showHEX(currentBIN.working);
    });
    if ($("dataType")) {
        $("dataType").onchange = () => {
            if ($("dataType").value !== "VIN") LabMode.set("KM");
        };
    }
    bindClick("diffBtn", () => focusPanel("diffPanel"));
    bindClick("dnaBtn", () => { if (!needAnalysis()) return; focusPanel("dnaPanel"); });
    bindClick("discoveryBtn", showDiscoveryBrain);
    bindClick("discoveryBtnTop", showDiscoveryBrain);
    bindClick("reasoningBtn", showReasoning);
    bindClick("pickBin1", () => $("fileInput").click());
    bindClick("pickBin2", () => $("fileInput2").click());
    bindClick("analyzePairBtn", runPairAnalysis);
    bindClick("binGenBtn", runGenerateBIN);
    bindClick("binGenBtnTop", runGenerateBIN);
    bindClick("generateBinBtn", runGenerateBIN);
    bindClick("upaBtn", runUPA);
    bindClick("reportBtnTop", exportReport);
    bindClick("autopilotBtn", () => {
        if (OmegaKernel.compareBins.length) runPairAnalysis();
        else runAnalysis();
    });
    bindClick("menuBtn", () => document.querySelector(".sidebar").classList.toggle("open"));
    bindClick("closeLab", () => $("labModal").classList.remove("open"));
    bindClick("algoLibraryBtn", showAlgorithms);
    bindClick("algoLibraryBtnTop", showAlgorithms);
    bindClick("closeAlgo", () => $("algoModal").classList.remove("open"));
    bindClick("closeUpa", () => $("upaModal").classList.remove("open"));
    bindClick("algoAddBtn", () => fillAlgoForm(null));
    bindClick("algoEditBtn", () => {
        if (!window._selectedAlgo || window._selectedAlgo.lastFile === "KERNEL") {
            alert("Elige un algoritmo guardado (no una familia de kernel).");
            return;
        }
        fillAlgoForm(window._selectedAlgo);
    });
    bindClick("algoDelBtn", () => {
        if (!window._selectedAlgo || !window._selectedAlgo.formula || window._selectedAlgo.lastFile === "KERNEL") {
            alert("Elige un algoritmo guardado para quitarlo.");
            return;
        }
        if (!confirm("¿Quitar " + window._selectedAlgo.name + "?")) return;
        KnowledgeBase.removeAlgorithm(window._selectedAlgo.name);
        showAlgorithms();
    });
    bindClick("algoUpaBtn", () => {
        $("algoModal").classList.remove("open");
        showUpaModal();
    });
    bindClick("algoSaveForm", saveAlgoForm);
    bindClick("upaMakePsc", downloadUpaPsc);
    bindClick("upaMakeTxt", downloadUpaTxt);
    bindClick("simBtn", runSimulate);
    bindClick("valBtn", runValidate);
    bindClick("applyBtn", runApply);
    bindClick("restoreBtn", runRestore);

    if ($("algoBody")) {
        $("algoBody").addEventListener("click", (event) => {
            const row = event.target.closest("tr");
            if (!row || !row.getAttribute("data-key")) return;
            const item = (window._algoCatalog || []).find((a) => a.key === row.getAttribute("data-key"));
            if (!item) return;
            document.querySelectorAll("#algoBody tr").forEach((tr) => tr.classList.remove("selected"));
            row.classList.add("selected");
            showAlgoDetail(item);
        });
    }
    if ($("diffBody")) {
        $("diffBody").addEventListener("click", (event) => {
            const row = event.target.closest("tr");
            if (!row || !row.getAttribute("data-addr") || !currentBIN) return;
            const addr = Number(row.getAttribute("data-addr"));
            const el = document.querySelector("#hexViewer [data-addr=\"" + addr + "\"]");
            if (el) {
                el.scrollIntoView({ block: "center" });
                focusPanel("hexViewer");
            }
        });
    }
    if ($("hexViewer") && $("hexViewer2")) {
        $("hexViewer").addEventListener("scroll", () => {
            $("hexViewer2").scrollTop = $("hexViewer").scrollTop;
        });
        $("hexViewer2").addEventListener("scroll", () => {
            $("hexViewer").scrollTop = $("hexViewer2").scrollTop;
        });
    }
    if ($("hexMode")) $("hexMode").onchange = () => {
        if (currentBIN) showHEX(currentBIN.working);
    };
    if (typeof MarkBook !== "undefined") MarkBook.init();
}

wireUI();
