'use strict';
global.Promise = require('bluebird');
var log = require('./log').child({
    module: 'processing'
});
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

var db = redis.createClient(config.redis_port || 6379, config.redis_host ||
    '127.0.0.1');

function augmentNotes(gms, ps, mr) {
    var gid = ps[mr.project_id].namespace.id;
    log.trace({
        type: 'mr',
        gid: gid
    });
    return mr.notes.map(function (note) {
        log.trace({
            type: 'isAuthor',
            result: note.author.id === mr.author.id
        });
        log.trace({
            type: 'inGroup',
            result: !gms[gid][note.author.id]
        });
        log.trace({
            type: 'accessLevel',
            result: gms[gid][note.author.id] && gms[gid][note.author.id]
                .access_level
        });
        if (!gms[gid][note.author.id] || gms[gid][note.author.id].access_level <
            30) {
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
        note.is_assignee = mr.assignee && note.author.id === mr.assignee.id;
        note.yea = !! note.body.match(/\bYEA\b/i);
        return note;
    }).filter(Boolean);
}

function getReviewResult(notes) {
    var all = {};
    var yeas = {};
    var result = {
        assignee_id: null,
        assignee_name: null,
        assignee_yea: false,
        postInit: true,
        postReset: false,
    };
    for (var note, i = -1; note = notes[++i];) {
        if (note.isUpdate) {
            all = {};
            yeas = {};
            result.assignee_yea = false;
            result.updated_at = (new Date).toISOString();
            result.postReset = true;
            continue;
        }
        if (note.author.username === 'creditcloud') {
            result.postInit = false;
            if (result.updated_at) result.postReset = false;
            continue;
        }
        all[note.author.id] = note.author.name;
        if (note.yea) {
            yeas[note.author.id] = note.author.name;
        } else {
            delete yeas[note.author.id];
        }
        if (note.is_assignee) {
            result.assignee_id = note.author.id;
            result.assignee_name = note.author.name;
            result.assignee_yea = note.yea;
        }
    }
    return assign(result, {
        votes: Object.keys(all).map(function (id) {
            return {
                id: id,
                name: all[id],
                yea: !! yeas[id]
            };
        }),
    });
}

var postInit = co.wrap(function * (mr) {
    if (mr.project_id !== 88) return;
    var body = (yield superagent.post(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
        .type('json')
        .send({
            body: 'gitlab review 已关注此 merge request，请登录 http://gitlab.creditcloud.com/~review 了解 review 投票状态并在达成条件时进行 merge 操作\n\n请回复包含大写 YEA 单词的评论表示赞同 merge，回复其他表示反对'
        })
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
    log.info({
        body: body,
        mr: mr
    }, 'post review notes');
});
var postReset = co.wrap(function * (mr) {
    if (mr.project_id !== 88) return;
    var body = (yield superagent.post(
            config.inner_url_prefix + '/api/v3/projects/' + mr.project_id +
            '/merge_requests/' + mr.id + '/notes')
        .type('json')
        .send({
            body: '因为有代码更新，review 状态已重设，请重新回复 YEA 表示同意 merge'
        })
        .set('PRIVATE-TOKEN', config.private_token)
        .end()).body;
    log.info({
        body: body,
        mr: mr
    }, 'post review notes');
});
var ticking = false;
var tick = co.wrap(function * () {
    if (ticking) return;
    ticking = true;
    log.trace({
        type: 'ticktock'
    }, 'tick');
    var gms = JSON.parse(yield db.getAsync('tick:gms'));
    var ps = JSON.parse(yield db.getAsync('tick:ps'));
    var mrs = JSON.parse(yield db.getAsync('tick:mrs'));
    mrs.forEach(function (mr) {
        if (!mr.notes.filter(function (note) {
            return note.author.username === 'creditcloud';
        }).length) {}
        mr.notes = augmentNotes(gms, ps, mr);
        mr.review = {
            updated_at: mr.created_at
        };
        assign(mr.review, getReviewResult(mr.notes));
        if (mr.review.postInit) {
            postInit(mr);
        }
        if (mr.review.postReset) {
            postReset(mr);
        }
        mr.project = ps[mr.project_id];
        // var beenUpdatedFor = Date.now() - (new Date(mr.review.updatedAt)).valueOf();
        /*
		mr.reviewAll = countYeas(gms, ps, mr, mr.notes, true);
		mr.reviewYea = countYeas(gms, ps, mr, mr.notes);
		mr.reviewYeaByAssignee = yeaByAssignee(mr, mr.notes);
*/
    });
    log.trace({
        mrs: mrs,
    });
    yield sleep(1000);
    yield db.setAsync('opened_merge_requests', JSON.stringify(mrs));
    yield db.publishAsync('tock', true);
    ticking = false;
});
db.publish('tock', true);

var sub = redis.createClient(config.redis_port || 6379, config.redis_host ||
    '127.0.0.1');
sub.on('message', tick);
sub.subscribe('tick');
