const ExpressionTree = {

    input() {
        return { type: "input" };
    },

    constant(value) {
        return { type: "constant", value: Number(value) >>> 0 };
    },

    op(operation, children) {
        return { type: "operation", operation: operation, children: children || [] };
    },

    evaluate(node, input) {
        if (!node) return 0;
        if (node.type === "input") return Number(input) >>> 0;
        if (node.type === "constant") return Number(node.value) >>> 0;
        if (node.type === "operation") {
            const kids = (node.children || []).map((child) => this.evaluate(child, input));
            return OperationRegistry.evaluate(node.operation, kids);
        }
        return 0;
    },

    complexity(node) {
        if (!node) return 0;
        if (node.type === "input") return 1;
        if (node.type === "constant") return 1;
        const op = OperationRegistry.get(node.operation);
        const cost = op ? op.cost : 1;
        return cost + (node.children || []).reduce((n, child) => n + this.complexity(child), 0);
    },

    toMath(node) {
        if (!node) return "?";
        if (node.type === "input") return "X";
        if (node.type === "constant") return String(node.value);
        const kids = (node.children || []).map((child) => this.toMath(child));
        if (kids.length === 1) return node.operation + "(" + kids[0] + ")";
        if (kids.length === 2) {
            const mid = { ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD", XOR: "XOR", AND: "AND", OR: "OR" }[node.operation];
            if (mid) return "(" + kids[0] + " " + mid + " " + kids[1] + ")";
        }
        return node.operation + "(" + kids.join(", ") + ")";
    },

    id(node) {
        return this.toMath(node);
    },

    serialize(node) {
        return JSON.stringify(node);
    },

    deserialize(raw) {
        return typeof raw === "string" ? JSON.parse(raw) : raw;
    },

    same(a, b) {
        return this.id(a) === this.id(b);
    },

    fromFormula(formula) {
        const f = String(formula || "X").trim();
        if (f === "X") return this.input();
        let m = f.match(/^X\s*\*\s*(\d+)$/);
        if (m) return this.op("MUL", [this.input(), this.constant(m[1])]);
        m = f.match(/^X\s*\+\s*(\d+)$/);
        if (m) return this.op("ADD", [this.input(), this.constant(m[1])]);
        m = f.match(/^X\s*-\s*(\d+)$/);
        if (m) return this.op("SUB", [this.input(), this.constant(m[1])]);
        m = f.match(/^X\s*\/\s*(\d+)$/);
        if (m) return this.op("DIV", [this.input(), this.constant(m[1])]);
        m = f.match(/^X XOR ([0-9A-F]+)$/i);
        if (m) return this.op("XOR", [this.input(), this.constant(parseInt(m[1], 16))]);
        m = f.match(/^\(X XOR ([0-9A-F]+)\) \* (\d+)$/i);
        if (m) {
            return this.op("MUL", [
                this.op("XOR", [this.input(), this.constant(parseInt(m[1], 16))]),
                this.constant(m[2])
            ]);
        }
        m = f.match(/^X\s*\*\s*(\d+)\s*-\s*(\d+)$/);
        if (m) return this.op("SUB", [this.op("MUL", [this.input(), this.constant(m[1])]), this.constant(m[2])]);
        m = f.match(/^X\s*\*\s*(\d+)\s*\+\s*(\d+)$/);
        if (m) return this.op("ADD", [this.op("MUL", [this.input(), this.constant(m[1])]), this.constant(m[2])]);
        return this.input();
    }
};
