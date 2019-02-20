
import PouchDB from 'pouchdb';


export default class DataManager {

    constructor (worker, dbs, logger) {
        this.worker = worker;
        this.dbs = dbs;
    }

    get options () {
	return {
            adapter: 'idb',
            revs_limit: 1,
            auto_compaction: true};
    }

    async createDB (db) {
	return await new PouchDB(db, this.options);
    }

    get globalDbs () {
	// this should be on the db config i think
	return ['core.l10n'];
    }

    _dbName = (username, db) => {
	return (
	    (username && this.globalDbs.indexOf(db) === -1)
		? [username, db].join('.')
		: db)
    }

    load = async (username) => {
	const {data} = this.worker;
	await Promise.all(
	    this.dbs.map(async db => {
		if (typeof db === 'string') {
		    data[db] = await this.createDB(this._dbName(username, db))
		} else {
		    let {indeces, name} = db;
                    data[name] = await this.createDB(this._dbName(username, name))
		    for (let [idx, params] of Object.entries(indeces)) {
			await this.addIndex(name, idx, params.map, params.reduce);
		    }
		}
            }));
    }

    closeDbs = async (globals) => {
	const {data} = this.worker;	
	await Promise.all(
	    Object.entries(data).map(async ([k, d]) => {
		if (!globals && this.globalDbs.indexOf(k) !== -1) {
		    return
		}
		try {
		    await d.close()
		} catch (err) {
		    console.error('failed closing', d, err);
		}
	    }))
    }
    
    loadUser = async (username) => {
	await this.closeDbs();
	await this.load(username);
    }

    reload = async (params) => {
	// const {exclude, include} = params || {};
	// let toReload = (include || this.dbs).filter(db => (!exclude || exclude.indexOf(db) === -1))
    }

    truncate = async (db) => {
	const {data} = this.worker;
	await data[db].destroy();
	this.worker.data[db] = await this.createDB(db)
	// this needs to change
	if (db === 'core.task') {
	    this.worker.jobs.db = this.worker.data[db];
	}
    }

    _createDesignDoc (name, func, reduce) {
	const ddoc = {
	    _id: '_design/' + name,
	    views: {
	    }
	};
	ddoc.views[name] = {map: func.toString()};
	if (reduce) {
	    ddoc.views[name].reduce = reduce;
	}
	return ddoc;
    }

    addIndex = async (db, name, func, reduce) => {
	const {data} = this.worker;
        try {
	    await data[db].put(this._createDesignDoc(name, func, reduce));
	    await data[db].query(name, {limit: 0});	    
        } catch (err) {
            return;
        }
    }
}
