'use strict';
global.Promise = require('bluebird');
/*
var log = require('./log').child({
    module: 'app'
});
*/
var config = require('config');
var koa = require('koa');
var co = require('co');
var superagent = require('cc-superagent-promise');
var redis = require('redis');
Promise.promisifyAll(require("redis"));
var db = redis.createClient(config.redis_port || 6379, config.redis_host ||
    '127.0.0.1');
var pick = require('lodash').pick;

var app = koa();

app.use(function * (next) {
    if (this.path.indexOf('/api/v1/opened_merge_requests') < 0) return yield next;
    this.type = 'json'
    this.body = yield db.getAsync('opened_merge_requests');
});

app.use(function * (next) {
    if (this.path.indexOf('/api/v1/omr') < 0) return yield next;
    this.type = 'json'
    var omr = JSON.parse(yield db.getAsync('opened_merge_requests'))
        .map(function (mr) {
            console.log(mr);
            var result = pick(mr, [
                'title',
                'iid',
                'review',
            ]);
            result.project_url = mr.project.web_url;
            result.project_name = mr.project.name_with_namespace;
            result.url = result.project_url + '/merge_requests/' + mr.iid;
            return result;
        });
    this.body = omr;
});

app.use(function * (next) {
    if (this.path.indexOf('/account') < 0) return yield next;
    var r = yield superagent.get(config.inner_url_prefix +
        '/profile/account')
        .set('User-Agent', null)
        .set('Accept-Encoding', null)
        .set('Cookie', '_gitlab_session=' + this.cookies.get(
            '_gitlab_session'))
        .end();
    var pk = null;
    var match;
    if ((match = (r.text || '').match(/api_token=\"(\w+)\"/))) {
        pk = match[1];
    }
    this.type = 'json';
    this.body = pk || 'no pk found';
});

app.listen(7080);
