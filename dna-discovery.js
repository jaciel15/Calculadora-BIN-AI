const DNADiscovery = {

    entropy(bytes) {
        const freq = new Array(256).fill(0);
        for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++;
        let ent = 0;
        for (let i = 0; i < 256; i++) {
            if (!freq[i]) continue;
            const p = freq[i] / bytes.length;
            ent -= p * Math.log2(p);
        }
        return Number(ent.toFixed(3));
    },

    build(bytes, best, checksums, familyMatch) {
        const validChecksums = checksums.filter((c) => c.status === "VALIDO").length;
        const copies = best ? (best.copies || []).length : 0;
        const formula = best ? best.formula : "SIN IDENTIFICAR";
        let family = best ? best.name : "DESCONOCIDO";
        let score = 12;
        if (best) score += best.confidence * 0.55;
        if (copies >= 2) score += 12;
        if (validChecksums) score += 8;
        if (best && best.fromMemory) score += 10;
        if (familyMatch) score = Math.max(score, familyMatch.confidence);
        score = Math.max(0, Math.min(99.8, score));

        const dna = {
            family,
            formula,
            version: best ? best.endian + " " + best.width + "B" : "-----",
            manufacturer: this.guessMaker(best),
            copies,
            entropy: this.entropy(bytes),
            size: bytes.length,
            score: Number(score.toFixed(1)),
            status: score >= 80 ? "ALTA COINCIDENCIA" : score >= 50 ? "HIPOTESIS" : "SIN ANALIZAR"
        };

        if (familyMatch && familyMatch.family) {
            dna.family = familyMatch.family.id;
            dna.manufacturer = familyMatch.family.manufacturer;
            dna.version = familyMatch.family.version;
            dna.formula = familyMatch.family.writable ? (best ? best.formula : "X") : "FINO SIN FÓRMULA";
            dna.status = familyMatch.family.status;
            dna.score = Number(familyMatch.confidence.toFixed(1));
        }
        return dna;
    },

    guessMaker(best) {
        if (!best) return "Sin identificar";
        if (best.formula.indexOf("XOR") !== -1) return "FAMILIA XOR";
        if (best.formula === "BCD") return "FAMILIA BCD";
        if (best.formula.indexOf("* 10") !== -1) return "FAMILIA x10";
        if (best.formula === "X") return "RAW BINARIO";
        return "FAMILIA MATEMATICA";
    },

    hypotheses(mileageHits, hoursHits) {
        const rows = [];
        mileageHits.slice(0, 8).forEach((item, index) => {
            rows.push({
                rank: index + 1,
                type: "KILOMETRAJE",
                formula: item.formula,
                name: item.name,
                address: item.addressText,
                copies: item.copies.length,
                confidence: item.confidence,
                writeHow: item.writeHow,
                fromMemory: !!item.fromMemory
            });
        });
        hoursHits.slice(0, 4).forEach((item, index) => {
            rows.push({
                rank: mileageHits.length + index + 1,
                type: "HORAS MOTOR",
                formula: item.formula,
                name: item.name,
                address: item.addressText,
                copies: item.copies.length,
                confidence: item.confidence,
                writeHow: item.writeHow,
                fromMemory: !!item.fromMemory
            });
        });
        return rows;
    },

    discovery(best, hypotheses) {
        if (!best) {
            return {
                algorithm: "Sin analizar",
                type: "-----",
                region: "-----",
                confidence: 0,
                patterns: 0,
                note: "Omega puede mapear sin KM. Si lo conoces, la fórmula sale más rápido."
            };
        }
        return {
            algorithm: best.formula,
            type: best.endian + " / " + best.width + " bytes",
            region: best.addressText,
            confidence: best.confidence,
            patterns: hypotheses.length,
            note: best.writeHow
        };
    }

};
