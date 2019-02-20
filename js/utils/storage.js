
import {syncify} from '@pluggable/app/utils';


export class WorkerStorage {

    constructor (worker) {
	this.worker = worker
    }
    
    async get (k) {
	return await syncify({
	    signals: this.worker.signals,
	    todo: async (uuid) => {
		this.worker.port.postMessage({
		    emit: 'storage.local.get',
		    msg: {k, uuid},
		    uuid})			
            }
	});
    }

    set (k, v) {
	let data = {}
	data[k] = v;
	// this.worker.port.postMessage({emit: 'storage.local.set', msg: data})	
    }
}
