// ============================================================================
// PLAYBACK & LIVE - Storm reports over time, with archived radar and warnings
// ============================================================================
//
// Playback: load a time range, then play/scrub a clock across it. Reports up to
// the playhead are drawn (cumulative); those within the highlight window get a
// halo and full opacity. Radar (IEM N0Q composite) and storm-based warnings in
// effect follow the same clock.
//
// Live: the range ends at "now" and refreshes every minute; the playhead follows
// now (LIVE badge) until you scrub or play the last-hour loop.
//
// URL parameters (shared with index.html): start, end (YYYY-MM-DDTHHMM, UTC),
// region, types (comma list), mode=live, hours (live window), t (playhead).

import { maplibregl, createMap, routeFeatureClick, getSavedTheme } from './js/map/mapSetup.js';
import { applyBasemapTheme, LABEL_ANCHOR_LAYER } from './js/map/basemap.js';
import { getIconForReport } from './js/map/iconService.js';
import { createPopupContent } from './js/map/popupService.js';
import { ReportLayer } from './js/map/reportLayer.js';
import { AreaOverlay, AlertLayer } from './js/map/overlayLayers.js';
import { RadarPlayer } from './js/map/radarPlayer.js';
import {
    loadBoundaryGeoJson,
    getClipFeaturesForSelection,
    pointInClipFeatures,
    boundsOfFeatures
} from './js/map/boundaryOverlays.js';
import LSRService from './js/api/lsrService.js';
import { requestManager } from './js/api/requestManager.js';
import { normalizeLSRReports } from './js/lsr/normalizeLSR.js';
import { extractWindSpeed } from './js/utils/formatters.js';
import { showStatusToast, hideStatusToast } from './js/ui/toastService.js';
import { errorHandler } from './js/errors/errorHandler.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LIVE_REFRESH_MS = CONFIG.LIVE_MODE_REFRESH_INTERVAL || 60000;
const LIVE_LOOP_MS = HOUR; // live-mode Play loops the last hour, like the old live radar
const MAX_RANGE_MS = 7 * 24 * HOUR;
const SBW_URL = 'https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson';

const $ = (id) => document.getElementById(id);

const state = {
    mode: 'playback',
    startMs: 0,
    endMs: 0,
    stepMin: 5,
    speed: 2, // steps per second
    t: 0,
    playing: false,
    follow: true, // live: playhead tracks "now"
    trailMin: 60,
    liveHours: 6,
    region: '',
    typesKey: 'all',
    customTypes: null,
    showRadar: true,
    showWarnings: true
};

let map = null;
let reportLayer = null;
let warningsLayer = null;
let areaOverlay = null;
let radar = null;
let lsrService = null;

let rawReports = []; // normalized reports for the loaded range (all locations / types)
let rawWarnings = []; // storm-based warnings for the loaded range
let reports = []; // after location / type filters, sorted by time
let times = []; // reports[i].tms, sorted
let regionClip = null; // GeoJSON polygons for the selected location (null = bbox / all)
let regionBounds = null;
let bins = { size: HOUR, counts: [], rects: [] };

let playToken = 0;
let loadToken = 0;
let liveTimer = null;
let urlTimer = null;

// ============================================================================
// TIME HELPERS (all UTC)
// ============================================================================

const pad = (n) => String(n).padStart(2, '0');
const floorTo = (ms, step) => Math.floor(ms / step) * step;
const stepMs = () => state.stepMin * MINUTE;

