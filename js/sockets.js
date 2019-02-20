

export class SocketWrapper {
    ws = null;
    _session = null;
    _buffer = [];
    _hasConnected = false;
    _connected = false
    _authenticating = false

    constructor (worker) {
	this.worker = worker;
	this.logger = worker.logger;
	this.log = this.worker.debug('worker:ws');
        this.signals = this.worker.signals;
    }

    _reconnect = async (addr, resolve, reject, disconnectTime) => {
	let server;
	this.log('connecting');
	if (this._session || this.worker.name) {
	    server = new WebSocket(addr, this.worker.name);
	} else {
	    server = new WebSocket(addr);
	}
	server.onopen = async (resp) => {
	    this.log('connected', addr, resp, server);
	    this.ws = server;
	    const todo = [];
	    if (!this.worker.name || this.worker.name === '') {
		this.resolve(this.ws);
		todo.push(this.clearBuffer());
		this._connected = true;
	    }
	    if (this._hasConnected) {
		todo.push(
		    this.worker.port.postMessage({
			cmd: 'emit',
			emit: 'log.worker.socket',
			msg: 'connect'}))
	    }
	    this.log('establishing session')	    
	    await Promise.all(todo);
	    this.log('session established', todo)
	    return false;
	};
	server.onerror = err => {
	    // this.logger.error('[Worker/ws] ERROR: ' + addr, err);
	    reject(err);
	};
	server.onclose = () => {
	    // this.logger.warn('[Worker/ws] disconnected: ' + addr);
	    this.worker.port.postMessage({
		cmd: 'emit',
		emit: 'log.worker.socket',
		msg: 'disconnect'})
	    this._connected = false;
	    this._reconnect(addr, resolve, reject, new Date());
	};

	server.onmessage = async evt => {
            await this.recv(evt.data);
	};
	return server;
    }

    async _connect(addr, signals, log, logger) {
	return new Promise(async (resolve, reject) => {
            let connection;
	    try {
		this.resolve = resolve;
                connection = await this._reconnect(addr, resolve, reject);
	    } catch (err) {
		this.logger.error(err);
	    }
            return connection;
	});
    }

    async connect () {
        if (this.ws === null) {
	    await this._connect('ws://localhost:3001');
        }
        return this.ws;
    }

    recv = async (data) => {
        data = JSON.parse(data);
	this.log('recv.ws', data);

	if (data.msg === 'connected') {
	    this.log('session established')
	    this.worker._authenticated = data.user
	    this.resolve(this.ws);
	    await this.clearBuffer();
	    this._connected = true;
	    this._hasConnected = true;
	}

	if (data.session) {
	    this._session = data.session;
	    this.worker.localStorage.set('session', data.session);
	    delete data.session;
	}

	if (data.uuid && data.command && data.command.startsWith('ui.')) {
	    data.command = data.command.substring(3);
	    this.worker.port.postMessage({...data});
	} else if (data.uuid) {
	    await this.signals.emit(data.uuid, data || {});
	} else if (!data.id) {
	    this.signals.emit(data.request, data);
	} else {
	    this.signals.emit(data.id, data);
	}
    }

    clearBuffer = async () => {
	if (this._buffer.length > 0) {
	    this.log('clearing socket buffer', this._buffer.length, 'items');
	    ([...this._buffer]).forEach(b => {
		if (this.ws === null) {
		    return;
		}
		this.log('send.ws', b);
		this.ws.send(JSON.stringify(b));
		this._buffer.shift();
	    });
	}
    }

    async send (msg) {
	if (this.ws === null) {
	    this.log('websocket not connected, buffering');
	    this._buffer.push(msg);
	} else {
	    this.log('send.ws', msg);
            this.ws.send(JSON.stringify(msg));
	}
    }

    get status () {
	return (
	    this._connected
		? 'connected'
		: 'disconnected')
    }
}
