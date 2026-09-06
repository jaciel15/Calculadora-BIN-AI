class BINCore {

    constructor() {
        this.currentBIN = null;
        this.log = [];
    }

    load(binObject) {
        this.currentBIN = binObject;
        this.log = [];
        this.addLog("BIN CORE", "Archivo cargado: " + binObject.fileName + " (" + binObject.fileSize + " bytes)");
        const family = FamilyLibrary.identify(binObject.original);
        if (family) {
            binObject.chip = family.family.chip;
            binObject.family = family;
            this.addLog("DNA MATCH", family.family.id + " · " + family.family.status);
            if (family.decodedKm !== null) {
                this.addLog("FAMILY KERNEL", "KM leído: " + family.decodedKm);
            }
        } else {
            this.addLog("EEPROM", "Chip estimado: " + binObject.chip);
        }
        return binObject;
    }

    addLog(module, message) {
        this.log.push({
            time: new Date().toLocaleTimeString(),
            module,
            message
        });
        if (this.log.length > 80) this.log.shift();
    }

    analyze(knownKm, knownHours, extra) {
        const bin = this.currentBIN;
        if (!bin) return null;

        bin.knownKm = knownKm;
        bin.knownHours = knownHours;
        this.addLog("MASTER ORCHESTRATOR", "Cadena Omega: Core → Map → Pattern → Counter → Math → Checksum → DNA → Correlation → Hypothesis → Validation → Truth");

        const report = OmegaKernel.run(bin, {
            knownKm,
            knownHours,
            knownKm2: extra && extra.knownKm2,
            knownVin: extra && extra.knownVin,
            impossible: extra && extra.impossible
        });

        (report.log || []).forEach((row) => this.addLog(row.module, row.message));

        bin.analysis = {
            mileageHits: report.mileageHits,
            hoursHits: report.hoursHits,
            vins: report.vins,
            serials: report.serials,
            copies: report.copies,
            checksums: report.checksums,
            counters: report.counters,
            memoryMap: report.map,
            hypotheses: report.hypotheses,
            dna: report.dna,
            discovery: report.discovery,
            best: report.best,
            validChecksums: report.validChecksums,
            errorChecksums: report.errorChecksums,
            omega: report
        };
        bin.status = "ANALIZADO";
        this.addLog("VALIDATION", report.truth.status + " · " + report.truth.confidence + "%");
        return bin.analysis;
    }

    analyzeVin(knownVin, knownVin2) {
        const bin = this.currentBIN;
        if (!bin) return null;
        this.addLog("VIN HEART", "Analizo el VIN como dato propio, no como KM.");
        const report = OmegaKernel.runVin(bin, { knownVin, knownVin2 });
        (report.log || []).forEach((row) => this.addLog(row.module, row.message));
        const prev = bin.analysis || {};
        bin.analysis = Object.assign({}, prev, {
            vins: report.vins,
            omega: Object.assign({}, prev.omega || {}, report),
            vinFocus: true
        });
        bin.status = "VIN ANALIZADO";
        this.addLog("VIN HEART", report.vinHeart
            ? report.vinHeart.layoutLabel + " · " + (report.vinHeart.copies || []).length + " copias"
            : "VIN no localizado");
        return bin.analysis;
    }

    buildCounters(mileageHits, hoursHits, vins, serials) {
        const pick = (label, hits, unit) => {
            const hit = hits[0] || null;
            return {
                name: label,
                value: hit ? hit.value + (unit ? " " + unit : "") : "---",
                address: hit ? hit.addressText : "----",
                size: hit ? hit.width + " B" : "----",
                type: hit ? hit.endian : "----",
                confidence: hit ? hit.confidence + "%" : "0%",
                status: hit ? (hit.confidence >= 80 ? "VALIDADO" : "HIPOTESIS") : "SIN DATOS",
                hit
            };
        };

        return [
            pick("KILOMETRAJE", mileageHits, "KM"),
            pick("KILOMETRAJE BCK", mileageHits.slice(1), "KM"),
            pick("HORAS MOTOR", hoursHits, "h"),
            pick("HORAS BCK", hoursHits.slice(1), "h"),
            pick("VIN", vins.map((v) => Object.assign({
                value: v.value,
                addressText: v.addressText,
                width: v.width,
                endian: "ASCII",
                confidence: v.confidence,
                copies: [v.address],
                formula: "ASCII",
                name: "VIN_ASCII"
            })), ""),
            pick("SERIAL", serials.map((v) => Object.assign({
                value: v.value,
                addressText: v.addressText,
                width: v.width,
                endian: "ASCII",
                confidence: v.confidence,
                copies: [v.address],
                formula: "ASCII",
                name: "SERIAL_ASCII"
            })), "")
        ];
    }

    simulate(newValue, kind) {
        const bin = this.currentBIN;
        if (!bin || !bin.analysis) return null;
        if (kind === "VIN") {
            const heart = (bin.analysis.omega && bin.analysis.omega.vinHeart) || bin.analysis.vins[0];
            if (!heart) {
                this.addLog("VIN HEART", "No hay VIN en el dump para escribir.");
                return null;
            }
            const applied = EditorEngine.applyVin(bin.original, heart, newValue);
            if (!applied) {
                this.addLog("VIN HEART", "El VIN debe tener 17 caracteres válidos.");
                return null;
            }
            return { applied, repaired: [], copies: applied.copies, checksums: heart.checksum ? 1 : 0 };
        }
        if (!bin.analysis.best) return null;
        if (bin.analysis.best.writable === false) {
            this.addLog("TRUTH ENGINE", "Esta familia no se escribe: " + (bin.analysis.best.familyId || "desconocida"));
            return null;
        }
        const machine = bin.analysis.omega && bin.analysis.omega.machine;
        if (machine && typeof WriteMachine !== "undefined") {
            const ghost = WriteMachine.ghost(machine, bin.original, newValue, bin.analysis.best);
            if (ghost && ghost.blocked) {
                this.addLog("MAQUINA SELLADA", ghost.reason);
                return null;
            }
            if (ghost) {
                const extra = ChecksumEngine.recalculate(ghost.bytes, bin.analysis.checksums || []);
                this.addLog("MAQUINA SELLADA", ghost.proved.ok
                    ? "Fantasma " + newValue + " KM · " + ghost.diffs.length + " bytes · el sello sigue cerrado"
                    : "Fantasma " + newValue + " KM · el sello se rompe: " + ghost.proved.broken.join(", "));
                return {
                    applied: { bytes: ghost.bytes, copies: ghost.slots, hex: "" },
                    repaired: extra.concat(ghost.repaired),
                    copies: ghost.slots,
                    checksums: extra.length + ghost.repaired.length,
                    ghost
                };
            }
        }
        const applied = EditorEngine.apply(bin.original, bin.analysis.best, newValue);
        const repaired = ChecksumEngine.recalculate(applied.bytes, bin.analysis.checksums);
        return {
            applied,
            repaired,
            copies: applied.copies,
            checksums: repaired.length
        };
    }

    applyValue(newValue, kind) {
        const sim = this.simulate(newValue, kind);
        if (!sim) return null;
        this.currentBIN.working = sim.applied.bytes;
        this.currentBIN.status = "EDITADO";
        this.addLog(kind === "VIN" ? "VIN HEART" : "EDITOR", "Nuevo valor aplicado: " + newValue + " · " + sim.copies + " copias");
        if (kind !== "VIN") this.addLog("AUTO CHECKSUM", sim.repaired.length + " checksums recalculados");
        return sim;
    }

    restore() {
        if (!this.currentBIN) return;
        this.currentBIN.working = new Uint8Array(this.currentBIN.original);
        this.currentBIN.status = "RESTAURADO";
        this.addLog("EDITOR", "BIN restaurado al original");
    }

    generateBIN() {
        if (!this.currentBIN) return null;
        this.addLog("BIN GENERATOR", "BIN listo: " + this.currentBIN.fileName);
        return this.currentBIN.working;
    }

    generateUPA() {
        const bin = this.currentBIN;
        if (!bin || !bin.analysis || !bin.analysis.best) return "";
        const hit = bin.analysis.best;
        const changes = (hit.copies || [hit.address]).map((addr) => ({
            address: addr,
            hex: MathEngine.hexBytes(bin.working.slice(addr, addr + hit.width))
        }));
        this.addLog("UPA SCRIPT", "Script generado para " + bin.chip);
        return EditorEngine.generateUPA(bin.fileName, bin.chip, changes, bin.analysis.checksums);
    }

}

const binCore = new BINCore();
