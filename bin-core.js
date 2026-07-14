class BINCore {

    constructor() {
        this.currentBIN = null;
    }

    load(binObject) {
        this.currentBIN = binObject;

        console.log("BIN Core iniciado");
        console.log(this.currentBIN);
    }

}

const binCore = new BINCore();