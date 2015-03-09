'use strict';
var logger = require('bunyan-hub-logger');
logger.replaceDebug('gitlab-review:');
logger.replaceConsole('gitlab-review:');
module.exports = logger('gitlab-review');
