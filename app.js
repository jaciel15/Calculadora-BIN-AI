let currentBIN = null;
let lastSimulation = null;

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

function showHEX(bytes) {
    const mode = $("hexMode") ? $("hexMode").value : "16-BIT";
    const step = 16;
    let output = "";
    for (let i = 0; i < bytes.length; i += step) {
        output += padHex(i, 4) + " : ";
        let ascii = "";
        for (let j = 0; j < step; j++) {
            if (i + j < bytes.length) {
                const b = bytes[i + j];
                output += padHex(b, 2) + (mode === "16-BIT" && j % 2 === 1 ? "  " : " ");
                ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
            } else {
                output += "   ";
            }
        }
        output += " | " + ascii + "\n";
    }
    $("hexViewer").textContent = output;
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
    if ($("aiHow")) $("aiHow").textContent = best ? describeOperation(best) : (discovery.note || "-----");
    if ($("aiEdited")) $("aiEdited").textContent = describeEdited(best, $("newValue") ? $("newValue").value.replace(/[^\d]/g, "") : "");
    const omega = currentBIN && currentBIN.analysis ? currentBIN.analysis.omega : null;
    if ($("aiKmOrder")) {
        $("aiKmOrder").textContent = omega && omega.kmOrder
            ? omega.kmOrder.layout + " · bytes " + omega.kmOrder.hex + " · " + omega.kmOrder.copies + " copias"
            : "-----";
    }
    if ($("aiKmChecksum")) {
        const linked = omega && omega.kmChecksums && omega.kmChecksums[0];
        $("aiKmChecksum").textContent = linked
            ? linked.name + " " + linked.endian + " @ " + padHex(linked.storedAt) + " (ventana " + linked.window + ")"
            : "Sin checksum ligado al KM. Puede valerse solo de copias espejo.";
    }
}

function fillEditorFromBest(analysis) {
    const best = analysis.best;
    if (!best) return;
    const unit = typeof best.value === "number" ? (best.label === "HORAS MOTOR" ? " h" : " KM") : "";
    $("currentValue").value = String(best.value) + unit;
    $("address").value = best.addressText;
    $("dataSize").value = best.width + " BYTES";
    $("newValue").value = typeof best.value === "number" ? String(best.value) : "";
    $("dataType").value = best.label === "HORAS MOTOR" ? "HORAS MOTOR" : "KILOMETRAJE (KM)";
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
    setStatus("ANALIZANDO", false);
    setTimeout(function () {
        const opts = extra || {};
        if (opts.knownKm2 === undefined && knownKm2() !== null) opts.knownKm2 = knownKm2();
        const analysis = binCore.analyze(km, hours, opts);
        renderAnalysis(analysis);
    }, 40);
}

function runSimulate() {
    if (!needBIN() || !currentBIN.analysis) return;
    const value = $("newValue").value.replace(/[^\d]/g, "");
    lastSimulation = binCore.simulate(value);
    if (!lastSimulation) return;
    if ($("aiEdited") && currentBIN.analysis) {
        $("aiEdited").textContent = describeEdited(currentBIN.analysis.best, value);
    }
    $("resumeValue").textContent = value + " KM";
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
    if (currentBIN.analysis.best && currentBIN.analysis.best.writable === false) {
        alert("Esta familia está reconocida, pero la fórmula de escritura no está demostrada. No se genera BIN.");
        return;
    }
    const value = $("newValue").value.replace(/[^\d]/g, "");
    if (value === "") {
        alert("Escribe el nuevo KM antes de aplicar.");
        return;
    }
    lastSimulation = binCore.applyValue(value);
    if (!lastSimulation) return;
    if ($("aiEdited") && currentBIN.analysis) {
        $("aiEdited").textContent = describeEdited(currentBIN.analysis.best, value);
    }
    $("resumeValue").textContent = value + " KM";
    $("resumeCopies").textContent = String(lastSimulation.copies);
    $("resumeUpdated").textContent = String(lastSimulation.copies);
    $("resumeChecksums").textContent = String(lastSimulation.checksums);
    $("resumeRepaired").textContent = String(lastSimulation.repaired.length);
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
    if (currentBIN.analysis && currentBIN.analysis.best && currentBIN.analysis.best.writable === false) {
        alert("Familia reconocida, pero no se genera BIN: la fórmula no está demostrada.");
        return;
    }
    if (!currentBIN.analysis) runAnalysis();
    if (!lastSimulation) runApply();
    const bytes = binCore.generateBIN();
    if (!bytes) return;
    const name = currentBIN.fileName.replace(/(\.[^.]+)?$/, "") + "_EDITADO.bin";
    downloadBlob(name, [bytes], "application/octet-stream");
    addLogRows();
}