function utcDate(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function utcHHMM(ms) {
    const d = new Date(ms);
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** URL form used by both pages: YYYY-MM-DDTHHMM */
function toParam(ms) {
    return `${utcDate(ms)}T${utcHHMM(ms)}`;
}

function fromParam(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})$/.exec(value || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

/** datetime-local inputs hold UTC wall time */
function toInput(ms) {
    return new Date(ms).toISOString().slice(0, 16);
}

function fromInput(value) {
    const ms = Date.parse(`${value}:00Z`);
    return Number.isFinite(ms) ? ms : NaN;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatUtc(ms, withDay = true) {
    const d = new Date(ms);
    const hm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
    return withDay ? `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()} · ${hm}` : hm;
}

function formatLocal(ms) {
    return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Number of reports with time <= ms */
function countUpTo(ms) {
    let lo = 0, hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= ms) lo = mid + 1; else hi = mid;
    }
    return lo;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// ============================================================================
// DATA
// ============================================================================

function activeTypes() {
    if (state.typesKey === 'custom' && state.customTypes) return new Set(state.customTypes);
    if (state.typesKey !== 'all' && WEATHER_CATEGORIES[state.typesKey]) return new Set(WEATHER_CATEGORIES[state.typesKey]);
    return null; // all
}

function regionBbox(region) {
    const def = CONFIG.STATES[region] || CONFIG.REGIONS[region];
    if (!def) return null;
    const [south, north, east, west] = def.bounds;
    return { south, north, east, west };
}

async function resolveRegion() {
    regionClip = null;
    regionBounds = null;
    if (!state.region) return;
    try {
        await loadBoundaryGeoJson();
        regionClip = getClipFeaturesForSelection(state.region, '');
    } catch (e) {
        regionClip = null; // fall back to the CONFIG bounding box
    }
    regionBounds = (regionClip && boundsOfFeatures(regionClip)) || regionBbox(state.region);
}

function inRegion(lat, lon) {
    if (!regionBounds) return true;
    const b = regionBounds;
    if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return false;
    return regionClip ? pointInClipFeatures(lat, lon, regionClip) : true;
}

/** Apply location and type filters to the loaded data and redraw */
function applyFilters() {
    const types = activeTypes();
    reports = rawReports
        .filter(r => (!types || types.has(r.filterType)) && inRegion(r.lat, r.lon))
        .sort((a, b) => a.tms - b.tms);
    times = reports.map(r => r.tms);
    if (reportLayer) reportLayer.setReports(reports);

    if (warningsLayer) {
        const b = regionBounds;
        const visible = !b ? rawWarnings : rawWarnings.filter(w => {
            const wb = w.bounds;
            return wb && wb.west <= b.east && wb.east >= b.west && wb.south <= b.north && wb.north >= b.south;
        });
        warningsLayer.setAlerts(visible);
    }

    if (areaOverlay) {
        areaOverlay.clear();
        if (regionClip && regionClip.length) areaOverlay.addFeatures(regionClip);
        else if (regionBounds) areaOverlay.addRectangle(regionBounds.south, regionBounds.north, regionBounds.east, regionBounds.west);
    }

    buildTimeline();
    applyTime();
}

function prepareReports(geoJson) {
    const { normalized } = normalizeLSRReports(geoJson, REPORT_TYPE_MAP);
    const out = [];
    for (const r of normalized) {
        const tms = Date.parse(String(r.time).replace(' ', 'T'));
        if (!Number.isFinite(tms)) continue;
        r.tms = tms;
        r.icon = getIconForReport(r.iconRtype, r.iconMagnitude, r.remark, ICON_CONFIG, CONFIG.ICON_SIZE, extractWindSpeed, r.typetext);
        out.push(r);
    }
    return out;
}

function warningPopup(p) {
    const fmt = (v) => (v ? formatUtc(Date.parse(v)) : '');
    const color = p.nws_color || '#64748b';
    return `
        <div class="warning-popup">
            <div class="warning-header" style="border-left: 4px solid ${escapeHtml(color)};">
                <div class="warning-title"><strong>${escapeHtml(p.event_label || p.ph_sig || 'Warning')}</strong></div>
                <div class="warning-severity" style="color: ${escapeHtml(color)};">${escapeHtml(p.wfo || '')} · ${escapeHtml(p.status || '')}</div>
            </div>
            <div class="warning-body">
                ${p.locations ? `<div class="warning-area"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(p.locations)}</div>` : ''}
                <div class="warning-time"><i class="fas fa-clock"></i> Issued ${escapeHtml(fmt(p.utc_issue))}</div>
                <div class="warning-time"><i class="fas fa-hourglass-end"></i> Expires ${escapeHtml(fmt(p.utc_expire))}</div>
                <div class="warning-time"><i class="fas fa-draw-polygon"></i> Polygon valid ${escapeHtml(fmt(p.utc_polygon_begin))} – ${escapeHtml(fmt(p.utc_polygon_end))}</div>
            </div>
        </div>`;
}

function prepareWarnings(geoJson) {
    const out = [];
    for (const f of geoJson?.features || []) {
        const p = f.properties || {};
        const b = Date.parse(p.utc_polygon_begin || p.utc_issue);
        const e = Date.parse(p.utc_polygon_end || p.utc_expire);
        if (!f.geometry || !Number.isFinite(b) || !Number.isFinite(e)) continue;
        out.push({
            geometry: f.geometry,
            color: p.nws_color || '#64748b',
            emoji: '',
            popupHtml: warningPopup(p),
            properties: { b, e },
            bounds: boundsOfFeatures([f])
        });
    }
    return out;
}

async function fetchWarnings(startMs, endMs) {
    const url = `${SBW_URL}?begints=${new Date(startMs).toISOString().slice(0, 16)}Z&endts=${new Date(endMs).toISOString().slice(0, 16)}Z`;
    const response = await requestManager.fetchWithRetry(url, { headers: { Accept: 'application/geo+json, application/json' } });
    return prepareWarnings(await response.json());
}

/**
 * Load reports (and warnings) for state.startMs..state.endMs.
 * @param {object} [options]
 * @param {boolean} [options.fit] zoom to the reports / location afterwards
 * @param {number} [options.playhead] where to put the playhead (default: start, or end in live mode)
 * @param {boolean} [options.quiet] no loading toast (live refresh)
 */
async function loadData({ fit = true, playhead, quiet = false } = {}) {
    const token = ++loadToken;
    if (!quiet) showStatusToast('Loading storm reports...', 'loading');
    setPlaying(false);
    try {
        if (!lsrService) lsrService = new LSRService(CONFIG);
        const [geoJson, warnings] = await Promise.all([
            lsrService.fetchLSRData({
                startDate: utcDate(state.startMs),
                startHour: utcHHMM(state.startMs),
                endDate: utcDate(state.endMs),
                endHour: utcHHMM(state.endMs),
                useCache: state.mode !== 'live'
            }),
            fetchWarnings(state.startMs, state.endMs).catch((e) => {
                errorHandler.log('Warning archive unavailable', e);
                return [];
            }),
            resolveRegion()
        ]);
        if (token !== loadToken) return;
        rawReports = prepareReports(geoJson);
        rawWarnings = warnings;

        const live = state.mode === 'live';
        const target = playhead ?? (live ? state.endMs : state.startMs);
        state.t = Math.min(state.endMs, Math.max(state.startMs, target));
        applyFilters();
        if (fit) fitToData();
        showRadar(state.t);
        if (live) $('liveUpdated').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (!quiet) {
            hideStatusToast();
            showStatusToast(`Loaded ${reports.length.toLocaleString()} reports and ${rawWarnings.length.toLocaleString()} warnings`, 'success');
        }
    } catch (error) {
        if (token !== loadToken) return;
        hideStatusToast();
        const handled = errorHandler.handleError(error, 'Playback load');
        showStatusToast(handled.message || 'Could not load storm reports', 'error', () => loadData({ fit, playhead }));
    }
}

function fitToData() {
    let b = regionBounds;
    if (!b && reports.length) {
        b = { south: 90, north: -90, west: 180, east: -180 };
        for (const r of reports) {
            b.south = Math.min(b.south, r.lat); b.north = Math.max(b.north, r.lat);
            b.west = Math.min(b.west, r.lon); b.east = Math.max(b.east, r.lon);
        }
    }
    if (!b || !map) return;
    map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: { top: 60, bottom: 40, left: 60, right: 340 }, maxZoom: 9, duration: 600 });
}

