const EditorEngine = {

    encodeValue(value, hit) {
        if (hit.formula === "BCD") {
            return MathEngine.toBCD(value, hit.width);
        }
        const numeric = this.applyFormula(value, hit.formula);
        return MathEngine.toBytes(numeric, hit.width, hit.endian !== "BE");
    },

    applyFormula(value, formula) {
        return MathEngine.applyFormula(value, formula);
    },

    applyVin(bytes, heart, vin) {
        const text = String(vin || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
        if (!heart || text.length < 6) return null;
        if (text.length !== 17 && !(heart.value && text.length === String(heart.value).length)) return null;
        const working = new Uint8Array(bytes);
        const layout = { id: heart.layout || "PACKED", step: heart.step || 1, pad: heart.pad };
        const copies = heart.copies && heart.copies.length ? heart.copies : [heart.address];
        const xor = heart.xor || 0;
        copies.forEach((start) => {
            for (let i = 0; i < text.length; i++) {
                let addr;
                if (layout.id === "SWAP16") {
                    addr = start + (i % 2 === 0 ? i + 1 : i - 1);
                    if (i === text.length - 1 && text.length % 2 === 1) addr = start + i;
                } else addr = start + i * (layout.step || 1);
                if (addr >= 0 && addr < working.length) working[addr] = text.charCodeAt(i) ^ xor;
            }
            if (heart.checksum && heart.checksum.name === "SUM8") {
                let sum = 0;
                for (let i = 0; i < 17; i++) sum = (sum + text.charCodeAt(i)) & 0xFF;
                const at = start + (heart.span || 17);
                if (at < working.length) working[at] = sum;
            }
        });
        return {
            bytes: working,
            encoded: new Uint8Array(Array.from(text).map((ch) => ch.charCodeAt(0))),
            hex: text,
            copies: copies.length
        };
    },

    apply(bytes, hit, newValue) {
        if ((hit.fromStair || hit.fromWorld) && hit.familyId !== "YAMAHA_R5F10") {
            const written = FamilyLibrary.writeStair(new Uint8Array(bytes), hit, Number(newValue));
            return {
                bytes: written.bytes,
                encoded: written.encoded,
                hex: MathEngine.hexBytes(written.encoded),
                copies: written.count
            };
        }
        if (hit.familyId === "YAMAHA_R5F10") {
            const written = FamilyLibrary.writeR5FRing(new Uint8Array(bytes), hit.address, Number(newValue));
            return {
                bytes: written.bytes,
                encoded: written.encoded,
                hex: MathEngine.hexBytes(written.encoded),
                copies: written.count
            };
        }
        const encoded = this.encodeValue(Number(newValue), hit);
        const working = new Uint8Array(bytes);
        (hit.copies || [hit.address]).forEach((addr) => {
            working.set(encoded, addr);
        });
        return {
            bytes: working,
            encoded,
            hex: MathEngine.hexBytes(encoded),
            copies: (hit.copies || [hit.address]).length
        };
    },

    hexConst(addr) {
        return "$" + Number(addr).toString(16).toUpperCase();
    },

    pascalExpr(formula, km) {
        const f = String(formula || "X");
        if (f === "X") return km;
        if (f === "~X") return "(not " + km + ")";
        if (f === "X * 10") return "(" + km + " * 10)";
        if (f === "X * 10 - 1") return "(" + km + " * 10 - 1)";
        if (f === "X * 10 - 5") return "(" + km + " * 10 - 5)";
        if (f === "X * 100") return "(" + km + " * 100)";
        let m = f.match(/^X \* (\d+)$/);
        if (m) return "(" + km + " * " + m[1] + ")";
        m = f.match(/^X \* (\d+) - (\d+)$/);
        if (m) return "(" + km + " * " + m[1] + " - " + m[2] + ")";
        m = f.match(/^X \* (\d+) \+ (\d+)$/);
        if (m) return "(" + km + " * " + m[1] + " + " + m[2] + ")";
        m = f.match(/^X \+ (\d+)$/);
        if (m) return "(" + km + " + " + m[1] + ")";
        m = f.match(/^X - (\d+)$/);
        if (m) return "(" + km + " - " + m[1] + ")";
        m = f.match(/^X XOR ([0-9A-F]+)$/i);
        if (m) return "(" + km + " xor $" + m[1] + ")";
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (m) return "((" + km + " xor $" + m[1] + ") * " + m[2] + ")";
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+) \+ (\d+)$/i);
        if (m) return "((" + km + " xor $" + m[1] + ") * " + m[2] + " + " + m[3] + ")";
        return km;
    },

    writeBytesPascal(lines, addrs, width, endian, varName) {
        const little = endian !== "BE";
        addrs.forEach((addr) => {
            for (let i = 0; i < width; i++) {
                const shift = little ? i * 8 : (width - 1 - i) * 8;
                lines.push("  SetByteHexEdit(" + this.hexConst(addr + i) + ", (" + varName + " shr " + shift + ") and $FF);");
            }
        });
    },

    checksumPascal(lines, item) {
        if (!item || item.storedAt === null || item.storedAt === undefined) return;
        const start = item.start;
        const end = item.end;
        const at = item.storedAt;
        const name = String(item.name || "SUM16").toUpperCase();
        if (name.indexOf("CRC32") !== -1) {
            lines.push("  CS := CalcCheckSum(csCRC32, " + this.hexConst(start) + ", " + this.hexConst(end - 1) + ");");
            lines.push("  AddMsg('CRC32=' + CS);");
            return;
        }
        if (name.indexOf("CRC16") !== -1) {
            lines.push("  CS := CalcCheckSum(csCRC16_CCITT, " + this.hexConst(start) + ", " + this.hexConst(end - 1) + ");");
            lines.push("  AddMsg('CRC16=' + CS);");
            return;
        }
        lines.push("  Sum := 0;");
        lines.push("  for I := " + this.hexConst(start) + " to " + this.hexConst(end - 1) + " do");
        lines.push("    Sum := Sum + GetByteHexEdit(I);");
        if ((item.size || 2) === 1 || name.indexOf("SUM8") !== -1 || name === "XOR8" || name === "LRC") {
            if (name === "LRC") lines.push("  Sum := (256 - (Sum and $FF)) and $FF;");
            lines.push("  SetByteHexEdit(" + this.hexConst(at) + ", Sum and $FF);");
        } else if (item.endian === "BE") {
            lines.push("  SetByteHexEdit(" + this.hexConst(at) + ", (Sum shr 8) and $FF);");
            lines.push("  SetByteHexEdit(" + this.hexConst(at + 1) + ", Sum and $FF);");
        } else {
            lines.push("  SetByteHexEdit(" + this.hexConst(at) + ", Sum and $FF);");
            lines.push("  SetByteHexEdit(" + this.hexConst(at + 1) + ", (Sum shr 8) and $FF);");
        }
    },

    writeR5FPascal(lines, lastAddr) {
        const base = lastAddr - (lastAddr % 0x20);
        lines.push("  LastVal := Km * 10;");
        lines.push("  Page := " + this.hexConst(base) + ";");
        lines.push("  while (Page >= 0) and (GetByteHexEdit(Page) <> $FF) do");
        lines.push("  begin");
        lines.push("    Val24 := LastVal;");
        lines.push("    SetByteHexEdit(Page, Val24 and $FF);");
        lines.push("    SetByteHexEdit(Page + 1, (Val24 shr 8) and $FF);");
        lines.push("    SetByteHexEdit(Page + 2, (Val24 shr 16) and $FF);");
        lines.push("    for I := 3 to 29 do SetByteHexEdit(Page + I, 0);");
        lines.push("    Sum := GetByteHexEdit(Page) + GetByteHexEdit(Page + 1) + GetByteHexEdit(Page + 2);");
        lines.push("    SetByteHexEdit(Page + 30, (Sum shr 8) and $FF);");
        lines.push("    SetByteHexEdit(Page + 31, Sum and $FF);");
        lines.push("    if Page < $20 then Break;");
        lines.push("    Page := Page - $20;");
        lines.push("    LastVal := LastVal - 1;");
        lines.push("  end;");
    },

    generatePSC(options) {
        options = options || {};
        const algos = (options.algorithms || []).filter((a) => a && (a.addresses || a.copies || a.address !== undefined));
        const chip = options.chip || "25C080";
        const inherit = /^(24C|25C|25LC|93C|95)/i.test(chip) ? chip : "25C080";
        const mode = options.mode || "auto";
        const fileName = options.fileName || "dump.bin";
        const lines = [];
        lines.push("{ VELOCIMETROS CDMX — script UUPROGS / UPA-USB }");
        lines.push("{ AI pack TMS Pascal · " + new Date().toLocaleString() + " }");
        lines.push("{ Origen: " + fileName + " · chip " + chip + " · modo " + mode + " }");
        lines.push("{ No {$IFDEF}. Host: GetSwVersion. Hex: SetByteHexEdit + RefreshHexEdit. }");
        lines.push("uses");
        lines.push("  uuprog, SysUtils;");
        lines.push("");
        lines.push("var");
        lines.push("  Km: integer;");
        lines.push("  Encoded: cardinal;");
        lines.push("  I, Sum, Page, LastVal, Val24: integer;");
        lines.push("  CS, S: string;");
        lines.push("");
        lines.push("function AskKm: integer;");
        lines.push("begin");
        lines.push("  S := InBox('Nuevo KM', '150500');");
        lines.push("  if S = '' then");
        lines.push("    Result := 0");
        lines.push("  else");
        lines.push("    Result := StrToInt(S);");
        lines.push("end;");
        lines.push("");
        algos.forEach((algo, index) => {
            const addrs = algo.addresses || algo.copies || (algo.address !== undefined ? [algo.address] : []);
            const proc = "WriteAlgo" + (index + 1);
            lines.push("procedure " + proc + ";");
            lines.push("begin");
            lines.push("  { " + (algo.name || "ALG") + " · " + (algo.formula || "X") + " · " + (algo.width || 2) + "B " + (algo.endian || "LE") + " }");
            lines.push("  Km := AskKm;");
            lines.push("  if Km <= 0 then Exit;");
            if (algo.familyId === "YAMAHA_R5F10") {
                this.writeR5FPascal(lines, addrs[0] || 0);
            } else {
                lines.push("  Encoded := " + this.pascalExpr(algo.formula, "Km") + ";");
                this.writeBytesPascal(lines, addrs, algo.width || 2, algo.endian || "LE", "Encoded");
                (algo.checksums || []).forEach((c) => this.checksumPascal(lines, c));
            }
            lines.push("  RefreshHexEdit;");
            lines.push("  AddMsg('Escrito " + String(algo.name || proc).replace(/'/g, "") + "');");
            lines.push("end;");
            lines.push("");
        });
        if (!algos.length) {
            lines.push("procedure WriteAlgo1;");
            lines.push("begin");
            lines.push("  ShowMessage('No hay algoritmo elegido. Guarda uno y vuelve a generar.');");
            lines.push("end;");
            lines.push("");
        }
        lines.push("function DetectVersion: integer;");
        lines.push("var");
        lines.push("  N: integer;");
        lines.push("begin");
        lines.push("  Result := 1;");
        lines.push("  N := GetSizeHexEdit;");
        algos.forEach((algo, index) => {
            if (algo.fileSize) {
                lines.push("  if N = " + algo.fileSize + " then Result := " + (index + 1) + ";");
            }
        });
        lines.push("end;");
        lines.push("");
        lines.push("procedure WriteKmAction;");
        lines.push("var");
        lines.push("  Ver: integer;");
        lines.push("begin");
        lines.push("  if GetHexEdit = nil then");
        lines.push("  begin");
        lines.push("    ShowMessage('Abre el dump en el hex editor primero.');");
        lines.push("    Exit;");
        lines.push("  end;");
        if (mode === "auto") {
            lines.push("  Ver := DetectVersion;");
            algos.forEach((algo, index) => {
                lines.push("  if Ver = " + (index + 1) + " then WriteAlgo" + (index + 1) + ";");
            });
            if (!algos.length) lines.push("  WriteAlgo1;");
        } else {
            lines.push("  WriteAlgo1;");
        }
        lines.push("end;");
        lines.push("");
        lines.push("begin");
        lines.push("  { Install-only. Acciones se disparan al elegir el dispositivo. }");
        lines.push("  if (GetSwVersion < 100000) or (GetSwVersion >= 200000) then");
        lines.push("    AddMsg('Aviso: este script apunta a UUPROGS.');");
        lines.push("  AddDeviceGroupEx('VELOCIMETROS CDMX', 'Cluster / EEPROM', '');");
        lines.push("  AddDeviceEx('CDMX_AutoKM', 'Auto KM — " + (mode === "auto" ? "varias versiones" : "algoritmo elegido") + "', 'VELOCIMETROS CDMX', '" + inherit + "', '', '');");
        lines.push("  AddAction('Escribir KM', 'WriteKmAction', 'CDMX_AutoKM');");
        algos.forEach((algo, index) => {
            lines.push("  AddAction('" + String(algo.name || ("Algo " + (index + 1))).replace(/'/g, "") + "', 'WriteAlgo" + (index + 1) + "', 'CDMX_AutoKM');");
        });
        lines.push("end.");
        return lines.join("\r\n");
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
