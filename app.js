const openBtn =
document.getElementById("openBtn");

const fileInput =
document.getElementById("fileInput");

openBtn.onclick = () =>
fileInput.click();

fileInput.addEventListener(
"change",
loadBIN
);

async function loadBIN(event){

    const file =
    event.target.files[0];

    if(!file) return;

    const buffer =
    await file.arrayBuffer();

    const bytes =
    new Uint8Array(buffer);

    currentBIN =
    createBINObject(
        file,
        bytes
    );
    console.log("binCore =", binCore);
    binCore.load(currentBIN);
    document.getElementById(
        "fileName"
    ).textContent =
    currentBIN.fileName;

    document.getElementById(
        "fileSize"
    ).textContent =
    currentBIN.fileSize;

    showHEX(bytes);

}
function createBINObject(file, bytes){

    return {

        // Información del archivo
        fileName: file.name,

        extension: file.name.includes(".")
            ? file.name.split(".").pop().toUpperCase()
            : "",

        fileSize: file.size,

        created: new Date(),

        // Información de la memoria
        bytes: bytes,

        totalBytes: bytes.length,

        // Estado
        loaded: true,

        version: "1.0",

        status: "LOADED"

    };

}
function showHEX(bytes){

    let output = "";

    for(
        let i=0;
        i<bytes.length;
        i+=16
    ){

        let offset =
        i.toString(16)
        .toUpperCase()
        .padStart(4,"0");

        output += offset + " : ";

        for(
            let j=0;
            j<16;
            j++
        ){

            if(
                i+j < bytes.length
            ){

                output +=
                bytes[i+j]
                .toString(16)
                .toUpperCase()
                .padStart(2,"0")
                + " ";

            }

        }

        output += "\n";

    }

    document.getElementById(
        "hexViewer"
    ).textContent = output;

}
