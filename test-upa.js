const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { console: console };
vm.createContext(context);
["math-engine.js", "editor-upa.js"].forEach((file) => {
    const raw = fs.readFileSync(path.join(__dirname, file), "utf8");
    const name = (raw.match(/^const\s+(\w+)/) || [])[1];
    vm.runInContext(raw.replace(/^const\s+(\w+)/, "var $1") + (name ? ("\nthis." + name + " = " + name + ";") : ""), context);
});

let failed = 0;
function assert(name, cond) {
    if (!cond) {
        failed++;
        console.log("FAIL " + name);
    } else console.log("OK   " + name);
}

const algos = [{
    name: "Yamaha R5F10 anillo 32B",
    formula: "X * 10",
    width: 3,
    endian: "LE",
    address: 0x260,
    copies: [0x260, 0x240],
    fileSize: 8192,
    version: 2,
    familyId: "YAMAHA_R5F10"
}, {
    name: "Genérico X/100",
    formula: "X / 100",
    width: 2,
    endian: "BE",
    address: 0x10,
    copies: [0x10],
    fileSize: 2048,
    version: 1
}];

const read = context.EditorEngine.generatePSC({ algorithms: algos, kind: "read", mode: "auto", chip: "R5F10" });
const write = context.EditorEngine.generatePSC({ algorithms: algos, kind: "write", mode: "auto", chip: "R5F10" });
const auto = context.EditorEngine.generatePSC({ algorithms: algos, kind: "auto", mode: "auto", chip: "R5F10" });

assert("read has ReadDevice", read.indexOf("ReadDevice") !== -1);
assert("read has ReadAlgo", read.indexOf("ReadAlgo1") !== -1);
assert("read has GetByteHexEdit", read.indexOf("GetByteHexEdit") !== -1);
assert("read no ProgramDevice", read.indexOf("ProgramDevice") === -1);
assert("write has SetByteHexEdit", write.indexOf("SetByteHexEdit") !== -1);
assert("write has AskKm", write.indexOf("AskKm") !== -1);
assert("write has DetectVersion", write.indexOf("DetectVersion") !== -1);
assert("auto has both", auto.indexOf("ReadKmAction") !== -1 && auto.indexOf("WriteKmAction") !== -1);
assert("no IFDEF", auto.indexOf("{$IFDEF ") === -1);
assert("uses uuprog", auto.indexOf("uuprog") !== -1);
assert("AddDeviceEx", auto.indexOf("AddDeviceEx") !== -1);
assert("div 10 invert", read.indexOf("div 10") !== -1);
assert("X/100 encode", write.indexOf("div 100") !== -1);
assert("cc error tip", /certificado|CC Error/i.test(context.EditorEngine.analyzeError("CC Error certificate")));
assert("hex nil tip", /hex/i.test(context.EditorEngine.analyzeError("GetHexEdit is nil")));

if (failed) {
    console.log("FAILED " + failed);
    process.exit(1);
}
console.log("ALL PASS");
