// ============================================================================
// OVERLAY LAYERS - Selected area outline, warnings/watches, radar frames
// ============================================================================

import { createAlertIcon, ensureIconImage } from './iconService.js';

const AREA_COLOR = '#dc2626';

/**
 * Selected location outline (state / CWA / NWS region polygons, bbox rectangles)
 * and the first corner marker of the "click two corners" bounds tool.
 */
export class AreaOverlay {
    constructor(id = 'user-area') {
        this.id = id;
        this.map = null;
        this.features = [];
    }

    addTo(map, beforeId) {
        this.map = map;
        map.addSource(this.id, { type: 'geojson', data: this.collection() });
        map.addLayer({
            id: `${this.id}-fill`,
            type: 'fill',
            source: this.id,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'fill'], true]],
            paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.06 }
        }, beforeId);
        map.addLayer({
            id: `${this.id}-line`,
            type: 'line',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'line-color': AREA_COLOR, 'line-width': 2, 'line-dasharray': [2.5, 2.5] }
        }, beforeId);
        map.addLayer({
            id: `${this.id}-point`,
            type: 'circle',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': 6,
                'circle-color': AREA_COLOR,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        return this;
    }

    collection() {
        return { type: 'FeatureCollection', features: this.features };
    }

    update() {
        const source = this.map?.getSource(this.id);
        if (source) {
            source.setData(this.collection());
        }
    }

    clear() {
        this.features = [];
        this.update();
    }

    /** Add GeoJSON polygon features (filled, dashed outline) */
    addFeatures(features) {
        for (const f of features) {
            this.features.push({ type: 'Feature', geometry: f.geometry, properties: { fill: true } });
        }
        this.update();
    }

    /** Add an unfilled dashed rectangle */
    addRectangle(south, north, east, west) {
        this.features.push({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
            },
            properties: { fill: false }
        });
        this.update();
    }

    addPoint(lat, lon) {
        this.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {}
        });
        this.update();
    }
}

/**
 * NWS alerts (warnings or watches): translucent polygons plus point markers,
 * each with an HTML popup.
 */
export class AlertLayer {
    /**
     * @param {object} maplibregl  the MapLibre module (for Popup)
     * @param {string} id
     */
    constructor(maplibregl, id) {
        this.maplibregl = maplibregl;
        this.id = id;
        this.map = null;
        this.alerts = [];
        this.visible = true;
        this.popup = null;
    }

    /**
     * @param {string} areaBeforeId layer to put polygons under (basemap labels)
     */
    addTo(map, areaBeforeId) {
        this.map = map;
        map.addSource(this.id, { type: 'geojson', data: this.collection() });
        map.addLayer({
            id: `${this.id}-fill`,
            type: 'fill',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 }
        }, areaBeforeId);
        map.addLayer({
            id: `${this.id}-line`,
            type: 'line',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.5 }
        }, areaBeforeId);
        map.addLayer({
            id: `${this.id}-point`,
            type: 'symbol',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'icon-image': ['get', 'icon'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: { 'icon-opacity': 0.85 }
        });
        // Leave the crosshair alone while the bounds tool is active
        const setCursor = (cursor) => {
            const canvas = map.getCanvas();
            if (canvas.style.cursor !== 'crosshair') canvas.style.cursor = cursor;
        };
        for (const layerId of this.layerIds) {
            map.on('mouseenter', layerId, () => setCursor('pointer'));
            map.on('mouseleave', layerId, () => setCursor(''));
        }
        this.applyVisibility();
        return this;
    }

    collection() {
        const features = [];
        if (this.visible) {
            this.alerts.forEach((a, i) => {
                const geom = a.geometry;
                if (!geom) return;
                const properties = { i, color: a.color, icon: a.icon?.id || '' };
                if (geom.type === 'Point' || geom.type === 'Polygon') {
                    features.push({ type: 'Feature', geometry: geom, properties });
                } else if (geom.type === 'MultiPolygon') {
                    // Outer rings only, as before
                    for (const poly of geom.coordinates) {
                        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [poly[0]] }, properties });
                    }
                }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    update() {
        if (!this.map) return;
        for (const a of this.alerts) {
            if (a.icon) ensureIconImage(this.map, a.icon);
        }
        const source = this.map.getSource(this.id);
        if (source) source.setData(this.collection());
    }

    /**
     * @param {Array<{geometry, color, emoji, popupHtml}>} alerts
     */
    setAlerts(alerts) {
        this.alerts = alerts.map(a => ({ ...a, icon: createAlertIcon(a.color, a.emoji) }));
        this.closePopup();
        this.update();
    }

    clear() {
        this.setAlerts([]);
    }

    show() {
        this.visible = true;
        this.applyVisibility();
    }

    hide() {
        this.visible = false;
        this.applyVisibility();
    }

    isVisible() {
        return this.visible;
    }

    applyVisibility() {
        if (!this.map) return;
        const v = this.visible ? 'visible' : 'none';
        for (const suffix of ['fill', 'line', 'point']) {
            if (this.map.getLayer(`${this.id}-${suffix}`)) {
                this.map.setLayoutProperty(`${this.id}-${suffix}`, 'visibility', v);
            }
        }
        if (!this.visible) this.closePopup();
    }

    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    /** Clickable layer ids (see the map click router in app.js) */
    get layerIds() {
        return [`${this.id}-point`, `${this.id}-fill`];
    }

    /** Handle a click on one of this layer's features */
    handleFeature(feature, lngLat) {
        const alert = this.alerts[feature.properties.i];
        if (!alert) return;
        this.closePopup();
        this.popup = new this.maplibregl.Popup({ maxWidth: '400px', className: 'warning-popup-container', focusAfterOpen: false })
            .setLngLat(lngLat)
            .setHTML(alert.popupHtml)
            .addTo(this.map);
    }
}

/**
 * Stack of radar raster frames. frames[i].setOpacity(o) mirrors the Leaflet
 * tile layer API the animation code uses.
 */
export class RadarFrames {
    constructor(prefix = 'radar') {
        this.prefix = prefix;
        this.map = null;
        this.ids = [];
    }

    /**
     * @param {object} map
     * @param {string[]} tileUrls  {z}/{x}/{y} templates, oldest first
     * @param {string} beforeId
     * @returns {Array<{setOpacity: Function}>}
     */
    add(map, tileUrls, beforeId, attribution) {
        this.remove();
        this.map = map;
        return tileUrls.map((url, index) => {
            const id = `${this.prefix}-${index}`;
            map.addSource(id, {
                type: 'raster',
                tiles: [url],
                tileSize: 256,
                maxzoom: 10,
                attribution
            });
            map.addLayer({
                id,
                type: 'raster',
                source: id,
                paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 }
            }, beforeId);
            this.ids.push(id);
            return {
                setOpacity: (opacity) => {
                    if (this.map?.getLayer(id)) {
                        this.map.setPaintProperty(id, 'raster-opacity', opacity);
                    }
                }
            };
        });
    }

    remove() {
        if (!this.map) return;
        for (const id of this.ids) {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
            if (this.map.getSource(id)) this.map.removeSource(id);
        }
        this.ids = [];
    }
}
