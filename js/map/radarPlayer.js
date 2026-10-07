// ============================================================================
// RADAR PLAYER - Archived NEXRAD composite synced to a playback clock
// ============================================================================
//
// IEM keeps the national base-reflectivity composite (N0Q) for every 5-minute
// time, served as {z}/{x}/{y} tiles. A small pool of raster layers is reused:
// the frame for the playhead is shown once its tiles have loaded, and the next
// frames load (invisibly) ahead of it, so playback never flashes blank radar.

const FRAME_MS = 5 * 60 * 1000;
/** Newest frame to ask for: IEM publishes each composite a few minutes late */
const PUBLISH_DELAY_MS = 5 * 60 * 1000;
const ATTRIBUTION = 'Radar &copy; <a href="https://mesonet.agron.iastate.edu">Iowa Environmental Mesonet / NWS</a>';

function pad(n) {
    return String(n).padStart(2, '0');
}

export class RadarPlayer {
    /**
     * @param {object} [options]
     * @param {string} [options.prefix] source/layer id prefix
     * @param {number} [options.slots] frames kept loaded (current + look-ahead)
     * @param {number} [options.opacity] radar opacity when shown
     */
    constructor({ prefix = 'pb-radar', slots = 4, opacity = 0.45 } = {}) {
        this.prefix = prefix;
        this.opacity = opacity;
        this.map = null;
        this.enabled = true;
        this.slots = Array.from({ length: slots }, (_, i) => ({ id: `${prefix}-${i}`, frame: null, used: 0 }));
        this.current = null;
        this.clock = 0;
        this.request = 0;
    }

    /** 5-minute frame time at or before ms (never newer than IEM has published) */
    static frameTime(ms) {
        const newest = Date.now() - PUBLISH_DELAY_MS;
        return Math.floor(Math.min(ms, newest) / FRAME_MS) * FRAME_MS;
    }

    static tileUrl(frame) {
        const d = new Date(frame);
        const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
            `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
        return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${stamp}/{z}/{x}/{y}.png`;
    }

    addTo(map, beforeId) {
        this.map = map;
        for (const slot of this.slots) {
            map.addSource(slot.id, {
                type: 'raster',
                tiles: [RadarPlayer.tileUrl(RadarPlayer.frameTime(Date.now()))],
                tileSize: 256,
                maxzoom: 10,
                attribution: ATTRIBUTION
            });
            map.addLayer({
                id: slot.id,
                type: 'raster',
                source: slot.id,
                layout: { visibility: 'none' },
                paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 }
            }, beforeId);
        }
        return this;
    }

    /** Frame time currently on screen, or null */
    get shownFrame() {
        return this.current ? this.current.frame : null;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!this.map) return;
        if (!enabled) {
            for (const slot of this.slots) {
                this.map.setLayoutProperty(slot.id, 'visibility', 'none');
                slot.frame = null;
            }
            this.current = null;
        }
    }

    /** Slot holding frame (loading it into the least recently used free slot if needed) */
    assign(frame, keep) {
        let slot = this.slots.find(s => s.frame === frame);
        if (!slot) {
            const free = this.slots.filter(s => !keep.has(s));
            slot = free.reduce((a, b) => (a.used <= b.used ? a : b), free[0]);
            slot.frame = frame;
            this.map.getSource(slot.id).setTiles([RadarPlayer.tileUrl(frame)]);
            this.map.setPaintProperty(slot.id, 'raster-opacity', 0);
            this.map.setLayoutProperty(slot.id, 'visibility', 'visible');
        }
        slot.used = ++this.clock;
        keep.add(slot);
        return slot;
    }

    async waitLoaded(slot, timeoutMs) {
        const deadline = performance.now() + timeoutMs;
        // Let the source register its new tile requests before polling
        await new Promise(r => setTimeout(r, 60));
        while (performance.now() < deadline) {
            if (slot.frame === null) return false;
            try {
                if (this.map.isSourceLoaded(slot.id)) return true;
            } catch (e) {
                return false;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        return false;
    }

    /**
     * Show the radar frame for time ms and preload the frames for aheadMs.
     * @param {number} ms playhead time (epoch ms)
     * @param {object} [options]
     * @param {number[]} [options.aheadMs] times likely to be shown next
     * @param {number} [options.timeoutMs] how long to wait for tiles before showing anyway
     * @returns {Promise<number|null>} the frame time shown
     */
    async show(ms, { aheadMs = [], timeoutMs = 1500 } = {}) {
        if (!this.enabled || !this.map) return null;
        const request = ++this.request;
        const frame = RadarPlayer.frameTime(ms);
        const keep = new Set(this.current ? [this.current] : []);
        const slot = this.assign(frame, keep);
        for (const t of aheadMs) {
            const f = RadarPlayer.frameTime(t);
            if (f !== frame && keep.size < this.slots.length) this.assign(f, keep);
        }
        if (slot !== this.current) {
            await this.waitLoaded(slot, timeoutMs);
            // A newer request (fast scrubbing) wins; never show a stale frame over it
            if (!this.enabled || slot.frame !== frame || request !== this.request) return this.shownFrame;
            this.map.setPaintProperty(slot.id, 'raster-opacity', this.opacity);
            if (this.current && this.current !== slot && this.current.frame !== null) {
                this.map.setPaintProperty(this.current.id, 'raster-opacity', 0);
            }
            this.current = slot;
        }
        return frame;
    }
}