// ============================================================================
// CLOCK
// ============================================================================

function stepCount() {
    return Math.max(1, Math.ceil((state.endMs - state.startMs) / stepMs()));
}

function timeForIndex(i) {
    return Math.min(state.endMs, state.startMs + i * stepMs());
}

function indexForTime(ms) {
    return Math.round((ms - state.startMs) / stepMs());
}

/** Move the playhead (and radar) */
function setTime(ms, { radarToo = true, userScrub = false } = {}) {
    state.t = Math.min(state.endMs, Math.max(state.startMs, ms));
    if (userScrub && state.mode === 'live') {
        state.follow = state.t >= state.endMs;
        updateLiveBadge();
    }
    applyTime();
    if (radarToo) showRadar(state.t);
}

function showRadar(ms) {
    if (!radar || !state.showRadar) return Promise.resolve(null);
    const s = stepMs();
    return radar.show(ms, { aheadMs: [ms + s, ms + 2 * s, ms + 3 * s] });
}

/** Push the playhead time into the map layers and the readout */
function applyTime() {
    const t = state.t;
    const trail = state.trailMin * MINUTE;
    if (reportLayer) {
        reportLayer.setFilter(['<=', ['get', 't'], t]);
        reportLayer.setPaintProperty('icon-opacity', ['case', ['>=', ['get', 't'], t - trail], 1, 0.45]);
    }
    if (map?.getLayer('pb-recent-halo')) {
        map.setFilter('pb-recent-halo', ['all', ['<=', ['get', 't'], t], ['>=', ['get', 't'], t - trail]]);
    }
    if (warningsLayer) {
        warningsLayer.setFilter(['all', ['<=', ['get', 'b'], t], ['>', ['get', 'e'], t]]);
    }
    updateReadout();
    updateTimelinePosition();
    scheduleUrlUpdate();
}

