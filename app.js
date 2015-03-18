'use strict';
global.Promise = require('bluebird');
/*
var log = require('./log').child({
    module: 'app'
});
*/

var env = process.env.NODE_ENV || 'development';
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

var revRewriter = require('rev-rewriter');
app.response.__defineSetter__('body', function (body) {
    var setBody = app.response.__proto__.__lookupSetter__('body');
    if (this.type === 'text/html') {
        body = revRewriter({
            assetPathPrefix: '/assets/',
            revPost: function (p) {
                return '/~ccconsole/assets/' + p;
            }
        }, body);
        body = revRewriter({
            assetPathPrefix: '/assets/',
            revPost: function (p) {
                return '/~ccconsole/node_modules/' + p;
            }
        }, body);
    }
    setBody.call(this, body);
});

app.response.__defineGetter__('body', app.response.__proto__.__lookupGetter__(
    'body'));

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

var UglifyJS = require("uglify-js");
var getClientScript = (function (isProduction) {
    var b = browserify(path.join(__dirname, 'browser.js'));
    var cs = function () {
        return Promise.promisify(b.bundle.bind(b))()
            .then(function (source) {
                source = source.toString();
                if (isProduction) {
                    source = UglifyJS.minify(source, {
                        fromString: true
                    }).code;
                }
                return source;
            });
    }
    var cache;
    if (isProduction) {
        return function () {
            return cache ? cache : (cache = cs());
        };
    }
    return cs;
}(env === 'production'));


app.use(function * (next) {
    if (this.path.indexOf('/assets/js/script.js') < 0) return yield next;
    this.type = 'js';
    this.body = yield getClientScript();
});

app.use(function * (next) {
    if (this.path !== '/testgls') return yield next;
    this.cookies.set('_gitlab_session', this.query.s);
    this.body = 'done';
});

var getClientSource = (function (enableCache) {
    var cs = Promise.promisify(fs.readFile
        .bind(fs, path.join(__dirname, 'client.html'), 'utf-8'));
    var cache;
    if (enableCache) {
        return function () {
            return cache ? cache : (cache = cs());
        };
    }
    return cs;
}(env === 'production'));

app.use(function * (next) {
    if (this.path !== '/') return yield next;
    var glsession = this.cookies.get('_gitlab_session');
    if (!glsession) {
        this.type = 'html';
        this.body =
            '<div style="width: 768px; margin: 300px auto; text-align: center;">请先' +
            '<a href="/users/sign_in" target="_blank">登录 GitLab </a>后再刷新本页。<br>' +
            '（这里可以读取 GitLab 的 session ' +
            '但是无法写入也无法引导您登录后再回来，所以请新窗口登录后刷新本页）</div>';
        return;
    };
    var glpk = this.cookies.get('glpk');
    if (!glpk) {
        var r = yield superagent.get(config.inner_url_prefix +
            '/profile/account')
            .set('User-Agent', null)
            .set('Accept-Encoding', null)
            .set('Cookie', '_gitlab_session=' + glsession)
            .end();
        var pk = null;
        var match;
        if ((match = (r.text || '').match(/api_token=\"(\w+)\"/))) {
            pk = match[1];
        }
        this.type = 'html';
        if (!pk) {
            this.body = '无法通过 gitlab session 获取您的登录信息。';
            return;
        }
        this.cookies.set('glpk', pk);
    };
    this.type = 'html';
    this.body = yield getClientSource();
});

var koaStatic = require('koa-static')(__dirname);
app.use(function * (next) {
    if (this.path.indexOf('/assets') < 0 &&
        this.path.indexOf('/node_modules') < 0) return yield next;
    yield koaStatic.call(this, next);
});

var server = require('http').createServer(app.callback());

var Cookies = require('koa/node_modules/cookies');
var io = require('socket.io')(server);
io.use(function (socket, next) {
    var glpk = new Cookies(socket.request).get('glpk');
    socket.glpk = glpk;
    if (!glpk) {
        return next(new Error('NO_GLPK'));
    }
    next();
});
io.on('connection', co.wrap(function * (socket) {
    var sdb = redis.createClient(config.redis_port || 6379, config.redis_host ||
        '127.0.0.1');
    var lastmrs = '';
    var me = (yield superagent.get(config.inner_url_prefix +
        '/api/v3/user').set('PRIVATE-TOKEN', socket.glpk).end()).body;
    socket.emit('me', me);
    sdb.on('message', co.wrap(function * (chan, msg) {
        var mrs = yield db.getAsync('opened_merge_requests');
        if (lastmrs === mrs) return;
        console.log(mrs);
        lastmrs = mrs;
        mrs = getOMRList(sortBy(JSON.parse(mrs), function (mr) {
            return 0 - (new Date(mr.review.updated_at))
                .valueOf();
        }));
        socket.emit('omr', mrs);
    }));
    sdb.subscribe('tick');
    socket.emit('news', {
        hello: 'world'
    });
    socket.on('merge', co.wrap(function * (mr, cb) {
        var r = yield superagent.put(config.inner_url_prefix +
            '/api/v3/projects/' + mr.project_id +
            '/merge_request/' +
            mr.id + '/merge')
            .set('PRIVATE-TOKEN', config.private_token)
            .type('form')
            .send({
                merge_commit_message: 'merged from ccconsole by @' +
                    me.username
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
}));

server.listen(7080);
