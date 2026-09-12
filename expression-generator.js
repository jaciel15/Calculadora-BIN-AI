const ExpressionGenerator = {

    defaults() {
        return {
            maximumDepth: 3,
            maximumCandidates: 400,
            maximumConstants: 24,
            timeout: 800,
            beamWidth: 40
        };
    },

    inferredConstants(samples) {
        const out = new Set([0, 1, 2, 5, 8, 10, 16, 32, 64, 100, 256, 1000]);
        (samples || []).forEach((row) => {
            const x = Number(row.input);
            const y = Number(row.output);
            if (!x || !Number.isFinite(y)) return;
            const mul = Math.round(y / x);
            if (mul >= 1 && mul <= 1000000) out.add(mul);
            if (y && x % y === 0) {
                const div = x / y;
                if (div >= 1 && div <= 1000000) out.add(div);
            }
            if (x && y % x === 0) {
                const mulExact = y / x;
                if (mulExact >= 1 && mulExact <= 1000000) out.add(mulExact);
            }
            out.add((y - x) >>> 0);
            out.add((x - y) >>> 0);
            out.add((y ^ x) >>> 0);
            if (y % 10 === 9 || y % 10 === 1) out.add(1);
        });
        return Array.from(out).filter((n) => n >= 0 && n <= 0xFFFFFF).slice(0, 24);
    },

    generate(config) {
        const opt = Object.assign(this.defaults(), config || {});
        const started = Date.now();
        const seen = new Set();
        const trees = [];
        const push = (node) => {
            if (trees.length >= opt.maximumCandidates) return false;
            if (Date.now() - started > opt.timeout) return false;
            if (ExpressionTree.complexity(node) > 12) return false;
            const id = ExpressionTree.id(node);
            if (seen.has(id)) return false;
            seen.add(id);
            trees.push(node);
            return trees.length < opt.maximumCandidates;
        };

        push(ExpressionTree.input());
        const ks = this.inferredConstants(opt.samples).slice(0, opt.maximumConstants);
        const unary = ["NOT", "SWAP16", "NIBBLE_SWAP", "COMPLEMENT", "UINT8", "UINT16", "UINT24"];
        const binary = ["ADD", "SUB", "MUL", "XOR", "AND", "OR"];

        unary.forEach((op) => push(ExpressionTree.op(op, [ExpressionTree.input()])));
        ks.forEach((k) => {
            binary.forEach((op) => push(ExpressionTree.op(op, [ExpressionTree.input(), ExpressionTree.constant(k)])));
            push(ExpressionTree.op("DIV", [ExpressionTree.input(), ExpressionTree.constant(k || 1)]));
            push(ExpressionTree.op("MOD", [ExpressionTree.input(), ExpressionTree.constant(k || 1)]));
            push(ExpressionTree.op("SHIFT_LEFT", [ExpressionTree.input(), ExpressionTree.constant(k & 15)]));
            push(ExpressionTree.op("SHIFT_RIGHT", [ExpressionTree.input(), ExpressionTree.constant(k & 15)]));
        });

        if (opt.maximumDepth >= 2) {
            const first = trees.slice(0, opt.beamWidth);
            first.forEach((left) => {
                if (left.type === "input") return;
                ks.slice(0, 8).forEach((k) => {
                    ["ADD", "SUB", "XOR", "MUL"].forEach((op) => {
                        push(ExpressionTree.op(op, [left, ExpressionTree.constant(k)]));
                    });
                });
                unary.slice(0, 3).forEach((op) => push(ExpressionTree.op(op, [left])));
            });
        }

        if (opt.maximumDepth >= 3) {
            const second = trees.slice(0, opt.beamWidth);
            second.forEach((left) => {
                ks.slice(0, 4).forEach((k) => {
                    push(ExpressionTree.op("MOD", [left, ExpressionTree.constant(k || 1)]));
                    push(ExpressionTree.op("XOR", [left, ExpressionTree.constant(k)]));
                });
            });
        }

        return trees;
    }
};
