

export default class WorkerPluginWrapper {

    constructor (Plugin, worker) {
        const {debug} = worker;
	this.worker = worker;
	this.context = new Plugin(worker);
        const {name} = this.context;
        this.log = debug('worker:' + name);
    }

    configure () {
	const {addDefaultHooks, worker, context, log} = this;
        const {addHooks, getPluginHooks, name} = context;
        if (getPluginHooks) {
            context.hooks = getPluginHooks();
        }
	worker.plugins[name] = this;
	if (addDefaultHooks) {
            addDefaultHooks();
	}
	if (addHooks) {
            addHooks();
	}
	log('plugin configured');
    }    

    addTaps () {
    }

    addHooks () {
    }

    addPluginHooks () {
    }

    getPluginHooks () {
    }
}