function setPlaying(playing) {
    state.playing = playing;
    playToken++;
    const icon = $('btnPlay').querySelector('i');
    icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    $('btnPlay').title = playing ? 'Pause (Space)' : 'Play (Space)';
    if (playing) {
        if (state.mode === 'live') {
            state.follow = false;
            updateLiveBadge();
            // Live loop: last hour of the window
            if (state.t >= state.endMs) state.t = Math.max(state.startMs, state.endMs - LIVE_LOOP_MS);
        } else if (state.t >= state.endMs) {
            state.t = state.startMs; // replay from the start
        }
        playLoop(playToken);
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function playLoop(token) {
    while (state.playing && token === playToken) {
        const began = performance.now();
        let next = state.t + stepMs();
        if (next > state.endMs) {
            if (state.mode === 'live') {
                await sleep(1500); // hold on the newest frame, then loop the last hour
                if (!state.playing || token !== playToken) return;
                next = Math.max(state.startMs, state.endMs - LIVE_LOOP_MS);
            } else if (state.t < state.endMs) {
                next = state.endMs;
            } else {
                setPlaying(false);
                return;
            }
        }
        // Wait (briefly) for the radar frame so radar and reports stay in step
        await showRadar(next);
        if (!state.playing || token !== playToken) return;
        setTime(next, { radarToo: false });
        if (state.mode !== 'live' && state.t >= state.endMs) {
            setPlaying(false);
            return;
        }
        await sleep(Math.max(0, 1000 / state.speed - (performance.now() - began)));
    }
}

function stepBy(n) {
    setPlaying(false);
    const i = indexForTime(state.t) + n;
    setTime(timeForIndex(Math.max(0, Math.min(stepCount(), i))), { userScrub: true });
}

// ============================================================================
// TIMELINE (histogram + scrubber)
// ============================================================================

const BIN_SIZES = [5, 10, 15, 30, 60, 120, 180, 360, 720].map(m => m * MINUTE);

function buildTimeline() {
    const range = Math.max(MINUTE, state.endMs - state.startMs);
    const size = BIN_SIZES.find(s => range / s <= 144) || 24 * HOUR;
    const n = Math.max(1, Math.ceil(range / size));
    const counts = new Array(n).fill(0);
    for (const t of times) {
        const i = Math.floor((t - state.startMs) / size);
        if (i >= 0 && i < n) counts[i]++;
    }
    bins = { size, counts, rects: [] };

    const scrubber = $('scrubber');
    scrubber.max = String(stepCount());
    drawHistogram();
    drawAxis();
    updateTimelinePosition();
}

function drawHistogram() {
    const svg = $('histogram');
    const width = svg.clientWidth || 600;
    const height = svg.clientHeight || 44;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.textContent = '';
    const ns = 'http://www.w3.org/2000/svg';
    const range = state.endMs - state.startMs || 1;
    const peak = Math.max(1, ...bins.counts);
    const top = 12; // room for the peak label
    bins.rects = bins.counts.map((count, i) => {
        const x0 = ((i * bins.size) / range) * width;
        const x1 = Math.min(width, (((i + 1) * bins.size) / range) * width);
        const w = Math.max(1, x1 - x0 - 2); // 2px surface gap between bars
        const h = count ? Math.max(2, ((height - top) * count) / peak) : 0;
        const r = Math.min(2, w / 2, h);
        const x = x0 + 1, y = height - h;
        const rect = document.createElementNS(ns, 'path');
        // Rounded data end (top), square at the baseline
        rect.setAttribute('d', h ? `M${x},${height}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${height}Z` : '');
        svg.appendChild(rect);
        return rect;
    });
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'peak-label');
    label.setAttribute('x', '2');
    label.setAttribute('y', '9');
    const per = bins.size >= HOUR ? `${bins.size / HOUR} h` : `${bins.size / MINUTE} min`;
    label.textContent = `max ${peak.toLocaleString()} reports / ${per}`;
    svg.appendChild(label);
}

function drawAxis() {
    const axis = $('axis');
    axis.textContent = '';
    const range = state.endMs - state.startMs;
    if (range <= 0) return;
    const tickSizes = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR];
    const width = axis.clientWidth || 600;
    const tick = tickSizes.find(s => (range / s) * 70 <= width) || 24 * HOUR;
    for (let t = Math.ceil(state.startMs / tick) * tick; t <= state.endMs; t += tick) {
        const span = document.createElement('span');
        span.style.left = `${((t - state.startMs) / range) * 100}%`;
        const d = new Date(t);
        span.textContent = d.getUTCHours() === 0 ? `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}` : `${pad(d.getUTCHours())}Z`;
        axis.appendChild(span);
    }
}

