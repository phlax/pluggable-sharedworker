
// eslint-disable-next-line
import SharedWorker from '@pluggable/sharedworker-loader/connect.shared-worker.js';

import {WorkerRequest} from './request';


export class SharedWorkerRunner {
    debugName = 'app:worker'

    constructor (worker) {
	this.log = worker.app.debug(this.debugName)
	this.worker = worker;
	this.app = worker.app;
    }

    call = async (args) => {
	const {writer} = args;
	return await this._run(
	    args,
	    this._todo.bind(this, args),
	    writer
		? this._resolves.bind(this, args)
		: null)
    }

    _getArgs = (uuid, args, chunk, status) => {
	const {cmd, data, params, reader, writer} = args;
	const _args = {
	    uuid,
	    data,
	    cmd: 'worker.' + cmd,
	    ...params}
	if (reader) {
 	    _args.reader = true;
	}
	if (writer) {
	    _args.writer = true;
	}
	if (chunk) {
	    _args.chunk = chunk
	}
	if (status) {
	    _args.status = status
	}
	return _args;
    }

    _todo = async (args, uuid) => {
	let {reader} = args;
	if (!reader) {
            return this.worker.send(this._getArgs(uuid, args));
	}
	while (true) {
	    let chunk = await reader.read();
	    let status = (
		chunk
		    ? WorkerRequest.NOT_DONE_YET
		    : WorkerRequest.COMPLETE);
	    this.worker.send(
		this._getArgs(
		    uuid, args, chunk, status))
	    if (!chunk) {
		break;
	    }
	}
    }

    _resolves = async (args, response) => {
	const {writer} = args;
	if (!writer) {
	    return
	}
	if (response.response) {
	    writer.write(response.response);
	}
	return (response.status !== WorkerRequest.NOT_DONE_YET);
    }

    _run = async (args, todo, resolves) => {
	const {writer} = args;
        const {signals, utils} = this.app;
        const {syncify} = utils;
	const result = await syncify({signals, resolves, todo});
	if (!writer) {
	    return result.response;
	}
    }
}


export default class ShareableWorker {
    debugName = 'app:worker'

    constructor (app, name) {
	this.log = app.debug(this.debugName)
	this.app = app;
	this.name = name;
	this.runner = this.getRunner();
    }

    call = async (args) => {
	return await this.runner.call(args);
    }

    send = (msg) => {
	this.log('send.worker', msg);
	this.worker.port.postMessage(this.serialize(msg));
    }

    connect () {
	return new Promise((resolve, reject) => {
	    this.worker = this._connect(resolve, reject);
	});
    }

    create () {
	return new SharedWorker();
    }

    getRunner () {
	return new SharedWorkerRunner(this);
    }

    onconnect (resolve) {
	resolve(this);
    }

    onerror (reject, e) {
	console.error(e);
	reject(e);
    }

    onmessage = (resolve, e) => {
	const {logger} = this.app
        try {
	    this._onmessage(resolve, e);
        } catch (err) {
            logger.error('[Web/Worker] ERROR', {data: e.data, error: err});
        }
    }

    deserialize (data) {
	return JSON.parse(data);
    }

    serialize (data) {
	return JSON.stringify(data)
    }

    _oldLog (data) {
	const {logger} = this.app
	if (Object.keys(data).indexOf('error') !== -1) {
	    // not sure whats going on here
	    logger.error(
		data.msg,
		data.error)
	} else if (Object.keys(data).indexOf('warning') !== -1) {
	    logger.warn(data.warning)
	} else if (Object.keys(data).indexOf('debug') !== -1) {
	    logger.debug(data.msg, data.debug)
	} else {
	    logger.log(data.msg)
	}
    }

    _isConnecting (data) {
	return data.msg === 'helo';
    }

    _handleData (data) {
	const {logger, signals} = this.app
	if (data.log) {
	    this._oldLog(data)
 	} else if (data.hash !== undefined) {
            signals.emit(data.hash, data.msg);
	} else if (data.emit !== undefined) {
            signals.emit(data.emit, data.msg);
	} else if (data.uuid !== undefined) {
             signals.emit(data.uuid, data);
	} else if (data.request !== undefined) {
            signals.emit(data.request, data);
	} else {
	    logger.debug(data.msg)
	}
    }

    _onmessage = (resolve, e) => {
        const data = this.deserialize(e.data);
	if (this._isConnecting(data)) {
	    return this.onconnect(resolve)
	}
	this.log('recv.worker', data);
	this._handleData(data);
    }

    _connect = (resolve, reject) => {
	let worker = this.create();
	worker.port.onmessage = this.onmessage.bind(this, resolve);
	worker.onerror = this.onerror.bind(this, reject);

	// not sure if this is necessary/works properly
	window.addEventListener('beforeunload', (event) => {
	    this.send({command:'closing'});
	});
	return worker;
    }
}
