

export class WorkerRequest {
    static NOT_DONE_YET = 7;
    static COMPLETE = 23;
    cmd = null;

    constructor (worker, uuid, from, cmd, params, reader, writer) {
        this.worker = worker;
        this.uuid = uuid;
        this.from = from;
        this._cmd = cmd;
        this.params = params;
        this.reader = reader;
        this.writer = writer;
        this.resolve();
    }

    resolve () {
        if (this.cmdName.startsWith('server.')) {
            return;
        } else if (Object.keys(this.worker.commands).indexOf(this.cmdName) !== -1) {
            this.cmd = new this.worker.commands[this.cmdName](this);
        }
    }

    get cmdName () {
        return this._cmd.substr(7);
    }

    update = async (part) => {
        // test for reader ?
        if (this.cmd) {
	    await this.cmd.update(part);
        }
    }

    dispatch = async () => {
        if (this.cmdName.startsWith('server.')) {
            // proxy to server
            await this.handleServerCommand();
        } else if (this.cmd !== null) {
            await this.handleWorkerCommand();
        }
    }

    get _writer () {
        const {uuid} = this;
	return {
            write: async (response) => {
                response.uuid = uuid;
	        await this.worker.port.postMessage(response);
            }
        };
    }

    async callServer (_writer) {
        const {params, reader, worker} = this;
	const _params = {params}
	if (reader) {
	    _params.reader = reader;
	}
	if (_writer) {
	    _params.writer = _writer
	}	
	return await worker.server.call(
	    {cmd: this.cmdName.substr(7),
             ..._params});
    }

    handleServerCommand = async () => {
        const {uuid, worker, writer} = this;
        let _writer;
        if (writer) {
            _writer = this._writer;
        }
        const response = await this.callServer(_writer);
        if (!writer) {
            response.uuid = uuid;
	    await worker.port.postMessage(response);
        }
    }

    _run = async () => {
	try {
	    return await this.cmd.respond();
	} catch (err) {
	    console.error('failed running worker command', err);
	    this.worker.logs.log(
		'worker',
		'workerLogErrorRunningCommand',
		{type: 'error', info: err.toString()})
	}
    }
    
    handleWorkerCommand = async () => {
        const {writer, uuid} = this;
        while (true) {
	    let response = await this._run();
	    let msg = {uuid, response};
            if (writer) {
                msg.status =(
		    response
			? WorkerRequest.NOT_DONE_YET
                        : this.COMPLETE);
            }
	    this.worker.port.postMessage(msg);            
	    if (!response || !writer) {
		break;
	    }
        }
    }
}
