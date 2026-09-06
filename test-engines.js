const fs = require("fs");
const path = require("path");
const vm = require("vm");

const localStorageData = {};
const context = {
    console,
    localStorage: {
        getItem: (k) => localStorageData[k] || null,
        setItem: (k, v) => { localStorageData[k] = String(v); }
    }
};
vm.createContext(context);

[
    "math-engine.js",
    "checksum-engine.js",
    "knowledge-base.js",
    "hunters.js",
    "dna-discovery.js",
    "editor-upa.js",
    "bin-object.js",
    "bin-core.js"
].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
});

const bytes = new Uint8Array(2048);
const km = 25340;
const encoded = context.MathEngine.toBytes((km ^ 0xFF) * 16 + 3, 4, true);
bytes.set(encoded, 0x48);
bytes.set(encoded, 0x80);
bytes.set(encoded, 0xC0);
const vin = "ACCT-000019";
for (let i = 0; i < vin.length; i++) bytes[0x200 + i] = vin.charCodeAt(i);
const crc = context.ChecksumEngine.crc16(bytes, 0x40, 0x50);
bytes[0x50] = crc & 0xFF;
bytes[0x51] = (crc >> 8) & 0xFF;

const file = { name: "MT09_TEST.bin", size: bytes.length };
const bin = new context.BINObject(file, bytes);
context.binCore.load(bin);
const analysis = context.binCore.analyze(km, null);

const best = analysis.best;
if (!best) throw new Error("No encontró algoritmo");
if (best.copies.length < 3) throw new Error("No encontró las 3 copias");
if (best.address !== 0x48) throw new Error("Dirección incorrecta: " + best.address);

const sim = context.binCore.applyValue(125000);
const decodedHits = context.Hunters.huntValue(bin.working, 125000, "KILOMETRAJE");
if (!decodedHits.length) throw new Error("El nuevo KM no quedó escrito de forma recuperable");

const upa = context.binCore.generateUPA();
if (upa.indexOf("[WRITE]") === -1) throw new Error("UPA sin bloque WRITE");

console.log("OK formula:", best.formula);
console.log("OK address:", best.addressText);
console.log("OK copies:", best.copies.length);
console.log("OK confidence:", best.confidence);
console.log("OK DNA:", analysis.dna.score);
console.log("OK new hex:", sim.applied.hex);
console.log("OK VIN:", analysis.vins[0] && analysis.vins[0].value);
console.log("OK UPA lines:", upa.split(/\r?\n/).length);
