const OperationRegistry = {
    ops: {},

    register(spec) {
        if (!spec || !spec.id || typeof spec.fn !== "function") return;
        this.ops[spec.id] = {
            id: spec.id,
            name: spec.name || spec.id,
            args: spec.args || 1,
            cost: spec.cost || 1,
            description: spec.description || spec.name || spec.id,
            fn: spec.fn
        };
    },

    get(id) {
        return this.ops[id] || null;
    },

    all() {
        return Object.keys(this.ops).map((id) => this.ops[id]);
    },

    evaluate(id, args) {
        const op = this.get(id);
        if (!op) return 0;
        if (!Array.isArray(args) || args.length < op.args) return 0;
        const out = op.fn(args);
        return Number.isFinite(out) ? (out >>> 0) : 0;
    }
};

(function seedOps() {
    const u = (n) => (Number(n) >>> 0);
    const bits = (n, w) => u(n) & (w >= 32 ? 0xFFFFFFFF : ((1 << w) - 1));
    const rol = (n, k, w) => {
        const mask = w >= 32 ? 0xFFFFFFFF : ((1 << w) - 1);
        const v = u(n) & mask;
        const s = ((k % w) + w) % w;
        return ((v << s) | (v >>> (w - s))) & mask;
    };
    const ror = (n, k, w) => {
        const mask = w >= 32 ? 0xFFFFFFFF : ((1 << w) - 1);
        const v = u(n) & mask;
        const s = ((k % w) + w) % w;
        return ((v >>> s) | (v << (w - s))) & mask;
    };
    const revBits = (n) => {
        let v = u(n);
        let out = 0;
        for (let i = 0; i < 32; i++) {
            out = (out << 1) | (v & 1);
            v >>>= 1;
        }
        return out >>> 0;
    };
    const revBytes = (n) => (
        ((n & 0xFF) << 24) | ((n & 0xFF00) << 8) | ((n >> 8) & 0xFF00) | ((n >> 24) & 0xFF)
    ) >>> 0;

    const add = (id, name, args, cost, fn, description) => {
        OperationRegistry.register({ id, name, args, cost, fn, description });
    };

    add("ADD", "ADD", 2, 1, (a) => u(a[0]) + u(a[1]), "Suma");
    add("SUB", "SUB", 2, 1, (a) => u(a[0]) - u(a[1]), "Resta");
    add("MUL", "MUL", 2, 2, (a) => u(a[0]) * u(a[1]), "Multiplicación");
    add("DIV", "DIV", 2, 2, (a) => a[1] ? Math.floor(u(a[0]) / u(a[1])) : 0, "División entera");
    add("MOD", "MOD", 2, 2, (a) => a[1] ? (u(a[0]) % u(a[1])) : 0, "Módulo");
    add("XOR", "XOR", 2, 1, (a) => u(a[0]) ^ u(a[1]), "XOR");
    add("AND", "AND", 2, 1, (a) => u(a[0]) & u(a[1]), "AND");
    add("OR", "OR", 2, 1, (a) => u(a[0]) | u(a[1]), "OR");
    add("NOT", "NOT", 1, 1, (a) => (~u(a[0])) >>> 0, "NOT 32");
    add("SHIFT_LEFT", "SHL", 2, 1, (a) => u(a[0]) << (u(a[1]) & 31), "Shift left");
    add("SHIFT_RIGHT", "SHR", 2, 1, (a) => u(a[0]) >>> (u(a[1]) & 31), "Shift right");
    add("ROTATE_LEFT", "ROL16", 2, 2, (a) => rol(a[0], a[1], 16), "Rotate left 16");
    add("ROTATE_RIGHT", "ROR16", 2, 2, (a) => ror(a[0], a[1], 16), "Rotate right 16");
    add("REVERSE_BITS", "REVBITS", 1, 3, (a) => revBits(a[0]), "Reverse bits");
    add("REVERSE_BYTES", "REVBYTES", 1, 2, (a) => revBytes(a[0]), "Reverse bytes");
    add("SWAP16", "SWAP16", 1, 1, (a) => ((u(a[0]) & 0xFF) << 8) | ((u(a[0]) >> 8) & 0xFF), "Swap 16");
    add("SWAP32", "SWAP32", 1, 2, (a) => revBytes(a[0]), "Swap 32");
    add("NIBBLE_SWAP", "NIBBLE", 1, 2, (a) => {
        let n = u(a[0]);
        let out = 0;
        let sh = 0;
        for (let i = 0; i < 4; i++) {
            const lo = n & 0x0F;
            const hi = (n >> 4) & 0x0F;
            out |= ((lo << 4) | hi) << sh;
            n >>>= 8;
            sh += 8;
        }
        return out >>> 0;
    }, "Nibble swap");
    add("COMPLEMENT", "COMP8", 1, 1, (a) => (256 - (u(a[0]) & 0xFF)) & 0xFF, "Complemento 8");
    add("ABS", "ABS", 1, 1, (a) => Math.abs(Number(a[0])) >>> 0, "Absoluto");
    add("UINT8", "UINT8", 1, 1, (a) => bits(a[0], 8), "Corta a 8 bits");
    add("UINT16", "UINT16", 1, 1, (a) => bits(a[0], 16), "Corta a 16 bits");
    add("UINT24", "UINT24", 1, 1, (a) => u(a[0]) & 0xFFFFFF, "Corta a 24 bits");
    add("UINT32", "UINT32", 1, 1, (a) => u(a[0]), "32 bits");
})();
