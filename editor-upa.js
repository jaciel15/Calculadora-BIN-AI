const EditorEngine = {

    encodeValue(value, hit) {
        if (hit.formula === "BCD") {
            return MathEngine.toBCD(value, hit.width);
        }
        const wanted = MathEngine.variantsForValue(value).find((item) => {
            return item.formula === hit.formula && item.width === hit.width && item.endian === hit.endian;
        });
        if (wanted) return wanted.bytes;
        const numeric = this.applyFormula(value, hit.formula);
        return MathEngine.toBytes(numeric, hit.width, hit.endian !== "BE");
    },

    applyFormula(value, formula) {
        if (formula === "X") return value;
        if (formula === "~X") return (~value) >>> 0;
        if (formula === "BCD") return value;
        const xorMulAdd = formula.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+) \+ (\d+)$/i);
        if (xorMulAdd) return ((value ^ parseInt(xorMulAdd[1], 16)) * Number(xorMulAdd[2])) + Number(xorMulAdd[3]);
        const xorMul = formula.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (xorMul) return (value ^ parseInt(xorMul[1], 16)) * Number(xorMul[2]);
        const xorOnly = formula.match(/^X XOR ([0-9A-F]+)$/i);
        if (xorOnly) return value ^ parseInt(xorOnly[1], 16);
        const mulSub = formula.match(/^X \* (\d+) - (\d+)$/);
        if (mulSub) return value * Number(mulSub[1]) - Number(mulSub[2]);
        const mul = formula.match(/^X \* (\d+)$/);
        if (mul) return value * Number(mul[1]);
        const div = formula.match(/^X \/ (\d+)$/);
        if (div) return value / Number(div[1]);
        const add = formula.match(/^X \+ (\d+)$/);
        if (add) return value + Number(add[1]);
        const sub = formula.match(/^X - (\d+)$/);
        if (sub) return value - Number(sub[1]);
        return value;
    },

    apply(bytes, hit, newValue) {
        const encoded = this.encodeValue(Number(newValue), hit);
        const working = new Uint8Array(bytes);
        (hit.copies || [hit.address]).forEach((addr) => {
            working.set(encoded, addr);
            if (hit.familyId === "YAMAHA_R5F10" && encoded.length >= 3) {
                working[addr + 31] = (encoded[0] + encoded[1] + encoded[2]) & 0xFF;
            }
        });
        return {
            bytes: working,
            encoded,
            hex: MathEngine.hexBytes(encoded),
            copies: (hit.copies || [hit.address]).length
        };
    },

    generateUPA(fileName, chip, changes, checksums) {
        const lines = [];
        lines.push("; VELOCIMETROS CDMX - UPA USB SCRIPT");
        lines.push("; Archivo: " + fileName);
        lines.push("; Chip: " + chip);
        lines.push("; Generado: " + new Date().toLocaleString());
        lines.push("");
        lines.push("[INFO]");
        lines.push("DEVICE=" + chip);
        lines.push("PROTOCOL=AUTO");
        lines.push("");
        lines.push("[WRITE]");
        changes.forEach((change) => {
            lines.push(
                "W 0x" + change.address.toString(16).toUpperCase().padStart(4, "0") +
                " " + change.hex
            );
        });
        if (checksums && checksums.length) {
            lines.push("");
            lines.push("[CHECKSUMS]");
            checksums.forEach((item) => {
                if (item.storedAt === null || item.calculated === null) return;
                lines.push(
                    "W 0x" + item.storedAt.toString(16).toUpperCase().padStart(4, "0") +
                    " ; " + item.name + " = " + Number(item.calculated).toString(16).toUpperCase()
                );
            });
        }
        lines.push("");
        lines.push("; Como escribir: carga este script en UPA USB, verifica DEVICE y ejecuta WRITE.");
        return lines.join("\r\n");
    }

};
