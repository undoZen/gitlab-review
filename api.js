'use strict';
global.Promise = require('bluebird');
var superagent = require('cc-superagent-promise');
var co = require('co');
var sortBy = require('lodash').sortBy;
var pluck = require('lodash').pluck;

function requestOnce(f) {
    return function (p1) {
        if (!p1) {
            if (!f.cache) f.cache = {};
            if (f.cache[p1]) {
                return f.cache[p1];
            } else {
                f.cache[p1] = f();
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

var getAllProjects = requestOnce(co.wrap(function * () {
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
    return result;
}));
getAllProjects();

var getOpenedMergeRequests = co.wrap(function * (pid) {
    return (yield superagent.get(
            config.inner_url_prefix + '/api/v3/projects/' + pid +
            '/merge_requests?state=opened')
        .set('PRIVATE-TOKEN', 'PsfVVHfxMxya3YzM9HR5')
        .end()).body;
});
var getAllOpenedMergeRequests = co.wrap(function * () {
    console.time('aomr');
    var projects = yield getAllProjects();
    var result = [];
    for (var project, i = -1; project = projects[++i];) {
        result = result.concat(yield getOpenedMergeRequests(project.id));
    }
    console.timeEnd('aomr');
    return result;
});
getAllProjects()
    .then(function (result) {
        //console.log(result);
        console.log('r', result.length);
        console.log('r', pluck(sortBy(result, 'last_activity_at').reverse(),
            'name_with_namespace'))
    })
getAllOpenedMergeRequests()
    .then(console.log.bind(console));
