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
        m = f.match(/^X \/ (\d+)$/);
        if (m) return "(" + km + " div " + m[1] + ")";
        m = f.match(/^X XOR ([0-9A-F]+)$/i);
        if (m) return "(" + km + " xor $" + m[1] + ")";
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (m) return "((" + km + " xor $" + m[1] + ") * " + m[2] + ")";
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+) \+ (\d+)$/i);
        if (m) return "((" + km + " xor $" + m[1] + ") * " + m[2] + " + " + m[3] + ")";
        return km;
    },

    pascalInvert(formula, encoded) {
        const f = String(formula || "X");
        if (f === "X") return encoded;
        if (f === "X * 10") return "(" + encoded + " div 10)";
        let m = f.match(/^X \* (\d+)$/);
        if (m) return "(" + encoded + " div " + m[1] + ")";
        m = f.match(/^X \/ (\d+)$/);
        if (m) return "(" + encoded + " * " + m[1] + ")";
        m = f.match(/^X \+ (\d+)$/);
        if (m) return "(" + encoded + " - " + m[1] + ")";
        m = f.match(/^X - (\d+)$/);
        if (m) return "(" + encoded + " + " + m[1] + ")";
        m = f.match(/^X \* (\d+) - (\d+)$/);
        if (m) return "((" + encoded + " + " + m[2] + ") div " + m[1] + ")";
        m = f.match(/^X \* (\d+) \+ (\d+)$/);
        if (m) return "((" + encoded + " - " + m[2] + ") div " + m[1] + ")";
        return encoded;
    },

    readBytesPascal(lines, addr, width, endian, varName) {
        const little = endian !== "BE";
        lines.push("  " + varName + " := 0;");
        for (let i = 0; i < width; i++) {
            const shift = little ? i * 8 : (width - 1 - i) * 8;
            if (shift === 0) lines.push("  " + varName + " := GetByteHexEdit(" + this.hexConst(addr + i) + ");");
            else lines.push("  " + varName + " := " + varName + " + (GetByteHexEdit(" + this.hexConst(addr + i) + ") shl " + shift + ");");
        }
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
        const inherit = /^(24C|25C|25LC|93C|95|R5F)/i.test(chip) ? chip : "25C080";
        const mode = options.mode || "auto";
        const kind = options.kind || (mode === "auto" ? "auto" : "write");
        const wantRead = kind === "read" || kind === "auto";
        const wantWrite = kind === "write" || kind === "auto";
        const fileName = options.fileName || "dump.bin";
        const lines = [];
        const clean = (s) => String(s || "").replace(/'/g, "");
        lines.push("{ VELOCIMETROS CDMX — script UUPROGS / UPA-USB }");
        lines.push("{ AI pack TMS Pascal 1.2.2 · " + new Date().toLocaleString() + " }");
        lines.push("{ Origen: " + fileName + " · chip " + chip + " · " + kind + " · " + algos.length + " versiones }");
        lines.push("{ No {$IFDEF}. Host: GetSwVersion 100000..199999 = UUPROGS. }");
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
        lines.push("  S := InBox('Nuevo KM', '12000');");
        lines.push("  if S = '' then Result := 0 else Result := StrToInt(S);");
        lines.push("end;");
        lines.push("");
        lines.push("function DetectVersion: integer;");
        lines.push("var");
        lines.push("  N, B0: integer;");
        lines.push("begin");
        lines.push("  Result := 1;");
        lines.push("  if GetHexEdit = nil then Exit;");
        lines.push("  N := GetSizeHexEdit;");
        algos.forEach((algo, index) => {
            const n = index + 1;
            if (algo.fileSize) lines.push("  if N = " + algo.fileSize + " then Result := " + n + ";");
            const addr = (algo.addresses || algo.copies || [algo.address])[0];
            if (addr !== undefined) {
                lines.push("  if N > " + Number(addr) + " then");
                lines.push("  begin");
                lines.push("    B0 := GetByteHexEdit(" + this.hexConst(addr) + ");");
                lines.push("    if B0 <> $FF then Result := " + n + ";");
                lines.push("  end;");
            }
        });
        lines.push("end;");
        lines.push("");
        if (wantWrite) {
            if (!algos.length) {
                lines.push("procedure WriteAlgo1;");
                lines.push("begin");
                lines.push("  ShowMessage('No hay algoritmo. Guarda uno y vuelve a generar.');");
                lines.push("end;");
                lines.push("");
            }
            algos.forEach((algo, index) => {
                const addrs = algo.addresses || algo.copies || (algo.address !== undefined ? [algo.address] : []);
                lines.push("procedure WriteAlgo" + (index + 1) + ";");
                lines.push("begin");
                lines.push("  { WRITE " + clean(algo.name) + " · " + clean(algo.formula) + " · v" + (algo.version || 1) + " }");
                lines.push("  Km := AskKm;");
                lines.push("  if Km <= 0 then Exit;");
                if (algo.familyId === "YAMAHA_R5F10") this.writeR5FPascal(lines, addrs[0] || 0);
                else {
                    lines.push("  Encoded := " + this.pascalExpr(algo.formula, "Km") + ";");
                    this.writeBytesPascal(lines, addrs, algo.width || 2, algo.endian || "LE", "Encoded");
                    (algo.checksums || []).forEach((c) => this.checksumPascal(lines, c));
                }
                lines.push("  RefreshHexEdit;");
                lines.push("  AddMsg('Escrito " + clean(algo.name) + "');");
                lines.push("end;");
                lines.push("");
            });
            lines.push("procedure WriteKmAction;");
            lines.push("var");
            lines.push("  Ver: integer;");
            lines.push("begin");
            lines.push("  if GetHexEdit = nil then");
            lines.push("  begin");
            lines.push("    ShowMessage('Abre o lee el dump en el hex editor primero.');");
            lines.push("    Exit;");
            lines.push("  end;");
            if (mode === "auto" || kind === "auto") {
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
            lines.push("procedure ProgramAction;");
            lines.push("begin");
            lines.push("  WriteKmAction;");
            lines.push("  if not ProgramDevice(True) then");
            lines.push("    AddMsg('ProgramDevice fallo. Pega el error en VELOCIMETROS CDMX.');");
            lines.push("end;");
            lines.push("");
        }
        if (wantRead) {
            if (!algos.length) {
                lines.push("procedure ReadAlgo1;");
                lines.push("begin");
                lines.push("  ShowMessage('No hay algoritmo de lectura.');");
                lines.push("end;");
                lines.push("");
            }
            algos.forEach((algo, index) => {
                const addrs = algo.addresses || algo.copies || (algo.address !== undefined ? [algo.address] : []);
                const addr = addrs[0] || 0;
                lines.push("procedure ReadAlgo" + (index + 1) + ";");
                lines.push("begin");
                lines.push("  { READ " + clean(algo.name) + " · " + clean(algo.formula) + " · v" + (algo.version || 1) + " }");
                this.readBytesPascal(lines, addr, algo.width || 2, algo.endian || "LE", "Encoded");
                lines.push("  Km := " + this.pascalInvert(algo.formula, "Encoded") + ";");
                lines.push("  AddMsg('Version " + clean(algo.name) + " KM=' + IntToStr(Km) + ' raw=' + IntToHex(Encoded, 6));");
                lines.push("end;");
                lines.push("");
            });
            lines.push("procedure ReadKmAction;");
            lines.push("var");
            lines.push("  Ver: integer;");
            lines.push("begin");
            lines.push("  if not ReadDevice then");
            lines.push("  begin");
            lines.push("    AddMsg('ReadDevice fallo. Revisa chip, conexion y UUSP.');");
            lines.push("    Exit;");
            lines.push("  end;");
            lines.push("  if GetHexEdit = nil then Exit;");
            if (mode === "auto" || kind === "auto") {
                lines.push("  Ver := DetectVersion;");
                algos.forEach((algo, index) => {
                    lines.push("  if Ver = " + (index + 1) + " then ReadAlgo" + (index + 1) + ";");
                });
                if (!algos.length) lines.push("  ReadAlgo1;");
            } else {
                lines.push("  ReadAlgo1;");
            }
            lines.push("end;");
            lines.push("");
        }
        lines.push("begin");
        lines.push("  { Install-only. Create/Destroy van vacios: no hay form extra. }");
        lines.push("  if (GetSwVersion < 100000) or (GetSwVersion >= 200000) then");
        lines.push("    AddMsg('Aviso: este script apunta a UUPROGS (GetSwVersion 100000-199999).');");
        lines.push("  AddDeviceGroupEx('VELOCIMETROS CDMX', 'Cluster / EEPROM', '');");
        lines.push("  AddDeviceEx('CDMX_AutoKM', 'Auto KM " + kind + " · " + algos.length + " ver', 'VELOCIMETROS CDMX', '" + inherit + "', '', '');");
        if (wantRead) {
            lines.push("  AddAction('Leer KM', 'ReadKmAction', 'CDMX_AutoKM');");
            algos.forEach((algo, index) => {
                lines.push("  AddAction('Leer " + clean(algo.name || ("v" + (index + 1))) + "', 'ReadAlgo" + (index + 1) + "', 'CDMX_AutoKM');");
            });
        }
        if (wantWrite) {
            lines.push("  AddAction('Escribir KM', 'WriteKmAction', 'CDMX_AutoKM');");
            lines.push("  AddAction('Programar chip', 'ProgramAction', 'CDMX_AutoKM');");
            algos.forEach((algo, index) => {
                lines.push("  AddAction('Escribir " + clean(algo.name || ("v" + (index + 1))) + "', 'WriteAlgo" + (index + 1) + "', 'CDMX_AutoKM');");
            });
        }
        lines.push("end.");
        return lines.join("\r\n");
    },

    analyzeError(text) {
        const t = String(text || "").toLowerCase();
        const tips = [];
        if (!t.trim()) return "Pega el error del UPA (pantalla roja, log o mensaje).";
        if (/cc error|certificate|digital signing/.test(t)) {
            tips.push("CC Error: Windows sin parches o falta el certificado Elrasoft. Instala es_cert y reinicia UPA.");
        }
        if (/gethexedit|hex editor|nil/.test(t)) {
            tips.push("No hay dump en el hex. Primero pulsa Leer KM / ReadDevice o abre el BIN.");
        }
        if (/readdevice/.test(t)) {
            tips.push("ReadDevice falló: chip heredado mal, clip/socket, 5V/3V, o UUSP no activo.");
        }
        if (/programdevice|verifydevice|verify/.test(t)) {
            tips.push("La escritura o el verify falló: fórmula/versión mala, checksum, o rango. Prueba otra versión o edita el .psc.");
        }
        if (/getswversion|uuprogs|uucan/.test(t)) {
            tips.push("Host equivocado. Este .psc es para UUPROGS (GetSwVersion 100000–199999), no UUCAN.");
        }
        if (/undeclared|unknown identifier|uses/.test(t)) {
            tips.push("Error de TMS Pascal: revisa uses uuprog, SysUtils; no uses {$IFDEF}.");
        }
        if (/adddevice|inherited|25c|93c|24c/.test(t)) {
            tips.push("El dispositivo heredado no existe en tu árbol. Cambia el inherit al chip real (24C04, 93C86, 25C080…).");
        }
        if (!tips.length) {
            tips.push("No reconocí el código. Revisa: 1) chip, 2) versión del algoritmo, 3) que el hex tenga el dump, 4) pega más líneas del log.");
        }
        return tips.join(" ");
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
