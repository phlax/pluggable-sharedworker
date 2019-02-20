
import {ACTIVE} from './jobs';
import TaskRunner from './runner';


export default class JobHandler {
    frequency = 100;

    constructor (worker, jobs) {
        this.worker = worker;
        this.jobs = jobs;
	this.onWorkerStatus = this.onWorkerStatus.bind(this);
    }

    get maxSimultaneousJobs () {
        return this.worker.setting['core.worker.simultaneous_requests'].value;
    }

    get args () {
        return [this.worker];
    }

    get tasks () {
        return this.jobs.tasks;
    }

    async cleanup () {
	let active = await this.jobs.cleanup();
        if (active > 0) {
            this.log('setting ' + active + ' active jobs to pending...');
	}
    }

    hash (task, params) {
        return this.jobs.hash(task, params);
    }

    async init (queue) {
        await this.jobs.listen(queue.handlePending);
	this.worker.logs.log('worker', 'workerLogQueueStarted');
        this.worker.signals.listen('worker.emit', this.onWorkerStatus);
    }

    async stop (queue) {
	this.worker.logs.log('worker', 'workerLogQueueStopped');
    }

    async onWorkerStatus () {
	let pending = 0;
	let complete = 0;
	let failed = 0;
	try {
	    pending = (await this.jobs.pending()).rows.length;
	    complete = (await this.jobs.complete()).rows.length;
	    failed = (await this.jobs.failed()).rows.length;
	} catch (err) {
	    this.error('Failed getting worker status', err);
	}
	this.worker.signals.emit('ui.worker.status', {
	    pending, failed, complete,
	    jobs: this.runner.dumpJobs()});
    }

    async setActive (tasks) {
        return await this.jobs.changeState(tasks, ACTIVE);
    }

    getRunner (queue) {
        this.runner = new TaskRunner(queue);
	return this.runner;
    }

    async pending (args) {
        return this.jobs.pending(args);
    }

    _onSignal = async (signal, msg) => {
	// const {getTaskForId} = this.runner;	
	// await getTaskForId(j.id).listener(signal, msg)
    }
    
    async start (jobs) {
	const {logs, parsers, signals} = this.worker;
	// const {getTaskForId} = this.runner;
	try {
	    for (let j of jobs) {
		let job = parsers['worker.jobid'].parse(j.id);
		await logs.log(
		    'worker',
		    'workerLogJobStarted',
		    {info: [job.task, job.id].join('/'),
		     ref: j.id});
		try {
		    signals.listen(j.id, this._onSignal);
		} catch (err) {
		    this.error('Failed starting job: ' + j.id, err);
		}
            }
	    await this.setActive(jobs);
	} catch (err) {
	    await this.fail(jobs, err);
	}
    }

    async success (jobid) {
	try {
            this.worker.signals.unlisten(jobid, this._onSignal);
            await this.jobs.success(ACTIVE + jobid.substring(1));	    
	} catch (err) {
	    await this.fail(jobid, err);
	    return;
	}
	await this.onchange(jobid, 'success');
    }

    _newSuccess = async (jobid) => {
	const {emitStatus, logs, signals} = this.worker;
	// notify that worker job succeeded
	let job = this.worker.parsers['worker.jobid'].parse(jobid);
	logs.log(
	    'worker',
	    'workerLogJobSucceeded',
	    {info: [job.task, job.id].join('/'),
	     ref: jobid,	     
	     type: 'success'});
	try {
	    await signals.emit(jobid, {status: 'success'});
	    await emitStatus();
	} catch (err) {
	    console.error('emitting failed', err);
	}
    }

    _newFail = async (jobid, error) => {
	const {emitStatus, logs, signals} = this.worker;
	// notify that worker job succeeded
	let job = this.worker.parsers['worker.jobid'].parse(jobid);	
	logs.log(
	    'worker',
	    'workerLogJobFailed',
	    {type: 'error',
	     extra: error.toString(),
	     ref: jobid,
	     info: [job.task, job.id].join('/')});	
	try {
	    await signals.emit(jobid, {status: 'failed', errors: error});
	    await emitStatus();	    
	} catch (err) {
	    console.error('emitting failed', err);
	}
    }
    
    async onchange (jobid, status, error) {
	if (status === 'success') {
	    await this._newSuccess(jobid)
	} else {
	    await this._newFail(jobid, error);
	}
    }

    async update (jobid, update) {
	await this.worker.port.postMessage({
	    emit: 'ui.worker.activity',
	    msg: {log: {ref: jobid, msg: update}}});	
    }

    async fail (jobid, error) {
	const {signals} = this.worker;
	// const {getTaskForId} = this.runner;
	// const listener = getTaskForId(jobid).listener

	signals.unlisten(jobid, this._onSignal)
	try {
	    // let job = parsers['worker.jobid'].parse(jobid);
            await this.jobs.fail(ACTIVE + jobid.substring(1), error);
	} catch (err) {
	    console.warn(err);
	}
	await this.onchange(jobid, 'failed', error);
    }

    get logger () {
	return this.worker.logger;
    }

    log (msg) {
	// this.worker.logs.log('worker', 'workerLogJobSucceeded', msg);
    }

    error (msg, error) {

    }

    debug (msg, debug) {
	this.logger.debug('[Worker/queue] ' + msg, debug);
    }

    warn (msg) {
	this.logger.warn('[Worker/queue] ' + msg);
    }

}
