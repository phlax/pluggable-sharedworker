
import PouchDB from "pouchdb";
import PouchDBFind from "pouchdb-find";

// import Crypto from '@pluggable/app/utils/crypto';

export const PENDING = 0;
export const ACTIVE = 1;
export const COMPLETE = 2;
export const FAILED = 3;

// this is required for worker usage of db
PouchDB.plugin(PouchDBFind);

// let crypto = new Crypto();


export class Jobs {
    __db = null;
    _jobs = [];
    _latest = null;
    _requested = [];

    constructor (db, tasks) {
	this.db = db;
        this.tasks = tasks;
    }    

    _hash = (str) => {
	// courtesy of:
	// https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
	//
	let hash = 0;
	let i;
	let chr;
	if (str.length === 0) {
	    return hash;
	}
	for (i = 0; i < str.length; i++) {
	    chr   = str.charCodeAt(i);
	    hash  = ((hash << 5) - hash) + chr;
	    hash |= 0; // Convert to 32bit integer
	}
	return hash;
    }
    
    hash = (task, params) => {
	return this._hash(JSON.stringify({task, params}))
    }

    async fetch (key, params) {
        params = params || {};
        if (key !== null) {
	    let startkey = key + '@';
	    let endkey = key + '@\uffff';	    
	    if (params.descending) {
		endkey = key + '@';
		startkey = key + '@\uffff';
	    }	    
            return await this.db.allDocs({
		startkey, endkey,
                ...params});
        }
        return await this.db.allDocs({...params})
    }

    async get (id) {
        let params = {
            limit: 1,
            startkey: id,
            endkey: id + '@\uffff'};
        let result = await this.fetch('core.task', null, params);
        if (result.rows > 0) {
            return result.rows[0];
        }
    }

    async sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
    }

    async pending (params) {
        return await this.fetch(PENDING, params);
    }

    async active (params) {
        return await this.fetch(ACTIVE, params || {});
    }

    async complete (params) {
        return await this.fetch(COMPLETE, params || {});
    }

    async failed (params) {
        return await this.fetch(FAILED, params || {});
    }

    async changeState (task, state) {
        // console.log('changing state(' + state + ') of task ' + task.id);
        let tasks = task;
        if (!Array.isArray(task)) {
            tasks = [task];
        }
        let update = [];
        let returns = [];
        let removes = [];
	for (let t of tasks) {
            let [tstamp, name, taskname] = t.id.substring(2).split('@');

            let rev = t._rev;
            if (t.value) {
                rev = t.value.rev;
            }
            removes.push({_id: t.id, _rev: rev, _deleted: true});
            let newid = this.getId(state, name, taskname, tstamp);
            update.push({id: newid, _id: newid});
            returns.push([newid, taskname, name]);
        }
        try {
            await this.db.bulkDocs(update);
            await this.db.bulkDocs(removes);
            return returns;
        } catch (err) {
            console.warn(err);
        }
    }

    async success (jobid) {
        let task = await this.db.get(jobid);
        await this.changeState(task, COMPLETE);
    }

    async fail (jobid, error) {
        let task = await this.db.get(jobid);
        task.error = error;
        await this.changeState(task, FAILED);
    }

    async add (task, params) {
        try {
            return await this._add(task, params);
        } catch (err) {
            console.warn(err);
        }
    }

    get timestamp () {
        let dt = new Date();
        return Math.round(dt.getTime() / 1000);
    }

    getId (state, name, task, tstamp) {
        return [state, tstamp || this.timestamp, name, task].join('@');
    }

    async _add (task, params) {
        let update;
        let hash;
        let records;
        let _hashes = [];
        if (Array.isArray(params)) {
            update = params.map(name => {
                let hash = this.hash(task, {screen_name: name});
                _hashes.push({hash, name, task});
                return {_id: this.getId(PENDING, name, task)};
            });
            records = await this.db.bulkDocs(update);
            Object.values(_hashes).forEach((v, k) => {
                v.id = records[k].id;
            });
            return _hashes;
        }
        hash = this.hash(task, params);
        update = JSON.parse(JSON.stringify({
            _id: this.getId(PENDING, params.screen_name, task)}));
        let record = await this.db.post(update);
        return {hash, id: record.id};
    }

    async cleanup () {
        let active = await this.active();
        if (active.rows.length > 0) {
            await this.changeState(active.rows, PENDING);            
        }
	return active.rows.length;
    }

    async listen (cb) {
        let _changes = {since: 'now', live: true, filter: doc => {
	    return doc._id.startsWith(PENDING.toString());
        }};
        this.db.changes(_changes).on('change', async change => {
            await cb(change);
        }).on('error', err => {
            console.warn(err);
        });
    }
}
