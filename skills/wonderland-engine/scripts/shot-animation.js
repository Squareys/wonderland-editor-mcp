import { AnimationComponent, Component, Property } from "@wonderlandengine/api";

/**
 * Crossfades a character between its idle and action animation depending on
 * the current shot of a `camera-sequence`.
 *
 * Put it on the object with the `animation` component. That component must use
 * blendType "blend1D" with blendAnimations [idle, action]: the editor then
 * generates an animation graph with a float parameter "blendFactor"
 * (0 = idle, 1 = action), which this component animates.
 */
export class ShotAnimation extends Component {
    static TypeName = "shot-animation";
    static Properties = {
        /** Object with the camera-sequence component */
        sequence: Property.object(),
        /** Comma separated 1-based shot numbers in which the action plays */
        actionShots: Property.string(""),
        /** Crossfade duration (s) */
        fade: Property.float(0.5),
    };

    start() {
        this._anim = this.object.getComponent(AnimationComponent);
        this._seq = this.sequence?.getComponent("camera-sequence") ?? null;
        this._shots = new Set(
            this.actionShots
                .split(",")
                .map((s) => parseInt(s, 10))
                .filter((n) => !Number.isNaN(n))
        );
        this._blend = 0;
        if (!this._anim) console.warn("[shot-animation] no animation component on", this.object.name);
        if (!this._seq) console.warn("[shot-animation] no camera-sequence on", this.sequence?.name);
    }

    update(dt) {
        if (!this._anim || !this._seq) return;
        const target = this._shots.has(this._seq.shot) ? 1 : 0;
        const step = this.fade > 0 ? dt / this.fade : 1;
        this._blend += Math.max(-step, Math.min(step, target - this._blend));
        try {
            this._anim.setFloatParameter("blendFactor", this._blend);
        } catch (e) {
            /* No blend graph: the animation component is not set to blend1D */
            console.warn("[shot-animation]", this.object.name, e);
            this._anim = null;
        }
    }
}
