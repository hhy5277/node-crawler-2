/// 依赖模块
var fs = require('fs');
var request = require("request");
var cheerio = require("cheerio");
var mkdirp = require('mkdirp');
var iconv = require('iconv-lite');
var async = require('async');
var color = require('./color.js');
var path = require('path');
var URL = require('url');

/// 配置文件
var config = require('./config.js');
var rooturl = config.isPagination ? function (i) { return config.url.replace('%%', i); }:config.url;
var rootsite = config.url.match(/[^\.]+[^/]+/)[0];

console.log(color('blueBG', 2), '抓取对象：', rootsite);

var Crawler = function () {
    this.from = config.from || 1;
    this.to = config.to || 1;
};

/// 开始处理的入口
Crawler.prototype.crawl = function () {
    var that = this;
    var urlLevels = []; /// 收集每个层级的url
    console.log('程序正在执行中...');
    
    /// 通过config.selector的长度来确定页面的层级
    async.eachSeries(config.selector, function (item, callback) {
        var index = config.selector.indexOf(item);
        /// 最后一层级
        if (index === config.selector.length - 1) {
            if (config.type) {
                if (that[config.type]) {
                    that[config.type](urlLevels[index - 1]);
                } else {
                    console.log(color('redBG'), '参数type值无效，参数值:text|image');
                }
            } else {
                console.log(color('redBG'), '您没有配置参数type，参数值:text|image');
            }
        } 
        /// 第一层级
        else if (index === 0) {
            urlLevels[0] = [];
            if (config.isPagination) {
                var i = config.from;
                async.whilst(function () {
                    return i <= config.to;
                }, function (_callback) {
                    that.request(rooturl(i), function (status, $) {
                        if (status) {
                            var $$ = eval(item.$);
                            $$.each(function () {
                                var nextUrl = $(this).attr(item.attr);
                                if (!/^http:\/\//i.test(nextUrl)) {
                                    nextUrl = rootsite + nextUrl;
                                }
                                urlLevels[0].push(nextUrl);
                            });
                            console.log('第%d页分析完成', i);
                        } else {
                            console.log(color('red', 2), rooturl(i), '请求失败');
                        }
                        setTimeout(function () {
                            ++i;
                            _callback(null);
                        }, parseInt(Math.random() * 2000));
                    });
                }, function (err) {
                    if (err) {
                        console.log(color('red'), err);
                    } else {
                        var show_txt = '';
                        if (config.type === 'image') {
                            show_txt = '套图片';
                        } else if (config.type === 'text') {
                            show_txt = '篇文章';
                        }
                        
                        console.log(color('green'), '分页处理完成，共收集到了' + urlLevels[0].length + show_txt);
                    }
                    callback(null);
                });
            } else {
                that.request(rooturl, function (status, $) {
                    if (status) {
                        eval(item.$).each(function () {
                            urlLevels[0].push($(this).attr(item.attr));
                        });
                    } else {
                        console.log(color('red', 2), rooturl, '请求失败');
                    }
                    callback(null);
                });
            }
        } 
        /// 中间层级
        else {
            urlLevels[index] = [];
            async.eachSeries(urlLevels[index - 1], function (_item, _callback) {
                that.request(_item, function (status, $) {
                    if (status) {
                        eval(_item.$).each(function () {
                            urlLevels[index].push($(this).attr(_item.attr));
                        });
                    } else {
                        console.log(color('red', 2), _item, '请求失败');
                    }
                    _callback(null);
                });
            }, function () {
                callback(null);
            });
        }
    }, function (err) {
        if (err) {
            console.log(color('red'), err);
        } else {
            console.log(color('green'), '层级地址完成');
        }
    });
};