function updateTimelinePosition() {
    const range = state.endMs - state.startMs || 1;
    const fraction = (state.t - state.startMs) / range;
    $('playhead').style.left = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    $('scrubber').value = String(indexForTime(state.t));
    bins.rects.forEach((rect, i) => {
        const binEnd = state.startMs + (i + 1) * bins.size;
        rect.setAttribute('class', binEnd <= state.t + 1 ? 'bar-played' : 'bar-future');
    });
}

function showTrackTooltip(clientX) {
    const track = $('track');
    const box = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const ms = state.startMs + fraction * (state.endMs - state.startMs);
    const i = Math.min(bins.counts.length - 1, Math.floor((ms - state.startMs) / bins.size));
    if (i < 0) return;
    const b0 = state.startMs + i * bins.size;
    const b1 = Math.min(state.endMs, b0 + bins.size);
    const tip = $('trackTooltip');
    const count = bins.counts[i];
    tip.textContent = `${formatUtc(b0)}–${formatUtc(b1, false)} · ${count.toLocaleString()} report${count === 1 ? '' : 's'}`;
    tip.style.left = `${fraction * 100}%`;
    tip.hidden = false;
    bins.rects.forEach((r, j) => r.classList.toggle('bar-hover', j === i));
}

function hideTrackTooltip() {
    $('trackTooltip').hidden = true;
    bins.rects.forEach(r => r.classList.remove('bar-hover'));
}

function updateReadout() {
    $('timeUtc').textContent = state.endMs ? formatUtc(state.t) : '--';
    $('timeLocal').textContent = state.endMs ? `${formatLocal(state.t)} local` : '';
    const shown = countUpTo(state.t);
    const recent = shown - countUpTo(state.t - state.trailMin * MINUTE - 1);
    const trailLabel = state.trailMin >= 60 ? `${state.trailMin / 60} h` : `${state.trailMin} min`;
    $('reportCount').innerHTML = `${shown.toLocaleString()} of ${reports.length.toLocaleString()} reports · ` +
        `<span class="pb-recent-dot"></span> ${recent.toLocaleString()} in last ${trailLabel}`;
}

// ============================================================================
// LIVE MODE
// ============================================================================

function liveRange() {
    const end = floorTo(Date.now(), 5 * MINUTE);
    return { start: end - state.liveHours * HOUR, end };
}

function updateLiveBadge() {
    const badge = $('btnGoLive');
    badge.hidden = state.mode !== 'live';
    badge.classList.toggle('following', state.follow);
    badge.title = state.follow ? 'Following the latest time' : 'Jump back to now';
}

