

export class JobIdParser {

    parse (jobid) {
	let [state, tstamp, id, task] = jobid.split('@');
	return {state, tstamp, id, task};
    }
}
