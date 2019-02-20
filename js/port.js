

export default class PseudoPort {

    constructor (ports) {
        this.ports = ports;
    }

    async postMessage (msg) {
	/// hmmm !!!???!!!!
	
        if (typeof msg !== "string") {
            msg = JSON.stringify(msg);
        }

        await this.ports.forEach(async (port, key) => {
            await port.postMessage(msg);
        });
    }
}