function setMode(mode, { load = true } = {}) {
    state.mode = mode;
    const live = mode === 'live';
    $('modePlayback').classList.toggle('active', !live);
    $('modePlayback').setAttribute('aria-pressed', String(!live));
    $('modeLive').classList.toggle('active', live);
    $('modeLive').setAttribute('aria-pressed', String(live));
    $('rangeFields').hidden = live;
    $('liveFields').hidden = !live;
    $('loadButton').hidden = live;
    const title = $('modeTitle');
    title.textContent = live ? 'Live' : 'Playback';
    title.classList.toggle('live', live);
    document.title = `NWS Local Storm Reports - ${live ? 'Live' : 'Playback'}`;
    clearInterval(liveTimer);
    liveTimer = null;
    if (live) {
        state.follow = true;
        const { start, end } = liveRange();
        state.startMs = start;
        state.endMs = end;
        if (state.stepMin > 15) state.stepMin = 5;
        $('stepSelect').value = String(state.stepMin);
        markPresets('livePresets', state.liveHours);
        liveTimer = setInterval(refreshLive, LIVE_REFRESH_MS);
        if (load) loadData({ fit: true });
    } else {
        state.follow = false;
        setRangeInputs();
    }
    updateLiveBadge();
}

async function refreshLive() {
    if (state.mode !== 'live') return;
    const { start, end } = liveRange();
    const keep = state.follow ? end : Math.max(start, state.t);
    state.startMs = start;
    state.endMs = end;
    const wasPlaying = state.playing;
    await loadData({ fit: false, playhead: keep, quiet: true });
    if (wasPlaying) setPlaying(true);
}

function goLive() {
    setPlaying(false);
    state.follow = true;
    updateLiveBadge();
    setTime(state.endMs);
}

// ============================================================================
// SETTINGS PANEL
// ============================================================================

function buildRegionSelect() {
    const select = $('regionSelect');
    const add = (parent, value, label) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        parent.appendChild(o);
    };
    add(select, '', 'All (United States)');
    const nwsKeys = CONFIG.NWS_ADMIN_REGION_KEYS || [];
    const groups = [
        ['Regions', Object.keys(CONFIG.REGIONS).filter(k => !nwsKeys.includes(k)).map(k => [k, CONFIG.REGIONS[k].name])],
        ['NWS Administrative Regions', nwsKeys.filter(k => CONFIG.REGIONS[k]).map(k => [k, CONFIG.REGIONS[k].name])],
        ['States', Object.keys(CONFIG.STATES).map(k => [k, CONFIG.STATES[k].name]).sort((a, b) => a[1].localeCompare(b[1]))]
    ];
    for (const [label, items] of groups) {
        const group = document.createElement('optgroup');
        group.label = label;
        items.forEach(([value, name]) => add(group, value, name));
        select.appendChild(group);
    }
}

function setRangeInputs() {
    $('rangeStart').value = toInput(state.startMs);
    $('rangeEnd').value = toInput(state.endMs);
}

function markPresets(containerId, hours) {
    document.querySelectorAll(`#${containerId} button`).forEach(b => {
        b.classList.toggle('active', Number(b.dataset.hours) === hours);
    });
}

function setPlaybackRange(startMs, endMs) {
    if (!(endMs > startMs)) {
        showStatusToast('The end time must be after the start time.', 'error');
        return false;
    }
    if (endMs - startMs > MAX_RANGE_MS) {
        showStatusToast('Playback ranges are limited to 7 days.', 'error');
        return false;
    }
    state.startMs = startMs;
    state.endMs = endMs;
    // Default step: fine for short ranges, coarser for long ones
    const hours = (endMs - startMs) / HOUR;
    state.stepMin = hours <= 12 ? 5 : hours <= 48 ? 15 : 60;
    $('stepSelect').value = String(state.stepMin);
    setRangeInputs();
    return true;
}

