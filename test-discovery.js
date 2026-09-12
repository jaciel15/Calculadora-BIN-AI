const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { console: console };
vm.createContext(context);
[
    "operation-registry.js",
    "expression-tree.js",
    "math-engine.js",
    "expression-generator.js",
    "fitness-engine.js",
    "validation-engine.js",
    "discovery-manager.js",
    "deep-attack.js"
].forEach((file) => {
    const raw = fs.readFileSync(path.join(__dirname, file), "utf8");
    const name = (raw.match(/^const\s+(\w+)/) || [])[1];
    const src = raw.replace(/^const\s+(\w+)/, "var $1");
    vm.runInContext(src + (name ? ("\nthis." + name + " = " + name + ";") : ""), context);
});

let failed = 0;
function assert(name, cond) {
    if (!cond) {
        failed++;
        console.log("FAIL " + name);
    } else console.log("OK   " + name);
}

const X = 35000;
const mul = context.ExpressionTree.op("MUL", [context.ExpressionTree.input(), context.ExpressionTree.constant(10)]);
assert("eval X*10", context.ExpressionTree.evaluate(mul, X) === 350000);
assert("math text", context.ExpressionTree.toMath(mul) === "(X * 10)");
assert("serialize", context.ExpressionTree.deserialize(context.ExpressionTree.serialize(mul)).operation === "MUL");
assert("registry XOR", context.OperationRegistry.evaluate("XOR", [90, 10]) === 80);
assert("swap16", context.OperationRegistry.evaluate("SWAP16", [0x1234]) === 0x3412);

const a = new Uint8Array(64);
const b = new Uint8Array(64);
const km1 = 35000;
const km2 = 150500;
a[0] = 0x18; a[1] = 0x57; a[2] = 0x05;
b[0] = 0xE8; b[1] = 0xF6; b[2] = 0x16;
const rows = context.DiscoveryManager.samplesFromPair(a, b, km1, km2, [0], 3, true);
const trees = context.ExpressionGenerator.generate({ samples: rows, maximumCandidates: 120, timeout: 400 });
assert("generator not empty", trees.length > 5);
const fit = context.FitnessEngine.evaluate(mul, rows);
assert("fitness exact pair *10", fit.samplesMatched >= 1);
const check = context.ValidationEngine.validate(mul, rows);
assert("validation has status", !!check.status);
assert("MathEngine.evaluate tree", context.MathEngine.evaluate(mul, 12000) === 120000);
assert("MathEngine.evaluate formula", context.MathEngine.evaluate("X * 10", 12000) === 120000);

const found = context.DiscoveryManager.discoverSync({
    bytes: a,
    bytes2: b,
    km1: km1,
    km2: km2,
    addrs: [0]
});
assert("discovery found something", found.length >= 1);
if (found[0]) {
    console.log("TOP " + found[0].expression + " " + found[0].status + " " + found[0].confidence);
}

assert("apply X/100", context.MathEngine.applyFormula(100000, "X / 100") === 1000);
assert("invert X/100", context.MathEngine.invertFormula(1000, "X / 100") === 100000);
assert("divisors include 100", context.MathEngine.divisorsUpTo(100000, 1000000).indexOf(100) !== -1);
const vars = context.MathEngine.variantsForValue(100000);
const be = vars.find((v) => v.formula === "X / 100" && v.endian === "BE" && v.width === 2);
assert("03 E8 is X/100 BE16", !!(be && be.hex === "03 E8"));
const le = vars.find((v) => v.formula === "X / 100" && v.endian === "LE" && v.width === 2);
assert("E8 03 is X/100 LE16", !!(le && le.hex === "E8 03"));

const d1 = new Uint8Array(32);
const d2 = new Uint8Array(32);
d1[0] = 0x03; d1[1] = 0xE8;
d2[0] = 0x07; d2[1] = 0xD0;
const divRows = context.DiscoveryManager.samplesFromPair(d1, d2, 100000, 200000, [0], 2, false);
const divTree = context.ExpressionTree.op("DIV", [context.ExpressionTree.input(), context.ExpressionTree.constant(100)]);
assert("DIV 100000/100", context.ExpressionTree.evaluate(divTree, 100000) === 1000);
assert("fitness X/100 pair", context.FitnessEngine.evaluate(divTree, divRows).samplesMatched >= 2);
const foundDiv = context.DiscoveryManager.discoverSync({
    bytes: d1,
    bytes2: d2,
    km1: 100000,
    km2: 200000,
    addrs: [0]
});
assert("discovery sees /100", foundDiv.some((h) => String(h.expression).indexOf("/ 100") !== -1 || String(h.expression).indexOf("/100") !== -1));
assert("attack match X/100", !!(context.DeepAttack.matchPair(1000, 2000, 100000, 200000) &&
    context.DeepAttack.matchPair(1000, 2000, 100000, 200000).formula === "X / 100"));
assert("attack match 3rd BIN", !!(context.DeepAttack.matchMany([1000, 2000, 3000], [100000, 200000, 300000]) &&
    context.DeepAttack.matchMany([1000, 2000, 3000], [100000, 200000, 300000]).formula === "X / 100"));
assert("attack rejects bad 3rd", context.DeepAttack.matchMany([1000, 2000, 1111], [100000, 200000, 300000]) === null);

if (failed) {
    console.log("FAILED " + failed);
    process.exit(1);
}
console.log("ALL PASS");