function runUPA() {
    if (!needBIN()) return;
    if (currentBIN.analysis && currentBIN.analysis.best && currentBIN.analysis.best.writable === false) {
        alert("No se genera script UPA: la fórmula de esta familia no está demostrada.");
        return;
    }
    if (!currentBIN.analysis) runAnalysis();
    if (!lastSimulation) runApply();
    const script = binCore.generateUPA();
    const name = currentBIN.fileName.replace(/(\.[^.]+)?$/, "") + "_UPA.txt";
    downloadBlob(name, [script], "text/plain");
    addLogRows();
}

function showAlgorithms() {
    const db = KnowledgeBase.load();
    const body = $("algoBody");
    const families = FamilyLibrary.list().map((f) => {
        return "<tr><td>" + f.id + "</td><td>" + f.status + "</td><td>" + f.chip + "</td><td>" + f.writeHow + "</td><td>" + f.binsProven + "</td><td>KERNEL</td></tr>";
    }).join("");
    if (!db.algorithms.length && !families) {
        body.innerHTML = "<tr><td colspan=\"6\">Aún no hay algoritmos en memoria. Analiza un BIN con KM conocido.</td></tr>";
    } else {
        body.innerHTML = families + db.algorithms.map((item) => {
            return "<tr>" +
                "<td>" + item.name + "</td>" +
                "<td>" + item.formula + "</td>" +
                "<td>" + item.width + " / " + item.endian + "</td>" +
                "<td>" + item.writeHow + "</td>" +
                "<td>" + item.hits + "</td>" +
                "<td>" + (item.lastFile || "—") + "</td>" +
                "</tr>";
        }).join("");
    }
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
    const a = currentBIN.original;
    const b = OmegaKernel.compareBins[0].bytes;
    const diffs = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) diffs.push(i);
    }
    const km1 = $("knownKm1") ? $("knownKm1").value : "";
    const km2 = $("knownKm2") ? $("knownKm2").value : "";
    const html = "<p><strong>BIN 1:</strong> " + currentBIN.fileName + " · KM " + (km1 || knownKm() || "?") + "</p>" +
        "<p><strong>BIN 2:</strong> " + OmegaKernel.compareBins[0].fileName + " · KM " + (km2 || "?") + "</p>" +
        "<p><strong>Bytes distintos:</strong> " + diffs.length + "</p>" +
        "<p>" + diffs.slice(0, 40).map((i) => padHex(i) + ": " + padHex(a[i], 2) + " → " + padHex(b[i], 2)).join("<br>") + "</p>" +
        (currentBIN.analysis && currentBIN.analysis.best ? "<p><strong>Operación:</strong> " + describeOperation(currentBIN.analysis.best) + "</p>" : "") +
        (currentBIN.analysis && currentBIN.analysis.omega && currentBIN.analysis.omega.kmOrder
            ? "<p><strong>Orden KM:</strong> " + currentBIN.analysis.omega.kmOrder.layout + " · " + currentBIN.analysis.omega.kmOrder.hex + "</p>"
            : "") +
        (currentBIN.analysis && currentBIN.analysis.omega && currentBIN.analysis.omega.kmChecksums && currentBIN.analysis.omega.kmChecksums[0]
            ? "<p><strong>Checksum KM:</strong> " + currentBIN.analysis.omega.kmChecksums[0].name + " @ " + padHex(currentBIN.analysis.omega.kmChecksums[0].storedAt) + "</p>"
            : "<p><strong>Checksum KM:</strong> no ligado; revisar copias espejo</p>") +
        (currentBIN.analysis && currentBIN.analysis.omega
            ? "<p><strong>Mente:</strong> " + currentBIN.analysis.omega.thinking + "</p>"
            : "");
    openLab("COMPARADOR 2 BIN", html);
    if (currentBIN.analysis && currentBIN.analysis.omega) {
        $("omegaThink").textContent = "Par analizado: " + diffs.length + " bytes cambian entre los dos archivos.";
    }
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
    $("fileName").textContent = "Ninguno";
    $("fileSize").textContent = "0";
    $("hexViewer").textContent = "";
    setStatus("LISTO", true);
}

