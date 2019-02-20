

export class Task {

    constructor (runner, worker) {
	this.runner = runner;
        this.worker = worker;
    }

    get listener () {
        return this.onRecv.bind(this);
    }

    async onRecv () {
	//
    }

    async update (id, msg) {
	return await this.runner.update(id, msg);
    }
    
    async success (id, msg) {
	return await this.runner.success(id, msg);
    }

    async fail (id, msg, error) {
	return await this.runner.fail(id, msg, error);
    }        
}
