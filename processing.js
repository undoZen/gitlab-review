'use strict';
global.Promise = require('bluebird');
var log = require('./log').child({ module: 'processing' });
var superagent = require('cc-superagent-promise');
var co = require('co');
var sortBy = require('lodash').sortBy;
var pluck = require('lodash').pluck;
var indexBy = require('lodash').indexBy;
var transform = require('lodash').transform;
var config = require('config');
var redis = require('redis');
Promise.promisifyAll(require("redis"));

function sleep(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

var db = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');
function yeaByAssignee(mr, notes) {
	if (!mr.assignee) return false;
	return notes.filter(function (note) {
		return note.author.id === mr.assignee.id && !!note.body.match(/\bYEA\b/);
	}).length > 0;
}
function countYeas(gms, ps, mr, notes, all) {
	var gid = ps[mr.project_id].namespace.id;
	return Object.keys(transform(notes, function (c, note) {
		if (note.author.id === mr.author.id || !gms[gid][note.author.id]) return;
		if (gms[gid][note.author.id].access_level >= 30) {
			if (!all && !note.body.match(/\bYEA\b/)) return;
			c[note.author.id] = 1;
		}
	})).length;
}
function getReviews(gms, ps, mr) {
	var gid = ps[mr.project_id].namespace.id;
	log.trace({ type:'mr', gid: gid});
	return mr.notes.reduce(function (result, note) {
		log.trace({ type:'mr' }, note.author.id === mr.author.id)
		log.trace({ type:'mr' }, !gms[gid][note.author.id])
		log.trace({ type:'mr' }, gms[gid][note.author.id] && gms[gid][note.author.id].access_level >= 30)
		if (note.author.id === mr.author.id ||
			!gms[gid][note.author.id] ||
			gms[gid][note.author.id].access_level < 30) return;
		log.trace({
type:'mr',
result: result
		});
		log.trace({
type:'mr',
			author: note.author,
			isAssignee: mr.assignee && note.author.id === mr.assignee.id,
			yea: !!note.body.match(/\bYEA\b/)
		});
		result.push({
			author: note.author,
			isAssignee: mr.assignee && note.author.id === mr.assignee.id,
			yea: !!note.body.match(/\bYEA\b/)
		});
		return result;
	}, []);
}
var ticking = false;
var tick = co.wrap(function *() {
	if (ticking) return;
	ticking = true;
	log.trace({type: 'ticktock'}, 'tick');
	var gms = JSON.parse(yield db.getAsync('tick:gms'));
	var ps = JSON.parse(yield db.getAsync('tick:ps'));
	var mrs = JSON.parse(yield db.getAsync('tick:mrs'));
	mrs.forEach(function (mr) {
		mr.reviews = getReviews(gms, ps, mr); 
/*
		mr.reviewAll = countYeas(gms, ps, mr, mr.notes, true);
		mr.reviewYea = countYeas(gms, ps, mr, mr.notes);
		mr.reviewYeaByAssignee = yeaByAssignee(mr, mr.notes);
*/
		log.trace({type: 'mr', reviews: mr.reviews});
	});
	yield sleep(1000);
	db.publish('tock', true);
	ticking = false;
});
db.publish('tock', true);

var sub = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');
sub.on('message', tick);
sub.subscribe('tick');
