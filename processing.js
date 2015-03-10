'use strict';
global.Promise = require('bluebird');
var log = require('./log').child({ module: 'processing' });
var superagent = require('cc-superagent-promise');
var co = require('co');
var sortBy = require('lodash').sortBy;
var pluck = require('lodash').pluck;
var indexBy = require('lodash').indexBy;
var transform = require('lodash').transform;
var assign = require('lodash').assign;
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
function augmentNotes(gms, ps, mr) {
	var gid = ps[mr.project_id].namespace.id;
	log.trace({ type:'mr', gid: gid});
	return mr.notes.map(function (note) {
		log.trace({ type:'isAuthor', result: note.author.id === mr.author.id});
		log.trace({ type:'inGroup', result: !gms[gid][note.author.id]});
		log.trace({ type:'accessLevel', result: gms[gid][note.author.id] && gms[gid][note.author.id].access_level});
		if (!gms[gid][note.author.id] || gms[gid][note.author.id].access_level < 30) {
			// not a group member or developer
			return false;
		} 
		if (note.author.id === mr.author.id) {
			if (note.body.match(/Added \d+ new commit/)) {
				note.isUpdate = true;
				return note;
			}
			return false;
		}
		note.isAssignee = mr.assignee && note.author.id === mr.assignee.id;
		note.yea = !!note.body.match(/\bYEA\b/);
		return note;
	}).filter(Boolean);
}
function getReviewResult(notes) {
	var all = {};
	var yeas = {};
	var result = {
		assigneeId: null,
		assigneeName: null,
		assigneeYea: false,
		postInit: true,
		postReset: false,
	};
	for (var note, i = -1; note = notes[++i]; ) {
		if (note.isUpdate) {
			all = {};
			yeas = {};
			result.assigneeYea = false;
			result.updatedAt = (new Date).toISOString();
			continue;
		}
		if (note.author.username === 'creditcloud') {
			result.postInit = false;
			if (result.updatedAt) result.postReset = true;
		}
		all[note.author.id] = note.author.name;
		if (note.yea) {
			yeas[note.author.id] = note.author.name;
		} else {
			delete yeas[note.author.id];
		}
		if (note.isAssignee) {
			result.assigneeId = note.author.id;
			result.assigneeName = note.author.name;
			result.assigneeYea = note.yea;
		}
	}
	return assign(result, {
		votes: Object.keys(all).map(function (id) {
			return {
				id: id,
				name: all[id],
				yea: !!yeas[id]
			};
		}),
	});
}
function postReviewNotes(mr) {
	log.info({mr: mr}, 'posting review notes');
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
		if (!mr.notes.filter(function (note) {
					return note.author.username === 'creditcloud';
				}).length) {
		}
		mr.notes = augmentNotes(gms, ps, mr); 
		mr.review = { updatedAt: mr.created_at };
		assign(mr.review, getReviewResult(mr.notes));
		postReviewNotes(mr);
/*
		mr.reviewAll = countYeas(gms, ps, mr, mr.notes, true);
		mr.reviewYea = countYeas(gms, ps, mr, mr.notes);
		mr.reviewYeaByAssignee = yeaByAssignee(mr, mr.notes);
*/
		log.trace({notes: mr.notes, review: mr.review, mr: mr});
	});
	yield sleep(1000);
	db.publish('tock', true);
	ticking = false;
});
db.publish('tock', true);

var sub = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');
sub.on('message', tick);
sub.subscribe('tick');
