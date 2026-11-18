import {Component, Property, ViewComponent} from '@wonderlandengine/api';

/**
 * Plays a looping sequence of camera shots with hard cuts.
 *
 * `shotsParent` is an object whose children are marker objects named
 * `Shot_<n>_Start` and `Shot_<n>_End`. Each shot moves the camera from the start
 * marker's world transform to the end marker's over `duration` seconds, then cuts to
 * the next shot. `exposures` is a comma separated list, one view exposure per shot.
 */
export class CameraSequence extends Component {
    static TypeName = 'camera-sequence';
    static Properties = {
        shotsParent: Property.object(),
        duration: Property.float(4.0),
        exposures: Property.string('1'),
    };

    init() {
        this.shot = 0;
        this._shots = [];
        this._t = 0;
        this._p0 = new Float32Array(3);
        this._p1 = new Float32Array(3);
        this._q0 = new Float32Array(4);
        this._q1 = new Float32Array(4);
        this._tmp = new Float32Array(3);
    }

    start() {
        const byName = {};
        for (const c of this.shotsParent.children) byName[c.name] = c;
        for (let i = 1; byName[`Shot_${i}_Start`]; ++i) {
            this._shots.push([byName[`Shot_${i}_Start`], byName[`Shot_${i}_End`] ?? byName[`Shot_${i}_Start`]]);
        }
        this._exp = this.exposures.split(',').map((s) => parseFloat(s) || 1);
        this._view = this.object.getComponent(ViewComponent);
    }

    update(dt) {
        const n = this._shots.length;
        if (!n) return;
        this._t += dt;
        const total = this._t / this.duration;
        const idx = Math.floor(total) % n;
        /** Current shot, 1-based; read by other components (e.g. shot-animation) */
        this.shot = idx + 1;
        let u = total - Math.floor(total);
        u = u * u * (3 - 2 * u);
        const [a, b] = this._shots[idx];
        a.getPositionWorld(this._p0);
        b.getPositionWorld(this._p1);
        a.getRotationWorld(this._q0);
        b.getRotationWorld(this._q1);
        const p = this._tmp;
        for (let i = 0; i < 3; ++i) p[i] = this._p0[i] + (this._p1[i] - this._p0[i]) * u;
        // normalised lerp, shortest path
        const q0 = this._q0, q1 = this._q1;
        const dot = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3];
        const s = dot < 0 ? -1 : 1;
        let len = 0;
        for (let i = 0; i < 4; ++i) {
            q0[i] = q0[i] + (s * q1[i] - q0[i]) * u;
            len += q0[i] * q0[i];
        }
        len = Math.sqrt(len) || 1;
        for (let i = 0; i < 4; ++i) q0[i] /= len;
        this.object.setPositionWorld(p);
        this.object.setRotationWorld(q0);
        if (this._view) this._view.exposure = this._exp[idx % this._exp.length] ?? 1;
    }
}
