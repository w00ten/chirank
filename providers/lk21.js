var cheerio = require('cheerio');

var DEFAULT_MOVIE_BASE = 'https://tv12.lk21official.cc';
var DEFAULT_SERIES_BASE = 'https://tv.nontondrama.vip';
var SEARCH_API_BASE = 'https://gudangvape.com';
var FALLBACK_TMDB_KEY = 'b030404650f279792a8d3287232358e3';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function normalizeText(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/\(\d{4}\)/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreMatch(candidateTitle, candidateYear, targetTitle, targetOrigTitle, targetYear) {
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

    if (targetYear && candidateYear) {
        var diff = Math.abs(Number(candidateYear) - Number(targetYear));
        if (diff === 0) score += 30;
        else if (diff === 1) score += 10;
        else score -= 15;
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
            var token = encodeBase(i);
            p = p.replace(new RegExp('\\b' + token + '\\b', 'g'), k[i]);
        }
    }
    return p;
}

function extractUrlsFromText(text) {
    var matches = text.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/gi) || [];
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

async function resolveHydrax(embedUrl, playerUrl) {
    var streams = [];
    try {
        var res = await fetch(embedUrl, {
            headers: {
                'User-Agent': UA,
                'Referer': playerUrl
            }
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
        var result = decJson && decJson.result;
        var sources = (result && Array.isArray(result.sources)) ? result.sources : [];

        for (var i = 0; i < sources.length; i++) {
            var s = sources[i];
            if (s && s.url && s.status !== false) {
                var q = s.type || 'HD';
                streams.push({
                    name: 'LK21',
                    title: 'LK21 · Hydrax (' + q + ')',
                    url: s.url,
                    quality: q,
                    language: 'id',
                    provider: 'LK21',
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

async function resolvePlayCdn(embedUrl) {
    var streams = [];
    try {
        var clean = embedUrl.split('?')[0];
        var parts = clean.split('/');
        var slug = parts[parts.length - 1];
        if (!slug) return streams;

        var res = await fetch('https://playcdn.de/verify/' + encodeURIComponent(slug), {
            headers: {
                'User-Agent': UA,
                'Referer': embedUrl,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        if (!res.ok) return streams;
        var data = await res.json();
        if (data && data.fileUrl) {
            var q = 'HD';
            var qm = data.fileUrl.match(/\/(360|480|720|1080)\.(?:m3u8|mp4)/i);
            if (qm) q = qm[1] + 'p';
            streams.push({
                name: 'LK21',
                title: 'LK21 · P2P (' + q + ')',
                url: data.fileUrl,
                quality: q,
                language: 'id',
                provider: 'LK21',
                headers: {
                    'Referer': 'https://playcdn.de/',
                    'Origin': 'https://playcdn.de',
                    'User-Agent': UA
                }
            });
        }
    } catch (e) {}
    return streams;
}

async function resolvePlayerUrl(playerUrl) {
    var out = [];
    try {
        var m = playerUrl.match(/\/iframe3\/([^\/]+)\/([^\/?&]+)/);
        if (m) {
            var host = m[1];
            var vid = m[2];
            var apiRes = await fetch('https://videonode.de/api.php', {
                method: 'POST',
                headers: {
                    'User-Agent': UA,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': playerUrl,
                    'Origin': 'https://videonode.de'
                },
                body: 'host=' + encodeURIComponent(host) + '&id=' + encodeURIComponent(vid)
            });
            if (apiRes.ok) {
                var apiJson = await apiRes.json();
                var embedUrl = apiJson && apiJson.embedUrl;
                if (embedUrl) {
                    if (embedUrl.indexOf('playcdn.de') !== -1) {
                        return await resolvePlayCdn(embedUrl);
                    }
                    if (embedUrl.indexOf('abyssplayer') !== -1 || embedUrl.indexOf('playhydrax') !== -1 || host.toLowerCase() === 'hydrax') {
                        return await resolveHydrax(embedUrl, playerUrl);
                    }
                    var pRes = await fetch(embedUrl, { headers: { 'User-Agent': UA, 'Referer': playerUrl } });
                    if (pRes.ok) {
                        var pHtml = await pRes.text();
                        var unpacked = unpackDeanEdwards(pHtml) || pHtml;
                        var urls = extractUrlsFromText(unpacked);
                        for (var i = 0; i < urls.length; i++) {
                            out.push({
                                name: 'LK21',
                                title: 'LK21 · ' + host.toUpperCase(),
                                url: urls[i],
                                quality: 'HD',
                                language: 'id',
                                provider: 'LK21',
                                headers: { 'Referer': embedUrl, 'User-Agent': UA }
                            });
                        }
                    }
                }
            }
        }
    } catch (e) {}
    return out;
}

async function resolveSeriesBase() {
    try {
        var r = await fetch('https://nontondrama.my/', { headers: { 'User-Agent': UA } });
        if (r && r.url && r.url.indexOf('http') === 0) {
            return r.url.replace(/\/+$/, '');
        }
    } catch (e) {}
    return DEFAULT_SERIES_BASE;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var meta = await fetchMeta(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    var isTv = mediaType === 'tv' || mediaType === 'series';
    var queries = [meta.title];
    if (meta.originalTitle && meta.originalTitle !== meta.title) {
        queries.push(meta.originalTitle);
    }

    var bestItem = null;
    var bestScore = 0;

    for (var qi = 0; qi < queries.length; qi++) {
        try {
            var sUrl = SEARCH_API_BASE + '/search.php?s=' + encodeURIComponent(queries[qi]) + '&page=1';
            var sRes = await fetch(sUrl, {
                headers: {
                    'User-Agent': UA,
                    'Referer': DEFAULT_MOVIE_BASE + '/'
                }
            });
            if (!sRes.ok) continue;
            var sJson = await sRes.json();
            var items = (sJson && Array.isArray(sJson.data)) ? sJson.data : [];

            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var itType = String(it.type || '').toLowerCase();
                if (isTv && itType !== 'series') continue;
                if (!isTv && itType !== 'movie') continue;

                var sc = scoreMatch(it.title, it.year, meta.title, meta.originalTitle, meta.year);
                if (sc > bestScore) {
                    bestScore = sc;
                    bestItem = it;
                }
            }
            if (bestScore >= 100) break;
        } catch (e) {}
    }

    if (!bestItem || !bestItem.slug) return [];

    var pageUrl = '';
    var referer = DEFAULT_MOVIE_BASE + '/';

    if (isTv) {
        var seriesBase = await resolveSeriesBase();
        referer = seriesBase + '/';
        var seriesUrl = seriesBase + '/' + bestItem.slug.replace(/^\/+/, '');
        var seriesRes = await fetch(seriesUrl, { headers: { 'User-Agent': UA, 'Referer': referer } });
        if (!seriesRes.ok) return [];
        var seriesHtml = await seriesRes.text();

        var sdMatch = seriesHtml.match(/<script[^>]*id=["']season-data["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!sdMatch || !sdMatch[1]) return [];
        var seasonData = JSON.parse(sdMatch[1]);
        var sKey = String(seasonNum || 1);
        var eps = seasonData[sKey] || [];
        var targetEp = Number(episodeNum || 1);
        var epSlug = '';

        for (var ei = 0; ei < eps.length; ei++) {
            if (Number(eps[ei].episode_no) === targetEp) {
                epSlug = eps[ei].slug;
                break;
            }
        }
        if (!epSlug) return [];
        pageUrl = seriesBase + '/' + epSlug.replace(/^\/+/, '');
    } else {
        pageUrl = DEFAULT_MOVIE_BASE + '/' + bestItem.slug.replace(/^\/+/, '');
    }

    var pageRes = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Referer': referer } });
    if (!pageRes.ok) return [];
    var pageHtml = await pageRes.text();

    var $ = cheerio.load(pageHtml);
    var playerUrls = [];
    var seenPlayers = {};

    $('#player-list li a').each(function () {
        var u = $(this).attr('data-url') || $(this).attr('href') || '';
        if (u && u.indexOf('http') === 0 && !seenPlayers[u]) {
            seenPlayers[u] = true;
            playerUrls.push(u);
        }
    });

    if (playerUrls.length === 0) {
        var iframeSrc = $('iframe#main-player').attr('src') || $('iframe[src*="videonode"]').attr('src') || '';
        if (iframeSrc && iframeSrc.indexOf('http') === 0) {
            playerUrls.push(iframeSrc);
        }
    }

    var tasks = playerUrls.map(function (pu) {
        return resolvePlayerUrl(pu);
    });
    var settled = await Promise.all(tasks);
    var allStreams = [];
    var seenUrls = {};

    for (var si = 0; si < settled.length; si++) {
        var group = settled[si] || [];
        for (var sj = 0; sj < group.length; sj++) {
            var st = group[sj];
            if (st && st.url && !seenUrls[st.url]) {
                seenUrls[st.url] = true;
                allStreams.push(st);
            }
        }
    }

    return allStreams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
}
globalThis.getStreams = getStreams;