function setupControls() {
    $('modePlayback').addEventListener('click', () => {
        if (state.mode === 'playback') return;
        setPlaying(false);
        setMode('playback');
        applyTime();
    });
    $('modeLive').addEventListener('click', () => {
        if (state.mode === 'live') return;
        setPlaying(false);
        setMode('live');
    });

    $('rangePresets').addEventListener('click', (e) => {
        const hours = Number(e.target.closest('button')?.dataset.hours);
        if (!hours) return;
        const end = floorTo(Date.now(), 5 * MINUTE);
        if (setPlaybackRange(end - hours * HOUR, end)) {
            markPresets('rangePresets', hours);
            loadData({ fit: true });
        }
    });
    $('livePresets').addEventListener('click', (e) => {
        const hours = Number(e.target.closest('button')?.dataset.hours);
        if (!hours) return;
        state.liveHours = hours;
        setMode('live');
    });
    for (const id of ['rangeStart', 'rangeEnd']) {
        $(id).addEventListener('change', () => markPresets('rangePresets', 0));
    }
    $('loadButton').addEventListener('click', () => {
        if (setPlaybackRange(fromInput($('rangeStart').value), fromInput($('rangeEnd').value))) {
            loadData({ fit: true });
        }
    });

    $('regionSelect').addEventListener('change', async (e) => {
        state.region = e.target.value;
        await resolveRegion();
        applyFilters();
        fitToData();
    });
    $('typeSelect').addEventListener('change', (e) => {
        state.typesKey = e.target.value;
        applyFilters();
    });
    $('showRadar').addEventListener('change', (e) => {
        state.showRadar = e.target.checked;
        radar?.setEnabled(state.showRadar);
        if (state.showRadar) showRadar(state.t);
    });
    $('showWarnings').addEventListener('change', (e) => {
        state.showWarnings = e.target.checked;
        if (state.showWarnings) warningsLayer?.show(); else warningsLayer?.hide();
    });
    $('trailSelect').addEventListener('change', (e) => {
        state.trailMin = Number(e.target.value);
        applyTime();
    });
    $('togglePanel').addEventListener('click', () => {
        const panel = $('settingsPanel');
        const collapsed = panel.classList.toggle('collapsed');
        $('togglePanel').setAttribute('aria-expanded', String(!collapsed));
        $('togglePanel').querySelector('i').className = collapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        $('togglePanel').title = collapsed ? 'Show settings' : 'Collapse settings';
    });

    // Transport
    $('btnPlay').addEventListener('click', () => setPlaying(!state.playing));
    $('btnBack').addEventListener('click', () => stepBy(-1));
    $('btnForward').addEventListener('click', () => stepBy(1));
    $('btnStart').addEventListener('click', () => { setPlaying(false); setTime(state.startMs, { userScrub: true }); });
    $('btnEnd').addEventListener('click', () => { setPlaying(false); setTime(state.endMs, { userScrub: true }); });
    $('btnGoLive').addEventListener('click', goLive);
    $('stepSelect').addEventListener('change', (e) => {
        state.stepMin = Number(e.target.value);
        buildTimeline();
        setTime(state.startMs + indexForTime(state.t) * stepMs());
    });
    $('speedSelect').addEventListener('change', (e) => {
        state.speed = Number(e.target.value);
    });

    const scrubber = $('scrubber');
    scrubber.addEventListener('input', () => {
        setPlaying(false);
        setTime(timeForIndex(Number(scrubber.value)), { userScrub: true });
    });
    scrubber.addEventListener('pointermove', (e) => showTrackTooltip(e.clientX));
    scrubber.addEventListener('pointerleave', hideTrackTooltip);

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { drawHistogram(); drawAxis(); updateTimelinePosition(); }, 150);
    });

    // Keyboard: Space play/pause, arrows step, Home/End, L live
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        const onScrubber = e.target === scrubber;
        if (!onScrubber && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === ' ') {
            e.preventDefault();
            setPlaying(!state.playing);
        } else if (!onScrubber && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            stepBy(e.key === 'ArrowLeft' ? -1 : 1);
        } else if (!onScrubber && e.key === 'Home') {
            e.preventDefault();
            $('btnStart').click();
        } else if (!onScrubber && e.key === 'End') {
            e.preventDefault();
            $('btnEnd').click();
        } else if (e.key.toLowerCase() === 'l') {
            if (state.mode === 'live') goLive(); else $('modeLive').click();
        }
    });

    $('closeStatusToast')?.addEventListener('click', () => { $('statusToast').style.display = 'none'; });
}

// ============================================================================
// URL STATE
// ============================================================================

function filterParams() {
    const params = new URLSearchParams();
    if (state.region) params.set('region', state.region);
    const types = activeTypes();
    if (types) params.set('types', [...types].join(','));
    return params;
}

function scheduleUrlUpdate() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
        const params = filterParams();
        if (state.mode === 'live') {
            params.set('mode', 'live');
            params.set('hours', String(state.liveHours));
        } else if (state.endMs) {
            params.set('start', toParam(state.startMs));
            params.set('end', toParam(state.endMs));
            params.set('t', toParam(state.t));
        }
        history.replaceState(null, '', `${location.pathname}?${params}`);

        // "Map" link: same range and filters on the main map
        const mapParams = filterParams();
        if (state.endMs) {
            mapParams.set('start', toParam(state.startMs));
            mapParams.set('end', toParam(state.endMs));
        }
        $('linkMainMap').href = `index.html?${mapParams}`;
    }, 300);
}

