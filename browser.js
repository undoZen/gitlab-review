'use strict';
var Ractive = require('ractive');
var Bacon = require('baconjs');
var socket = require('socket.io-client')();
var moment = require('moment');
require('moment/locale/zh-cn');
window.moment = moment;

var showMergeMessage = console.log.bind(console, 'smm');
var omrList = new Ractive({
    el: 'omr-list',
    template: '#omr-list-template',
    data: {
        mrs: []
    },
    merge: function (mr) {
        console.log('merge', {
            username: 'undozen',
            project_id: mr.project_id,
            id: mr.id,
        });
        socket.emit('merge', {
            username: 'undozen',
            project_id: mr.project_id,
            id: mr.id
        }, showMergeMessage);
    }
});

socket.on('omr', function (mrs) {
    console.log(mrs);
    omrList.set('mrs', mrs.map(function (mr) {
        mr.review.updated_at_mmt = moment(mr.review.updated_at).fromNow();
        if (!mr.review.all) {
            mr.hint = '请等待其他开发者 review';
        } else if (mr.review.yeas < mr.review.all) {
            mr.hint = '需所有开发者同意才可 merge';
        } else if (mr.review.all < 2) {
            if (mr.review.assignee_yea) {
                mr.hint = '请点击左侧按钮 merge，如不成功请手动解决冲突';
                mr.canMerge = true;
            } else {
                mr.hint = '至少还需要一位开发者的同意才能 merge'
            }
        } else {
            mr.hint = '请点击左侧按钮 merge，如不成功请手动解决冲突';
            mr.canMerge = true;
        }
        mr.updated = moment(Date.now(), mr.review.updated_at);
        return mr;
    }));
});

console.log('hello');
window.socket = socket;
