

export default class TaskRunner {
    __tasks = {};
    _running = {};

    constructor (handler) {
	this.handler = handler;
        this.createTasks();
        this._running = {};
    }

    dumpJobs () {
	return {...this._running};
    }
    
    get activeCount () {
	return Object.keys(this._running).length;
    }

    isRunning (jobid) {
	return Object.keys(this._running).indexOf(jobid) !== -1;
    }
    
    createTasks () {
        Object.keys(this.handler.tasks).forEach(task => {
            this.__tasks[task] = new this.handler.tasks[task](this, ...this.handler.args);
        });
    }

    _validateJobHash (hash) {
	return (Object.values(this._running).map(v => v.hash).indexOf(hash) === -1);
    }

    async run (jobs) {
	try {
	    await this._run(jobs);
	} catch (err) {
	    console.warn(err);
	}
    }

    async _run (jobs) {
	for (let j of jobs) {
            if (!this._validateJobHash(j.hash)) {
	        this._running[j.id] = j;                            
                await this.fail(j.id, 'Duplicate job scheduled');
                return;
            }
	    this._running[j.id] = j;
        }
	jobs = jobs.filter(j => (this.isRunning(j.id)));
	await this.handler.start(jobs);

	for (let j of jobs) {
            if (Object.keys(this._running).indexOf(j.id) === -1) {
                return;
            }            
            try {
                this.__tasks[j.task].run(j.id, j.params);
            } catch (err) {
                await this.fail(j.id, err);
            }
        }
    }

    getTaskForId = (jobid) => {
        return this.__tasks[this._running[jobid].task];
    }
    
    async success (jobid) {
        await this.handler.success(jobid);
        delete this._running[jobid];
    }

    async fail (jobid, error) {
        await this.handler.fail(jobid, error);
        delete this._running[jobid];
    }

    async update (jobid, msg) {
        await this.handler.update(jobid, msg);
    }
}
