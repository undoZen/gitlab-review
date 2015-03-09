'use strict';
global.Promise = require('bluebird');
var log = require('./log').child({ module: 'polling' });
var superagent = require('cc-superagent-promise');
var co = require('co');
var sortBy = require('lodash').sortBy;
var pluck = require('lodash').pluck;
var indexBy = require('lodash').indexBy;
var transform = require('lodash').transform;
var config = require('config');
var redis = require('redis');
Promise.promisifyAll(require("redis"));
var db = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');

function sleep(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

function ts(timestr) {
    return (new Date(timestr)).valueOf();
}
var getAllProjects = co.wrap(function * () {
    console.time('ap');
    var body;
    var result = [];
    var i = 0;
    do {
        i += 1;
        body = (yield superagent.get(
                config.inner_url_prefix +
                '/api/v3/projects?per_page=100&page=' + i)
            .set('PRIVATE-TOKEN', config.private_token)
            .end()).body;
        result = result.concat(body);
    } while (body.length);
    var project;
/*
    for (i = -1; project = body[++i]; ) {
	yield db.zaddAsync('projects', ~~(ts(project.last_activity_at) / 1000), project.id);
	yield db.setAsync('project_detail:' + project.id, JSON.stringify(project));
    }
*/
    console.timeEnd('ap');
    return result;
});

var getAllGroupMembers = co.wrap(function * () {
    console.time('agm');
    var groups = (yield superagent.get(config.inner_url_prefix + '/api/v3/groups')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
	var groupMembers = {};
	for (var group, i = -1; group = groups[++i]; ) {
		groupMembers[group.id] = (yield superagent.get(config.inner_url_prefix + '/api/v3/groups/' + group.id + '/members')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
	}
    console.timeEnd('agm');
	log.trace({type: 'groupMembers', groupMembers: groupMembers});
	return groupMembers;
});

var getOpenedMergeRequests = co.wrap(function * (pid) {
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + pid +
            '/merge_requests?state=opened')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
});

var getAllOpenedMergeRequests = co.wrap(function * (projects) {
    console.time('aomr');
    var projects = projects ? projects : yield getAllProjects();
    var mrs;
    var result = [];
    for (var project, i = -1; project = projects[++i];) {
	mrs = yield getOpenedMergeRequests(project.id);
        if (mrs.length) {
            result = result.concat(mrs);
            //yield db.zincrbyAsync('projects', mrs.length * 100000000, project.id);
        }
    }
    //yield db.setAsync('omr', JSON.stringify(result));
    console.timeEnd('aomr');
    return result;
});
var getOpenedMergeRequestsByProjects = co.wrap(function * () {
    var mrs = yield getAllOpenedMergeRequests();
console.log('mrs', mrs);
    var result = {};
    mrs.forEach(function (mr) {
	if (!result[mr.project_id]) result[mr.project_id] = [];
        result[mr.project_id].push(mr);
    });
    return result;
});

var getNotesByMergeRequest = co.wrap(function * (mr) {
console.log(mr)
    console.log(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
});
getAllProjects()
    .then(function (result) {
        console.log(result);
        console.log('r', result.length);
        console.log('r', pluck(sortBy(result, 'last_activity_at').reverse(),
            'name_with_namespace'))
    })
/*
co(function *() {
	while (true) {
		var mrs = yield getAllOpenedMergeRequests();
		var notes;
		for (var mr, i = -1; mr = mrs[++i]; ) {
			notes = yield getNotesByMergeRequest(mr);
			console.log(mr.id);
			console.log(notes.length);
		}
		yield sleep(1000);
    }
});
*/
var tocking = false;
var tock = co.wrap(function *() {
	if (tocking) return;
	tocking = true;
	log.trace({type: 'ticktock'}, 'tock');
	var gms = transform(yield getAllGroupMembers(), function (result, members, gid) {
		result[gid] = indexBy(members, 'id');
	});
	var ps = (yield getAllProjects()).filter(function (p) {
		return !!gms[p.namespace.id];
	});
	var mrs = yield getAllOpenedMergeRequests(ps);
	ps = indexBy(ps, 'id');
	yield db.setAsync('tick:gms', JSON.stringify(gms));
	yield db.setAsync('tick:ps', JSON.stringify(ps));
	for (var mr, i = -1; mr = mrs[++i]; ) {
		mr.notes = yield getNotesByMergeRequest(mr);
	}
	yield db.setAsync('tick:mrs', JSON.stringify(mrs));
	db.publish('tick', true);
	tocking = false;
});
var sub = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');
sub.on('message', tock);
sub.subscribe('tock');
tock();
