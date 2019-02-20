
import debug from 'debug';

import {Logs} from '@pluggable/app/logs';

import {
    AsyncParallelHook, SyncBailHook} from 'tapable';

import {Signals, WorkerLogger} from '@pluggable/app/utils';

import {WorkerRequest} from './request'
import {
    DataManager, Server, WorkerPluginWrapper,
    WorkerStorage, JobIdParser, PseudoPort} from './utils';
import JobQueue from './queues';
import {SocketWrapper} from './sockets';
import JobHandler from './handler';
import {Jobs} from './jobs';

import {IntegerSetting} from '@pluggable/app/settings';

// import {PouchClient} from '@pluggable/web-app/utils/db';
// import {RemotePouchClient} from '@pluggable/web-app/utils/sync';

// import PouchDB from 'pouchdb';
// import PouchDBDebug from 'pouchdb-debug';
// PouchDB.plugin(PouchDBDebug);
// PouchDB.debug.enable('pouchdb:*');

//import {CoreWorkerPlugin} from 'core/worker';
// import TwitterWorkerPlugin from '../twitter/worker';
//import DataWorkerPlugin from '../data/worker';


export default class PluggableWorker {
    signals = null;
    ws = null;
    port = null;
    started = false;
    ports = [];
    port = null;
    queue = null;
    setting = {};
    parsers = {};
    __hashes = {};
    data = {};
    _readers = {};
    utils = {}
    _buffer = [];
    tasks = {};
    managers = {};

    constructor (name, plugins, _debug) {
	// this is the passed in session key
	// it might not work, in which case sending
	// the session to the socket with cookies is
	// probably the better option
	this.name = name
	if (_debug) {
	    debug.enable(_debug);
	}
        this.debug = debug;
	this._plugins = plugins;
	this.configure();
    }

    configure () {
	this.logs = new Logs(this);
        this.log = debug('worker:loader');
        this.log('configuring', this._plugins);
	this.hooks = this.getHooks();
        this.addHooks();
        this.plugins = {};
	this.server = new Server(this);
        this.port = new PseudoPort(this.ports);
        this.signals = new Signals(this.debug('worker:signals'));
        this.logger = new WorkerLogger(this.port);
	this.localStorage = new WorkerStorage(this);
        this.log('configuring plugins');
	try {
	    this._plugins.forEach(WorkerPlugin => {new WorkerPluginWrapper(WorkerPlugin, this).configure();});
	} catch (err) {
	    console.error(err);
	}
        this.log('adding plugin hooks');
	Object.values(this.plugins).forEach(p => p.addPluginHooks());
        this.listen();
        this.log('configured');
    }

    async load () {
	this._starting = true;
	this.log('loading')
	this.socket = new SocketWrapper(this);
	this.commands = {}
	await this.loadUtils();
	await Promise.all([
	    this.loadDBs(),
	    this.connectSocket(),
	    this.loadCommands()
	])
	this.createQueue()
	await this.clearBuffer();
	this.log('buffer cleared')
	this.logs.log('worker', 'workerLogWorkerStarted');
    }

    async loadCommands () {
	await this.hooks.commands.promise(this.commands)
	this.log('commands loaded')
    }

    async connectSocket () {
	await this.socket.connect()
	this.log('socket connected')
    }

    async createQueue () {
	try {
	    await this.loadSettings();
	    await this.loadParsers();
	    await this.loadTasks();
	    await this.loadJobs();
	    await this.loadQueue();
	    await this.queue.init();
	} catch (err) {
	    console.error('starting queue failed', err);
	}
	this.log('job queue created')
    }

    listen () {
	// this.signals.listen('ui.worker.onchange', this.onWorkerChange);
	// this.signals.listen('ui.worker.status', this.onWorkerStatus);
    }

    emitStatus = async () => {
	const {queue, socket} = this;
	const _status = await this.status();
	// make this consistent with how get status responds
	const status = {
	    status: queue.status,
	    socket: socket.status,
	    pending: _status.pending,
	    active: Object.keys(_status.jobs).length,
	    complete: _status.complete,
	    failed: _status.failed}
	await this.port.postMessage({
	    cmd: 'emit',
	    emit: 'ui.worker.status',
	    msg: {status}});
    }

