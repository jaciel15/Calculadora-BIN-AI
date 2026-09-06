const OmegaKernel = {

    compareBins: [],
    lastReport: null,

    hex(value, size) {
        return Number(value).toString(16).toUpperCase().padStart(size || 4, "0");
    },

    range(start, width) {
        return "0x" + this.hex(start) + "–0x" + this.hex(start + width - 1);
    },

    add(evidence, module, type, data, confidence, proof) {
        evidence.push({
            id: "E" + String(evidence.length + 1).padStart(3, "0"),
            module,
            type,
            data,
            confidence: Number(confidence.toFixed(1)),
            proof,
            time: new Date().toLocaleTimeString()
        });
        return evidence[evidence.length - 1];
    },

    entropyBlock(bytes, start, len) {
        const freq = new Array(256).fill(0);
        let n = 0;
        for (let i = 0; i < len && start + i < bytes.length; i++) {
            freq[bytes[start + i]]++;
            n++;
        }
        if (!n) return 0;
        let ent = 0;
        for (let i = 0; i < 256; i++) {
            if (!freq[i]) continue;
            const p = freq[i] / n;
            ent -= p * Math.log2(p);
        }
        return ent;
    },

    classifyWindow(bytes, start, len) {
        let zeros = 0;
        let ffs = 0;
        let ascii = 0;
        const uniq = new Set();
        for (let i = 0; i < len && start + i < bytes.length; i++) {
            const b = bytes[start + i];
            uniq.add(b);
            if (b === 0) zeros++;
            if (b === 0xFF) ffs++;
            if (b >= 32 && b <= 126) ascii++;
        }
        const ent = this.entropyBlock(bytes, start, len);
        if (zeros >= len * 0.9 || ffs >= len * 0.9) return { kind: "PADDING", ent };
        if (ascii >= len * 0.85) return { kind: "ASCII", ent };
        if (uniq.size <= 3 && ent < 1.4) return { kind: "HEADER", ent };
        if (ent >= 2.2 && uniq.size >= 8) return { kind: "DATA", ent };
        if (ent >= 1.2 && uniq.size >= 4) return { kind: "COUNTER CANDIDATE", ent };
        return { kind: "UNKNOWN", ent };
    },

    memoryMapAI(bytes) {
        const win = 16;
        const raw = [];
        for (let i = 0; i < bytes.length; i += win) {
            const len = Math.min(win, bytes.length - i);
            const info = this.classifyWindow(bytes, i, len);
            raw.push({ start: i, end: i + len - 1, size: len, kind: info.kind, ent: info.ent });
        }
        const merged = [];
        raw.forEach((row) => {
            const last = merged[merged.length - 1];
            if (last && last.kind === row.kind) {
                last.end = row.end;
                last.size = last.end - last.start + 1;
                last.ent = (last.ent + row.ent) / 2;
            } else {
                merged.push(Object.assign({}, row));
            }
        });
        return merged.map((row, index) => ({
            id: "R" + String(index + 1).padStart(2, "0"),
            name: row.kind,
            start: row.start,
            end: row.end,
            size: row.size,
            description: row.kind + " · ent " + row.ent.toFixed(2),
            copies: 0,
            kind: row.kind,
            confidence: row.kind === "UNKNOWN" ? 42 : 74
        }));
    },

    patternHunter(bytes) {
        const counts = new Map();
        const width = 4;
        for (let i = 0; i <= bytes.length - width; i++) {
            if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 0) continue;
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xFF && bytes[i + 2] === 0xFF && bytes[i + 3] === 0xFF) continue;
            const key = bytes[i] + "," + bytes[i + 1] + "," + bytes[i + 2] + "," + bytes[i + 3];
            let item = counts.get(key);
            if (!item) {
                item = { key, hex: MathEngine.hexBytes(bytes.slice(i, i + 4)), addrs: [] };
                counts.set(key, item);
            }
            if (item.addrs.length < 12) item.addrs.push(i);
        }
        return Array.from(counts.values())
            .filter((item) => item.addrs.length >= 2 && item.addrs.length <= 8)
            .sort((a, b) => b.addrs.length - a.addrs.length)
            .slice(0, 20);
    },

    hiddenCopies(bytes, patterns) {
        const found = [];
        const sample = patterns.slice(0, 8);
        sample.forEach((pat) => {
            const src = pat.hex.split(" ").map((h) => parseInt(h, 16));
            const xor = src.map((b) => b ^ 0xFF);
            const rev = src.slice().reverse();
            const hitsXor = MathEngine.findPattern(bytes, new Uint8Array(xor));
            const hitsRev = MathEngine.findPattern(bytes, new Uint8Array(rev));
            if (hitsXor.length) {
                found.push({
                    kind: "XOR FF",
                    source: pat.hex,
                    address: hitsXor[0],
                    copies: hitsXor.length,
                    formula: "COPIA XOR 0xFF"
                });
            }
            if (hitsRev.length) {
                found.push({
                    kind: "ESPEJO",
                    source: pat.hex,
                    address: hitsRev[0],
                    copies: hitsRev.length,
                    formula: "COPIA INVERTIDA"
                });
            }
        });
        return found;
    },

    unknownCounters(bytes, map) {
        const candidates = [];
        const zones = map.filter((r) => r.kind === "COUNTER CANDIDATE" || r.kind === "DATA" || r.kind === "UNKNOWN");
        zones.slice(0, 8).forEach((zone) => {
            [2, 3, 4].forEach((width) => {
                const limit = Math.min(zone.end, zone.start + 96);
                for (let addr = zone.start; addr <= limit - width + 1; addr += width) {
                    const le = MathEngine.fromBytes(bytes, addr, width, true);
                    if (le === null || le < 80 || le > 800000) continue;
                    const pattern = bytes.slice(addr, addr + width);
                    const copies = MathEngine.findPattern(bytes, pattern);
                    if (copies.length < 2 || copies.length > 8) continue;
                    candidates.push({
                        label: "CONTADOR DESCONOCIDO",
                        value: le,
                        address: addr,
                        addressText: Hunters.range(addr, width),
                        width,
                        endian: "LE",
                        formula: "X",
                        hex: MathEngine.hexBytes(pattern),
                        copies,
                        name: "UNKNOWN_LE" + width,
                        writeHow: MathEngine.encodeWriteup("X", "LE", width),
                        confidence: Hunters.scoreHit(copies, width, false),
                        representation: "desconocida"
                    });
                }
            });
        });
        const uniq = [];
        const seen = new Set();
        candidates.sort((a, b) => b.confidence - a.confidence).forEach((item) => {
            const key = item.hex + "|" + item.width;
            if (seen.has(key)) return;
            seen.add(key);
            uniq.push(item);
        });
        return uniq.slice(0, 10);
    },

    familyDiffs(bytes) {
        const diffs = [];
        this.compareBins.forEach((other) => {
            const n = Math.min(bytes.length, other.bytes.length);
            let run = null;
            for (let i = 0; i < n; i++) {
                if (bytes[i] !== other.bytes[i]) {
                    if (!run) run = { start: i, end: i, file: other.fileName };
                    run.end = i;
                } else if (run) {
                    diffs.push(run);
                    run = null;
                }
            }
            if (run) diffs.push(run);
        });
        return diffs;
    },

    correlate(best, checksums, copies, diffs) {
        const links = [];
        if (best && checksums) {
            checksums.filter((c) => c.status === "VALIDO").forEach((c) => {
                const near = Math.abs((c.storedAt || 0) - best.address) <= 32;
                if (near) {
                    links.push({
                        from: this.range(best.address, best.width),
                        to: this.range(c.storedAt, c.size),
                        why: "checksum junto al contador",
                        confidence: 90
                    });
                }
            });
        }
        if (best && (best.copies || []).length > 1) {
            links.push({
                from: this.range(best.address, best.width),
                to: (best.copies || []).map((a) => this.hex(a)).join(", "),
                why: "mismas copias del valor",
                confidence: 93
            });
        }
        copies.forEach((c) => {
            links.push({
                from: c.source,
                to: this.hex(c.address),
                why: c.formula,
                confidence: 76
            });
        });
        diffs.slice(0, 6).forEach((d) => {
            links.push({
                from: this.hex(d.start),
                to: this.hex(d.end),
                why: "cambia frente a " + d.file,
                confidence: 81
            });
        });
        return links;
    },

    stressTest(hit) {
        if (!hit || hit.value === undefined || hit.formula === "ASCII") {
            return { cases: 0, passed: 0, rate: 0, status: "SIN PRUEBA" };
        }
        const probes = [hit.value, hit.value + 1, hit.value + 10, Math.max(1, hit.value - 7), hit.value * 2];
        let passed = 0;
        probes.forEach((val) => {
            try {
                const encoded = EditorEngine.encodeValue(val, hit);
                const again = EditorEngine.encodeValue(val, hit);
                const same = encoded.length === again.length && encoded.every((b, i) => b === again[i]);
                const unique = val === hit.value || MathEngine.hexBytes(encoded) !== hit.hex;
                if (same && unique) passed++;
            } catch (error) { /* ignore */ }
        });
        const rate = passed / probes.length;
        return {
            cases: probes.length,
            passed,
            rate,
            status: rate >= 0.8 ? "RESILIENTE" : rate >= 0.5 ? "PARCIAL" : "FRAGIL"
        };
    },

    truthJudge(hit, links, stress, binsChecked) {
        if (!hit) {
            return { status: "SIN EVIDENCIA", confidence: 0, note: "No hay contador demostrable." };
        }
        let score = hit.confidence || 0;
        const checksumLinked = links.some((l) => l.why.indexOf("checksum") !== -1);
        const copies = (hit.copies || []).length;
        if (copies >= 2) score += 6;
        if (checksumLinked) score += 8;
        if (hit.fromMemory) score += 7;
        if (stress.rate >= 0.8) score += 6;
        if (binsChecked > 1) score += Math.min(8, binsChecked);
        score = Math.max(5, Math.min(99.6, score));
        let status = "COINCIDENCIA POSIBLE";
        if (score >= 88 && (copies >= 2 || checksumLinked)) status = "DEMOSTRADO";
        else if (score >= 70) status = "HIPOTESIS FUERTE";
        else if (score >= 50) status = "HIPOTESIS";
        return {
            status,
            confidence: Number(score.toFixed(1)),
            note: status === "DEMOSTRADO"
                ? "La relación explica copias y/o checksum. No es solo un match aislado."
                : "Hay señal, pero hace falta más familia BIN o checksum ligado."
        };
    },

    thinking(best, map, diffs, impossible) {
        if (!best && impossible) {
            return "Impossible Case: ninguna hipótesis conocida basta. Ampliar cadenas XOR/MOD/ROL y comparar familia.";
        }
        if (!best) {
            return "Pensando: no hay valor conocido. Investigar regiones COUNTER CANDIDATE y patrones repetidos.";
        }
        if (diffs.length) {
            return "Pensando: hay BINs de familia. Cruzar offsets que cambian con el contador detectado.";
        }
        return "Pensando: validar " + best.formula + " contra copias, checksum y stress test.";
    },

    reasoning(hypotheses) {
        return hypotheses.slice().sort((a, b) => b.confidence - a.confidence);
    },

    inventChains(knownKm, bytes) {
        if (knownKm === null || knownKm === undefined) return [];
        const found = [];
        const masks = [0xFF, 0x55, 0xAA];
        const mods = [256, 255, 100];
        const rols = [1, 3, 4];
        masks.forEach((mask) => {
            mods.forEach((mod) => {
                rols.forEach((rol) => {
                    let v = knownKm ^ mask;
                    v = v % mod;
                    v = MathEngine.rol(v, rol, 16);
                    const formula = "((X XOR " + mask.toString(16).toUpperCase() + ") MOD " + mod + ") ROL " + rol;
                    [2, 3].forEach((width) => {
                        const le = MathEngine.toBytes(v, width, true);
                        const hits = MathEngine.findPattern(bytes, le);
                        if (hits.length >= 1 && hits.length <= 8) {
                            found.push({
                                label: "INVENTADO",
                                value: knownKm,
                                address: hits[0],
                                addressText: Hunters.range(hits[0], width),
                                width,
                                endian: "LE",
                                formula,
                                hex: MathEngine.hexBytes(le),
                                copies: hits,
                                name: KnowledgeBase.algorithmName(formula, width, "LE"),
                                writeHow: MathEngine.encodeWriteup(formula, "LE", width),
                                confidence: Hunters.scoreHit(hits, width, false) - 8,
                                invented: true
                            });
                        }
                    });
                });
            });
        });
        return found.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    },

    dnaFingerprint(bytes, map, best, checksums) {
        const kinds = {};
        map.forEach((r) => { kinds[r.kind] = (kinds[r.kind] || 0) + r.size; });
        return {
            size: bytes.length,
            entropy: DNADiscovery.entropy(bytes),
            structure: kinds,
            formula: best ? best.formula : "?",
            checksums: checksums.filter((c) => c.status === "VALIDO").map((c) => c.name),
            signature: bytes.length + ":" + (best ? best.width + best.endian : "NA") + ":" + Object.keys(kinds).join("-")
        };
    },

    dnaMatch(fingerprint) {
        const db = KnowledgeBase.load();
        const rows = (db.files || []).map((file) => {
            const sameSize = file.dna && file.dna.size === fingerprint.size;
            const sameFormula = file.dna && file.dna.formula === fingerprint.formula;
            let score = 20;
            if (sameSize) score += 35;
            if (sameFormula) score += 40;
            return {
                file: file.fileName,
                score: Math.min(99, score),
                family: sameFormula ? "MISMA REGLA" : (sameSize ? "MISMO TAMAÑO" : "DISTINTO")
            };
        }).sort((a, b) => b.score - a.score);
        const top = rows[0];
        return {
            probable: top ? top.family + " · " + top.score + "%" : "SIN BIBLIOTECA",
            alternatives: rows.slice(1, 3),
            rows
        };
    },

    buildOmegaCard(best, truth, stress, links, binsChecked, checksums) {
        if (!best) {
            return [
                "BIN HUNTER OMEGA",
                "COUNTER DETECTADO: no",
                "Estado: sin demostración",
                "Siguiente: cargar KM conocido o más BINs de la misma familia"
            ].join("\n");
        }
        const familyLine = best.familyId ? "Familia kernel: " + best.familyId : null;
        const chk = checksums.find((c) => c.status === "VALIDO");
        return [
            familyLine || "BIN HUNTER OMEGA",
            "COUNTER DETECTADO",
            "Dirección: " + this.range(best.address, best.width),
            "Tamaño: " + best.width + " bytes",
            "Representación: " + (best.representation || best.endian || "desconocida"),
            "Transformación candidata: " + best.formula,
            "Correlación: " + (links[0] ? links[0].confidence + "%" : "0%"),
            "BINs comprobados: " + binsChecked,
            "Hipótesis: " + truth.status,
            "Checksum asociado: " + (chk ? chk.name + " encontrado" : "no demostrado"),
            "Stress test: " + stress.passed + "/" + stress.cases + " · " + stress.status,
            "Confianza: " + truth.confidence + "%"
        ].join("\n");
    },

    run(bin, options) {
        const bytes = bin.original;
        const knownKm = options.knownKm;
        const knownHours = options.knownHours;
        const impossible = !!options.impossible;
        const evidence = [];
        const log = [];
        const say = (module, message) => log.push({ time: new Date().toLocaleTimeString(), module, message });

        say("ORCHESTRATOR", "Pipeline Omega iniciado");
        this.add(evidence, "BIN CORE", "profile", { size: bytes.length, chip: bin.chip }, 95, "tamaño y chip");
        say("BIN CORE", "Perfil: " + bytes.length + " bytes · " + bin.chip);

        const familyMatch = FamilyLibrary.identify(bytes);
        if (familyMatch) {
            bin.chip = familyMatch.family.chip;
            this.add(evidence, "EEPROM STRUCTURE", "family", { id: familyMatch.family.id }, familyMatch.confidence, familyMatch.family.status);
            say("DNA MATCH", familyMatch.family.id + " · " + familyMatch.family.status);
            if (familyMatch.decodedKm !== null) {
                say("FAMILY KERNEL", "KM leído por familia: " + familyMatch.decodedKm + (familyMatch.swapped ? " (dump swapeado)" : ""));
            } else {
                say("FAMILY KERNEL", "Familia reconocida. " + familyMatch.family.writeHow);
            }
        }

        const map = this.memoryMapAI(bytes);
        this.add(evidence, "MEMORY MAP AI", "regions", { count: map.length }, 80, "entropía + constantes + ASCII");
        say("MEMORY MAP AI", map.length + " regiones estructurales");

        const patterns = this.patternHunter(bytes);
        this.add(evidence, "PATTERN HUNTER", "repeats", { count: patterns.length }, 72, "bloques 4B repetidos");
        say("PATTERN HUNTER", patterns.length + " patrones repetidos");

        let mileageHits = Hunters.huntValue(bytes, knownKm, "KILOMETRAJE");
        if (familyMatch && familyMatch.hits) {
            familyMatch.hits.forEach((hit) => mileageHits.unshift(hit));
        }
        let hoursHits = Hunters.huntValue(bytes, knownHours, "HORAS MOTOR");
        say("MOTOR MATEMATICO", MathEngine.lastComboCount + " combinaciones probadas");
        say("COUNTER HUNTER", mileageHits.length ? "KM: " + mileageHits[0].formula : "sin KM conocido");
        say("HOURS HUNTER", hoursHits.length ? "Horas: " + hoursHits[0].formula : "sin horas conocidas");

        const unknown = this.unknownCounters(bytes, map);
        this.add(evidence, "UNKNOWN DECODER", "candidates", { count: unknown.length }, unknown[0] ? unknown[0].confidence : 30, "contadores sin etiqueta");
        say("UNKNOWN DECODER", unknown.length + " bloques candidatos");

        if (impossible || (!mileageHits.length && knownKm !== null)) {
            const invented = this.inventChains(knownKm, bytes);
            invented.forEach((item) => mileageHits.push(item));
            say("ALGORITHM INVENTOR", invented.length + " cadenas nuevas");
        }

        const vins = Hunters.huntVIN(bytes);
        const serials = Hunters.huntSerial(bytes);
        say("VIN HUNTER", vins.length ? vins[0].value : "no encontrado");
        say("SERIAL HUNTER", serials.length ? serials.length + " candidatos" : "no encontrado");

        let best = mileageHits[0] || hoursHits[0] || unknown[0] || null;
        const copiesExact = best && best.copies ? Hunters.hiddenCopies([best]) : [];
        const copiesHidden = this.hiddenCopies(bytes, patterns);
        say("COPIAS OCULTAS", (copiesHidden.length + copiesExact.length) + " relaciones");

        const hot = [];
        if (best) hot.push(best.address);
        map.filter((r) => r.kind === "COUNTER CANDIDATE").forEach((r) => hot.push(r.start));
        const checksums = ChecksumEngine.hunt(bytes, hot);
        const kmChecksums = ChecksumEngine.linkToKm(bytes, best);
        kmChecksums.forEach((item) => {
            if (!checksums.some((c) => c.name === item.name && c.storedAt === item.storedAt)) {
                checksums.unshift(item);
            }
        });
        const kmOrder = ChecksumEngine.describeKmOrder(best, bytes);
        const valid = checksums.filter((c) => c.status === "VALIDO").length;
        say("CHECKSUM HUNTER", valid + " válidos");
        say("ORDEN KM", kmOrder.layout + " · " + kmOrder.hex);
        if (kmChecksums.length) {
            say("KM+CHECKSUM", kmChecksums[0].name + " @ " + this.hex(kmChecksums[0].storedAt) + " cubre " + kmChecksums[0].window);
        } else {
            say("KM+CHECKSUM", "Sin checksum pegado al KM. La integridad puede ser solo las copias.");
        }

        const diffs = this.familyDiffs(bytes);
        const links = this.correlate(best, checksums, copiesHidden, diffs);
        this.add(evidence, "CORRELATION", "links", { count: links.length }, links[0] ? links[0].confidence : 20, "regiones que cambian juntas");
        say("CORRELATION ENGINE", links.length + " vínculos");

        const hypotheses = DNADiscovery.hypotheses(mileageHits, hoursHits);
        unknown.slice(0, 4).forEach((item, i) => {
            hypotheses.push({
                rank: hypotheses.length + 1,
                type: "DESCONOCIDO",
                formula: item.formula,
                name: item.name,
                address: item.addressText,
                copies: item.copies.length,
                confidence: Number(item.confidence.toFixed(1)),
                writeHow: item.writeHow,
                fromMemory: false
            });
        });
        const reasoned = this.reasoning(hypotheses);
        say("HYPOTHESIS FACTORY", reasoned.length + " hipótesis");
        say("REASONING ENGINE", reasoned[0] ? "Prioridad: " + reasoned[0].formula : "sin prioridad");

        const stress = this.stressTest(best);
        say("STRESS TEST", stress.status + " " + stress.passed + "/" + stress.cases);

        const binsChecked = 1 + this.compareBins.length;
        let truth = this.truthJudge(best, links, stress, binsChecked);
        if (best && best.fromFamily && best.writable) {
            truth = {
                status: "DEMOSTRADO",
                confidence: 99.2,
                note: "Familia de kernel " + best.familyId + ". Regla comprobada en " + (familyMatch.family.binsProven || 1) + " BIN."
            };
        } else if (best && best.fromFamily && best.writable === false) {
            truth = {
                status: "LUGAR DEMOSTRADO",
                confidence: 96.4,
                note: "La región es correcta. La fórmula de escritura aún no está demostrada."
            };
        }
        say("TRUTH ENGINE", truth.status + " · " + truth.confidence + "%");
        say("THINKING ENGINE", this.thinking(best, map, diffs, impossible));

        const dna = DNADiscovery.build(bytes, best, checksums, familyMatch);
        const fingerprint = this.dnaFingerprint(bytes, map, best, checksums);
        dna.fingerprint = fingerprint;
        const match = this.dnaMatch(fingerprint);
        dna.match = match;
        const discovery = DNADiscovery.discovery(best, reasoned);
        if (!best) {
            discovery.note = "Sin valor conocido. Omega mapeará estructura y candidatos.";
        }
        say("DNA BIN", dna.family + " · " + dna.score + "%");
        say("DNA MATCH", match.probable);

        const counters = this.mergeCounters(mileageHits, hoursHits, vins, serials, unknown, truth);
        const taggedMap = this.mergeMap(map, counters, vins, checksums);

        if (best && truth.confidence >= 70 && best.writable !== false) {
            KnowledgeBase.rememberAlgorithm(best, bin.fileName, bin.fileSize);
            say("SELF LEARNING", "Guardado: " + best.name);
        }
        KnowledgeBase.rememberFile(bin.fileName, Object.assign({}, dna, fingerprint), counters);
        KnowledgeBase.rememberGraph({
            file: bin.fileName,
            region: best ? this.range(best.address, best.width) : "—",
            pattern: best ? best.hex : "—",
            algorithm: best ? best.formula : "—",
            checksum: valid ? "SI" : "NO",
            truth: truth.status,
            confidence: truth.confidence
        });

        const omegaCard = this.buildOmegaCard(best, truth, stress, links, binsChecked, checksums);
        const twin = {
            physical: bin.fileName,
            regions: taggedMap.length,
            variables: counters.filter((c) => c.hit).length,
            relations: links.length,
            checksums: valid,
            dependencies: copiesHidden.length
        };
        const docs = {
            id: "DESC-" + Date.now().toString().slice(-6),
            region: best ? this.range(best.address, best.width) : "—",
            pattern: best ? best.hex : "—",
            transform: best ? best.formula : "—",
            evidence: evidence.length,
            bins: binsChecked,
            confidence: truth.confidence,
            estado: truth.status
        };

        this.lastReport = {
            evidence,
            map: taggedMap,
            patterns,
            copies: copiesExact.concat(copiesHidden),
            links,
            hypotheses: reasoned,
            checksums,
            counters,
            vins,
            serials,
            dna,
            discovery,
            best,
            truth,
            stress,
            match,
            twin,
            docs,
            omegaCard,
            thinking: this.thinking(best, map, diffs, impossible),
            binsChecked,
            validChecksums: valid,
            errorChecksums: checksums.length - valid,
            mileageHits,
            hoursHits,
            familyMatch,
            kmOrder,
            kmChecksums
        };
        say("BIN HUNTER OMEGA", truth.status + " · confianza " + truth.confidence + "%");
        this.lastReport.log = log;
        return this.lastReport;
    },

    mergeCounters(mileageHits, hoursHits, vins, serials, unknown, truth) {
        const pick = (label, hits, unit) => {
            const hit = hits[0] || null;
            let status = "SIN DATOS";
            if (hit && truth && hit === (mileageHits[0] || hoursHits[0] || unknown[0])) status = truth.status;
            else if (hit) status = hit.confidence >= 80 ? "VALIDADO" : "HIPOTESIS";
            return {
                name: label,
                value: hit ? (typeof hit.value === "number" ? hit.value + (unit ? " " + unit : "") : String(hit.value)) : "---",
                address: hit ? hit.addressText : "----",
                size: hit ? hit.width + " B" : "----",
                type: hit ? (hit.endian || hit.type || "----") : "----",
                confidence: hit ? Number(hit.confidence).toFixed(1) + "%" : "0%",
                status,
                hit
            };
        };
        const extra = unknown.slice(0, 2).map((u, i) => pick("DESCONOCIDO " + (i + 1), [u], ""));
        return [
            pick("KILOMETRAJE", mileageHits, "KM"),
            pick("KILOMETRAJE BCK", mileageHits.slice(1), "KM"),
            pick("HORAS MOTOR", hoursHits, "h"),
            pick("HORAS BCK", hoursHits.slice(1), "h"),
            pick("VIN", vins.map((v) => Object.assign({
                value: v.value, addressText: v.addressText, width: v.width,
                endian: "ASCII", confidence: v.confidence, copies: [v.address],
                formula: "ASCII", name: "VIN_ASCII"
            })), ""),
            pick("SERIAL", serials.map((v) => Object.assign({
                value: v.value, addressText: v.addressText, width: v.width,
                endian: "ASCII", confidence: v.confidence, copies: [v.address],
                formula: "ASCII", name: "SERIAL_ASCII"
            })), "")
        ].concat(extra);
    },

    mergeMap(map, counters, vins, checksums) {
        const extra = [];
        counters.filter((c) => c.hit).forEach((c) => {
            extra.push({
                id: "C-" + c.name.slice(0, 3),
                name: c.name,
                start: c.hit.address,
                end: c.hit.address + c.hit.width - 1,
                size: c.hit.width,
                description: (c.hit.formula || "") + " · " + (c.hit.endian || ""),
                copies: (c.hit.copies || []).length
            });
        });
        vins.forEach((v) => extra.push({
            id: "VIN", name: "VIN", start: v.address, end: v.address + 16,
            size: 17, description: v.value, copies: 1
        }));
        checksums.filter((c) => c.status === "VALIDO").forEach((c) => extra.push({
            id: c.name, name: c.name, start: c.storedAt, end: c.storedAt + c.size - 1,
            size: c.size, description: "ventana " + c.window, copies: 1
        }));
        return map.concat(extra).slice(0, 24);
    }
};
