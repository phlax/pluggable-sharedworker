

export default class JobQueue {
    _queueEnabled = false;
    _queueIsScheduling = false;
    _queueIsInitiating = false;
    _backlogCount = 0;
    jobs = null;

    constructor (handler) {
        this.handler = handler;
    }

    hash (task, params) {
        return this.handler.hash(task, params);
    }

    parseJob (jobid) {
        let [name, task] = jobid.split('@').slice(2);
        let params = {screen_name: name};
        let hash = this.handler.hash(task, params);
        return {
            id: jobid,
            hash, task, params};
    }

    handlePending = async (change) => {
        if (!this._queueEnabled) {
            this._backlogCount = this._backlogCount + 1;
            return;
        }
        if (this._hasBacklog) {
            this._backlogCount = this._backlogCount + 1;
            return;
        }
	if (this.runner.isRunning(change.id)) {
	    // console.log('job already running' + change.id);
	    return;
	}
        if (this.runner.activeCount + 1 > this.handler.maxSimultaneousJobs) {
            await this.activateBacklog();
            return;
        }
        // console.log('Running update job: current queue (' + this.runner.activeCount + '/' + this.handler.maxSimultaneousJobs.toString() + ')');
	await this.runner.run([Object.assign({_rev: change.changes[0].rev}, this.parseJob(change.id))]);
    }

    async activateBacklog () {
        if (!this._hasBacklog) {
            this._hasBacklog = true;
            this.handler.log('Activating backlog: current queue (' + this.runner.activeCount + '/' + this.handler.maxSimultaneousJobs.toString() + ')');
            await this.handleBacklog();
        } else {
            this._backlogCount = this._backlogCount + 1;
        }
    }

    async deactivateBacklog () {
	this.handler.log('Deactivating backlog worker');
        this._queueIsScheduling = false;
        this._hasBacklog = false;
        this._backlogCount = 0;
    }

    async _asyncForEach (array, callback) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    }

    async runBacklog (tasks) {
	await this.runner.run(tasks.map(t => Object.assign({_rev: t.value.rev}, this.parseJob(t.id))));
    }

    async handleBacklog () {
        try {
            return await this._handleBacklog();
        } catch (err) {
            this.handler.error('Failed handling backlog', err);
        }
    }

    rescheduleBacklog () {
        this._queueIsScheduling = false;
        this._backlogCount = 0;
        setTimeout(this.handleBacklog.bind(this), this.handler.frequency);
    }

    async _handleBacklog () {
        if (this._queueIsScheduling) {
	    this.handler.debug('queue is busy - will call back ?');
            // setTimeout(this.handleBacklog, 1000);
            return;
        }
        // block the queue
        this._queueIsScheduling = true;

        // check how many free slots avail - if none callback in .1s
        let freeSlots = (this.handler.maxSimultaneousJobs - this.runner.activeCount);

        // console.log('Checking backlog: current queue (' + this.runner.activeCount + '/' + this.handler.maxSimultaneousJobs.toString() + ')');

        if (freeSlots < 1 && this.runner.activeCount > 1) {
            this.rescheduleBacklog();
            return;
        }
        this._backlogCount = 0;

        // grab n pending items
        let pending = await this.handler.pending({limit: this.handler.maxSimultaneousJobs});

        // schedule tasks - if queue is clear, switch back to normal change handling
        // but also check that nothing has come in since making the db request
        if (pending.rows.length === 0) {
            if (this._backlogCount > 0) {
		this.handler.debug('inmem backlog queue not empty ');
                // more appeared since checking/updating the db
                this.rescheduleBacklog();
            } else {
                await this.deactivateBacklog();
            }
        } else {
	    let required = (this.handler.maxSimultaneousJobs - this.runner.activeCount);
	    let rows = pending.rows;
            // console.log('scheduling ' + required + ' jobs');
	    if (rows.length > required) {
		rows.length = required;
	    }
	    await this.runBacklog(rows);
            this.rescheduleBacklog();
        }
    }

    // rename or move this - this is starting a *job* not the queue
    async start (jobid) {
        await this.handler.start(jobid);
    }

    async fail (jobid, error) {
        await this.handler.fail(jobid, error);
    }

    async update (jobid, msg) {
	// if the queue/job is stopped, or job paused
	// ...throw a PauseError ?
	
        await this.handler.update(jobid, msg);
    }

    async success (jobid) {
        await this.handler.success(jobid);
    }

    get args () {
        return this.handler.args;
    }

    get tasks () {
        return this.handler.tasks;
    }

    async init (db) {
	if (db) {
	    // eek!
	    this.handler.jobs.db = db;
	}	
        this.runner = this.handler.getRunner(this);
        await this.handler.cleanup();
        this._queueEnabled = true;
        await this.handler.init(this);	
        await this.handleBacklog(true);
    }

    async stop () {
	// stop actual jobs!
        this._queueEnabled = false;
	await this.handler.stop(this);
    }

    get status () {
	return (
	    this._queueEnabled
		? 'running'
		: 'stopped')
    }
}