    status = async () => {
	const {jobs, queue} = this;
	let pending = 0;
	let complete = 0;
	let failed = 0;
	try {
	    pending = (await jobs.pending()).rows.length;
	    complete = (await jobs.complete()).rows.length;
	    failed = (await jobs.failed()).rows.length;
	    let _jobs = [];
	    if (queue.status === 'running') {
		_jobs = queue.runner.dumpJobs();
	    }
	    return {
		pending, failed, complete,
		jobs: _jobs}
	} catch (err) {
	    queue.handler.error('Failed getting worker status', err);
	}
    }

    onWorkerStatus = (evt, msg) => {
 	this.port.postMessage({emit: 'worker.status', msg});
    }

    onWorkerChange = (evt, msg) => {
 	this.port.postMessage({emit: 'worker.onchange', msg});
    }

    async loadDBs () {
	const dbs = [];
	try {
	    await this.hooks.dbs.promise(dbs)
	    this.managers.data = new DataManager(this, dbs);
            await this.managers.data.load();
	} catch (err) {
	    console.error('loading dbs', err);
	}
	this.log('dbs loaded')
    }

    getHooks () {
	return {
	    commands: new AsyncParallelHook(['result']),
	    parsers: new AsyncParallelHook(['parsers']),
	    metrics: new AsyncParallelHook(['metrics']),
	    settings: new AsyncParallelHook(['settings']),
	    dbs: new AsyncParallelHook(['db']),
	    tasks: new AsyncParallelHook(['task']),
	    utils: new AsyncParallelHook(['util']),
	    signals: new SyncBailHook([]),
	    logger: new SyncBailHook([]),
	    crypto: new SyncBailHook()};
    }

    addHooks () {
        this.hooks.settings.tapPromise(
            'core.settings', this.settings.bind(this));
        this.hooks.dbs.tapPromise(
            'core.dbs', this.dbs.bind(this));
        this.hooks.parsers.tapPromise(
            'core.parsers', this._parsers);
        this.hooks.metrics.tapPromise(
            'core.metrics', this.metrics.bind(this));
    }

    async loadSettings () {
	this.setting = await this.getSettings();
    }

    async loadUtils () {
	await this.hooks.utils.promise(this.utils);
    }

    async loadParsers () {
	await this.hooks.parsers.promise(this.parsers);
    }

    async loadTasks () {
	await this.hooks.tasks.promise(this.tasks)
    }

    async loadQueue () {
        this.queue = new JobQueue(
            new JobHandler(this, this.jobs));
    }

    async loadJobs () {
	this.jobs = new Jobs(
            this.data['core.task'],
            this.tasks)
    }

    async getSettings () {
        let settings = {};
	await this.hooks.settings.promise(settings);
        let dbSettings = {};

	// update these if user is auth ?
        //(await this.data['core.setting'].allDocs({include_docs: true})).rows.forEach(s => {
        //    dbSettings[s.key] = s.doc;
        //});
        let _settings = {};
        Object.keys(settings).forEach(s => {
            settings[s].key = s;
            settings[s].value = settings[s].default;
            settings[s].custom = false;
            if (Object.keys(dbSettings).indexOf(s) !== -1) {
                settings[s]._rev = dbSettings[s]._rev;
                if (dbSettings[s].value !== settings[s].default) {
                    settings[s].value = dbSettings[s].value;
                    settings[s].custom = true;
                }
            }
            _settings[s] = new settings[s].type(settings[s]);
        });
        return _settings;
    }

    async settings (result) {
        result["core.worker.simultaneous_requests"] = {
	    type: IntegerSetting,
            default: 10};
	return result;
    }

    async _parsers (result) {
        result["worker.jobid"] = new JobIdParser();
	return result;
    }

    async metrics (result) {
	return result;
    }

