var cheerio = require('cheerio');

var WEBSITE_JSON_URL = 'https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json';
var FALLBACK_BASE_URL = 'https://new13.savefilm21info.com';
var FALLBACK_TMDB_KEY = 'b030404650f279792a8d3287232358e3';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function normalizeText(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/sub\s*indo/gi, '')
        .replace(/\(\d{4}\)/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreMatch(candidateTitle, targetTitle, targetOrigTitle, targetYear) {
    var cand = normalizeText(candidateTitle);
    var t1 = normalizeText(targetTitle);
    var t2 = normalizeText(targetOrigTitle);
    var score = 0;

    if (cand && (cand === t1 || (t2 && cand === t2))) {
        score += 100;
    } else if (cand && t1 && (cand.indexOf(t1) !== -1 || t1.indexOf(cand) !== -1)) {
        score += 50;
    } else if (cand && t2 && (cand.indexOf(t2) !== -1 || t2.indexOf(cand) !== -1)) {
        score += 45;
    } else {
        return 0;
    }

    if (targetYear && String(candidateTitle).indexOf(String(targetYear)) !== -1) {
        score += 30;
    }
    return score;
}

async function fetchMeta(tmdbId, mediaType) {
    var isTv = mediaType === 'tv' || mediaType === 'series';
    var type = isTv ? 'tv' : 'movie';
    var apiKey = (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) ? TMDB_API_KEY : FALLBACK_TMDB_KEY;

    if (String(tmdbId).indexOf('tt') === 0) {
        try {
            var findRes = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(tmdbId) + '?external_source=imdb_id&api_key=' + apiKey);
            if (findRes.ok) {
                var findJson = await findRes.json();
                var list = isTv ? (findJson.tv_results || []) : (findJson.movie_results || []);
                if (list.length > 0) {
                    var item = list[0];
                    return {
                        title: item.title || item.name || '',
                        originalTitle: item.original_title || item.original_name || '',
                        year: String(item.release_date || item.first_air_date || '').substring(0, 4)
                    };
                }
            }
        } catch (e) {}

        try {
            var cRes = await fetch('https://v3-cinemeta.strem.io/meta/' + (isTv ? 'series' : 'movie') + '/' + encodeURIComponent(tmdbId) + '.json');
            if (cRes.ok) {
                var cJson = await cRes.json();
                var m = cJson.meta || {};
                return {
                    title: m.name || '',
                    originalTitle: m.name || '',
                    year: String(m.releaseInfo || m.year || '').substring(0, 4)
                };
            }
        } catch (e) {}
    }

    try {
        var res = await fetch('https://api.themoviedb.org/3/' + type + '/' + encodeURIComponent(tmdbId) + '?api_key=' + apiKey);
        if (res.ok) {
            var data = await res.json();
            return {
                title: data.title || data.name || '',
                originalTitle: data.original_title || data.original_name || '',
                year: String(data.release_date || data.first_air_date || '').substring(0, 4)
            };
        }
    } catch (e) {}

    return null;
}

async function getBaseUrl() {
    try {
        var res = await fetch(WEBSITE_JSON_URL, { headers: { 'User-Agent': UA } });
        if (res.ok) {
            var json = await res.json();
            if (json && Array.isArray(json.savefilm) && json.savefilm[0]) {
                return String(json.savefilm[0]).replace(/\/+$/, '');
            }
        }
    } catch (e) {}
    return FALLBACK_BASE_URL;
}

function unpackDeanEdwards(html) {
    var m = html.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
    if (!m) return '';
    var p = m[1];
    var a = parseInt(m[2], 10);
    var c = parseInt(m[3], 10);
    var k = m[4].split('|');
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    function encodeBase(n) {
        return (n < a ? '' : encodeBase(Math.floor(n / a))) + (chars[n % a] || '');
    }

    for (var i = c - 1; i >= 0; i--) {
        if (k[i]) {
            p = p.replace(new RegExp('\\b' + encodeBase(i) + '\\b', 'g'), k[i]);
        }
    }
    return p;
}

function normalizeIframeUrl(url) {
    if (!url) return '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (url.indexOf('dingtezuni') !== -1 || url.indexOf('movearnpre') !== -1 || url.indexOf('mivalyo') !== -1 || url.indexOf('ryderjet') !== -1 || url.indexOf('morencius') !== -1 || url.indexOf('bingezove') !== -1) {
        url = url.replace('/d/', '/v/').replace('/download/', '/v/').replace('/file/', '/v/').replace('/f/', '/v/');
    }
    return url;
}

function extractM3u8Links(text) {
    var matches = text.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi) || [];
    var seen = {};
    var out = [];
    for (var i = 0; i < matches.length; i++) {
        var u = matches[i].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        if (!seen[u]) {
            seen[u] = true;
            out.push(u);
        }
    }
    return out;
}

