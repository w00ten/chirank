var cheerio = require('cheerio');

var BASE_URL = 'https://server-1.layar.asia';
var FALLBACK_TMDB_KEY = 'b030404650f279792a8d3287232358e3';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function normalizeText(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/^ep\s*\d+\s*/i, '')
        .replace(/^(?:korea|china|jap|thailand|taiwan)\s+\d{4}\s*/i, '')
        .replace(/subtitle\s+indonesia.*$/i, '')
        .replace(/sub\s*indo.*$/i, '')
        .replace(/\(\d{4}\)/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreMatch(candidateTitle, href, targetTitle, targetOrigTitle, targetYear) {
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

    if (targetYear && (String(candidateTitle).indexOf(String(targetYear)) !== -1 || String(href).indexOf(String(targetYear)) !== -1)) {
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

function extractSrcFromOption(valStr) {
    if (!valStr) return '';
    var direct = valStr.match(/src\s*=\s*['"]([^'"]+)['"]/i);
    if (direct && direct[1]) return direct[1];
    if (valStr.indexOf('http') === 0) return valStr;

    try {
        if (typeof atob === 'function') {
            var decoded = atob(valStr);
            var m = decoded.match(/src\s*=\s*['"]([^'"]+)['"]/i);
            if (m && m[1]) return m[1].trim();
            if (decoded.indexOf('http') === 0) return decoded.trim();
        }
    } catch (e) {}
    return '';
}

async function resolveHydrax(embedUrl, refererUrl) {
    var streams = [];
    try {
        var res = await fetch(embedUrl, {
            headers: { 'User-Agent': UA, 'Referer': refererUrl }
        });
        if (!res.ok) return streams;
        var html = await res.text();
        var encMatch = html.match(/const\s+datas\s*=\s*"([^"]*)"/);
        if (!encMatch || !encMatch[1]) return streams;

        var decRes = await fetch('https://enc-dec.app/api/dec-abyss', {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Content-Type': 'application/json',
                'Origin': 'https://playhydrax.com',
                'Referer': 'https://playhydrax.com/'
            },
            body: JSON.stringify({ text: encMatch[1] })
        });
        if (!decRes.ok) return streams;
        var decJson = await decRes.json();
        var sources = (decJson && decJson.result && Array.isArray(decJson.result.sources)) ? decJson.result.sources : [];

        for (var i = 0; i < sources.length; i++) {
            var s = sources[i];
            if (s && s.url && s.status !== false) {
                var q = s.type || 'HD';
                streams.push({
                    name: 'LayarAsia',
                    title: 'LayarAsia · Hydrax (' + q + ')',
                    url: s.url,
                    quality: q,
                    language: 'id',
                    provider: 'LayarAsia',
                    headers: {
                        'Referer': 'https://playhydrax.com/',
                        'Origin': 'https://playhydrax.com',
                        'User-Agent': UA
                    }
                });
            }
        }
    } catch (e) {}
    return streams;
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

async function resolveGenericEmbed(embedUrl, pageReferer) {
    var out = [];
    try {
        var res = await fetch(embedUrl, { headers: { 'User-Agent': UA, 'Referer': pageReferer } });
        if (!res.ok) return out;
        var html = await res.text();
        var unpacked = unpackDeanEdwards(html) || html;
        var matches = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/gi) || [];
        var seen = {};
        for (var i = 0; i < matches.length; i++) {
            var u = matches[i].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            if (!seen[u]) {
                seen[u] = true;
                out.push({
                    name: 'LayarAsia',
                    title: 'LayarAsia · HLS (Sub Indo)',
                    url: u,
                    quality: 'HD',
                    language: 'id',
                    provider: 'LayarAsia',
                    headers: { 'Referer': embedUrl, 'User-Agent': UA }
                });
            }
        }
    } catch (e) {}
    return out;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var meta = await fetchMeta(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    var isTv = mediaType === 'tv' || mediaType === 'series';
    var queries = [meta.title];
    if (meta.originalTitle && meta.originalTitle !== meta.title) {
        queries.push(meta.originalTitle);
    }

    var bestUrl = '';
    var bestScore = 0;

    for (var qi = 0; qi < queries.length; qi++) {
        try {
            var searchUrl = BASE_URL + '/?s=' + encodeURIComponent(queries[qi]);
            var sRes = await fetch(searchUrl, { headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' } });
            if (!sRes.ok) continue;
            var sHtml = await sRes.text();
            var $s = cheerio.load(sHtml);

            $s('article.bs a[href], .listupd article a[href], article a[href]').each(function () {
                var href = $s(this).attr('href') || '';
                if (!href || href.indexOf('#') === 0) return;
                var title = $s(this).attr('title') || $s(this).find('.tt, h2, h3').text() || $s(this).text() || '';
                if (!title) return;

                var sc = scoreMatch(title, href, meta.title, meta.originalTitle, meta.year);
                if (sc > bestScore) {
                    bestScore = sc;
                    bestUrl = href.indexOf('http') === 0 ? href : (BASE_URL + '/' + href.replace(/^\/+/, ''));
                }
            });
            if (bestScore >= 100) break;
        } catch (e) {}
    }

    if (!bestUrl) return [];

    var pageUrl = bestUrl;
    if (isTv) {
        var sRes2 = await fetch(bestUrl, { headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' } });
        if (!sRes2.ok) return [];
        var sHtml2 = await sRes2.text();
        var $tv = cheerio.load(sHtml2);

        var targetEp = Number(episodeNum || 1);
        var matchedEp = '';
        $tv('.eplister li a, .episodelst li a, ul.clstyle li a').each(function () {
            var epHref = $tv(this).attr('href') || '';
            var epText = $tv(this).text() || '';
            var m = epText.match(/(?:Episode|Ep)\s*0*(\d+)/i) || epHref.match(/-episode-0*(\d+)/i) || epHref.match(/\/(\d+)\/?$/);
            if (m && Number(m[1]) === targetEp && !matchedEp) {
                matchedEp = epHref.indexOf('http') === 0 ? epHref : (BASE_URL + '/' + epHref.replace(/^\/+/, ''));
            }
        });
        if (matchedEp) {
            pageUrl = matchedEp;
        }
    }

    var pRes = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' } });
    if (!pRes.ok) return [];
    var pHtml = await pRes.text();
    var $p = cheerio.load(pHtml);

    var iframes = [];
    $p('#embed_holder iframe[src], #pembed iframe[src], .player-embed iframe[src]').each(function () {
        var src = $p(this).attr('src') || '';
        if (src && iframes.indexOf(src) === -1) iframes.push(src);
    });

    $p('select.mirror option, .mirror option').each(function () {
        var val = $p(this).attr('value') || '';
        var src = extractSrcFromOption(val);
        if (src && iframes.indexOf(src) === -1) iframes.push(src);
    });

    var tasks = [];
    for (var i = 0; i < iframes.length; i++) {
        var src = iframes[i];
        if (src.indexOf('//') === 0) src = 'https:' + src;
        if (src.indexOf('abyssplayer') !== -1 || src.indexOf('hydrax') !== -1 || src.indexOf('playhydrax') !== -1) {
            tasks.push(resolveHydrax(src, pageUrl));
        } else if (src.indexOf('http') === 0) {
            tasks.push(resolveGenericEmbed(src, pageUrl));
        }
    }

    var settled = await Promise.all(tasks);
    var streams = [];
    var seen = {};
    for (var si = 0; si < settled.length; si++) {
        var list = settled[si] || [];
        for (var sj = 0; sj < list.length; sj++) {
            if (list[sj] && list[sj].url && !seen[list[sj].url]) {
                seen[list[sj].url] = true;
                streams.push(list[sj]);
            }
        }
    }

    return streams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
}
globalThis.getStreams = getStreams;
