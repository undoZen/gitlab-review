'use strict';
global.Promise = require('bluebird');
var superagent = require('cc-superagent-promise');
var co = require('co');
var sortBy = require('lodash').sortBy;
var pluck = require('lodash').pluck;
var config = require('config');
var redis = require('redis');
Promise.promisifyAll(require("redis"));
var db = redis.createClient(config.redis_port || 6379, config.redis_host || '127.0.0.1');

function requestOnce(f) {
    return function (p1) {
        if (p1) {
            if (!f.cache) f.cache = {};
            if (f.cache[p1]) {
                return f.cache[p1];
            } else {
                f.cache[p1] = f(p1);
                f.cache[p1].finally(function () {
                    delete f.cache[p1];
                });
                return f.cache[p1];
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
    for (i = -1; project = body[++i]; ) {
	yield db.zaddAsync('projects', ~~(ts(project.last_activity_at) / 1000), project.id);
	yield db.setAsync('project_detail:' + project.id, JSON.stringify(project));
    }
    console.timeEnd('ap');
    return result;
}));
getAllProjects();

var getOpenedMergeRequests = requestOnce(co.wrap(function * (pid) {
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + pid +
            '/merge_requests?state=opened')
        .set('PRIVATE-TOKEN', 'PsfVVHfxMxya3YzM9HR5')
        .end()).body;
}));
var getAllOpenedMergeRequests = co.wrap(function * () {
    console.time('aomr');
    var projects = yield getAllProjects();
    var mrs;
    var result = [];
    for (var project, i = -1; project = projects[++i];) {
	mrs = yield getOpenedMergeRequests(project.id);
        if (mrs.length) {
            result = result.concat(mrs);
            yield db.zincrbyAsync('projects', mrs.length * 100000000, project.id);
        }
    }
    yield db.setAsync('omr', JSON.stringify(result));
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
getAllProjects()
    .then(function (result) {
        //console.log(result);
        console.log('r', result.length);
        console.log('r', pluck(sortBy(result, 'last_activity_at').reverse(),
            'name_with_namespace'))
    })
getOpenedMergeRequestsByProjects()
    .then(console.log.bind(console))
    .catch(console.error.bind(console));