async function resolveIframe(iframeUrl, pageReferer) {
    var streams = [];
    var target = normalizeIframeUrl(iframeUrl);
    if (!target || target.indexOf('http') !== 0) return streams;
    if (target.indexOf('youtube.com') !== -1 || target.indexOf('youtu.be') !== -1) return streams;

    try {
        var hostMatch = target.match(/^(https?:\/\/[^\/]+)/);
        var origin = hostMatch ? hostMatch[1] : pageReferer;
        var hostName = origin.replace(/^https?:\/\//, '');

        var res = await fetch(target, {
            headers: {
                'User-Agent': UA,
                'Referer': pageReferer
            }
        });
        if (!res.ok) return streams;
        var html = await res.text();
        var unpacked = unpackDeanEdwards(html) || html;
        var links = extractM3u8Links(unpacked);

        for (var i = 0; i < links.length; i++) {
            streams.push({
                name: 'Savefilm21',
                title: 'Savefilm21 · ' + hostName + ' (Sub Indo)',
                url: links[i],
                quality: 'HD',
                language: 'id',
                provider: 'Savefilm21',
                headers: {
                    'Referer': origin + '/',
                    'Origin': origin,
                    'User-Agent': UA
                }
            });
        }
    } catch (e) {}
    return streams;
}

function collectIframes($) {
    var list = [];
    $('div.gmr-embed-responsive iframe, iframe').each(function () {
        var src = $(this).attr('data-src') || $(this).attr('data-litespeed-src') || $(this).attr('src') || '';
        if (src && list.indexOf(src) === -1) {
            list.push(src);
        }
    });
    return list;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var meta = await fetchMeta(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    var isTv = mediaType === 'tv' || mediaType === 'series';
    var baseUrl = await getBaseUrl();

    var queries = [meta.title];
    if (meta.originalTitle && meta.originalTitle !== meta.title) {
        queries.push(meta.originalTitle);
    }

    var bestUrl = '';
    var bestScore = 0;

    for (var qi = 0; qi < queries.length; qi++) {
        try {
            var searchUrl = baseUrl + '/?s=' + encodeURIComponent(queries[qi]) + '&post_type[]=post&post_type[]=tv';
            var sRes = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
            if (!sRes.ok) continue;
            var sHtml = await sRes.text();
            var $s = cheerio.load(sHtml);

            $s('h2.entry-title a').each(function () {
                var href = $s(this).attr('href') || '';
                var text = $s(this).text() || '';
                if (!href) return;
                if (isTv && href.indexOf('/tv/') === -1) return;
                if (!isTv && href.indexOf('/tv/') !== -1) return;

                var sc = scoreMatch(text, meta.title, meta.originalTitle, meta.year);
                if (sc > bestScore) {
                    bestScore = sc;
                    bestUrl = href;
                }
            });
            if (bestScore >= 100) break;
        } catch (e) {}
    }

    if (!bestUrl) return [];

    var targetPageUrl = bestUrl;
    if (isTv) {
        var tvRes = await fetch(bestUrl, { headers: { 'User-Agent': UA, 'Referer': baseUrl + '/' } });
        if (!tvRes.ok) return [];
        var tvHtml = await tvRes.text();
        var $tv = cheerio.load(tvHtml);

        var targetEp = Number(episodeNum || 1);
        var targetSeason = Number(seasonNum || 1);
        var matchedEpUrl = '';

        $tv('a[href*="/eps/"]').each(function () {
            var href = $tv(this).attr('href') || '';
            var text = $tv(this).text() || '';
            var epRegex = new RegExp('(?:episode|ep|e)\\s*0*' + targetEp + '(?:\\D|$)', 'i');
            if (epRegex.test(href) || epRegex.test(text)) {
                if (targetSeason > 1) {
                    var sRegex = new RegExp('(?:season|s)\\s*0*' + targetSeason + '(?:\\D|$)', 'i');
                    if (sRegex.test(href) || sRegex.test(text) || !matchedEpUrl) {
                        matchedEpUrl = href;
                    }
                } else if (!matchedEpUrl) {
                    matchedEpUrl = href;
                }
            }
        });

        if (!matchedEpUrl) return [];
        targetPageUrl = matchedEpUrl;
    }

    var pageRes = await fetch(targetPageUrl, { headers: { 'User-Agent': UA, 'Referer': baseUrl + '/' } });
    if (!pageRes.ok) return [];
    var pageHtml = await pageRes.text();
    var $p = cheerio.load(pageHtml);

    var iframes = collectIframes($p);
    var tabUrls = [];

    $p('ul.muvipro-player-tabs a').each(function () {
        var href = $p(this).attr('href') || '';
        if (!href || href.indexOf('#') === 0) return;
        var full = href.indexOf('http') === 0 ? href : (baseUrl + '/' + href.replace(/^\/+/, ''));
        if (full !== targetPageUrl && tabUrls.indexOf(full) === -1) {
            tabUrls.push(full);
        }
    });

    if (tabUrls.length > 0) {
        var tabTasks = tabUrls.slice(0, 5).map(function (tu) {
            return fetch(tu, { headers: { 'User-Agent': UA, 'Referer': targetPageUrl } })
                .then(function (r) { return r.ok ? r.text() : ''; })
                .then(function (h) { return h ? collectIframes(cheerio.load(h)) : []; })
                .catch(function () { return []; });
        });
        var tabResults = await Promise.all(tabTasks);
        for (var ti = 0; ti < tabResults.length; ti++) {
            for (var tj = 0; tj < tabResults[ti].length; tj++) {
                if (iframes.indexOf(tabResults[ti][tj]) === -1) {
                    iframes.push(tabResults[ti][tj]);
                }
            }
        }
    }

    var tasks = iframes.map(function (ifr) {
        return resolveIframe(ifr, targetPageUrl);
    });
    var settled = await Promise.all(tasks);
    var streams = [];
    var seenUrls = {};

    for (var si = 0; si < settled.length; si++) {
        var list = settled[si] || [];
        for (var sj = 0; sj < list.length; sj++) {
            var st = list[sj];
            if (st && st.url && !seenUrls[st.url]) {
                seenUrls[st.url] = true;
                streams.push(st);
            }
        }
    }

    return streams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
}
globalThis.getStreams = getStreams;
