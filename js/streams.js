
export class WorkerStreamWriter {

    constructor (out) {
	this.out = out;
    }

    write = async (msg) => {
	this.out.push(msg);
    }

    close () {
    }
}


export class WorkerStreamReader {
    _msg = 'helo, worker'
    _count = 0;

    read = async (msg) => {
	if (this._count === this._msg.length) {
	    return;
	}
	const _read = this._msg.charAt(this._count);
	this._count = this._count + 1;
	return _read;
    }

    close () {

    }
}

// const resultWorker = await this.app.worker.call('motd', params, null, writer);
// const _params = {
//    cmd: 'motd',
//    params}
// const resultServer = await this.app.server.call(_params);
