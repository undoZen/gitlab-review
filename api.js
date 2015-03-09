'use strict';
global.Promise = require('bluebird');
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

function requestOnce(key, f) {
	if (!f) {
		f = key;
		key = function (p1) { return p1; };
	}
    return function (p1) {
        if (p1) {
			var p1key = key(p1);
            if (!f.cache) f.cache = {};
            if (f.cache[p1key]) {
                return f.cache[p1key];
            } else {
                f.cache[p1key] = f(p1);
                f.cache[p1key].finally(function () {
                    delete f.cache[p1key];
                });
                return f.cache[p1key];
            }
        } else {
            if (f.cache) {
                return f.cache;
            } else {
                f.cache = f();
                f.cache.finally(function () {
                    delete f.cache;
                });
                return f.cache;
            }
        }
    };
}

function sleep(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

function ts(timestr) {
    return (new Date(timestr)).valueOf();
}
var getAllProjects = requestOnce(co.wrap(function * () {
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
}));

var getAllGroupMembers = co.wrap(function * () {
    console.time('agm');
    var groups = (yield superagent.get(config.inner_url_prefix + '/api/v3/groups')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
	console.log(groups);
	var groupMembers = {};
	for (var group, i = -1; group = groups[++i]; ) {
		groupMembers[group.id] = (yield superagent.get(config.inner_url_prefix + '/api/v3/groups/' + group.id + '/members')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
	}
    console.timeEnd('agm');
	console.log(groupMembers);
	return groupMembers;
    var projects = yield getAllProjects();
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
    return result;
});

var getOpenedMergeRequests = requestOnce(co.wrap(function * (pid) {
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + pid +
            '/merge_requests?state=opened')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
}));
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
var getOpenedMergeRequestsByProjects = requestOnce(co.wrap(function * () {
    var mrs = yield getAllOpenedMergeRequests();
console.log('mrs', mrs);
    var result = {};
    mrs.forEach(function (mr) {
	if (!result[mr.project_id]) result[mr.project_id] = [];
        result[mr.project_id].push(mr);
    });
    return result;
}));

var getNotesByMergeRequest = requestOnce(function (mr) {
	return mr.project_id + ':' + mr.id;
}, co.wrap(function * (mr) {
console.log(mr)
    console.log(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
}));
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
co(function *() {
	function yeaByAssignee(mr, notes) {
		if (!mr.assignee) return false;
		return notes.filter(function (note) {
			return note.author.id === mr.assignee.id && !!note.body.match(/\bYEA\b/);
		}).length > 0;
		var gid = ps[mr.project_id].namespace.id;
console.log('gid', gid);
		var c = transform(notes, function (c, note) {
			if (note.author.id === mr.author.id || !gm[gid][note.author.id]) return;
console.log('author', note.author, gm[gid][note.author.id]);
			if (gm[gid][note.author.id].access_level >= 30) {
				if (!all && !note.body.match(/\bYEA\b/)) return;
				c[note.author.id] = 1;
			}
		});
		return Object.keys(c).length;
	}
	while (true) {
		var gm = transform(yield getAllGroupMembers(), function (result, members, gid) {
			result[gid] = indexBy(members, 'id');
		});
console.log(gm);
		var ps = (yield getAllProjects()).filter(function (p) {
			return !!gm[p.namespace.id];
		});
		var mrs = yield getAllOpenedMergeRequests(ps);
		ps = indexBy(ps, 'id');
		var notes = {};
		var countByNotes = function (mr, notes, all) {
			var gid = ps[mr.project_id].namespace.id;
console.log('gid', gid);
			var c = transform(notes, function (c, note) {
				if (note.author.id === mr.author.id || !gm[gid][note.author.id]) return;
console.log('author', note.author, gm[gid][note.author.id]);
				if (gm[gid][note.author.id].access_level >= 30) {
					if (!all && !note.body.match(/\bYEA\b/)) return;
					c[note.author.id] = 1;
				}
			});
			return Object.keys(c).length;
		}
		for (var mr, i = -1; mr = mrs[++i]; ) {
			mr.notes = yield getNotesByMergeRequest(mr);
			mr.reviewAll = countByNotes(mr, mr.notes, true);
			mr.reviewYea = countByNotes(mr, mr.notes);
			mr.reviewYeaByAssignee = yeaByAssignee(mr, mr.notes);
console.log(mr);
		}
		yield sleep(1000);
		break;
    }
	db.end();
});
