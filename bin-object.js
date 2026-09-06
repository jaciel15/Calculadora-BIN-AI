class BINObject {

    constructor(file, bytes) {
        this.fileName = file ? file.name : "";
        this.extension = this.fileName.includes(".")
            ? this.fileName.split(".").pop().toUpperCase()
            : "";
        this.fileSize = file ? file.size : (bytes ? bytes.length : 0);
        this.created = new Date();
        this.bytes = bytes || new Uint8Array();
        this.original = new Uint8Array(this.bytes);
        this.working = new Uint8Array(this.bytes);
        this.totalBytes = this.bytes.length;
        this.chip = Hunters.detectChip(this.totalBytes);
        this.loaded = !!bytes;
        this.version = "1.0";
        this.status = this.loaded ? "LOADED" : "EMPTY";
        this.knownKm = null;
        this.knownHours = null;
        this.analysis = null;
    }

}
