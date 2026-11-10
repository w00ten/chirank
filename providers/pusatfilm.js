var cheerio = require('cheerio');

var BASE_URL = 'https://new1.pusatfilm21info.com';
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
                    name: 'PusatFilm',
                    title: 'PusatFilm · Hydrax (' + q + ')',
                    url: s.url,
                    quality: q,
                    language: 'id',
                    provider: 'PusatFilm',
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

async function resolveKotakAjaib(shareId, pageReferer) {
    var out = [];
    try {
        var embedUrl = 'https://kotakajaib.me/embed/' + shareId;
        var res = await fetch(embedUrl, {
            headers: { 'User-Agent': UA, 'Referer': pageReferer }
        });
        if (!res.ok) return out;
        var html = await res.text();
        var $ = cheerio.load(html);
        var token = $('#kp').attr('data-token') || '';
        if (!token) return out;

        var providers = [];
        $('button[data-p]').each(function () {
            var p = $(this).attr('data-p');
            if (p && providers.indexOf(p) === -1) providers.push(p);
        });
        if (providers.length === 0) providers = ['hydrax', 'gdriveplayer'];

        for (var i = 0; i < providers.length; i++) {
            var prov = providers[i];
            if (prov === 'gdriveplayer') continue;
            try {
                var srcUrl = embedUrl + '/source/' + encodeURIComponent(prov) + '?t=' + encodeURIComponent(token);
                var sRes = await fetch(srcUrl, {
                    headers: {
                        'User-Agent': UA,
                        'Referer': embedUrl,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
                if (!sRes.ok) continue;
                var sJson = await sRes.json();
                var target = sJson && sJson.u ? String(sJson.u).trim() : '';
                if (!target) continue;
                if (target.indexOf('//') === 0) target = 'https:' + target;

                if (target.indexOf('playhydrax.com') !== -1 || target.indexOf('abyssplayer.com') !== -1) {
                    var hs = await resolveHydrax(target, embedUrl);
                    out = out.concat(hs);
                }
            } catch (e) {}
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

    var bestHref = '';
    var bestScore = 0;

    for (var qi = 0; qi < queries.length; qi++) {
        try {
            var searchUrl = BASE_URL + '/search?q=' + encodeURIComponent(queries[qi]);
            var res = await fetch(searchUrl, { headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' } });
            if (!res.ok) continue;
            var html = await res.text();
            var $ = cheerio.load(html);

            $('a[href*="/movie/"], a[href*="/series/"]').each(function () {
                var href = $(this).attr('href') || '';
                if (!href) return;
                if (isTv && href.indexOf('/series/') === -1) return;
                if (!isTv && href.indexOf('/movie/') === -1) return;

                var titleText = $(this).attr('title') || $(this).text() || '';
                if (!titleText) {
                    var slugPart = href.split('/').pop().replace(/-\d{4}$/, '').replace(/-/g, ' ');
                    titleText = slugPart;
                }

                var sc = scoreMatch(titleText, href, meta.title, meta.originalTitle, meta.year);
                if (sc > bestScore) {
                    bestScore = sc;
                    bestHref = href;
                }
            });
            if (bestScore >= 100) break;
        } catch (e) {}
    }

    if (!bestHref) return [];

    var cleanPath = bestHref.indexOf('http') === 0 ? bestHref : (BASE_URL + '/' + bestHref.replace(/^\/+/, ''));
    if (isTv) {
        cleanPath = cleanPath.replace(/\/season\/\d+.*$/, '') + '/season/' + Number(seasonNum || 1) + '/episode/' + Number(episodeNum || 1);
    }

    var pageRes = await fetch(cleanPath, { headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' } });
    if (!pageRes.ok) return [];
    var pageHtml = await pageRes.text();
    var unescaped = pageHtml.replace(/\\"/g, '"').replace(/\\\//g, '/');

    var shares = [];
    var active = unescaped.match(/["']embedUrl["']\s*:\s*["']https?:\/\/kotakajaib\.me\/(?:embed|file)\/([a-zA-Z0-9_-]+)/);
    if (active && active[1]) {
        shares.push(active[1]);
    } else {
        var re = /kotakajaib\.me\/(?:embed|file)\/([a-zA-Z0-9_-]+)/g;
        var m;
        while ((m = re.exec(unescaped)) !== null) {
            if (shares.indexOf(m[1]) === -1) shares.push(m[1]);
            if (shares.length >= 2) break;
        }
    }

    var allStreams = [];
    var seen = {};
    for (var i = 0; i < shares.length; i++) {
        var list = await resolveKotakAjaib(shares[i], cleanPath);
        for (var j = 0; j < list.length; j++) {
            if (list[j] && list[j].url && !seen[list[j].url]) {
                seen[list[j].url] = true;
                allStreams.push(list[j]);
            }
        }
    }

    return allStreams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
}
globalThis.getStreams = getStreams;
