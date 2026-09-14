/* Node check: ATAQUE only uses bytes that change, not Yamaha paint. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
global.window = global;
global.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
};
global.Hunters = { range() { return ""; }, hexAddr() { return ""; }, huntVIN() { return []; } };
["math-engine.js", "checksum-engine.js", "family-library.js", "knowledge-base.js", "editor-upa.js", "deep-attack.js"].forEach((name) => {
    const file = path.join(root, name);
    const src = fs.readFileSync(file, "utf8").replace(/^const (\w+) = /gm, "global.$1 = ");
    vm.runInThisContext(src, { filename: name });
});

function makeDump(km, copies) {
    const bytes = new Uint8Array(65536).fill(0xEB);
    const encoded = MathEngine.toBytes(km, 3, true);
    const sum = ChecksumEngine.sum8(encoded, 0, 3);
    for (let i = 0; i < copies; i++) {
        const page = 0x2C40 + i * 16;
        bytes[page + 4] = 0xAA;
        bytes[page + 5] = 0xAA;
        bytes[page + 6] = 0xAA;
        bytes[page + 7] = 0xAA;
        bytes[page + 8] = 0xAA;
        bytes[page + 9] = 0xAA;
        bytes[page + 10] = 0xAA;
        bytes[page + 11] = 0xAA;
        bytes[page + 12] = 0xF0;
        bytes.set(encoded, page + 13);
        bytes[page + 1] = sum;
    }
    return bytes;
}

function paintOldAlgo(src, km) {
    const out = new Uint8Array(src);
    const encoded = MathEngine.toBytes(km, 2, true);
    for (let p = 0; p < out.length; p += 16) out.set(encoded, p);
    return out;
}

async function main() {
    const a = makeDump(113171, 8);
    const b = makeDump(150000, 8);
    const c = makeDump(180000, 8);
    fs.mkdirSync(path.join(root, "samples"), { recursive: true });
    fs.writeFileSync(path.join(root, "samples", "tracker-km1-113171.bin"), Buffer.from(a));
    fs.writeFileSync(path.join(root, "samples", "tracker-km2-150000.bin"), Buffer.from(b));
    fs.writeFileSync(path.join(root, "samples", "tracker-km3-180000.bin"), Buffer.from(c));

    const report = await DeepAttack.run({
        bytes: a,
        bytes2: b,
        bytes3: c,
        km1: 113171,
        km2: 150000,
        km3: 180000
    });
    if (!report.ok || !report.best) {
        throw new Error("Ataque no descifró el par: " + report.message);
    }
    if (report.best.formula !== "X") {
        throw new Error("Fórmula mala: " + report.best.formula);
    }
    if (report.best.address !== 0x2C4D) {
        throw new Error("Dirección mala: 0x" + report.best.address.toString(16));
    }
    if (report.best.copies.length !== 8) {
        throw new Error("Copias de más o de menos: " + report.best.copies.length);
    }
    if (report.best.familyId) {
        throw new Error("No debe colgar familia Yamaha: " + report.best.familyId);
    }
    if (!report.best.checksumName) {
        throw new Error("No ligó checksum/CRC");
    }

    const written = EditorEngine.apply(a, report.best, 99999);
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== written.bytes[i]) changed++;
    if (changed > 64) {
        throw new Error("La escritura pintó el archivo (" + changed + " bytes).");
    }
    const raw = MathEngine.fromBytes(written.bytes, 0x2C4D, 3, true);
    if (raw !== 99999) throw new Error("No escribió el KM nuevo: " + raw);

    const painted = paintOldAlgo(a, 2500);
    const bad = await DeepAttack.run({ bytes: painted, bytes2: a, km1: 2500, km2: 113171 });
    if (bad.ok && bad.best) {
        throw new Error("Debió rechazar el dump pintado, no escribir otro algoritmo.");
    }

    console.log("OK", report.best.formula, report.best.addressText, report.best.checksumName, "copias", report.best.copies.length, "writeBytes", changed);
}

main().catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
});
