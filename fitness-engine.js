const FitnessEngine = {

    evaluate(tree, dataset) {
        const rows = dataset || [];
        if (!rows.length) {
            return { score: 0, accuracy: 0, error: 0, samplesMatched: 0, binsMatched: 0, complexity: ExpressionTree.complexity(tree), overfitPenalty: 0 };
        }
        let matched = 0;
        let error = 0;
        const bins = new Set();
        const binsOk = new Set();
        rows.forEach((row) => {
            const got = ExpressionTree.evaluate(tree, row.input);
            const want = Number(row.output) >>> 0;
            const slack = row.slack === undefined ? 0 : row.slack;
            const err = Math.abs(got - want);
            error += err;
            if (row.bin) bins.add(row.bin);
            if (err <= slack) {
                matched++;
                if (row.bin) binsOk.add(row.bin);
            }
        });
        const accuracy = matched / rows.length;
        const complexity = ExpressionTree.complexity(tree);
        const overfit = complexity > 8 ? (complexity - 8) * 1.5 : 0;
        const binBoost = bins.size ? (binsOk.size / bins.size) : accuracy;
        const score = Math.max(0, Math.min(100,
            accuracy * 70 +
            binBoost * 20 +
            (error === 0 ? 10 : 0) -
            overfit
        ));
        return {
            score: Number(score.toFixed(2)),
            accuracy: Number((accuracy * 100).toFixed(2)),
            error: error,
            samplesMatched: matched,
            binsMatched: binsOk.size,
            complexity: complexity,
            overfitPenalty: overfit
        };
    }
};
