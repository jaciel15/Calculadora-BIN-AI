let currentBIN = null;

function createBINObject(
    file,
    bytes
){

    const bin = new BINObject();

    bin.fileName = file.name;

    bin.fileSize = bytes.length;

    bin.rawData = bytes;

    return bin;

}