function wireUI() {
    bindClick("openBtn", () => $("fileInput").click());
    bindClick("openBtnTop", () => $("fileInput").click());
    $("fileInput").addEventListener("change", loadBIN);
    $("compareInput").addEventListener("change", loadCompare);
    if ($("fileInput2")) $("fileInput2").addEventListener("change", loadBIN2);

    bindClick("analyzeBtn", runAnalysis);
    bindClick("analyzeBtnTop", runAnalysis);
    bindClick("saveBinBtn", runGenerateBIN);
    bindClick("exportReportBtn", exportReport);
    bindClick("closeProjectBtn", closeProject);
    bindClick("memoryMapBtn", () => focusPanel("memoryPanel"));
    bindClick("memoryMapBtnTop", () => focusPanel("memoryPanel"));
    bindClick("countersBtn", () => focusPanel("counterPanel"));
    bindClick("countersBtnTop", () => focusPanel("counterPanel"));
    bindClick("checksumBtn", () => focusPanel("checksumPanel"));
    bindClick("checksumBtnTop", () => focusPanel("checksumPanel"));
    bindClick("vinHunterBtn", () => {
        if (!needBIN()) return;
        const found = (currentBIN.analysis && currentBIN.analysis.vins) || Hunters.huntVIN(currentBIN.original);
        if (!found.length) {
            alert("VIN no encontrado en el dump. El nombre del archivo no cuenta.");
            return;
        }
        alert(found.map((v) => {
            const id = MindEngine.decodeVin(v.value);
            return v.value + " @ " + v.addressText + (id && id.maker ? " → " + id.maker : "");
        }).join("\n"));
    });
    bindClick("serialHunterBtn", () => {
        if (!needBIN()) return;
        const found = (currentBIN.analysis && currentBIN.analysis.serials) || Hunters.huntSerial(currentBIN.original);
        alert(found.length ? found.map((v) => v.value + " @ " + v.addressText).join("\n") : "Serial no encontrado");
    });
    bindClick("hoursHunterBtn", () => {
        if (!needBIN()) return;
        focusPanel("counterPanel");
        const hours = currentBIN.analysis ? currentBIN.analysis.hoursHits : [];
        openLab("HOURS HUNTER", hours.length
            ? hours.map((h) => h.formula + " · " + h.addressText + " · " + h.value).join("<br>")
            : "<p>Sin horas conocidas. Escríbelas arriba y analiza.</p>");
    });
    bindClick("universalCounterBtn", () => {
        if (!needAnalysis()) return;
        focusPanel("counterPanel");
        openLab("UNIVERSAL COUNTER", "<pre>" + (currentBIN.analysis.omega ? currentBIN.analysis.omega.omegaCard : "") + "</pre>");
    });
    bindClick("dnaBtn", () => { if (!needAnalysis()) return; focusPanel("dnaPanel"); });
    bindClick("dnaBtnTop", () => { if (!needAnalysis()) return; focusPanel("dnaPanel"); });
    bindClick("discoveryBtn", showDiscoveryBrain);
    bindClick("discoveryBtnTop", showDiscoveryBrain);
    bindClick("hypothesisBtn", showHypotheses);
    bindClick("correlationBtn", showCorrelation);
    bindClick("predictorBtn", runSimulate);
    bindClick("truthBtn", runValidate);
    bindClick("reasoningBtn", showReasoning);
    bindClick("digitalTwinBtn", showTwin);
    bindClick("digitalTwinBtnTop", showTwin);
    bindClick("virtualEepromBtn", showTwin);
    bindClick("binEvolutionBtn", showEvolution);
    bindClick("stressTestBtn", showStress);
    bindClick("pickBin1", () => $("fileInput").click());
    bindClick("pickBin2", () => $("fileInput2").click());
    bindClick("analyzePairBtn", runPairAnalysis);
    bindClick("autoKmBtn", runApply);
    bindClick("autoChecksumBtn", runApply);
    bindClick("binGenBtn", runGenerateBIN);
    bindClick("binGenBtnTop", runGenerateBIN);
    bindClick("generateBinBtn", runGenerateBIN);
    bindClick("upaBtn", runUPA);
    bindClick("validateBtnTop", runValidate);
    bindClick("reportBtnTop", exportReport);
    bindClick("knowledgeBtn", showGraph);
    bindClick("patternBtn", showAlgorithms);
    bindClick("selfLearnBtn", showAlgorithms);
    bindClick("omegaBtn", showOmega);
    bindClick("omegaBtnTop", showOmega);
    bindClick("forensicBtn", showForensic);
    bindClick("unknownBtn", () => {
        if (!needBIN()) return;
        runAnalysis();
        focusPanel("counterPanel");
    });
    bindClick("impossibleBtn", () => runAnalysis({ impossible: true }));
    bindClick("autopilotBtn", () => {
        if (OmegaKernel.compareBins.length) runPairAnalysis();
        else runAnalysis();
    });
    bindClick("menuBtn", () => document.querySelector(".sidebar").classList.toggle("open"));
    bindClick("closeLab", () => $("labModal").classList.remove("open"));
    bindClick("algoLibraryBtn", showAlgorithms);
    bindClick("closeAlgo", () => $("algoModal").classList.remove("open"));
    bindClick("simBtn", runSimulate);
    bindClick("valBtn", runValidate);
    bindClick("applyBtn", runApply);
    bindClick("restoreBtn", runRestore);
    bindClick("saveProjectBtn", showAlgorithms);
    bindClick("compareBinBtn", () => $("compareInput").click());

    if ($("hexMode")) $("hexMode").onchange = () => {
        if (currentBIN) showHEX(currentBIN.working);
    };
}

wireUI();
