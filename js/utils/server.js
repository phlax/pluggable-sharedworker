
import {WorkerRequest} from '../request';

import {syncify} from '@pluggable/app/utils';


// this should be a manager
export default class Server {

    constructor (worker) {
	this.worker = worker;
    }

    _rejects = (recv) => {
	const {errors} = recv;
	if (errors) {
	    return errors;
	}
    }
    
    call = async (args) => {
	const {cmd, params, reader, writer} = args;
	let {timeout} = args;
        const {signals, socket} = this.worker;
	const _params = {cmd, params};	
	let resolves;
	
	if (writer) {
	    timeout = timeout || 60000;
	    resolves = response => {
		writer.write(response);
		return (!response.status || response.status !== WorkerRequest.NOT_DONE_YET);
	    };  
	}
	if (reader) {
	    _params.reader = reader;
	}
	if (writer) {
	    _params.writer = Boolean(writer);
	}
	let result;
	try {
            result = await syncify({
		signals,
		timeout: timeout || 10000,
		rejects: this._rejects,
		resolves,
		todo: async (_uuid) => {
		    _params.uuid = _uuid;
                    socket.send({..._params});
		}});
	} catch (errors) {
	    return {errors}
	}
	return result;
    }
}