/// 处理text
/// urls:{Array}
Crawler.prototype.text = function (urls) {
    console.log('抓取文本中...');
    var that = this;
    var i = 0;
    var count = urls.length;
    var hostname = URL.parse(rootsite).hostname;
    mkdirp(config.saveDir + '/' + hostname, function (err) {
        if (err) {
            console.log(color('red'), '创建目录失败');
            process.exit(0);
        } else {
            async.whilst(function () {
                return i < urls.length;
            }, function (callback) {
                var uri = urls[i];
                that.request(uri, function (status, $) {
                    if (status) {
                        var title = that.title($("title").text());
                        var filepath = path.join(config.saveDir, hostname, title + '.txt');
                        var last = config.selector[config.selector.length - 1];
                        var content = eval(last.$).text();
                        fs.writeFile(filepath, content, { flag: 'wx' }, function (_err) {
                            if (_err) {
                                if (_err.code === 'EEXIST') {
                                    console.log(color('yellow'), '文件' + filepath + '已存在');
                                } else {
                                    console.log(color('red'), '保存文件' + filepath + '失败');
                                }
                            } else {
                                console.log(color('green', 2), i + '/' + count , '文件' + filepath + '保存成功');
                            }
                            setTimeout(callback, parseInt(Math.random() * 2000));
                        });
                    } else {
                        setTimeout(callback, parseInt(Math.random() * 2000));
                    }
                });
                ++i;
            }, function (err) {
                if (err) {
                    console.log(color("red"), err);
                } else {
                    console.log(color("green"), '执行完毕~');
                }
            });
        }
    });
};

/// 处理image
/// urls:{Array}
Crawler.prototype.image = function (urls) {
    console.log('抓取图片中...');
    var that = this;
    var list = []; /// 存储图片路径
    var i = 0;
    var count = urls.length;
    async.whilst(function () {
        return i < count;
    }, function (callback) {
        var uri = urls[i];
        that.request(uri, function (status, $) {
            if (status) {
                var last = config.selector[config.selector.length - 1];
                var $$ = eval(last.$);
                var len = $$.length;
                if (len > 0) {
                    $$.each(function () {
                        list.push({
                            url: $(this).attr(last.attr),
                            title: that.title($("title").text())
                        });
                    });
                }
                console.log('第%s套图片收集了%d张图片', (i + 1) + '/' + count, $$.length);
            } else {
                console.log(color('red'), '页面' + uri + '请求失败');
            }
            setTimeout(function () {
                ++i;
                callback();
            }, parseInt(Math.random() * 2000));
        });
    }, function (err) {
        if (err) console.log('imageError', err);
        that.dlImage(list);
    });
};

/// 下载图片
Crawler.prototype.dlImage = function (list) {
    var that = this;
    var count = list.length;
    console.log('共发现%d张图片，准备下载到本地中...', count);
    if (count < 1) return;
    async.eachSeries(list, function (item, callback) {
        var filename = item.url.match(/[^\/]+\.\w{3,4}$/)[0];
        var filepath = path.join(config.saveDir, item.title);
        mkdirp(filepath, function (err) {
            if (err) {
                callback(err);
            } else {
                request.head(item.url, function (err, res, body) {
                    var url = config.imageFn ? config.imageFn(item.url) : item.url;
                    request(url).pipe(fs.createWriteStream(path.join(filepath, filename)));
                    console.log(color('green', 3), (list.indexOf(item) + 1) + '/' + count, path.join(filepath, filename), '保存成功');
                    setTimeout(callback, parseInt(Math.random() * 2000));
                });
            }
        });
    }, function (err) {
        if (err) {
            console.log(color("red"), err);
        } else {
            console.log(color("green"), '执行完毕~');
        }
    });
};

/// 获取页面
/// url:{String} 页面地址
/// callback:{Function} 获取页面完成后的回调callback(boolen,$)
Crawler.prototype.request = function (url, callback) {
    var that = this;
    iconv.extendNodeEncodings(); /// 转码用
    
    var opts = {
        url: url,
        encoding: config.charset || 'utf8'
    };
    
    config.headers && (opts.headers = config.headers);
    
    request(opts, function (err, res, body) {
        if (!err && res.statusCode == 200) {
            callback(true, cheerio.load(body));
        } else {
            !err && console.log(res.statusCode);
            callback(false);
        }
        iconv.undoExtendNodeEncodings();
    });
};

/// 处理标题(title)
Crawler.prototype.title = function (str) {
    var title = str.replace(/[\\/:\*\?"<>\|]/g, '').trim();
    if (/-/.test(title)) {
        title = title.match(/(.+)\-[^\-]+$/)[1];
    }
    return title;
};

new Crawler().crawl();