function readUrl() {
    const params = new URLSearchParams(location.search);
    state.region = params.get('region') || '';
    if (state.region && !CONFIG.STATES[state.region] && !CONFIG.REGIONS[state.region]) state.region = '';
    $('regionSelect').value = state.region;

    const types = (params.get('types') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (types.length && types.length < CONFIG.WEATHER_TYPES.length) {
        const key = Object.keys(WEATHER_CATEGORIES).find(k => {
            const set = WEATHER_CATEGORIES[k];
            return set.length === types.length && set.every(t => types.includes(t));
        });
        if (key) {
            state.typesKey = key;
        } else {
            state.typesKey = 'custom';
            state.customTypes = types;
            const o = document.createElement('option');
            o.value = 'custom';
            o.textContent = `Custom (${types.length} type${types.length === 1 ? '' : 's'})`;
            $('typeSelect').appendChild(o);
        }
    }
    $('typeSelect').value = state.typesKey;

    const hours = Number(params.get('hours'));
    if ([3, 6, 12, 24].includes(hours)) state.liveHours = hours;

    if (params.get('mode') === 'live') {
        return { live: true };
    }
    let start = fromParam(params.get('start'));
    let end = fromParam(params.get('end'));
    if (!(end > start)) {
        end = floorTo(Date.now(), 5 * MINUTE);
        start = end - 24 * HOUR;
        markPresets('rangePresets', 24);
    }
    if (end - start > MAX_RANGE_MS) start = end - MAX_RANGE_MS;
    setPlaybackRange(start, end);
    return { live: false, t: fromParam(params.get('t')) };
}

// ============================================================================
// THEME
// ============================================================================

function setupTheme() {
    const toggle = $('darkModeToggle');
    const icon = $('darkModeIcon');
    const label = toggle.querySelector('.header-action-label');
    const apply = (theme) => {
        const dark = theme === 'dark';
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        label.textContent = dark ? 'Light Mode' : 'Dark Mode';
        toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        try { localStorage.setItem('lsr-theme', theme); } catch (e) { /* storage unavailable */ }
        applyBasemapTheme(map, theme);
    };
    apply(getSavedTheme());
    toggle.addEventListener('click', () => {
        apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
}

// ============================================================================
// STARTUP
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    buildRegionSelect();
    setupControls();
    const initial = readUrl();

    ({ map } = await createMap('map', {
        theme: getSavedTheme(),
        center: [CONFIG.MAP_INITIAL.lon, CONFIG.MAP_INITIAL.lat],
        zoom: CONFIG.MAP_INITIAL.zoom
    }));
    setupTheme();

    areaOverlay = new AreaOverlay('pb-area');
    warningsLayer = new AlertLayer(maplibregl, 'pb-warnings');
    radar = new RadarPlayer({ prefix: 'pb-radar' });
    reportLayer = new ReportLayer(maplibregl, {
        id: 'pb-reports',
        popupHtml: (report) => createPopupContent(report),
        featureProperties: (report) => ({ t: report.tms })
    });

    map.on('load', () => {
        // Bottom to top: basemap, area outline, warnings, radar, labels, recent halo, reports
        areaOverlay.addTo(map, LABEL_ANCHOR_LAYER);
        warningsLayer.addTo(map, LABEL_ANCHOR_LAYER);
        radar.addTo(map, LABEL_ANCHOR_LAYER);
        reportLayer.addTo(map);
        map.addLayer({
            id: 'pb-recent-halo',
            type: 'circle',
            source: 'pb-reports',
            filter: ['==', ['get', 't'], -1],
            paint: {
                'circle-radius': 18,
                'circle-color': 'rgba(245, 158, 11, 0.22)',
                'circle-stroke-color': '#f59e0b',
                'circle-stroke-width': 2
            }
        }, 'pb-reports');
        map.on('click', (e) => routeFeatureClick(map, e, [reportLayer, warningsLayer]));

        if (initial.live) {
            setMode('live');
        } else {
            setMode('playback', { load: false });
            loadData({ fit: true, playhead: Number.isFinite(initial.t) ? initial.t : undefined });
        }
    });
});
