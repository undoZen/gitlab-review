'use strict';
global.Promise = require('bluebird');
/*
var log = require('./log').child({
    module: 'app'
});
*/

var config = require('config');
var fs = require('fs');
var path = require('path');
var koa = require('koa');
var co = require('co');
var superagent = require('cc-superagent-promise');
var redis = require('redis');
Promise.promisifyAll(require("redis"));
var db = redis.createClient(config.redis_port || 6379, config.redis_host ||
    '127.0.0.1');
var pick = require('lodash').pick;
var sortBy = require('lodash').sortBy;
var browserify = require('browserify');

var app = koa();

app.use(function * (next) {
    if (this.path.indexOf('/api/v1/opened_merge_requests') < 0) return yield next;
    this.type = 'json'
    this.body = yield db.getAsync('opened_merge_requests');
});

function getOMRList(mrs) {
    return mrs.map(function (mr) {
        console.log(mr);
        var result = pick(mr, [
            'project_id',
            'id',
            'iid',
            'title',
            'author',
            'review',
            'source_branch',
            'target_branch',
        ]);
        result.project_url = mr.project.web_url;
        result.project_name = mr.project.name;
        result.project_namespace_path = mr.project.namespace.path;
        result.url = result.project_url + '/merge_requests/' +
            mr.iid;
        return result;
    });
}

app.use(function * (next) {
    if (this.path.indexOf('/api/v1/omr') < 0) return yield next;
    this.type = 'json'
    var omr = getOMRList(JSON.parse(yield db.getAsync(
        'opened_merge_requests')));
    this.body = omr;
});

app.use(function * (next) {
    if (this.path.indexOf('/browser.js') < 0) return yield next;
    this.type = 'js';
    this.body = browserify(path.join(__dirname, 'browser.js')).bundle();
});

app.use(function * (next) {
    if (this.path !== '/') return yield next;
    this.type = 'html';
    this.body = fs.createReadStream(path.join(__dirname, 'client.html'));
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

var koaStatic = require('koa-static')(__dirname);
app.use(function * (next) {
    if (this.path.indexOf('/account') < 0 &&
        this.path.indexOf('/node_modules') < 0) return yield next;
    yield koaStatic.call(this, next);
});

var server = require('http').createServer(app.callback());

var io = require('socket.io')(server);
io.on('connection', function (socket) {
    var sdb = redis.createClient(config.redis_port || 6379, config.redis_host ||
        '127.0.0.1');
    var lastmrs = '';
    sdb.on('message', co.wrap(function * (chan, msg) {
        var mrs = yield db.getAsync('opened_merge_requests');
        if (lastmrs === mrs) return;
        console.log(mrs);
        lastmrs = mrs;
        mrs = getOMRList(sortBy(JSON.parse(mrs), function (mr) {
            return 0 - (new Date(mr.review.updated_at)).valueOf();
        }));
        socket.emit('omr', mrs);
    }));
    sdb.subscribe('tick');
    socket.emit('news', {
        hello: 'world'
    });
    socket.on('merge', co.wrap(function * (mr, cb) {
        var r = yield superagent.put(config.inner_url_prefix +
            '/api/v3/projects/' + mr.project_id + '/merge_request/' +
            mr.id + '/merge')
            .set('PRIVATE-TOKEN', config.private_token)
            .type('form')
            .send({
                merge_commit_message: 'merged from ccconsole by @' +
                    mr.username
            })
            .end();
        cb({
            statuc: r.status,
            body: r.body
        });
    }));
    socket.on('close', function () {
        sdb.unsubscribe();
        sdb.close();
    });
});

server.listen(7080);