    dbs = async (result) => {
	result.push.apply(
	    result,
	    ['core.db',
	     'core.task',
	     'core.log',
	     'core.l10n',
	     'core.setting']);
    }

    connect(port) {
	port.postMessage(JSON.stringify({msg: 'helo'}))
        this.ports.push(port);
    }

    clearBuffer = async () => {
	while (true) {
	    if (this._buffer.length === 0) {
		this._starting = false;
		break;
	    }
	    let request = this._buffer.shift()
	    let [port, message] = request;
	    try {
		await this.handleMessage(port, message);
	    } catch (err) {
		console.error('failed clearing queue', err);
	    }
	}
    }

    async onmessage (port, e) {
	if (this._starting || this._buffer.length > 0) {
	    this._buffer.push([port, e]);
	} else {
            try {
		await this.handleMessage(port, e);
            } catch (err) {
		console.error(err)
            }
	}
    }

    // move this
    async handleMessage (port, e) {
	let parsed = JSON.parse(e.data);
        let {command, ...data} = parsed;
	this.log('recv.app', 'ui', command, data);

        if (command === 'closing') {
            let index = this.ports.indexOf(port);
            if (index !== -1) {
                this.ports.splice(index, 1);
            }
	    if (this.ports.length === 0) {
		await this.logs.log(
		    'worker',
		    'workerLogWorkerDying')
		await Promise.all(
		    Object.values(this.data).map(async d => {
			try {
			    await d.close()
			} catch (err) {
			    console.error('failed closing', d, err);
			}
		    }))
	    }
        } else if (data.cmd.startsWith('worker.')) {
	    const {cmd, uuid, status, reader=false, writer=false, ...params} = data;
	    // await this.logs.log('worker', 'running command', cmd);
	    if (!reader) {
		const request = new WorkerRequest(this, uuid, 'ui', cmd, params, reader, writer);
		await request.dispatch();
	    } else {
		if (Object.keys(this._readers).indexOf(uuid) === -1) {
		    this._readers[uuid] = new WorkerRequest(this, uuid, 'ui', cmd, params, reader, writer);
		}
		if (status === WorkerRequest.NOT_DONE_YET) {
		    this._readers[uuid].update(params);
		} else {
		    this._readers[uuid].dispatch();
		    // delete ?
		}
	    }
        } else if (command === 'add-job') {
            let response = await this.queue.handler.jobs.add(data.task.name, data.task.params);
            this.__hashes[response.id] = response.hash;
            await this.port.postMessage({
		hash: response.hash,
		msg: "requested (" + data.task.name + "): " + JSON.stringify(data.task.params)});
        } else if (command === 'add-jobs') {
            let responses;
            responses = await this.queue.handler.jobs.add(data.task.name, data.task.params);
	    responses.forEach(r => {
                this.__hashes[r.id] = r.hash;
		this.port.postMessage({
		    hash: r.hash,
		    msg: "requested (" + data.task.names + "): " + r.name});
	    });
        } else if (command === 'emit') {
	    this.signals.emit(data.msg, data.params);
        } else if (command === 'pouch') {
	    this.remotePouch.handle(data);

	} else if (command.startsWith('ws.')) {
	    command = command.substring(3);
            data.command = command;
            this.socket.send(data);
	} else  {
	    this.logger.debug('unhandled message');
	    this.logger.debug(data);
	}
    }

    async update (jobid, msg) {
        try {
            await this.port.postMessage({
	        hash: this.__hashes[jobid],
	        msg: msg});
        } catch (err) {
	    this.logger.error('Failed sending update', err);
        }
    }

    async success (jobid, msg) {
        try {
            await this.port.postMessage({
	        hash: this.__hashes[jobid],
	        msg: msg});
            delete this.__hashes[jobid];
        } catch (err) {
	    this.logger.error('Failed sending success', err);
        }
    }

    async fail (jobid, msg, error) {
        try {
            await this.port.postMessage({
	        hash: this.__hashes[jobid],
	        msg: msg});
            delete this.__hashes[jobid];
        } catch (err) {
	    this.logger.error('Failed sending failure', err);
        }
    }
}
