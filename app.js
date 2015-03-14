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

var app = koa();

app.use(function * (next) {
	if (this.path.indexOf('/api/v1/opened_merge_requests') < 0) return yield next;
	this.type = 'json'
	this.body = yield db.getAsync('opened_merge_requests');
});

app.use(function * (next) {
	if (this.path.indexOf('/account') < 0) return yield next;
	var r = yield superagent.get(config.inner_url_prefix + '/profile/account')
			.set('User-Agent', null)
			.set('Accept-Encoding', null)
            .set('Cookie', '_gitlab_session='+this.cookies.get('_gitlab_session'))
			.end();
	var pk = null;
	var match;
	if ((match = (r.text || '').match(/api_token=\"(\w+)\"/))) {
		pk = match[1];
	}
	this.type = 'json';
	this.body = pk;
});

app.listen(7080);
