const ValidationEngine = {

    bands: [
        { max: 40, status: "NO CONFIABLE" },
        { max: 70, status: "DÉBIL" },
        { max: 85, status: "POSIBLE" },
        { max: 95, status: "FUERTE" },
        { max: 100, status: "MUY FUERTE" }
    ],

    band(score) {
        const n = Number(score) || 0;
        for (let i = 0; i < this.bands.length; i++) {
            if (n <= this.bands[i].max) return this.bands[i].status;
        }
        return "MUY FUERTE";
    },

    split(dataset) {
        const rows = dataset || [];
        if (rows.length < 2) return { train: rows, test: rows.slice() };
        const train = [];
        const test = [];
        rows.forEach((row, i) => {
            if (i % 2 === 0) train.push(row);
            else test.push(row);
        });
        if (!test.length) test.push(rows[rows.length - 1]);
        return { train, test };
    },

    validate(tree, dataset) {
        const parts = this.split(dataset);
        const train = FitnessEngine.evaluate(tree, parts.train);
        const test = FitnessEngine.evaluate(tree, parts.test);
        const independent = test.accuracy >= 80 && test.samplesMatched > 0;
        const confidence = Number((train.score * 0.45 + test.score * 0.55).toFixed(2));
        const status = independent && test.accuracy >= 95 && train.accuracy >= 95
            ? "VALIDATED"
            : (confidence >= 85 ? "POSSIBLE" : "REJECTED");
        return {
            train: train,
            test: test,
            confidence: confidence,
            label: this.band(confidence),
            status: status,
            independent: independent
        };
    }
};
