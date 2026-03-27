// ============================================================================
// NWS boundary GeoJSON for map overlays (states + County Warning Areas)
// Source: NOAA mapservices FeatureServer (same boundaries NWS uses for GIS)
// ============================================================================

const CWA_URL =
    'https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/1/query?' +
    'where=1%3D1&outFields=cwa%2Cwfo%2Ccitystate%2Cregion&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&f=geojson';

const STATE_URL =
    'https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/3/query?' +
    'where=1%3D1&outFields=state%2Cname&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&f=geojson';

/** NWS admin region keys -> CWA `region` attribute (ER, CR, SR, WR, AR, PR) */
const NWS_REGION_TO_CWA_REGION = {
    nws_eastern: ['ER'],
    nws_southern: ['SR'],
    nws_central: ['CR'],
    nws_western: ['WR'],
    nws_alaska: ['AR'],
    nws_pacific: ['PR']
};

const OVERLAY_STYLE = {
    color: '#dc2626',
    weight: 2,
    fill: true,
    fillOpacity: 0.06,
    dashArray: '5 6'
};

let cwaCollection = null;
let stateCollection = null;
let loadPromise = null;

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } });
    if (!res.ok) {
        throw new Error(`Boundary fetch failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Load CWA + state polygons (cached). Safe to call multiple times.
 */
export function loadBoundaryGeoJson() {
    if (!loadPromise) {
        loadPromise = Promise.all([fetchJson(CWA_URL), fetchJson(STATE_URL)])
            .then(([cwa, states]) => {
                cwaCollection = cwa && cwa.type === 'FeatureCollection' ? cwa : null;
                stateCollection = states && states.type === 'FeatureCollection' ? states : null;
            })
            .catch((err) => {
                loadPromise = null;
                throw err;
            });
    }
    return loadPromise;
}

export function boundariesReady() {
    return Boolean(cwaCollection && stateCollection);
}

function normalizeWfoCode(code) {
    if (!code) {
        return '';
    }
    const c = String(code).trim().toUpperCase();
    return c.startsWith('K') ? c.slice(1) : c;
}

function featuresForState(stateCode) {
    if (!stateCollection?.features || !stateCode) {
        return [];
    }
    const want = String(stateCode).toUpperCase();
    return stateCollection.features.filter((f) => {
        const st = f.properties?.state || f.properties?.STATE;
        return st && String(st).toUpperCase() === want;
    });
}

function featureForWfo(wfoCode) {
    if (!cwaCollection?.features || !wfoCode) {
        return null;
    }
    const want = normalizeWfoCode(wfoCode);
    return (
        cwaCollection.features.find((f) => {
            const w = f.properties?.wfo || f.properties?.WFO;
            return w && String(w).toUpperCase() === want;
        }) || null
    );
}

function featuresForNwsAdminRegion(regionKey) {
    const codes = NWS_REGION_TO_CWA_REGION[regionKey];
    if (!codes || !cwaCollection?.features) {
        return [];
    }
    const upper = new Set(codes.map((c) => String(c).toUpperCase()));
    return cwaCollection.features.filter((f) => {
        const r = f.properties?.region || f.properties?.REGION;
        return r && upper.has(String(r).toUpperCase());
    });
}

/**
 * @returns {L.Layer|null}
 */
export function createBoundaryLayer(features) {
    if (!features || features.length === 0) {
        return null;
    }
    const fc =
        features.length === 1
            ? features[0]
            : { type: 'FeatureCollection', features };
    return L.geoJSON(fc, { style: OVERLAY_STYLE });
}

/**
 * @param {string} stateCode e.g. IL
 */
export function createStateBoundaryLayer(stateCode) {
    return createBoundaryLayer(featuresForState(stateCode));
}

/**
 * @param {string} wfoCode e.g. LOT or KLOT
 */
export function createWfoBoundaryLayer(wfoCode) {
    const f = featureForWfo(wfoCode);
    return f ? createBoundaryLayer([f]) : null;
}

/**
 * @param {string} regionKey CONFIG.REGIONS key for NWS admin regions
 */
export function createNwsAdminRegionLayer(regionKey) {
    return createBoundaryLayer(featuresForNwsAdminRegion(regionKey));
}

export function isNwsAdminRegionWithGeoJson(regionKey) {
    return Boolean(NWS_REGION_TO_CWA_REGION[regionKey]);
}
